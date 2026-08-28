import { describe, expect, test } from 'vitest';

import {
  getAuthorFacingCapabilityActionHint,
  buildEffectiveCapabilitySummary,
  getAuthorFacingCapabilityCardCategory,
  getAuthorFacingCapabilityDeckHint,
  getAuthorFacingCapabilityEntryHint,
  getAuthorFacingCapabilityScopeLabel,
  getAuthorFacingCapabilityUseHint,
  resolveCapabilityDisplayName,
} from '../lib/capability-stage-cards';
import { listCatalogCapabilityManifests } from '../../shared/lib/capability-manifest-catalog';
import type { CapabilityManifestEntry } from '../../shared/types/capability-manifest';
import type { DeconstructionCardType } from '../../shared/types/skills';
import type { ProjectPreferenceProfile } from '../../shared/types';

describe('author-facing capability card categories', () => {
  test.each<[DeconstructionCardType, string]>([
    ['style-card', '文风卡'],
    ['hook-card', '结构卡'],
    ['conflict-card', '结构卡'],
    ['pacing-card', '结构卡'],
    ['platform-card', '结构卡'],
    ['worldview-card', '世界观卡'],
    ['character-card', '世界观卡'],
  ])('maps %s to %s', (cardType, category) => {
    expect(getAuthorFacingCapabilityCardCategory(cardType)).toBe(category);
  });

  test('maps diagnostic, transform and guardrail manifests without internal labels', () => {
    const base: CapabilityManifestEntry = {
      id: 'capability-1',
      version: '3',
      kind: 'diagnostic',
      stages: ['critic'],
      input: 'text',
      output: 'diagnostic',
      action: 'run-diagnostic',
      allowedScopes: ['single-run'],
      sideEffect: 'none',
      runtimeStatus: 'active',
      sourceType: 'built-in',
    };

    expect(getAuthorFacingCapabilityCardCategory(base)).toBe('审稿卡');
    expect(getAuthorFacingCapabilityCardCategory({ ...base, kind: 'technique', output: 'transform-preview' })).toBe('精修卡');
    expect(getAuthorFacingCapabilityCardCategory({ ...base, kind: 'guardrail' })).toBe('护栏卡');
    expect(getAuthorFacingCapabilityCardCategory({ ...base, kind: 'technique', output: 'outline-candidate', outputArtifact: 'worldBibleCandidate' })).toBe('世界观卡');
  });

  test('explains when authors should use each card category', () => {
    expect(getAuthorFacingCapabilityUseHint('世界观卡')).toBe('适合：大纲、人设与世界观设定');
    expect(getAuthorFacingCapabilityUseHint('结构卡')).toBe('适合：拆解结构、节奏与钩子');
    expect(getAuthorFacingCapabilityUseHint('精修卡')).toBe('适合：审稿后生成局部精修预览');
    expect(getAuthorFacingCapabilityUseHint('审稿卡')).toBe('适合：写后检查跑偏、重复与逻辑问题');
  });

  test('explains where authors should use each card category', () => {
    expect(getAuthorFacingCapabilityEntryHint('世界观卡')).toBe('入口：应用配置后设为作品默认，再回到大纲与设定');
    expect(getAuthorFacingCapabilityEntryHint('结构卡')).toBe('入口：应用配置后设为作品默认，用于开篇和节奏');
    expect(getAuthorFacingCapabilityEntryHint('精修卡')).toBe('入口：收藏后可点「应用配置后写入本章规则」或「生成精修预览」');
    expect(getAuthorFacingCapabilityEntryHint('审稿卡')).toBe('入口：写后直接运行审稿诊断');
    expect(getAuthorFacingCapabilityEntryHint('护栏卡')).toBe('入口：保存为系统检查候选，应用配置后参与写作与审稿检查');
    expect(getAuthorFacingCapabilityEntryHint('文风卡')).toBe('入口：可设为作品默认统一全文，也可点「用于本章」配置章节表达');
  });

  test('explains deconstruction card deck entry without changing generic categories', () => {
    expect(getAuthorFacingCapabilityDeckHint({ deconstructionCardType: 'style-card' })).toBe('入口：先选主卡或辅卡位置，应用配置后用于拆书');
    expect(getAuthorFacingCapabilityDeckHint({ deconstructionCardType: undefined })).toBeNull();
  });

  test('explains what each action will change before authors click', () => {
    const base: CapabilityManifestEntry = {
      id: 'capability-1',
      version: '3',
      kind: 'technique',
      stages: ['writer'],
      input: 'text',
      output: 'configuration',
      action: 'use-technique',
      allowedScopes: ['chapter'],
      sideEffect: 'configuration',
      runtimeStatus: 'active',
      sourceType: 'built-in',
    };

    expect(getAuthorFacingCapabilityActionHint(base)).toBe('应用配置后只影响当前章节写作。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, allowedScopes: ['project'], output: 'outline-candidate' })).toBe('配置到作品：应用配置后写入大纲技法，并前往大纲继续使用。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, allowedScopes: ['project'], output: 'configuration' })).toBe('配置到作品：应用配置后写入作品默认配置。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, outputArtifact: 'worldBibleCandidate' })).toBe('配置到作品：应用配置后写入设定素材，并前往世界观继续整理。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, kind: 'skill-card', action: 'add-to-stack', deconstructionCardType: 'style-card' })).toBe('卡组位置：先选主卡或辅卡，应用配置后写入作品卡组。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, kind: 'guardrail', action: 'automatic', allowedScopes: ['system'], sideEffect: 'none' })).toBe('护栏卡先保存为系统检查候选；应用配置后参与写作与审稿检查，凭证在生成或审稿结果中查看。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, output: 'transform-preview', allowedScopes: ['chapter', 'single-run'], sideEffect: 'preview-only' })).toBe('应用配置后可写入本章规则；运行一次只生成精修预览。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, allowedScopes: ['project', 'chapter'], output: 'configuration', sideEffect: 'configuration' })).toBe('可设为作品默认统一全文，也可只用于当前章节。');
    expect(getAuthorFacingCapabilityActionHint({ ...base, kind: 'diagnostic', output: 'diagnostic', action: 'run-diagnostic', allowedScopes: ['single-run'], sideEffect: 'none' })).toBe('运行一次：只生成诊断或辅助结果，不改正文。');
  });

  test('all catalog manifests resolve to author-facing categories and scopes', () => {
    const internalTerms = /mounted|overlay|utility|guardrail|single-run|project|chapter|system/i;

    for (const manifest of listCatalogCapabilityManifests()) {
      const category = getAuthorFacingCapabilityCardCategory(manifest);
      expect(['文风卡', '结构卡', '世界观卡', '审稿卡', '精修卡', '护栏卡']).toContain(category);
      expect(category).not.toMatch(internalTerms);

      for (const scope of manifest.allowedScopes) {
        const label = getAuthorFacingCapabilityScopeLabel(scope);
        expect(['作品默认', '本章使用', '仅运行一次', '系统检查']).toContain(label);
        expect(label).not.toMatch(internalTerms);
      }
    }
  });
});

