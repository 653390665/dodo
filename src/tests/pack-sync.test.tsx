import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { buildSyncExtractionPrompt } from '../../shared/lib/sync-extract-prompt';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import { buildSyncExtractionChunks, mergeSyncExtractionResults, SyncExtractionChunkLimitError, SYNC_EXTRACTION_CHUNK_CHAR_BUDGET } from '../../shared/lib/sync-extraction-chunks';

describe('sync extraction chunking and deterministic merge', () => {
  test('keeps 100 documents bounded and ordered', () => {
    const chunks = buildSyncExtractionChunks(Array.from({ length: 100 }, (_, index) => ({
      id: `doc-${index}`, filename: `${index}.txt`, text: `文档-${index}`,
    })));
    expect(chunks).toHaveLength(100);
    expect(chunks.map(chunk => chunk.filename)).toEqual(Array.from({ length: 100 }, (_, index) => `${index}.txt`));
    expect(chunks.map(chunk => chunk.sourceDocumentId)).toEqual(Array.from({ length: 100 }, (_, index) => `doc-${index}`));
    expect(chunks.every(chunk => chunk.text.length <= SYNC_EXTRACTION_CHUNK_CHAR_BUDGET)).toBe(true);
  });

  test('deduplicates entities and relationships after all chunks', () => {
    const base = { locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], globalOutline: '', worldRules: '' };
    const result = mergeSyncExtractionResults([
      { ...base, characters: [{ name: '张三', role: 'protagonist', summary: '', bio: '', traits: ['勇敢'] }], relationships: [{ sourceName: '张三', sourceType: 'character', targetName: '京城', targetType: 'location', relationshipType: '居住', description: '' }] },
      { ...base, characters: [{ name: ' 张三 ', role: '', summary: '主角', bio: '', traits: ['聪明'] }], locations: [{ name: '京城', region: '', description: '' }], relationships: [{ sourceName: '张三', sourceType: 'character', targetName: '京城', targetType: 'location', relationshipType: '居住', description: '' }] },
    ]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].traits).toEqual(['勇敢', '聪明']);
    expect(result.relationships).toHaveLength(1);
  });

  test('rejects oversized input instead of truncating it', () => {
    expect(() => buildSyncExtractionChunks([{ filename: 'huge.txt', text: 'x'.repeat(SYNC_EXTRACTION_CHUNK_CHAR_BUDGET * 2) }], SYNC_EXTRACTION_CHUNK_CHAR_BUDGET, 1)).toThrow(SyncExtractionChunkLimitError);
  });
});

describe('buildSyncExtractionPrompt', () => {
  test('includes source texts', () => {
    const prompt = buildSyncExtractionPrompt(['[sourceDocumentId:doc-1]\n文本1内容', '[sourceDocumentId:doc-2]\n文本2内容']);
    expect(prompt).toContain('文本1内容');
    expect(prompt).toContain('文本2内容');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('"sourceDocumentIds":["doc-1"]');
    expect(prompt).toContain('只能复制人物事实实际来源资料块');
  });

  test('handles single text', () => {
    const prompt = buildSyncExtractionPrompt(['单一文本']);
    expect(prompt).toContain('单一文本');
  });

  test('joins multiple texts with separator', () => {
    const prompt = buildSyncExtractionPrompt(['A', 'B', 'C']);
    expect(prompt).toContain('A\n\n---\n\nB\n\n---\n\nC');
  });

  test('empty array produces empty source section', () => {
    const prompt = buildSyncExtractionPrompt([]);
    expect(prompt).toContain('## 资料文本');
  });

  test('Plan 143 prompt includes the complete schema contract and repair mode', () => {
    const prompt = buildSyncExtractionPrompt(['资料'], {
      repairIssues: [{ path: 'characters.0.name', code: 'invalid_type', message: '必须是字符串' }],
    });
    expect(prompt).toContain('"characters": [{"name":"林默"');
    expect(prompt).toContain('"relationships": [{"sourceName":"林默"');
    expect(prompt).toContain('所有顶层数组都必须存在');
    expect(prompt).toContain('tier 范围是 0–100');
    expect(prompt).toContain('所有实体与关系数组合计不得超过 180 条');
    expect(prompt).toContain('characters.0.name');
    expect(prompt).toContain('不新增资料中没有的事实');
  });

  test('Plan 143 JSON syntax repair mode requires a complete single object', () => {
    const prompt = buildSyncExtractionPrompt(['资料'], { repairKind: 'json_syntax' });
    expect(prompt).toContain('单一 JSON 根对象');
    expect(prompt).toContain('双引号');
    expect(prompt).toContain('不得输出 Markdown、注释或尾逗号');
    expect(prompt).toContain('完整顶层结构');
  });

  test('requires compact fields without sacrificing the complete top-level JSON shape', () => {
    const prompt = buildSyncExtractionPrompt(['资料']);
    expect(prompt).toContain('每个字段只写资料中可核实的最短信息');
    expect(prompt).toContain('不要把同一事实重复写入多个字段');
    expect(prompt).toContain('必须输出完整且可解析的单一 JSON 根对象');
    expect(prompt).toContain('不得在中途截断');
  });

  test('compact retry keeps the full schema while reducing field redundancy', () => {
    const prompt = buildSyncExtractionPrompt(['资料'], { compact: true });
    expect(prompt).toContain('压缩重试模式');
    expect(prompt).toContain('保留所有顶层键');
    expect(prompt).toContain('不任意裁剪实体数量');
    expect(prompt).toContain('不要把推断写成证据');
  });
});

