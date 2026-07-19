import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildSyncExtractionPrompt } from '../../shared/lib/sync-extract-prompt';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';

describe('buildSyncExtractionPrompt', () => {
  test('includes source texts', () => {
    const prompt = buildSyncExtractionPrompt(['文本1内容', '文本2内容']);
    expect(prompt).toContain('文本1内容');
    expect(prompt).toContain('文本2内容');
    expect(prompt).toContain('JSON');
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

  test('T4.4: unconfirmed relationship blocks confirm button', async () => {
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
    // Switch to relationships tab
    fireEvent.click(screen.getByText('关系'));
    const confirmBtn = screen.getByRole('button', { name: /确认同步/ }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(confirmBtn.title).toContain('处理');
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
});
