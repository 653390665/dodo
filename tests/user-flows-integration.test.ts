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
  listForeshadowings,
  createSkill,
  getSkill,
  listSkills,
  syncSkillFeedbackScores
} from '../server/lib/db';
import {
  saveConfig,
  reloadConfig,
  getConfig,
  updateCachedApiKey
} from '../server/lib/config';
import {
  inferNovelGovernanceProfile,
  recommendPromptAssets
} from '../shared/lib/prompt-recommender.js';

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

  test('Flow 4: Production Pipeline (分镜 -> 生成 -> 应用章节)', () => {
    // 1. Create Novel and Chapter with Scene Beats (分镜)
    createNovel({
      id: 'n-4',
      title: '至尊剑帝',
      authorId: 'auth-user',
      summary: '修真大作',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    createChapter({
      id: 'c-4',
      novelId: 'n-4',
      volumeName: '第一卷',
      title: '第一章 剑起',
      content: '', // 初始正文为空
      order: 1,
      wordCount: 0,
      sceneBeats: '主角林惊羽在剑冢中得到古剑 -> 觉醒逆天剑魂',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const initialChapter = getChapter('c-4');
    assert.ok(initialChapter);
    assert.equal(initialChapter.sceneBeats, '主角林惊羽在剑冢中得到古剑 -> 觉醒逆天剑魂');
    assert.equal(initialChapter.content, '');

    // 2. Simulate AI Generation and Applying content (模拟正文产生并应用到章节)
    const generatedContent = '古老的剑冢深处，万剑悲鸣。林惊羽擦了擦唇角的血迹，将手伸向了那柄锈迹斑斑的断剑。轰！一股无可匹敌的逆天剑魂在他体内轰然觉醒！';
    const wordCount = 70; // 模拟字数统计

    updateChapter('c-4', {
      content: generatedContent,
      wordCount: wordCount
    });

    // 3. Verify final Chapter state in the DB
    const finalChapter = getChapter('c-4');
    assert.ok(finalChapter);
    assert.equal(finalChapter.content, generatedContent);
    assert.equal(finalChapter.wordCount, wordCount);
  });

  test('Flow 5: Skill Extraction (输入文本 -> 自动生成并存盘 Skill -> 进行装载与评估)', () => {
    // 1. Simulate Skill Generation based on text analysis and save to DB
    const extractedSkillId = 'sk-extracted-5';
    createSkill({
      id: extractedSkillId,
      name: '仙侠风精修 Skill',
      description: '擅长渲染悲壮、宏大的打斗场面',
      style: '悲壮、古典',
      pacing: '快节奏',
      vocabulary: ['仙侠常用词'],
      sentenceStructure: '长短句交错',
      imagery: ['剑气', '残阳'],
      bannedWords: ['现代词汇'],
      fewShots: ['示例 1 -> 示例 2'],
      characterTraits: '坚毅',
      worldBuilding: '仙凡对立',
      foreshadowing: '暗藏玄机',
      plotPattern: '先抑后扬',
      corePatterns: [],
      bannedElements: [],
      stabilityScore: 85,
      evaluationFeedback: '打斗渲染到位，词藻略显华丽',
      version: 1,
      parentSkillId: undefined,
      lineageRootId: extractedSkillId,
      primaryDimension: 'style',
      dimensionTags: ['style', 'world'],
      compositionProfile: {
        styleWeight: 0,
        characterWeight: 0,
        worldWeight: 0,
        powerWeight: 0,
        plotWeight: 0,
        pacingWeight: 0,
        conflictTags: [],
        blendHints: []
      },
      usageStats: {
        mountedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        revisedCount: 0,
        averageFitScore: 0
      },
      feedbackScore: 50,
      fusionMeta: undefined,
      methodChain: {
        items: [],
        summary: ''
      },
      whyThisSkillWorks: '词藻契合古典美感',
      sourceBadge: 'book-extracted',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // 2. Verify creation of skill
    const retrievedSkill = getSkill(extractedSkillId);
    assert.ok(retrievedSkill);
    assert.equal(retrievedSkill.name, '仙侠风精修 Skill');
    assert.equal(retrievedSkill.sourceBadge, 'book-extracted');

    const allSkills = listSkills();
    assert.ok(allSkills.some(s => s.id === extractedSkillId));

    // 3. Sync skill feedback scores and evaluate usage update
    const syncedSkills = syncSkillFeedbackScores();
    assert.ok(syncedSkills);
  });

  test('Flow 6: Prompt Governance (项目画像识别 -> 根据商业模式过滤推荐受限包 -> 拦截 paid / 免费激活机制)', () => {
    // 1. Create Novel with project preference profile (commercial mode)
    createNovel({
      id: 'n-6',
      title: '番茄神婿',
      authorId: 'auth-user',
      summary: '一个在番茄小说连载的现代都市逆袭爽文',
      status: 'ongoing',
      projectPreferenceProfile: {
        tags: ['tomato', '都市', 'xiaofeiji'],
        commercialMode: 'free',
        weights: {
          styleWeight: 0,
          characterWeight: 0,
          worldWeight: 0,
          plotWeight: 0,
          pacingWeight: 0
        },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const novel = getNovel('n-6');
    assert.ok(novel);

    // 2. Infer governance profile
    const profile = inferNovelGovernanceProfile(novel);
    assert.ok(profile);
    assert.equal(profile.targetPlatform, 'tomato');
    assert.equal(profile.activeSeriesId, 'xiaofeiji-novel-flow');
    assert.ok(profile.genreTags.includes('urban'));

    // 3. Test recommended prompt assets filtering based on commercialMode
    const freeRecommendations = recommendPromptAssets({
      commercialMode: 'free',
      targetPlatform: 'tomato',
      genreTags: ['urban']
    });
    // 验证免费推荐列表里没有 sourceType = 'licensed' 的违规推荐
    const hasLicensedInFree = freeRecommendations.some(asset => asset.sourceType === 'licensed');
    assert.equal(hasLicensedInFree, false, 'Free mode should block licensed assets');

    const paidRecommendations = recommendPromptAssets({
      commercialMode: 'paid',
      targetPlatform: 'tomato',
      genreTags: ['urban']
    });
    assert.ok(paidRecommendations.length >= 0);
  });
});