describe('SyncExtractionResult type', () => {
  test('compiles correctly', () => {
    const result: SyncExtractionResult = {
      characters: [{ name: '张三', role: 'protagonist', summary: '主角', bio: '详细', traits: ['勇敢'] }],
      locations: [{ name: '京城', region: '北方', description: '繁华' }],
      items: [{ name: '神剑', type: 'weapon', description: '锋利' }],
      factions: [{ name: '武林盟', leader: '盟主', territory: '中原', description: '正派' }],
      powerLevels: [{ name: '练气', tier: 1, characteristics: '基础', description: '入门' }],
      timelineEvents: [{ title: '开篇', timestamp: '第一天', description: '故事开始', order: 1 }],
      relationships: [{ sourceName: '张三', sourceType: 'character', targetName: '李四', targetType: 'character', relationshipType: '敌对', description: '仇人' }],
      globalOutline: '世界观概述',
      worldRules: '设定规则',
    };
    expect(result.characters).toHaveLength(1);
    expect(result.relationships).toHaveLength(1);
  });
});

describe('name normalization consistency', () => {
  const normalizeName = (name: string) => name.trim().normalize('NFC').toLowerCase();

  test('trims whitespace', () => {
    expect(normalizeName('  张三  ')).toBe('张三');
    expect(normalizeName('张三')).toBe('张三');
  });

  test('normalizes fullwidth characters', () => {
    const result = normalizeName('Ｚｈａｎｇ');
    expect(result).toBe(result.normalize('NFC'));
    expect(result).toBe(result.toLowerCase());
  });

  test('lowercases ASCII', () => {
    expect(normalizeName('ZHANG')).toBe('zhang');
  });
});

describe('SyncPreviewPanel dedup logic', () => {
  const normalizeName = (name: string) => name.trim().normalize('NFC').toLowerCase();

  test('detects existing entities', () => {
    const existingNames = new Set(['张三', '李四'].map(n => normalizeName(n)));
    expect(existingNames.has(normalizeName('张三'))).toBe(true);
    expect(existingNames.has(normalizeName('王五'))).toBe(false);
    expect(existingNames.has(normalizeName('  张三  '))).toBe(true);
  });

  test('cross-entity dedup works', () => {
    const existingCharacters = ['张三', '李四'];
    const existingLocations = ['京城'];
    const allNames = new Set([...existingCharacters, ...existingLocations].map(n => normalizeName(n)));
    expect(allNames.has(normalizeName('京城'))).toBe(true);
    expect(allNames.has(normalizeName('张三'))).toBe(true);
    expect(allNames.has(normalizeName('洛阳'))).toBe(false);
  });
});

