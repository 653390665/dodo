import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PROMPT_TEMPLATES } from '../src/config/prompt-templates';
import { migrateLegacyPromptTemplates } from '../src/lib/config';

const LEGACY_INSPIRATION_SYSTEM =
  '你是一个资深小说编辑和文学创作助手。你的回答应该具有文学性、逻辑性，并能激发作者的灵感。';

const LEGACY_STORY_CARDS = `你是一个资深网文策划编辑。请根据用户的灵感种子和上下文，生成 3 张差异明确、可继续写的故事方案卡。

【灵感种子】
{{ideaSeed}}

【对话上下文】
{{chatContext}}

请严格输出 JSON：
{
  "cards": [
    {
      "id": "card-1",
      "hook": "一句话卖点",
      "protagonist": "主角设定摘要",
      "coreConflict": "核心冲突",
      "tone": "故事气质 / 文风",
      "whyItWorks": "为什么值得写",
      "starterSeeds": {
        "worldSeed": "世界观或背景种子",
        "relationshipSeed": "关键关系种子",
        "chapterOneSeed": "第一章起点种子"
      },
      "riskNote": "最容易写崩的点",
      "mixTags": ["标签1", "标签2"],
      "signals": {
        "tone": "grim | bright | lyrical | sharp",
        "conflictType": "冲突类型短语",
        "worldWeight": 0.7,
        "characterWeight": 0.6,
        "pacingPreference": "tight | balanced | slow-burn"
      }
    }
  ]
}

要求：
1. 三张卡必须方向不同，不能只是换同义词。
2. 不要输出正文片段，不要写成大段散文。
3. 每张卡都必须能直接映射到设定记忆页。`;

test('legacy builtin prompt text should differ from current default templates', () => {
  assert.notEqual(LEGACY_INSPIRATION_SYSTEM, DEFAULT_PROMPT_TEMPLATES.inspirationSystem);
  assert.notEqual(LEGACY_STORY_CARDS, DEFAULT_PROMPT_TEMPLATES.storyCards);
});

test('migrateLegacyPromptTemplates upgrades legacy builtin values but preserves current defaults', () => {
  const migrated = migrateLegacyPromptTemplates({
    inspirationSystem: LEGACY_INSPIRATION_SYSTEM,
    storyCards: LEGACY_STORY_CARDS,
    setupTaskRefine: DEFAULT_PROMPT_TEMPLATES.setupTaskRefine,
  });

  assert.equal(migrated?.inspirationSystem, DEFAULT_PROMPT_TEMPLATES.inspirationSystem);
  assert.equal(migrated?.storyCards, DEFAULT_PROMPT_TEMPLATES.storyCards);
  assert.equal(migrated?.setupTaskRefine, DEFAULT_PROMPT_TEMPLATES.setupTaskRefine);
});
