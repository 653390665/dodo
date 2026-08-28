import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Novel } from '../../shared/types';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';

const mocks = vi.hoisted(() => ({
  listCharacters: vi.fn().mockResolvedValue([]),
  listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]),
  listFactions: vi.fn().mockResolvedValue([]),
  listPowerLevels: vi.fn().mockResolvedValue([]),
  listTimelineEvents: vi.fn().mockResolvedValue([]),
  createCharacter: vi.fn(), createLocation: vi.fn(), createItem: vi.fn(),
  createFaction: vi.fn(), createPowerLevel: vi.fn(), createTimelineEvent: vi.fn(),
  syncPackToWorld: vi.fn(),
  listContinuationPacks: vi.fn().mockResolvedValue([]),
  previewConfirm: vi.fn(),
}));

vi.mock('../lib/world-client', () => ({ ...mocks }));
vi.mock('../lib/db-transport', () => ({
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
  requireResponseDatabaseGeneration: vi.fn((response: Response) => {
    const generation = Number(response.headers.get('x-inkflow-database-generation'));
    if (!Number.isInteger(generation) || generation < 0) throw new Error('Server response is missing a valid database generation');
    return generation;
  }),
}));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/continuation-client', () => ({
  syncPackToWorld: (...args: unknown[]) => mocks.syncPackToWorld(...args),
  listContinuationPacks: (...args: unknown[]) => mocks.listContinuationPacks(...args),
}));
vi.mock('../components/world-bible/SyncPreviewPanel', () => ({
  SyncPreviewPanel: ({ onConfirm }: { onConfirm: (selections: Record<string, unknown>) => void }) => (
    <button type="button" aria-label="模拟确认同步预览" onClick={() => onConfirm({
      characters: [{ name: '批量人物', role: 'supporting', summary: '', bio: '', traits: [] }],
      locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
    })}>模拟确认同步预览</button>
  ),
}));

import { WorldBibleAssistant } from '../components/WorldBibleAssistant';

const novel: Novel = { id: 'novel-batch', title: '批量测试', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 };

function streamResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ token: text })}\n\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'x-inkflow-database-generation': '7' } });
}

function incompleteStreamResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ token: text })}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'x-inkflow-database-generation': '7' } });
}

function errorStreamResponse(error: string, code: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error, code })}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'x-inkflow-database-generation': '7' } });
}

function renderBatch(continuationPackId = 'pack-batch-1') {
  return render(<WorldBibleAssistant novel={novel} continuationPackId={continuationPackId || undefined} onClose={vi.fn()} />);
}

async function submitReply(reply: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '处理资料包中的设定' } });
  fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
  await waitFor(() => expect(screen.getByRole('log').textContent).toContain(reply));
}

async function submitCustomReply(input: string, reply: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: input } });
  fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
  await waitFor(() => expect(screen.getByRole('log').textContent).toContain(reply));
}

