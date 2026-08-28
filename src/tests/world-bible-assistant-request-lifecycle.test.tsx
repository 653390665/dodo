import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Novel } from '../../shared/types';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';
import { WorldBibleAssistant } from '../components/WorldBibleAssistant';

const listMocks = vi.hoisted(() => ({
  listCharacters: vi.fn().mockResolvedValue([]), listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]), listFactions: vi.fn().mockResolvedValue([]),
  listPowerLevels: vi.fn().mockResolvedValue([]), listTimelineEvents: vi.fn().mockResolvedValue([]),
  createCharacter: vi.fn(), createLocation: vi.fn(), createItem: vi.fn(), createFaction: vi.fn(),
  createPowerLevel: vi.fn(), createTimelineEvent: vi.fn(),
}));
vi.mock('../lib/world-client', () => listMocks);
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: vi.fn().mockResolvedValue(undefined) }));

describe('WorldBibleAssistant request lifecycle', () => {
  const novelA = { id: 'novel-a', title: 'A' } as Novel;
  const novelB = { id: 'novel-b', title: 'B' } as Novel;
  let fetchMock: ReturnType<typeof vi.fn>;
  let readPending: Promise<never>;

  beforeEach(() => {
    useNovelStore.setState({ selectedNovel: novelA });
    useAssistantSessionStore.getState().clearSession(novelA.id, 'bible');
    useAssistantSessionStore.getState().clearSession(novelB.id, 'bible');
    readPending = new Promise(() => {});
    fetchMock = vi.fn().mockImplementation((url: string) => url === '/api/db/generation'
      ? Promise.resolve(Response.json({ databaseGeneration: 0 }))
      : Promise.resolve({
        ok: true,
        headers: new Headers({ 'x-inkflow-database-generation': '0' }),
        body: { getReader: () => ({ read: () => readPending }) },
      }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('消息追加不会中止请求，切换作品和卸载会中止', async () => {
    const view = render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '创建人物' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const inspirationCall = fetchMock.mock.calls.find((call) => call[0] === '/api/inspiration');
    const signal = inspirationCall?.[1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.rerender(<WorldBibleAssistant novel={novelB} onClose={vi.fn()} />);
    expect(signal.aborted).toBe(true);
    expect(useAssistantSessionStore.getState().getSession(novelA.id, 'bible').isLoading).toBe(false);
    view.unmount();

    useNovelStore.setState({ selectedNovel: novelB });
    const second = render(<WorldBibleAssistant novel={novelB} onClose={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('textbox', { name: '输入设定灵感' }).at(-1)!, { target: { value: '继续' } });
    fireEvent.click(screen.getAllByRole('button', { name: '发送设定灵感' }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const secondCall = fetchMock.mock.calls.filter((call) => call[0] === '/api/inspiration').at(-1)!;
    const secondSignal = secondCall[1].signal as AbortSignal;
    second.unmount();
    expect(secondSignal.aborted).toBe(true);
  });

  test('清空对话会取消请求，迟到的 token 不得回写新会话', async () => {
    let releaseRead: ((result: { value: Uint8Array; done: boolean }) => void) | undefined;
    const reader = {
      read: () => new Promise<{ value: Uint8Array; done: boolean }>(resolve => { releaseRead = resolve; }),
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ databaseGeneration: 0 }),
    }).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'x-inkflow-database-generation': '0' }),
      body: { getReader: () => reader },
    });
    render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '创建人物' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const signal = fetchMock.mock.calls.find((call) => call[0] === '/api/inspiration')?.[1].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '清空对话历史' }));
    expect(signal.aborted).toBe(true);
    expect(useAssistantSessionStore.getState().getSession(novelA.id, 'bible').isLoading).toBe(false);

    releaseRead?.({
      value: new TextEncoder().encode('data: {"token":"迟到内容 [JSON_DATA]{\\"type\\":\\"character\\",\\"data\\":{\\"name\\":\\"迟到人物\\"}}[\\/JSON_DATA]"}\n\n'),
      done: false,
    });
    await waitFor(() => {
      const session = useAssistantSessionStore.getState().getSession(novelA.id, 'bible');
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].id).toBe('welcome');
      expect(session.draft).toBeNull();
      expect(session.isLoading).toBe(false);
    });
  });

  test('上下文加载未完成时清空，不应在列表迟到后发起请求', async () => {
    let releaseLists: (() => void) | undefined;
    const listsPending = new Promise<void>(resolve => { releaseLists = resolve; });
    for (const listMock of [
      listMocks.listCharacters, listMocks.listLocations, listMocks.listItems,
      listMocks.listFactions, listMocks.listPowerLevels, listMocks.listTimelineEvents,
    ]) listMock.mockReturnValueOnce(listsPending.then(() => []));

    render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '创建人物' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(useAssistantSessionStore.getState().getSession(novelA.id, 'bible').isLoading).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '清空对话历史' }));
    releaseLists?.();
    await waitFor(() => expect(useAssistantSessionStore.getState().getSession(novelA.id, 'bible').isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('inspiration 非 2xx 时显示服务端 error/code，保留输入并支持再次发送', async () => {
    const successfulBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"token":"已生成建议"}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 0 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '灵感服务暂不可用', code: 'INSPIRATION_UNAVAILABLE' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 0 }))
      .mockResolvedValueOnce(new Response(successfulBody, {
        status: 200,
        headers: { 'x-inkflow-database-generation': '0' },
      }));

    render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    const textbox = screen.getByRole('textbox', { name: '输入设定灵感' });
    fireEvent.change(textbox, { target: { value: '创建人物' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('灵感服务暂不可用');
      expect(screen.getByRole('alert').textContent).toContain('INSPIRATION_UNAVAILABLE');
    });
    expect(screen.getByRole('log').textContent).not.toContain('INSPIRATION_UNAVAILABLE');
    expect((textbox as HTMLTextAreaElement).value).toBe('创建人物');

    fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  test('配置错误显示打开设置且不提供重试', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 0 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '缺少模型配置', code: 'configuration', retriable: false }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    }));
    const openSettings = vi.fn();
    window.addEventListener('open-settings', openSettings);
    render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '创建人物' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('缺少模型配置'));
    expect(screen.queryByRole('button', { name: '重试本次请求' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    window.removeEventListener('open-settings', openSettings);
  });

  test('服务端 reason、finishReason、traceId 在世界设定告警中可见', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 0 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
      error: '模型响应为空', code: 'empty_response', reason: 'reasoning_only', finishReason: 'stop', traceId: 'trace-bible-1', retriable: false,
    }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    render(<WorldBibleAssistant novel={novelA} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '私密设定提示' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('只返回了推理过程'));
    const alert = screen.getByRole('alert').textContent || '';
    expect(alert).toContain('finishReason: stop');
    expect(alert).toContain('诊断编号：trace-bible-1');
    expect(alert).not.toContain('私密设定提示');
    expect(screen.getByRole('button', { name: '重试本次请求' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '输入设定灵感' }) as HTMLTextAreaElement).value).toBe('私密设定提示');
  });
});
