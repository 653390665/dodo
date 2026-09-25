/**
 * Plan 262 B1 · 质量标准面板的净增回执（GuardrailPolicyPanel）。
 *
 * 覆盖：①core-default 声明回执为「无净增」并给出原因；②引用壳（square-13）同样回执；
 * ③不可用 id 单独列出；④无条目时不渲染该区块；⑤增强护栏开关仍可切换；⑥默认护栏仍只读展示。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GuardrailPolicyPanel } from '../components/skills/GuardrailPolicyPanel';
import {
  getConfigurableGuardrailAssets,
  getCoreDefaultGuardrailCount,
  getGuardrailSelectionAudit,
} from '../lib/capability-governance';

afterEach(cleanup);

const enhanced = getConfigurableGuardrailAssets();

function renderPanel(enabledIds: string[], onToggle = vi.fn()) {
  render(
    <GuardrailPolicyPanel
      enhancedGuardrails={enhanced}
      enabledIds={enabledIds}
      audit={getGuardrailSelectionAudit(enabledIds)}
      onToggle={onToggle}
      onClose={() => {}}
    />
  );
  return onToggle;
}

describe('GuardrailPolicyPanel · 净增审计回执', () => {
  test('core-default 与引用壳回执为无净增，不可用 id 单独列出', () => {
    renderPanel(['core-slop-shield', 'square-13', 'ghost-guardrail']);

    expect(screen.getByTestId('guardrail-audit')).toBeTruthy();
    expect(screen.getByText(/已声明但未产生净增（3）/)).toBeTruthy();

    expect(
      screen.getByTestId('guardrail-redundant-entry-core-slop-shield').textContent
    ).toMatch(/默认已生效/);
    expect(
      screen.getByTestId('guardrail-redundant-entry-square-13').textContent
    ).toMatch(/引用壳/);
    expect(
      screen.getByTestId('guardrail-unusable-entry-ghost-guardrail').textContent
    ).toMatch(/不可用/);
  });

  test('没有无净增/不可用条目时不渲染审计区块', () => {
    renderPanel(['de-ai-tells-guard']);
    expect(screen.queryByTestId('guardrail-audit')).toBeNull();
  });

  test('审计与两侧目录同源：可选 9 张里 square-13/square-3 被判为引用壳', () => {
    const ids = enhanced.map((asset) => asset.id);
    expect(ids).toContain('de-ai-tells-guard');
    expect(ids).toContain('square-13');

    const audit = getGuardrailSelectionAudit(ids);
    expect(audit.selectable).toEqual([
      'private-162',
      'private-130',
      'private-101',
      'private-100',
      'private-86',
      'private-85',
      'de-ai-tells-guard',
    ]);
    expect(audit.redundant.map((entry) => entry.id)).toEqual(['square-13', 'square-3']);
    expect(audit.unusable).toEqual([]);
  });

  test('默认护栏只读展示，增强护栏开关仍可切换', () => {
    const card = enhanced.find((asset) => asset.id === 'de-ai-tells-guard');
    expect(card).toBeTruthy();
    const onToggle = renderPanel([]);

    expect(screen.getByText(`默认护栏（${getCoreDefaultGuardrailCount()}）`)).toBeTruthy();
    expect(screen.getAllByText('已自动生效').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: `开启增强护栏：${card!.title}` }));
    expect(onToggle).toHaveBeenCalledWith(card, true);
  });
});