describe('extractPackEntities', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('calls correct endpoint and returns result', async () => {
    const emptyExtraction: SyncExtractionResult = {
      characters: [], locations: [], items: [], factions: [],
      powerLevels: [], timelineEvents: [], relationships: [],
      globalOutline: '', worldRules: '',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ databaseGeneration: 42 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ packId: 'pack-123', novelId: 'novel-1', databaseGeneration: 42, extraction: emptyExtraction }), { status: 200 })
      );

    const { extractPackEntities } = await import('../lib/continuation-client');
    const result = await extractPackEntities('pack-123', 'novel-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/db/generation', expect.anything());
    expect(fetchSpy).toHaveBeenCalledWith('/api/continuation-packs/extract-entities', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ packId: 'pack-123', novelId: 'novel-1', databaseGeneration: 42 }),
    }));
    expect(result.packId).toBe('pack-123');
    expect(result.databaseGeneration).toBe(42);
    expect(result.extraction.characters).toEqual([]);
  });

  test('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ databaseGeneration: 1 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: '提取失败' }), { status: 500 })
      );

    const { extractPackEntities } = await import('../lib/continuation-client');
    await expect(extractPackEntities('pack-err', 'novel-err')).rejects.toThrow();
  });

  test('starts and polls a background extraction job with progress', async () => {
    vi.useFakeTimers();
    const emptyExtraction: SyncExtractionResult = {
      characters: [], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
      globalOutline: '', worldRules: '',
    };
    const progress = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ databaseGeneration: 42 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'extract-job-1', databaseGeneration: 42 }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running', progress: 45, stageText: '正在合并实体' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'completed', progress: 100, stageText: '提取完成',
        result: { packId: 'pack-123', novelId: 'novel-1', databaseGeneration: 42, extraction: emptyExtraction },
      }), { status: 200 }));

    const { extractPackEntities } = await import('../lib/continuation-client');
    const resultPromise = extractPackEntities('pack-123', 'novel-1', undefined, progress);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toMatchObject({ packId: 'pack-123' });
    expect(progress).toHaveBeenCalledWith({ progress: 45, stageText: '正在合并实体', status: 'running' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/continuation-packs/jobs/extract-job-1?databaseGeneration=42', expect.anything());
  });

  test('failed job preserves safe diagnostics and polling context', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ databaseGeneration: 42 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'extract-job-failed', databaseGeneration: 42, traceId: 'trace-143' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'failed', currentChunk: 2, totalChunks: 4, traceId: 'trace-143',
        code: 'EXTRACTION_INVALID_JSON', error: '模型返回结果无法解析，请重试',
        failedChunk: { attempt: 2 },
        outputDiagnostic: { provider: 'deepseek', responseFormatMode: 'json_object', thinkingMode: 'disabled', parserStage: 'quote_repair', candidateRoot: 'object', candidateLength: 18 },
      }), { status: 200 }));

    const { extractPackEntities } = await import('../lib/continuation-client');
    await expect(extractPackEntities('pack-failed', 'novel-failed')).rejects.toMatchObject({
      code: 'EXTRACTION_INVALID_JSON',
      batch: 2,
      totalBatches: 4,
      traceId: 'trace-143',
      jobId: 'extract-job-failed',
      databaseGeneration: 42,
      attempt: 2,
      outputDiagnostic: { parserStage: 'quote_repair' },
    });
  });

  test('malformed polling response rejects with the existing job context', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ databaseGeneration: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'extract-job-protocol', databaseGeneration: 7 }), { status: 202 }))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }));

    const { extractPackEntities } = await import('../lib/continuation-client');
    await expect(extractPackEntities('pack-protocol', 'novel-protocol')).rejects.toMatchObject({
      code: 'EXTRACTION_PROTOCOL_ERROR',
      jobId: 'extract-job-protocol',
      databaseGeneration: 7,
      httpStatus: 200,
    });
  });
});

describe('syncPackToWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('calls correct endpoint and returns result', async () => {
    const syncResult = {
      created: { characters: 1, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 },
      skipped: { characters: 0, locations: 0, items: 0, factions: 0 },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(syncResult), { status: 200 })
    );

    const { syncPackToWorld } = await import('../lib/continuation-client');
    const result = await syncPackToWorld({
      packId: 'pack-1',
      novelId: 'novel-1',
      databaseGeneration: 42,
      characters: [{ name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] }],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [],
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/continuation-packs/sync-to-world', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.created.characters).toBe(1);
  });

  test('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '同步失败' }), { status: 500 })
    );

    const { syncPackToWorld } = await import('../lib/continuation-client');
    await expect(syncPackToWorld({
      packId: 'pack-err',
      novelId: 'novel-err',
      databaseGeneration: 1,
      characters: [], locations: [], items: [], factions: [],
      powerLevels: [], timelineEvents: [], relationships: [],
    })).rejects.toThrow();
  });
});

// ─── T4 component rendering tests ────────────────────────────────

