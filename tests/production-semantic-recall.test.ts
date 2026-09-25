// Must stay the first import: it pins process.env before server/lib/config.ts
// snapshots it into its frozen defaults (see tests/helpers/llm-env.ts).
import './helpers/llm-env.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductionPromptContexts,
} from '../shared/lib/chapter-production.ts';
import {
  MAX_SEMANTIC_RECALL_CHARS,
  SEMANTIC_RECALL_MARKER,
  buildSemanticRecallSection,
  type SemanticRecallDeps,
} from '../server/helpers/story-context.ts';

const FRAGMENT = 'SEMANTIC_RECALL_FRAGMENT_SENTINEL：去年冬天，林舟在渡口把铜铃交给守夜人。';

function stubDeps(overrides: Partial<SemanticRecallDeps> = {}): SemanticRecallDeps {
  return {
    getChunkCount: () => 3,
    getEmbeddingStatus: () => ({ status: 'ready' }),
    embedWithMetadata: async () => ({ values: [1, 0], modelId: 'stub-model' }),
    searchSimilar: () => [{ text: FRAGMENT, score: 0.9, chapterId: 'chapter-old' }],
    ...overrides,
  };
}

test('semantic recall section carries the marker, the fragments and the hit count', async () => {
  const section = await buildSemanticRecallSection(
    { novelId: 'novel-semantic', queryText: '本章：渡口的雨夜' },
    stubDeps({
      searchSimilar: () => [
        { text: '第一段过往来信', score: 0.9, chapterId: 'chapter-a' },
        { text: '  第二段过往来信  ', score: 0.8, chapterId: 'chapter-b' },
      ],
    })
  );
  assert.ok(section);
  assert.equal(section.marker, SEMANTIC_RECALL_MARKER);
  assert.equal(section.hitCount, 2);
  assert.equal(section.text, '第一段过往来信\n---\n第二段过往来信');
  assert.equal(section.injectedChars, section.text.length);
  assert.equal(section.truncated, false);
});

test('semantic recall section truncates at MAX_SEMANTIC_RECALL_CHARS', async () => {
  const huge = '甲'.repeat(5_000);
  const section = await buildSemanticRecallSection(
    { novelId: 'novel-semantic', queryText: '本章：渡口的雨夜' },
    stubDeps({ searchSimilar: () => [{ text: huge, score: 0.9, chapterId: 'chapter-old' }] })
  );
  assert.ok(section);
  assert.equal(section.injectedChars, MAX_SEMANTIC_RECALL_CHARS);
  assert.equal(section.text.length, MAX_SEMANTIC_RECALL_CHARS);
  assert.equal(section.truncated, true);
});

test('semantic recall degrades to null when the index, the provider or the hits are unavailable', async () => {
  const query = { novelId: 'novel-semantic', queryText: '本章：渡口的雨夜' };

  assert.equal(await buildSemanticRecallSection(query, stubDeps({ getChunkCount: () => 0 })), null);
  assert.equal(
    await buildSemanticRecallSection(
      query,
      stubDeps({ getEmbeddingStatus: () => ({ status: 'unavailable' }) })
    ),
    null
  );
  assert.equal(
    await buildSemanticRecallSection(
      query,
      stubDeps({ getEmbeddingStatus: () => ({ status: 'initializing' }) })
    ),
    null
  );
  assert.equal(
    await buildSemanticRecallSection(
      query,
      stubDeps({
        embedWithMetadata: async () => {
          throw new Error('embedding down');
        },
      })
    ),
    null
  );
  assert.equal(await buildSemanticRecallSection(query, stubDeps({ searchSimilar: () => [] })), null);
  assert.equal(
    await buildSemanticRecallSection(query, stubDeps({ searchSimilar: () => [{ text: '   ', score: 0, chapterId: 'c' }] })),
    null
  );
  assert.equal(await buildSemanticRecallSection({ ...query, queryText: '   ' }, stubDeps()), null);
});

test('production prompt contexts append the semantic block last and stay byte-identical without it', () => {
  const base = {
    layeredContext: '',
    plannerContext: 'PLANNER_BASE',
    writerContext: 'WRITER_BASE',
    criticContext: 'CRITIC_BASE',
    continuationPackContext: 'PACK_BASE',
  };

  // Byte-level lock: with no semantic context the composed strings are exactly
  // the pre-change shape (`composeUniqueContext` joins non-empty unique parts).
  const unchanged = buildProductionPromptContexts(base);
  assert.equal(unchanged.planner, 'PACK_BASE\n\nPLANNER_BASE');
  assert.equal(unchanged.writer, 'WRITER_BASE\n\nPACK_BASE');
  assert.equal(unchanged.critic, 'CRITIC_BASE\n\nPACK_BASE');
  assert.equal(buildProductionPromptContexts({ ...base, semanticContext: undefined }).writer, unchanged.writer);
  assert.equal(buildProductionPromptContexts({ ...base, semanticContext: '' }).writer, unchanged.writer);

  const semanticContext = `${SEMANTIC_RECALL_MARKER}\n${FRAGMENT}`;
  const withSemantic = buildProductionPromptContexts({ ...base, semanticContext });
  for (const stage of ['planner', 'writer', 'critic'] as const) {
    assert.match(withSemantic[stage], new RegExp(SEMANTIC_RECALL_MARKER.replace(/[【】]/g, '\\$&')));
    assert.match(withSemantic[stage], /SEMANTIC_RECALL_FRAGMENT_SENTINEL/);
    assert.ok(withSemantic[stage].endsWith(semanticContext), `${stage} keeps canon first, recall last`);
  }
});