describe('WorldBibleAssistant continuation batch sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncPackToWorld.mockResolvedValue({
      created: { characters: 1, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 },
      skipped: { characters: 0, locations: 0, items: 0, factions: 0, relationships: 0 },
      syncState: 'synced',
    });
    useNovelStore.setState({ selectedNovel: novel });
    useAssistantSessionStore.getState().clearSession(novel.id, 'bible');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAssistantSessionStore.getState().clearSession(novel.id, 'bible');
  });

  test('普通批量回复不直接写库，并显示后续冲突检查入口', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let requestBody: { purpose?: string } | undefined;
    fetchMock.mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
      requestBody = JSON.parse(init?.body || '{}') as { purpose?: string };
      return streamResponse('已整理资料包中的人物与地点，等待冲突检查。');
    });
    renderBatch();
    await submitReply('等待冲突检查');
    expect(requestBody?.purpose).toBe('world-bible');
    expect(screen.getByRole('button', { name: '检查冲突并准备写入' })).toBeTruthy();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
    expect(mocks.createCharacter).not.toHaveBeenCalled();
    expect(mocks.createLocation).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.createFaction).not.toHaveBeenCalled();
  });

  test('批量提取请求保持独立 purpose，不按正文生成额度计费', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const purposes: string[] = [];
    fetchMock
      .mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
        purposes.push((JSON.parse(init?.body || '{}') as { purpose?: string }).purpose || '');
        return streamResponse('待检查的批量回复');
      })
      .mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
        purposes.push((JSON.parse(init?.body || '{}') as { purpose?: string }).purpose || '');
        return streamResponse(JSON.stringify({ characters: [{ name: '批量人物' }] }));
      });
    renderBatch();
    await submitReply('待检查的批量回复');
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '模拟确认同步预览' })).toBeTruthy());
    expect(purposes).toEqual(['world-bible', 'sync-extraction']);
  });

  test('大量既有设定会压缩为受限上下文，不触发 inspiration 请求长度校验', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    mocks.listCharacters.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({
      id: `character-${index}`, name: `人物${index}`, role: 'supporting', summary: '很长的背景'.repeat(500),
      traits: ['谨慎'], bio: '很长的小传'.repeat(500), current_state: '存活', novelId: novel.id,
    })));
    let requestBody: { prompt?: string } | undefined;
    fetchMock.mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
      requestBody = JSON.parse(init?.body || '{}') as { prompt?: string };
      return streamResponse('已整理，等待冲突检查。');
    });
    renderBatch();
    await submitReply('已整理，等待冲突检查。');
    expect(requestBody?.prompt?.length).toBeLessThan(200_000);
  });

  test('批量回复结构化解析失败时保留可操作草稿状态，不显示无效设定误导文案', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(streamResponse('[JSON_DATA]{"type":"character","data":[/JSON_DATA]'));
    renderBatch();
    await submitReply('结构化设定解析未完成');
    expect(screen.queryByText('抱歉，我未能生成有效的设定数据，请重新描述。')).toBeNull();
    expect(screen.getByRole('button', { name: '检查冲突并准备写入' })).toBeTruthy();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('未传 continuationPackId 时按用户资料包标题匹配唯一 pack 并显示检查入口', async () => {
    mocks.listContinuationPacks.mockResolvedValueOnce([{ id: 'pack-from-title', title: '批量资料包', novelId: novel.id, status: 'approved' }]);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(streamResponse('资料包整理完成，等待冲突审查。'));
    renderBatch('');
    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '处理资料包《批量资料包》中的设定' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('资料包整理完成'));
    expect(screen.getByRole('button', { name: '检查冲突并准备写入' })).toBeTruthy();
    expect(mocks.listContinuationPacks).toHaveBeenCalledWith(novel.id);
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('提取失败显示未知状态，不调用同步或 create*', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('批量普通回复'));
    renderBatch();
    await submitReply('批量普通回复');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: '提取服务不可用' }), { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByText(/冲突检查状态未知/)).toBeTruthy());
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
    expect(mocks.createCharacter).not.toHaveBeenCalled();
    expect(mocks.createLocation).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.createFaction).not.toHaveBeenCalled();
  });

  test('首次解析失败后使用压缩重试，二次仍截断则阻止同步', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const prompts: string[] = [];
    fetchMock
      .mockResolvedValueOnce(streamResponse('批量普通回复'))
      .mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
        prompts.push((JSON.parse(init?.body || '{}') as { prompt?: string }).prompt || '');
        return incompleteStreamResponse('{"characters":[{"name":"批量人物"');
      })
      .mockImplementationOnce(async (_input: string, init?: { body?: string }) => {
        prompts.push((JSON.parse(init?.body || '{}') as { prompt?: string }).prompt || '');
        return incompleteStreamResponse('{"characters":[{"name":"批量人物"');
      });
    renderBatch();
    await submitReply('批量普通回复');
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByText(/冲突检查状态未知/)).toBeTruthy());
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('压缩重试模式');
    expect(prompts[1]).toContain('压缩重试模式');
    expect(screen.queryByRole('button', { name: '模拟确认同步预览' })).toBeNull();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('最新请求失败后不复用旧回复准备同步', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(streamResponse('第一条可同步回复'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '模型暂不可用', code: 'service_unavailable' }), { status: 503 }));
    renderBatch();
    await submitReply('第一条可同步回复');
    expect(screen.getByRole('button', { name: '检查冲突并准备写入' })).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: '输入设定灵感' }), { target: { value: '生成第二条回复' } });
    fireEvent.click(screen.getByRole('button', { name: '发送设定灵感' }));
    await waitFor(() => expect(screen.getByRole('alert', { name: '助手请求失败' }).textContent).toContain('模型暂不可用'));

    expect(screen.queryByRole('button', { name: '检查冲突并准备写入' })).toBeNull();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('配置错误不重复消耗模型请求，并提供打开设置入口', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('待检查的批量回复'));
    renderBatch();
    await submitReply('待检查的批量回复');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: '模型配置不可用，请检查设置', code: 'configuration' }), { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByText(/模型配置不可用/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '打开设置检查模型配置' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('SSE 配置错误保留错误码并提供设置入口', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('待检查的批量回复'));
    renderBatch();
    await submitReply('待检查的批量回复');
    fetchMock.mockResolvedValueOnce(errorStreamResponse('模型配置不可用，请检查设置', 'configuration'));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByText(/模型配置不可用/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '打开设置检查模型配置' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('没有完成标记的部分结果不得进入同步预览', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('待检查的批量回复'));
    renderBatch();
    await submitReply('待检查的批量回复');
    const partial = JSON.stringify({ characters: [{ name: '不完整人物' }] });
    fetchMock.mockResolvedValueOnce(incompleteStreamResponse(partial));
    fetchMock.mockResolvedValueOnce(incompleteStreamResponse(partial));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByText(/生成连接提前结束/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('button', { name: '模拟确认同步预览' })).toBeNull();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('提取成功后只有预览确认触发 syncPackToWorld，并携带版本上下文', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('可继续检查冲突'));
    renderBatch();
    await submitReply('可继续检查冲突');
    fetchMock.mockResolvedValueOnce(streamResponse(JSON.stringify({ characters: [{ name: '批量人物', role: 'supporting', summary: '', bio: '', traits: [] }] })));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '模拟确认同步预览' })).toBeTruthy());
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '模拟确认同步预览' }));
    await waitFor(() => expect(mocks.syncPackToWorld).toHaveBeenCalledTimes(1));
    expect(mocks.syncPackToWorld).toHaveBeenCalledWith(expect.objectContaining({
      packId: 'pack-batch-1', novelId: novel.id, databaseGeneration: 7,
      characters: [{ name: '批量人物', role: 'supporting', summary: '', bio: '', traits: [] }],
    }));
    expect(mocks.createCharacter).not.toHaveBeenCalled();
  });

  test('服务端同步失败时不回退到逐条 create* 写入', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streamResponse('待检查的批量回复'));
    renderBatch();
    await submitReply('待检查的批量回复');
    fetchMock.mockResolvedValueOnce(streamResponse(JSON.stringify({ characters: [{ name: '批量人物' }] })));
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '模拟确认同步预览' })).toBeTruthy());
    mocks.syncPackToWorld.mockRejectedValueOnce(new Error('同步服务失败'));
    fireEvent.click(screen.getByRole('button', { name: '模拟确认同步预览' }));
    await waitFor(() => expect(mocks.syncPackToWorld).toHaveBeenCalledTimes(1));
    expect(mocks.createCharacter).not.toHaveBeenCalled();
    expect(mocks.createLocation).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.createFaction).not.toHaveBeenCalled();
  });

  test('新回复提交会取消进行中的旧提取，旧结果不得显示为可同步预览', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let extractionAborted = false;
    fetchMock
      .mockResolvedValueOnce(streamResponse('第一条批量回复'))
      .mockImplementationOnce((_: string, options?: { signal?: AbortSignal }) => new Promise<Response>((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          extractionAborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      }))
      .mockResolvedValueOnce(streamResponse('第二条批量回复'));

    renderBatch();
    await submitReply('第一条批量回复');
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await submitCustomReply('处理第二个资料包中的设定', '第二条批量回复');
    expect(extractionAborted).toBe(true);
    expect(screen.queryByRole('button', { name: '模拟确认同步预览' })).toBeNull();
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('切换资料包后清除旧预览，旧预览不能确认同步', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(streamResponse('资料包一回复'))
      .mockResolvedValueOnce(streamResponse(JSON.stringify({ characters: [{ name: '批量人物' }] })));
    const view = renderBatch('pack-one');
    await submitReply('资料包一回复');
    fireEvent.click(screen.getByRole('button', { name: '检查冲突并准备写入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '模拟确认同步预览' })).toBeTruthy());

    view.rerender(<WorldBibleAssistant novel={novel} continuationPackId="pack-two" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: '模拟确认同步预览' })).toBeNull());
    expect(mocks.syncPackToWorld).not.toHaveBeenCalled();
  });

  test('资料包标题无唯一匹配时清除旧的自动推断，不显示检查入口', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    mocks.listContinuationPacks
      .mockResolvedValueOnce([{ id: 'pack-inferred', title: '唯一资料包', novelId: novel.id, status: 'approved' }])
      .mockResolvedValueOnce([]);
    fetchMock
      .mockResolvedValueOnce(streamResponse('唯一资料包已整理'))
      .mockResolvedValueOnce(streamResponse('没有唯一匹配的资料包'));
    renderBatch('');

    await submitCustomReply('处理资料包《唯一资料包》中的设定', '唯一资料包已整理');
    await waitFor(() => expect(screen.getByRole('button', { name: '检查冲突并准备写入' })).toBeTruthy());

    await submitCustomReply('处理资料包《不存在的资料包》中的设定', '没有唯一匹配的资料包');
    await waitFor(() => expect(screen.queryByRole('button', { name: '检查冲突并准备写入' })).toBeNull());
  });

  test('自动推断不会让待审核资料包进入同步流程', async () => {
    mocks.listContinuationPacks.mockResolvedValueOnce([
      { id: 'pack-draft', title: '待审核资料包', novelId: novel.id, status: 'draft' },
    ]);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(streamResponse('资料整理完成'));
    renderBatch('');

    await submitCustomReply('处理资料包《待审核资料包》中的设定', '资料整理完成');
    await waitFor(() => expect(mocks.listContinuationPacks).toHaveBeenCalledWith(novel.id));
    expect(screen.queryByRole('button', { name: '检查冲突并准备写入' })).toBeNull();
  });
});
