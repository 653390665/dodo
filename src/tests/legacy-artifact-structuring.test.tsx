import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LegacyArtifactStructuringPrompt } from '../components/LegacyArtifactStructuringPrompt';
import type { LegacyArtifactSource } from '../../shared/types/legacy-artifact-structuring';

const source: LegacyArtifactSource = {
  novelId: 'novel-1', artifactKind: 'world', artifactId: 'novel-1', label: '世界观',
  originalContent: '世界规则原文', artifactVersion: 0, sourceFingerprint: 'fingerprint-1',
};
const changedSource = { ...source, originalContent: '更新后的世界规则', sourceFingerprint: 'fingerprint-2' };

describe('LegacyArtifactStructuringPrompt', () => {
  let discoverySources: LegacyArtifactSource[];
  let previewFails: boolean;

  beforeEach(() => {
    localStorage.clear();
    discoverySources = [source];
    previewFails = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.endsWith('/legacy-artifacts')) {
        return Response.json({ sources: discoverySources, databaseGeneration: 7 });
      }
      if (url.endsWith('/legacy-artifacts/preview')) {
        if (previewFails) return Response.json({ code: 'INVALID', error: '预览失败' }, { status: 422 });
        return Response.json({
          preview: { previewId: 'preview-1', source, proposedCore: { schemaVersion: 1, hardRules: [{ id: 'rule-1', statement: '不可飞' }] }, expiresAt: Date.now() + 60_000 },
          databaseGeneration: 7,
        });
      }
      if (url.endsWith('/legacy-artifacts/confirm')) return Response.json({ status: 'accepted', version: 1 });
      return Response.json({ error: 'unexpected request' }, { status: 500 });
    }));
  });

  test('does not request on mount and runs discovery, preview, then confirmation explicitly', async () => {
    render(<LegacyArtifactStructuringPrompt novelId="novel-1" />);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '检查旧产物' }));
    expect(await screen.findByRole('option', { name: '世界观' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/preview'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: '生成结构化预览' }));
    expect(await screen.findByText('世界规则原文')).toBeTruthy();
    expect(screen.getByText(/hardRules/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认结构化版本' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/novels/novel-1/legacy-artifacts/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ previewId: 'preview-1', databaseGeneration: 7 }) }),
    ));
    expect(await screen.findByText('结构化版本已确认')).toBeTruthy();
  });

  test('keeps confirmation unavailable after preview failure', async () => {
    previewFails = true;
    render(<LegacyArtifactStructuringPrompt novelId="novel-1" />);
    fireEvent.click(screen.getByRole('button', { name: '检查旧产物' }));
    await screen.findByRole('option', { name: '世界观' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化预览' }));
    expect(await screen.findByText('预览失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认结构化版本' })).toBeNull();
  });

  test('dismisses only the current fingerprint and shows a changed source again', async () => {
    render(<LegacyArtifactStructuringPrompt novelId="novel-1" />);
    fireEvent.click(screen.getByRole('button', { name: '检查旧产物' }));
    await screen.findByRole('option', { name: '世界观' });
    fireEvent.click(screen.getByRole('button', { name: '暂不处理' }));
    expect(screen.queryByRole('option', { name: '世界观' })).toBeNull();
    expect(localStorage.getItem('inkflow-legacy-structuring-dismissals:novel-1')).toContain('fingerprint-1');

    discoverySources = [changedSource];
    fireEvent.click(screen.getByRole('button', { name: '检查旧产物' }));
    expect(await screen.findByRole('option', { name: '世界观' })).toBeTruthy();
  });
});