test('production prompt contexts never exceed the shared char budget', () => {
  const semanticContext = `${SEMANTIC_RECALL_MARKER}\n${'乙'.repeat(3_000)}`;
  const base = {
    layeredContext: '',
    plannerContext: 'PLANNER_BASE',
    writerContext: 'WRITER_BASE',
    criticContext: 'CRITIC_BASE',
    continuationPackContext: 'PACK_BASE',
  };

  const withinBudget = buildProductionPromptContexts({ ...base, semanticContext });
  for (const stage of ['planner', 'writer', 'critic'] as const) {
    assert.ok(withinBudget[stage].length <= 24_000, `${stage} stays under the default budget`);
    assert.match(withinBudget[stage], /SEMANTIC|【语义相关的过往章节片段】/);
  }

  const squeezed = buildProductionPromptContexts({ ...base, semanticContext }, 40);
  for (const stage of ['planner', 'writer', 'critic'] as const) {
    assert.ok(squeezed[stage].length <= 40, `${stage} respects a tight budget`);
  }
  assert.doesNotMatch(squeezed.writer, /SEMANTIC_RECALL_FRAGMENT_SENTINEL/);
});

test('production pipeline requests carry the RAG marker and fragment', async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const draftContent = Array.from(
    { length: 36 },
    (_, index) =>
      `序号${index + 1}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。` +
      `林舟在第${index + 1}次确认时暂缓回应门后的询问，先确认手中的铜铃仍然完整，随后把下一步行动拆成几个可以回收的选择。` +
      `第${index + 1}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。`
  ).join('\n\n');
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    requests.push(body.messages?.map((message) => message.content || '').join('\n') || '');
    const content =
      requests.length === 1
        ? 'BEATS'
        : requests.length === 2
          ? draftContent
          : JSON.stringify({
              score: 80,
              fatalIssues: [],
              sceneChecks: [],
              surgerySuggestions: [],
              evidence: [
                {
                  category: 'scene_execution',
                  severity: 'low',
                  quote: '场景证据',
                  explanation: '动作目标清晰',
                  suggestedFix: '保持动作链',
                },
                {
                  category: 'character_state',
                  severity: 'low',
                  quote: '角色证据',
                  explanation: '人物选择一致',
                  suggestedFix: '保持人物动机',
                },
                {
                  category: 'hard_canon',
                  severity: 'low',
                  quote: '设定证据',
                  explanation: '设定约束一致',
                  suggestedFix: '保持规则约束',
                },
                {
                  category: 'foreshadowing',
                  severity: 'low',
                  quote: '伏笔证据',
                  explanation: '章末信息可追踪',
                  suggestedFix: '后续回收线索',
                },
              ],
            });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`
          )
        );
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      body: stream,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as Response;
  }) as typeof fetch;

  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const semanticContext = `${SEMANTIC_RECALL_MARKER}\n${FRAGMENT}`;
    const stageContexts = buildProductionPromptContexts({
      layeredContext: '',
      plannerContext: 'PLANNER_CONTEXT_SENTINEL',
      writerContext: 'WRITER_CONTEXT_SENTINEL',
      criticContext: 'CRITIC_CONTEXT_SENTINEL',
      continuationPackContext: 'PACK_CONTEXT_SENTINEL',
      semanticContext,
    });

    await runProductionPipeline({
      novelId: 'semantic-recall-novel',
      userIntent: '推进本章冲突',
      contextStr: stageContexts.writer,
      stageContexts,
      stagePrompts: { planner: '', writer: '', critic: '' },
    });

    assert.ok(requests.length >= 3, `expected planner/writer/critic calls, got ${requests.length}`);
    const plannerRequest = requests[0];
    assert.match(plannerRequest, /PLANNER_CONTEXT_SENTINEL/);
    assert.match(plannerRequest, /SEMANTIC_RECALL_FRAGMENT_SENTINEL/);
    assert.match(plannerRequest, /【语义相关的过往章节片段】/);
    assert.doesNotMatch(plannerRequest, /WRITER_CONTEXT_SENTINEL|CRITIC_CONTEXT_SENTINEL/);

    const writerRequest = requests[1];
    assert.match(writerRequest, /WRITER_CONTEXT_SENTINEL/);
    assert.match(writerRequest, /SEMANTIC_RECALL_FRAGMENT_SENTINEL/);
    assert.match(writerRequest, /【语义相关的过往章节片段】/);

    const criticRequest = requests.find((request) => /CRITIC_CONTEXT_SENTINEL/.test(request));
    assert.ok(criticRequest, 'critic request should carry the critic stage context');
    assert.match(criticRequest, /SEMANTIC_RECALL_FRAGMENT_SENTINEL/);
    assert.match(criticRequest, /【语义相关的过往章节片段】/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