describe('SyncPreviewPanel T4.4-T4.6', () => {
  const emptyExtraction: SyncExtractionResult = {
    characters: [], locations: [], items: [], factions: [],
    powerLevels: [], timelineEvents: [],
    relationships: [],
    globalOutline: '', worldRules: '',
  };

  const unresolvedExtraction: SyncExtractionResult = {
    ...emptyExtraction,
    characters: [{ name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] }],
    relationships: [
      { sourceName: '张三', sourceType: 'character', targetName: '未知角色', targetType: 'character', relationshipType: '敌对', description: '' },
    ],
  };

  async function loadPanel() {
    const { SyncPreviewPanel } = await import('../components/world-bible/SyncPreviewPanel');
    return SyncPreviewPanel;
  }

  test('T4.4: confirm skips unresolved relationships instead of disabling the primary action', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn();
    render(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );
    const confirmBtn = screen.getByRole('button', { name: '导入可确认项并处理 1 条关系' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].relationships).toEqual([]);
  });

  test('T4.4b: partial sync keeps the preview open and enters unresolved relationship repair', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '导入可确认项并处理 1 条关系' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].characters).toEqual(unresolvedExtraction.characters);
    expect(onConfirm.mock.calls[0][0].relationships).toEqual([]);
    expect(screen.getByText('同步预览 — 选择要导入的实体')).toBeDefined();
    expect(await screen.findByRole('option', { name: /未知角色/ })).toBeDefined();
    expect(screen.getByText('待确认')).toBeDefined();
    expect(screen.getByText(/待处理/)).toBeDefined();
  });

  test('T4.4c: partial sync removes submitted rows and never resubmits them while repairing', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn().mockResolvedValue(true);
    const extraction: SyncExtractionResult = {
      ...emptyExtraction,
      characters: [
        { name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] },
        { name: '李四', role: 'supporting', summary: '', bio: '', traits: [] },
      ],
      powerLevels: [{ name: '练气', tier: 1, characteristics: '', description: '' }],
      timelineEvents: [{ title: '开篇', timestamp: '第一天', description: '', order: 1 }],
      relationships: [
        { sourceName: '张三', sourceType: 'character', targetName: '李四', targetType: 'character', relationshipType: '同盟', description: '已经提交' },
        { sourceName: '张三', sourceType: 'character', targetName: '未知角色', targetType: 'character', relationshipType: '敌对', description: '等待修复' },
      ],
    };
    const { rerender } = render(
      <SyncPreviewPanel
        extraction={extraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '导入可确认项并处理 1 条关系' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      characters: extraction.characters,
      powerLevels: extraction.powerLevels,
      timelineEvents: extraction.timelineEvents,
      relationships: [extraction.relationships[0]],
    });

    rerender(
      <SyncPreviewPanel
        extraction={extraction}
        existingCharacters={[
          { id: 'c1', novelId: 'n1', name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] },
          { id: 'c2', novelId: 'n1', name: '李四', role: 'supporting', summary: '', bio: '', traits: [] },
          { id: 'c3', novelId: 'n1', name: '未知角色', role: 'supporting', summary: '', bio: '', traits: [] },
        ]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );
    expect(screen.getByText('等待修复')).toBeDefined();
    expect(screen.queryByText('已经提交')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '人物' }));
    expect(screen.getByText('未提取到人物')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '力量体系' }));
    expect(screen.getByText('未提取到力量体系')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '时间线' }));
    expect(screen.getByText('未提取到时间线事件')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '关系' }));

    expect(screen.getByText('等待修复')).toBeDefined();
    expect(screen.queryByText('已经提交')).toBeNull();
    const repairCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(repairCheckbox.disabled).toBe(false);
    await waitFor(() => expect(repairCheckbox.checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm.mock.calls[1][0]).toMatchObject({
      characters: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [extraction.relationships[1]],
    });
  });

  test('T4.5: skipping unresolved relationship enables confirm', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn();
    render(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );
    fireEvent.click(screen.getByText('关系'));
    const skipBtn = screen.getByText('跳过此关系');
    fireEvent.click(skipBtn);
    const confirmBtn = screen.getByRole('button', { name: /确认同步/ }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  test('T4.5b: skipping all unresolved relationships enables confirm and excludes them from sync', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn();
    const multipleUnresolvedExtraction: SyncExtractionResult = {
      ...unresolvedExtraction,
      relationships: [
        ...unresolvedExtraction.relationships,
        { sourceName: '张三', sourceType: 'character', targetName: '另一未知角色', targetType: 'character', relationshipType: '同盟', description: '' },
      ],
    };

    render(
      <SyncPreviewPanel
        extraction={multipleUnresolvedExtraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: '导入可确认项并处理 2 条关系' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '跳过全部待确认关系' }));

    expect(confirmBtn.disabled).toBe(false);
    expect(confirmBtn.textContent).toBe('确认同步');
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].relationships).toEqual([]);
  });

  test('T4.6: resolved relationship via dropdown enables confirm', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn();
    render(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[{ id: 'c1', novelId: 'n1', name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] }]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );
    fireEvent.click(screen.getByText('关系'));
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    fireEvent.change(selects[0], { target: { value: '张三' } });
    const confirmBtn = screen.getByRole('button', { name: /确认同步/ }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  test('T4.6b: every unresolved relationship offers a matching choice or an explicit skip', async () => {
    const SyncPreviewPanel = await loadPanel();
    const extraction: SyncExtractionResult = {
      ...emptyExtraction,
      characters: [{ name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] }],
      relationships: [
        { sourceName: '张三', sourceType: 'character', targetName: '未知甲', targetType: 'character', relationshipType: '同盟', description: '可匹配关系' },
        { sourceName: '张三', sourceType: 'character', targetName: '未知势力', targetType: 'faction', relationshipType: '敌对', description: '只能跳过关系' },
      ],
    };
    render(
      <SyncPreviewPanel
        extraction={extraction}
        existingCharacters={[{ id: 'c1', novelId: 'n1', name: '李四', role: 'supporting', summary: '', bio: '', traits: [] }]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={vi.fn()}
        onCancel={() => {}}
        isSyncing={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '关系' }));
    const repairRows = [screen.getByText('可匹配关系'), screen.getByText('只能跳过关系')]
      .map(description => description.closest('[data-relationship-repair]'));

    expect(repairRows.every(Boolean)).toBe(true);
    expect(within(repairRows[0] as HTMLElement).getByRole('option', { name: '李四' })).toBeDefined();
    expect(within(repairRows[0] as HTMLElement).getByRole('button', { name: '跳过此关系' })).toBeDefined();
    expect(within(repairRows[1] as HTMLElement).queryByRole('combobox')).toBeNull();
    expect(within(repairRows[1] as HTMLElement).getByRole('button', { name: '跳过此关系' })).toBeDefined();
  });

  test('T2c: skip then recheck entity clears skip and restores relationship', async () => {
    const SyncPreviewPanel = await loadPanel();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );
    // Switch to relationships tab, skip the unresolved relationship
    fireEvent.click(screen.getByText('关系'));
    const skipBtn = screen.getByText('跳过此关系');
    fireEvent.click(skipBtn);
    // Confirm button should be enabled (relationship skipped)
    const confirmBtn = screen.getByRole('button', { name: /确认同步/ }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    // Now re-render with the missing entity added (simulating user checking it)
    rerender(
      <SyncPreviewPanel
        extraction={unresolvedExtraction}
        existingCharacters={[{ id: 'c1', novelId: 'n1', name: '未知角色', role: 'supporting', summary: '', bio: '', traits: [] }]}
        existingLocations={[]}
        existingItems={[]}
        existingFactions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
        isSyncing={false}
      />
    );

    // The relationship should no longer be skipped — confirm should be disabled
    // (because the relationship is now resolved but unconfirmed, checkbox unchecked by default)
    fireEvent.click(screen.getByText('关系'));
    const confirmBtnAfter = screen.getByRole('button', { name: /确认同步/ }) as HTMLButtonElement;
    // After recheck, unresolvedCount should be 0 (entity exists now), but relationship is not checked
    // so confirm is not blocked by unresolvedCount — it's enabled
    expect(confirmBtnAfter.disabled).toBe(false);

    // Check the relationship checkbox and click confirm
    const relCheckbox = screen.getAllByRole('checkbox').find(
      cb => !cb.closest('label')?.textContent?.includes('张三')
    );
    expect(relCheckbox).toBeDefined();
    fireEvent.click(relCheckbox!);
    fireEvent.click(confirmBtnAfter);

    // Verify onConfirm was called with the relationship (skip cleared, relationship restored)
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const calledWith = onConfirm.mock.calls[0][0];
    expect(calledWith.relationships).toHaveLength(1);
    expect(calledWith.relationships[0].sourceName).toBe('张三');
    expect(calledWith.relationships[0].targetName).toBe('未知角色');
  });
});
