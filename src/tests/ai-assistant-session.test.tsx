import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AssistantLaunchContext, Novel } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  listNovels: vi.fn().mockResolvedValue([]),
  subscribeToChanges: vi.fn().mockReturnValue(() => {}),
  generateInspiration: vi.fn(),
  extractWorldSetupPhase: vi.fn(),
  importWorldExtraction: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({ listNovels: mocks.listNovels }));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: mocks.subscribeToChanges }));
vi.mock('../lib/prompt-client', () => ({ generateInspiration: mocks.generateInspiration }));
vi.mock('../lib/agents', () => ({ extractWorldSetupPhase: mocks.extractWorldSetupPhase }));
vi.mock('../lib/world-client', () => ({ importWorldExtraction: mocks.importWorldExtraction }));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: vi.fn().mockResolvedValue(undefined) }));

import { AIAssistant } from '../components/AIAssistant';
import { useAssistantSessionStore } from '../stores/assistant-session-store';

const novelA: Novel = { id: 'novel-a', title: '作品 A', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 };
const novelB: Novel = { id: 'novel-b', title: '作品 B', authorId: 'local', summary: '', status: 'ongoing', createdAt: 2, updatedAt: 2 };
const launchContext: AssistantLaunchContext = { source: 'workspace', novelId: novelA.id, novelTitle: novelA.title, intent: '补一段冲突' };

