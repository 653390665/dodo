import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';
import { recommendPromptAssets } from '../shared/lib/prompt-assets-governed.js';
import { PROMPT_GOVERNANCE_CATALOG as PUBLIC_CATALOG } from '../shared/lib/public-skill-catalog.js';
import { PROMPT_GOVERNANCE_CATALOG as SOURCE_CATALOG, GOVERNED_ASSETS_V2_REGISTRY } from '../shared/lib/prompt-governance-catalog.js';
import { validateAssetV2 } from '../shared/lib/prompt-assets-governed.js';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates.js';
import type { Novel } from '../shared/types.js';

const CARD_ID = 'de-ai-tells-guard';

function novel(): Novel {
  return {
    id: 'novel-1', title: 'Novel', authorId: 'author', summary: '', status: 'ongoing',
    mountedSkillIds: ['planner', 'writer', 'critic'],
    mountedSkillLoadout: [
      { slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'critic', weight: 1, lockedDimensions: [] },
    ],
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      skillLoadoutSchemaVersion: 2, contract: { styleAnchors: ['克制', '短句'] },
    },
    createdAt: 1, updatedAt: 1,
  };
}

test('writer hard rules cover the corpus-backed AI tells (翻案腔 / 破折号揭晓)', () => {
  const writerPrompt = DEFAULT_PROMPT_TEMPLATES.orchestrateWriter;
  assert.match(writerPrompt, /19\.\s*\*\*禁用翻案腔解释句\*\*[\s\S]*不是A，而是B[\s\S]*看似A，实则B/);
  assert.match(writerPrompt, /20\.\s*\*\*禁用破折号揭晓式停顿\*\*[\s\S]*破折号全章至多出现一次/);
  assert.match(writerPrompt, /□ 未出现"不是…而是…""看似…实则…"等翻案腔句式/);
  assert.match(writerPrompt, /□ 未用破折号制造揭晓式停顿/);
});

test('de-ai-tells-guard is a runtime-ready opt-in quality guardrail in both catalogs', () => {
  const registryEntry = GOVERNED_ASSETS_V2_REGISTRY.find((asset) => asset.id === CARD_ID);
  assert.ok(registryEntry, 'registry must contain de-ai-tells-guard');
  assert.equal(validateAssetV2(registryEntry), true, 'registry entry must pass V2 validation');

  const sourceEntry = SOURCE_CATALOG.find((asset) => asset.id === CARD_ID);
  const publicEntry = PUBLIC_CATALOG.find((asset) => asset.id === CARD_ID);
  assert.ok(sourceEntry, 'source catalog must expose de-ai-tells-guard');
  assert.ok(publicEntry, 'public catalog must expose de-ai-tells-guard');

  for (const entry of [sourceEntry!, publicEntry!]) {
    // 可配置护栏三要素：运行时就绪 + 质量护栏类目 + 非 core-default（用户显式开启）
    assert.equal(entry.primaryCategory, 'quality-guardrail');
    assert.equal(entry.runtimeStatus, 'active');
    assert.equal(entry.isRuntimeReady, true);
    assert.equal(entry.sanitizationStatus, 'runtime-ready');
    assert.notEqual(entry.placementTier, 'core-default');
  }
  // 源目录/注册表（运行时护栏注入用）携带完整规则正文
  assert.ok(sourceEntry!.template.includes('翻案腔'), 'source template must carry the tells rules');
  assert.ok(sourceEntry!.template.includes('破折号'));
  // 公开目录受 Safety Sandbox Door 约束：模板必须为空，不得向客户端泄露规则正文
  assert.ok(
    publicEntry!.template === undefined || publicEntry!.template === '',
    'public catalog must not leak template (Safety Sandbox Door)',
  );
});

test('configuring de-ai-tells-guard injects it into the writer stage prompt', () => {
  closeDb(); initDb(':memory:');
  try {
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        guardrailIds: [CARD_ID],
      },
    };
    db.createNovel(current);

    const resolved = resolveWritingStyleRequest(current.id);

    const guardrail = resolved.executionSnapshot.guardrails.find((item) => item.id === CARD_ID);
    assert.ok(guardrail, 'configured card must join the guardrail list');
    assert.deepEqual(guardrail.stage, 'writer');
    assert.match(guardrail.prompt, /翻案腔/);
    assert.match(resolved.executionSnapshot.stagePrompts.writer, new RegExp(`【系统护栏：${CARD_ID}】`));
    assert.ok(resolved.executionSnapshot.capabilityRefs?.includes(CARD_ID));
  } finally { closeDb(); }
});

test('de-ai-tells-guard stays opt-in: absent from default guardrails and polish recommendations', () => {
  closeDb(); initDb(':memory:');
  try {
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);

    const resolved = resolveWritingStyleRequest(current.id);
    assert.equal(
      resolved.executionSnapshot.guardrails.some((item) => item.id === CARD_ID),
      false,
      'card must not run unless the user configures it',
    );

    const polishRecommended = recommendPromptAssets({ currentStage: 'polish' });
    assert.equal(
      polishRecommended.some((asset) => asset.id === CARD_ID),
      false,
      'score below the category max keeps the card out of polish recommendations',
    );
  } finally { closeDb(); }
});
