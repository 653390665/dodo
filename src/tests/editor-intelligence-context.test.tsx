import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { useEditorIntelligenceContext } from '../lib/hooks/useEditorIntelligenceContext';
import type { Chapter, Novel, Skill } from '../../shared/types';

const now = 1;

function skill(id: string, name: string): Skill {
  return {
    id,
    name,
    description: `${name} description`,
    style: `${name} style`,
    pacing: `${name} pacing`,
    stabilityScore: 90,
    evaluationFeedback: '',
    version: 1,
    createdAt: now,
    primaryDimension: 'style',
  };
}

function novelWithProjectDeck(): Novel {
  return {
    id: 'novel-1',
    title: '测试作品',
    authorId: 'local-user',
    summary: '故事简介',
    worldRules: '世界规则',
    globalOutline: '全局大纲',
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
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: {
          mainCardId: 'main-card',
          supportCardIds: ['support-card'],
          updatedAt: now,
        },
        favoriteTechniqueIds: [],
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

const currentChapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  content: '',
  sceneBeats: '本章分镜',
  order: 1,
  wordCount: 0,
  createdAt: now,
  updatedAt: now,
};

describe('useEditorIntelligenceContext', () => {
  test('v3 作品卡组进入前端智能上下文与推荐判断', () => {
    const { result } = renderHook(() => useEditorIntelligenceContext({
      novel: novelWithProjectDeck(),
      chapters: [],
      currentChapter,
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      librarySkills: [
        skill('main-card', '主笔节奏卡'),
        skill('support-card', '世界观约束卡'),
      ],
      mountedSkillLoadout: [],
      continuationPacks: [],
      selectedContinuationPackId: '',
      sniffedEntities: null,
      userIntent: '',
      agentTab: 'planning',
    }));

    expect(result.current.mountedSkills.map((entry) => entry.name)).toEqual([
      '主笔节奏卡',
      '世界观约束卡',
    ]);
    expect(result.current.agentContext.mountedSkills?.map((entry) => entry.id)).toEqual([
      'main-card',
      'support-card',
    ]);
    expect(result.current.copilotSuggestion.reasons.ready).toContain('作品默认能力卡 2 张');
    expect(result.current.copilotSuggestion.reasons.risks).not.toContain('尚未配置作品默认能力卡');
  });

  test('active catalog 作品主卡无本地克隆时也进入前端智能上下文', () => {
    const novel = novelWithProjectDeck();
    novel.projectPreferenceProfile!.capabilityProfile!.projectSkillDeck = {
      mainCardId: 'style-ancient-elegance',
      supportCardIds: [],
      updatedAt: now,
    };

    const { result } = renderHook(() => useEditorIntelligenceContext({
      novel,
      chapters: [],
      currentChapter,
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      librarySkills: [],
      mountedSkillLoadout: [],
      continuationPacks: [],
      selectedContinuationPackId: '',
      sniffedEntities: null,
      userIntent: '',
      agentTab: 'planning',
    }));

    expect(result.current.mountedSkills.map((entry) => entry.name)).toEqual([
      '古言华美辞藻典雅国风参考包',
    ]);
    expect(result.current.agentContext.mountedSkills?.map((entry) => entry.id)).toEqual([
      'style-ancient-elegance',
    ]);
    expect(result.current.copilotSuggestion.reasons.ready).toContain('作品默认能力卡 1 张');
    expect(result.current.copilotSuggestion.reasons.risks).not.toContain('尚未配置作品默认能力卡');
  });
});