describe('AIAssistant general session', () => {
  beforeEach(() => {
    useAssistantSessionStore.getState().clearSession(novelA.id, 'general');
    useAssistantSessionStore.getState().clearSession(novelB.id, 'general');
    mocks.generateInspiration.mockReset();
    mocks.generateInspiration.mockResolvedValue('默认响应');
    mocks.listNovels.mockReset();
    mocks.listNovels.mockResolvedValue([novelA, novelB]);
    mocks.extractWorldSetupPhase.mockReset();
    mocks.importWorldExtraction.mockReset();
    mocks.importWorldExtraction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('按作品隔离并在关闭重挂后保留输入和消息', async () => {
    const view = render(<AIAssistant activeNovel={novelA} />);
    const input = screen.getByPlaceholderText('创作困惑？');

    fireEvent.change(input, { target: { value: 'A 的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getByText('默认响应')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: 'A 待续输入' } });

    view.rerender(<AIAssistant activeNovel={novelB} />);
    expect(screen.queryByText('A 的问题')).toBeNull();
    expect(screen.queryByText('默认响应')).toBeNull();
    expect((screen.getByPlaceholderText('创作困惑？') as HTMLInputElement).value).toBe('');

    view.unmount();
    render(<AIAssistant activeNovel={novelA} />);
    expect(screen.getByDisplayValue('A 待续输入')).toBeTruthy();
    expect(screen.getByText('默认响应')).toBeTruthy();
  });

  test('作品切换或卸载会取消请求，迟到结果不会写入新作品', async () => {
    const resolvers: Array<(value: string) => void> = [];
    mocks.generateInspiration.mockImplementation(() => new Promise<string>((resolve) => { resolvers.push(resolve); }));

    const view = render(<AIAssistant activeNovel={novelA} />);
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: 'A 请求' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mocks.generateInspiration).toHaveBeenCalled());

    const signal = mocks.generateInspiration.mock.calls[0]?.[3] as AbortSignal | undefined;
    view.rerender(<AIAssistant activeNovel={novelB} />);
    expect(signal?.aborted).toBe(true);

    await act(async () => { resolvers[0]?.('A 迟到响应'); });
    expect(screen.queryByText('A 迟到响应')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: 'A 卸载请求' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mocks.generateInspiration).toHaveBeenCalledTimes(2));
    const unmountSignal = mocks.generateInspiration.mock.calls[1]?.[3] as AbortSignal | undefined;
    view.unmount();
    expect(unmountSignal?.aborted).toBe(true);
  });

  test('相同 launchContext 关闭重挂后保留已有消息和输入', async () => {
    const view = render(<AIAssistant activeNovel={novelA} launchContext={launchContext} />);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getByText('默认响应')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: '继续追问' } });

    view.unmount();
    render(<AIAssistant activeNovel={novelA} launchContext={launchContext} />);
    expect(screen.getByText('默认响应')).toBeTruthy();
    expect(screen.getByDisplayValue('继续追问')).toBeTruthy();
  });

  test('作品层助手不显示需要章节的正文和分镜入口', () => {
    render(<AIAssistant activeNovel={novelA} launchContext={launchContext} />);

    expect(screen.queryByRole('button', { name: '创作当前章节' })).toBeNull();
    expect(screen.queryByRole('button', { name: '规划本章分镜' })).toBeNull();
    expect(screen.getByRole('button', { name: '完善作品设定' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建第一章并开始创作' })).toBeTruthy();
  });

  test('正文候选必须二次确认后才写入章节', async () => {
    const onApplyToContent = vi.fn();
    mocks.generateInspiration.mockResolvedValueOnce('候选正文内容');
    render(<AIAssistant
      activeNovel={novelA}
      launchContext={{ ...launchContext, chapterId: 'chapter-a', chapterTitle: '第一章' }}
      onApplyToContent={onApplyToContent}
    />);

    fireEvent.click(screen.getByRole('button', { name: '创作当前章节' }));
    await waitFor(() => expect(screen.getByText('候选正文内容')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '预览正文候选' }));

    expect(onApplyToContent).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认应用创作候选' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认写入正文' }));
    expect(onApplyToContent).toHaveBeenCalledWith('候选正文内容');
  });

  test('设定建议交给推荐能力生成候选，不直接导入 Canon', async () => {
    const onLaunchSettingCandidate = vi.fn();
    mocks.generateInspiration.mockResolvedValueOnce('规则：月蚀时不能点灯。');
    render(<AIAssistant
      activeNovel={novelA}
      launchContext={launchContext}
      onLaunchSettingCandidate={onLaunchSettingCandidate}
    />);

    fireEvent.click(screen.getByRole('button', { name: '完善作品设定' }));
    await waitFor(() => expect(screen.getByText('规则：月蚀时不能点灯。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '使用推荐能力生成设定候选' }));

    expect(onLaunchSettingCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'build-setting', recommendedCapabilityId: 'bible-world-builder', scope: 'project' }),
      '规则：月蚀时不能点灯。',
    );
    expect(mocks.extractWorldSetupPhase).not.toHaveBeenCalled();
    expect(mocks.importWorldExtraction).not.toHaveBeenCalled();
  });

  test('开始创作把作品目标交给完整流程', () => {
    const onStartCreation = vi.fn();
    render(<AIAssistant activeNovel={novelA} launchContext={launchContext} onStartCreation={onStartCreation} />);

    fireEvent.click(screen.getByRole('button', { name: '创建第一章并开始创作' }));

    expect(onStartCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'start-creation',
        executionMode: 'workflow',
        recommendedCapabilityId: 'generic-novel-flow',
        userRequest: '补一段冲突',
      }),
      undefined,
    );
  });

  test('作品切换后迟到的设定提取不会导入或更新新作品', async () => {
    let resolveExtraction: ((value: { result: Record<string, unknown>; databaseGeneration: number }) => void) | undefined;
    mocks.extractWorldSetupPhase.mockImplementation((_content: string, _novelId: string, onProgress: (progress: number, status: string) => void, signal: AbortSignal) => {
      onProgress(30, '处理中');
      return new Promise((resolve) => {
        resolveExtraction = resolve;
        signal.addEventListener('abort', () => undefined);
      });
    });

    const view = render(<AIAssistant activeNovel={novelA} launchContext={launchContext} />);
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: '提取这段设定' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getByText('默认响应')).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText('更多操作')[0]);
    fireEvent.click(screen.getAllByText('提取到其他作品')[0]);
    fireEvent.click(screen.getByRole('button', { name: novelA.title }));
    await waitFor(() => expect(mocks.extractWorldSetupPhase).toHaveBeenCalled());

    view.rerender(<AIAssistant activeNovel={novelB} />);

    await act(async () => {
      resolveExtraction?.({ result: { characters: [{ name: '迟到角色' }] }, databaseGeneration: 1 });
    });
    expect(mocks.importWorldExtraction).not.toHaveBeenCalled();
    expect(screen.queryByText(/已解析/)).toBeNull();
  });

  test('空字符串响应显示结构化 no_content 诊断信息', async () => {
    mocks.generateInspiration.mockResolvedValueOnce('');
    render(<AIAssistant activeNovel={novelA} />);
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: '请求灵感' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('模型未返回内容'));
    expect(screen.getByRole('alert').textContent).toContain('no_content');
  });

  test('服务端 reason、finishReason、traceId 在告警中可见且不暴露 prompt', async () => {
    mocks.generateInspiration.mockRejectedValueOnce(Object.assign(new Error('模型响应为空'), {
      code: 'empty_response', reason: 'length_exhausted', finishReason: 'length', traceId: 'trace-ai-1', retriable: false,
    }));
    render(<AIAssistant activeNovel={novelA} />);
    fireEvent.change(screen.getByPlaceholderText('创作困惑？'), { target: { value: '私密提示词' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('输出因长度限制结束'));
    const alert = screen.getByRole('alert').textContent || '';
    expect(alert).toContain('finishReason: length');
    expect(alert).toContain('诊断编号：trace-ai-1');
    expect(alert).not.toContain('私密提示词');
    expect(screen.getByRole('button', { name: '重试本次请求' })).toBeTruthy();
    expect((screen.getByPlaceholderText('创作困惑？') as HTMLInputElement).value).toBe('私密提示词');
  });
});
