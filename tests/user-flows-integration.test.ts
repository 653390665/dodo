import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDb,
  closeDb,
  createNovel,
  getNovel,
  createChapter,
  getChapter,
  updateChapter,
  createContinuationPack,
  listContinuationPacks,
  createForeshadowing,
  listForeshadowings
} from '../server/lib/db';
import {
  saveConfig,
  reloadConfig,
  getConfig,
  updateCachedApiKey
} from '../server/lib/config';

const DB_PATH = path.join(process.cwd(), 'tests', 'temp-integration.db');
const CONFIG_DIR = path.join(process.cwd(), 'tests', 'temp-config-integration');

test.describe('InkFlow End-to-End User Flows Integration Tests', () => {
  test.beforeEach(() => {
    // 1. Database setup
    try { closeDb(); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}
    initDb(DB_PATH);

    // 2. Config path isolation
    process.env.INKFLOW_CONFIG_DIR = CONFIG_DIR;
    if (fs.existsSync(CONFIG_DIR)) {
      fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    reloadConfig();
  });

  test.after(() => {
    // Cleanup database
    try { closeDb(); } catch {}
    try { fs.unlinkSync(DB_PATH); } catch {}

    // Cleanup config
    delete process.env.INKFLOW_CONFIG_DIR;
    if (fs.existsSync(CONFIG_DIR)) {
      try {
        fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
      } catch {}
    }
  });

  test('Flow 1: Create novel -> Create chapter -> Save content updates', () => {
    // Create Novel
    createNovel({
      id: 'n-1',
      title: '临仙传',
      authorId: 'auth-user',
      summary: '修仙故事',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const novel = getNovel('n-1');
    assert.ok(novel);
    assert.equal(novel.title, '临仙传');

    // Create Chapter
    createChapter({
      id: 'c-1',
      novelId: 'n-1',
      volumeName: '第一卷',
      title: '第一章 醒来',
      content: '荒野古刹...',
      order: 1,
      wordCount: 5,
      sceneBeats: '醒来 -> 环顾四周',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const chapter = getChapter('c-1');
    assert.ok(chapter);
    assert.equal(chapter.title, '第一章 醒来');
    assert.equal(chapter.content, '荒野古刹...');

    // Save/Update Chapter Content
    updateChapter('c-1', {
      content: '荒野古刹，大雨倾盆。林照慢慢睁开双眼...',
      wordCount: 19
    });

    const updatedChapter = getChapter('c-1');
    assert.equal(updatedChapter?.content, '荒野古刹，大雨倾盆。林照慢慢睁开双眼...');
    assert.equal(updatedChapter?.wordCount, 19);
  });

  test('Flow 2: Import Continuation Pack -> Plan Foreshadowing', () => {
    createNovel({
      id: 'n-2',
      title: '无尽星辰',
      authorId: 'auth-user',
      summary: '科幻小说',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // Import Pack
    createContinuationPack({
      id: 'p-1',
      novelId: 'n-2',
      title: '星海防线设定',
      status: 'approved',
      sourceDocuments: [],
      canonFacts: [{ id: 'f-1', priority: 'hard', category: 'world', text: '曲率飞船无法在恒星系内启动', evidence: '星海守则' }],
      characterStates: [],
      plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
      styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
      contradictions: [],
      continuationTask: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const packs = listContinuationPacks('n-2');
    assert.equal(packs.length, 1);
    assert.equal(packs[0].title, '星海防线设定');
    assert.equal(packs[0].canonFacts[0].text, '曲率飞船无法在恒星系内启动');

    // Planning: Create Foreshadowing referencing imported canon fact
    createForeshadowing({
      id: 'fs-1',
      novelId: 'n-2',
      title: '恒星系内的曲率陷阱',
      description: '敌人曲率引擎由于身处重力井内报错启动失败',
      status: 'planted',
      plantedChapterId: 'ch-3',
      payoffChapterId: 'ch-5',
      relatedCharacterIds: ['char-1'],
      notes: '基于星海防线设定中曲率规则设计',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const foreshadowings = listForeshadowings('n-2');
    assert.equal(foreshadowings.length, 1);
    assert.equal(foreshadowings[0].title, '恒星系内的曲率陷阱');
    assert.equal(foreshadowings[0].notes, '基于星海防线设定中曲率规则设计');
  });

  test('Flow 3: Settings Save -> Hot synchronization and API Key caching', () => {
    process.env.INKFLOW_ELECTRON_MODE = 'true';
    try {
      // 1. Settings Save
      saveConfig({
        apiKey: 'sk-test-key-9999',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        promptTemplates: {} as any
      });
      reloadConfig();

      const config = getConfig();
      assert.equal(config.apiKey, 'sk-test-key-9999');

      // 2. Hot synchronization mimicking Electron main process sync call
      updateCachedApiKey('sk-synced-key-8888');
      reloadConfig();

      const syncedConfig = getConfig();
      assert.equal(syncedConfig.apiKey, 'sk-synced-key-8888');
    } finally {
      delete process.env.INKFLOW_ELECTRON_MODE;
      delete process.env.INKFLOW_SECURE_API_KEY;
    }
  });
});