describe('effective capability summary', () => {
  test('summarizes project defaults, chapter cards, effective techniques and folded names', () => {
    const profile: ProjectPreferenceProfile = {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'main', supportCardIds: ['support-world'], updatedAt: 1 },
        favoriteTechniqueIds: ['favorite-only'],
        projectTechniqueIds: ['prose-mouth-flavor', 'opening-gold-three'],
      },
    };

    const summary = buildEffectiveCapabilitySummary({
      projectPreferenceProfile: profile,
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '',
        order: 1,
        wordCount: 0,
        createdAt: 1,
        updatedAt: 1,
        workflowMeta: {
          version: 1,
          capabilityState: {
            techniqueIds: ['prose-action-booster', 'opening-gold-three'],
            overlayCardIds: ['chapter-card', 'chapter-world'],
            updatedAt: 1,
          },
        },
      },
      librarySkills: [
        { id: 'support-world', name: '世界观辅助卡', deconstructionCardType: 'worldview-card' },
        { id: 'chapter-card', name: '本章卡', deconstructionCardType: 'style-card' },
        { id: 'chapter-world', name: '本章世界观卡', deconstructionCardType: 'worldview-card' },
        { id: 'prose-mouth-flavor', name: '作品技法' },
        { id: 'prose-action-booster', name: '本章技法' },
        { id: 'main', name: '主卡', deconstructionCardType: 'style-card' },
      ],
      maxNames: 2,
    });

    expect(summary.summaryText).toBe('作品默认 1 · 本章 1 · 作品技法 1 · 本章技法 1 · 系统护栏 12');
    expect(summary.projectDefaultCount).toBe(1);
    expect(summary.projectTechniqueCount).toBe(1);
    expect(summary.chapterTechniqueCount).toBe(1);
    expect(summary.names).toEqual(['主卡', '本章卡']);
    expect(summary.overflowCount).toBe(14);
  });

  test('includes system guardrail ids and names in the effective summary', () => {
    const profile: ProjectPreferenceProfile = {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        guardrailIds: ['square-13'],
      },
    };

    const summary = buildEffectiveCapabilitySummary({
      projectPreferenceProfile: profile,
      currentChapter: null,
      librarySkills: [{ id: 'square-13', name: '文本润色护栏' }],
    });

    expect(summary.summaryText).toBe('作品默认 0 · 本章 0 · 作品技法 0 · 本章技法 0 · 系统护栏 13');
    expect(summary.guardrailIds).toHaveLength(13);
    expect(summary.guardrailIds[0]).toBe('inspirationSystem');
    expect(summary.guardrailIds).toContain('core-slop-shield');
    expect(summary.guardrailIds).toContain('core-dialogue-enhancer');
    expect(summary.guardrailIds.at(-1)).toBe('square-13');
    expect(summary.names).toEqual(['灵感助手', '故事方案卡', 'AI 审计', '正文生成内审', '短篇文章逻辑检测分析器']);
  });

  test('does not count a project technique twice when the chapter repeats it', () => {
    const profile: ProjectPreferenceProfile = {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['prose-mouth-flavor'],
      },
    };

    const summary = buildEffectiveCapabilitySummary({
      projectPreferenceProfile: profile,
      currentChapter: {
        id: 'chapter-1', novelId: 'novel-1', title: '第一章', content: '', order: 1,
        wordCount: 0, createdAt: 1, updatedAt: 1,
        workflowMeta: { version: 1, capabilityState: { techniqueIds: ['prose-mouth-flavor'], overlayCardIds: [], updatedAt: 1 } },
      },
      librarySkills: [{ id: 'prose-mouth-flavor', name: '共享技法' }],
    });

    expect(summary.summaryText).toBe('作品默认 0 · 本章 0 · 作品技法 1 · 本章技法 0 · 系统护栏 12');
    expect(summary.names).toEqual(['共享技法', '灵感助手', '故事方案卡', 'AI 审计', '正文生成内审']);
  });

  test('resolves a persisted plaza technique through capability membership', () => {
    const profile: ProjectPreferenceProfile = {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['saved-mouth-flavor'],
        capabilityMemberships: [{
          sourceId: 'prose-mouth-flavor',
          sourceVersion: '3',
          sourceType: 'plaza',
          persistedSkillId: 'saved-mouth-flavor',
        }],
      },
    };

    const summary = buildEffectiveCapabilitySummary({
      projectPreferenceProfile: profile,
      currentChapter: {
        id: 'chapter-1', novelId: 'novel-1', title: '第一章', content: '', order: 1,
        wordCount: 0, createdAt: 1, updatedAt: 1,
        workflowMeta: { version: 1, capabilityState: { techniqueIds: ['prose-mouth-flavor', 'saved-mouth-flavor'], overlayCardIds: [], updatedAt: 1 } },
      },
      librarySkills: [{ id: 'saved-mouth-flavor', name: '已保存口语技法' }],
    });

    expect(summary.projectTechniqueCount).toBe(1);
    expect(summary.chapterTechniqueCount).toBe(0);
    expect(summary.names[0]).toBe('已保存口语技法');
  });

  test('resolves catalog capability names before falling back to raw ids', () => {
    expect(resolveCapabilityDisplayName('style-ancient-elegance', [])).toBe('古言华美辞藻典雅国风参考包');
    expect(resolveCapabilityDisplayName('saved-card', [{ id: 'saved-card', name: '已保存卡' }])).toBe('已保存卡');
    expect(resolveCapabilityDisplayName('missing-card', [])).toBe('missing-card');
    expect(resolveCapabilityDisplayName(undefined, [])).toBe('未设置');
  });
});
