import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isPaidSkill,
  checkQuota,
  consumeQuota,
  DEFAULT_QUOTA_MAX,
} from '../server/helpers/quota-guard';
import {
  closeDb,
  createNovel,
  getNovel,
  initDb,
} from '../server/lib/db';
import type { Skill, Novel } from '../shared/types';

/**
 * 构造干净的模拟 Skill
 */
function mockSkill(fields: Partial<Skill>): Skill {
  return {
    id: 'skill-test-1',
    name: '测试技能卡',
    description: 'Mock description',
    style: 'Mock style',
    pacing: 'Mock pacing',
    stabilityScore: 90,
    evaluationFeedback: 'Mock feedback',
    version: 1,
    executionScore: 85, // 默认 A 级
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...fields,
  };
}

/**
 * 构造干净的模拟 Novel
 */
function mockNovel(id: string, commercialMode: 'free' | 'paid' | 'strict'): Novel {
  const now = Date.now();
  return {
    id,
    title: `测试作品-${id}`,
    authorId: 'local-user',
    summary: '测试商业化与配额卡控',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      commercialMode,
      quotaLimits: {
        extractSkillCount: 0,
        extractSkillMax: DEFAULT_QUOTA_MAX.extractSkill,
        generateProseCount: 0,
        generateProseMax: DEFAULT_QUOTA_MAX.generateProse,
        advancedAuditCount: 0,
        advancedAuditMax: DEFAULT_QUOTA_MAX.advancedAudit,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe('Commercial Boundary & Quota Control Tests', () => {

  // ==========================================
  // 1. isPaidSkill (付费卡牌暗定判定策略) 校验
  // ==========================================
  test('isPaidSkill accurately maps free vs. paid skills according to tier, score, and inheritance', () => {
    // 免费 A-tier 技能卡
    const freeSkill = mockSkill({ executionScore: 85 });
    assert.equal(isPaidSkill(freeSkill), false);

    // 显式指定 accessTier
    const explicitFree = mockSkill({ accessTier: 'free', executionScore: 95 });
    assert.equal(isPaidSkill(explicitFree), false);

    const explicitPaid = mockSkill({ accessTier: 'paid', executionScore: 80 });
    assert.equal(isPaidSkill(explicitPaid), true);

    // 评分大等于 90 (S-tier卡) 隐式判定为付费高阶卡
    const sTierSkill = mockSkill({ executionScore: 90 });
    assert.equal(isPaidSkill(sTierSkill), true);

    // 具有父级传承链的技能卡隐式判定为高阶卡
    const inheritedSkill = mockSkill({ parentSkillId: 'parent-id-123', executionScore: 70 });
    assert.equal(isPaidSkill(inheritedSkill), true);
  });

  // ==========================================
  // 2. 配额卡控 (Quota Guard) 服务层功能校验
  // ==========================================
  test('Quota Guard logic correctly tracks, increments, and blocks free vs paid tiers', () => {
    // 使用临时临时 SQLite 物理文件，确保测试物理隔离
    closeDb();
    const dbPath = path.join(os.tmpdir(), `inkflow-quota-${Date.now()}.db`);

    try {
      initDb(dbPath);

      // 创建测试小说环境
      createNovel(mockNovel('novel-free', 'free'));
      createNovel(mockNovel('novel-premium', 'paid'));

      // ----------------------------------------
      // A. 游客或未绑定小说的请求: 自由通行
      // ----------------------------------------
      const guestCheck = checkQuota(undefined, 'extractSkill');
      assert.equal(guestCheck.allowed, true);

      // ----------------------------------------
      // B. Premium 付费小说: 无限额度直接放行
      // ----------------------------------------
      const premCheck1 = checkQuota('novel-premium', 'extractSkill');
      assert.equal(premCheck1.allowed, true);

      consumeQuota('novel-premium', 'extractSkill');
      const premiumNovel = getNovel('novel-premium');
      // 付费版小说不累加计数器
      assert.equal(premiumNovel?.projectPreferenceProfile?.quotaLimits?.extractSkillCount, 0);

      const premCheck2 = checkQuota('novel-premium', 'extractSkill');
      assert.equal(premCheck2.allowed, true);

      // ----------------------------------------
      // C. 免费体验版小说: 计数器按步累加并最终拦截
      // ----------------------------------------
      // C1. 拆书萃取配额卡控 (Limit: 5)
      for (let i = 0; i < 5; i++) {
        const check = checkQuota('novel-free', 'extractSkill');
        assert.equal(check.allowed, true);
        assert.equal(check.count, i);
        consumeQuota('novel-free', 'extractSkill');
      }

      // 耗尽后第 6 次触发拦截
      const extractBlockedCheck = checkQuota('novel-free', 'extractSkill');
      assert.equal(extractBlockedCheck.allowed, false);
      assert.equal(extractBlockedCheck.count, 5);
      assert.equal(extractBlockedCheck.max, 5);
      assert.ok(extractBlockedCheck.error?.includes('拆书萃取'));

      // C2. 正文生成配额卡控 (Limit: 10)
      for (let i = 0; i < 10; i++) {
        const check = checkQuota('novel-free', 'generateProse');
        assert.equal(check.allowed, true);
        assert.equal(check.count, i);
        consumeQuota('novel-free', 'generateProse');
      }

      // 耗尽后触发拦截
      const proseBlockedCheck = checkQuota('novel-free', 'generateProse');
      assert.equal(proseBlockedCheck.allowed, false);
      assert.equal(proseBlockedCheck.count, 10);
      assert.equal(proseBlockedCheck.max, 10);
      assert.ok(proseBlockedCheck.error?.includes('正文生成'));

      // C3. 智能审稿配额卡控 (Limit: 5)
      for (let i = 0; i < 5; i++) {
        const check = checkQuota('novel-free', 'advancedAudit');
        assert.equal(check.allowed, true);
        assert.equal(check.count, i);
        consumeQuota('novel-free', 'advancedAudit');
      }

      // 耗尽后触发拦截
      const auditBlockedCheck = checkQuota('novel-free', 'advancedAudit');
      assert.equal(auditBlockedCheck.allowed, false);
      assert.equal(auditBlockedCheck.count, 5);
      assert.equal(auditBlockedCheck.max, 5);
      assert.ok(auditBlockedCheck.error?.includes('智能审稿'));

    } finally {
      // 销毁并清理临时数据库
      closeDb();
      fs.rmSync(dbPath, { force: true });
    }
  });
});
