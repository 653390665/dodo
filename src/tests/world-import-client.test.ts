import { afterEach, describe, expect, test, vi } from 'vitest';

import { importWorldExtraction } from '../lib/world-client';

describe('importWorldExtraction', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the complete extraction as one transaction request', async () => {
    const payload = {
      databaseGeneration: 12,
      novelId: 'novel-1',
      globalOutline: '完整大纲',
      worldRules: '世界法则',
      characters: [{ name: '阿遥' }],
      locations: [{ name: '旧城' }],
      items: [{ name: '铜钥匙' }],
      factions: [{ name: '守夜人' }],
      powerLevels: [{ name: '第一阶' }],
      timelineEvents: [{ title: '城门失火' }],
    };
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await importWorldExtraction(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/world/import-extraction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  test('rejects a failed transaction so callers cannot announce success', async () => {
    const fetchMock = vi.fn(async () => Response.json(
      { error: '设定导入失败，未写入任何数据' },
      { status: 500 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(importWorldExtraction({ novelId: 'novel-1' })).rejects.toThrow('未写入任何数据');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
