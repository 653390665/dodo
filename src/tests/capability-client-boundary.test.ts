import { afterEach, describe, expect, test, vi } from 'vitest';
import { confirmWritingStyle } from '../lib/writing-style-client';
import { startChapterProductionRunStream } from '../lib/production-client';
import { buildContextPrompt } from '../lib/agents';
import type { Novel } from '../../shared/types';

afterEach(() => vi.restoreAllMocks());

describe('capability client boundary', () => {
  test('sends only server-resolvable ids, never skill objects or prompt text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resolution: { confirmed: true } }), { status: 200 }),
    );
    await confirmWritingStyle('novel-1', { chapterId: 'chapter-1', databaseGeneration: 7, continuationPackId: 'pack-1', sessionCardIds: ['card-1'], mode: 'default' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ chapterId: 'chapter-1', databaseGeneration: 7, continuationPackId: 'pack-1', sessionCardIds: ['card-1'], mode: 'default' });
    expect(body).not.toHaveProperty('skills');
    expect(body).not.toHaveProperty('prompt');
    expect(body).not.toHaveProperty('content');
  });

  test('passes only the style fingerprint and governed card ids to the production stream', async () => {
    const run = {
      id: 'run-1', novelId: 'novel-1', status: 'review_required', userIntent: '推进冲突',
      sceneBeats: '', draftContent: '', styleAudit: '',
      continuityReport: { score: 70, issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } },
      createdAt: 1, updatedAt: 1,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`data: ${JSON.stringify({ type: 'done', run })}\n\n`, { status: 200 }),
    );
    await startChapterProductionRunStream({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      userIntent: '推进冲突',
      writingStyleFingerprint: 'style-fingerprint-1',
      sessionCardIds: ['card-1'],
    }, vi.fn());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      userIntent: '推进冲突',
      styleConfirmationFingerprint: 'style-fingerprint-1',
      sessionCardIds: ['card-1'],
    });
    expect(body).not.toHaveProperty('skills');
    expect(body).not.toHaveProperty('prompt');
    expect(body).not.toHaveProperty('content');
    expect(JSON.stringify(body)).not.toContain('skill prompt sentinel');
  });

  test('retains factual context while excluding mounted skill prompt/style sentinels', () => {
    const context = buildContextPrompt({
      novel: {
        id: 'novel-1',
        title: '事实作品',
        authorId: 'local-user',
        summary: 'FACT_CONTEXT_SENTINEL',
        worldRules: 'FACT_WORLD_SENTINEL',
        globalOutline: 'FACT_OUTLINE_SENTINEL',
        status: 'ongoing',
        createdAt: 1,
        updatedAt: 1,
      } as Novel,
      characters: [],
      mountedSkills: [{ style: 'SKILL_STYLE_SENTINEL', pacing: 'SKILL_PROMPT_SENTINEL' } as never],
    });
    expect(context).toContain('FACT_CONTEXT_SENTINEL');
    expect(context).toContain('FACT_WORLD_SENTINEL');
    expect(context).toContain('FACT_OUTLINE_SENTINEL');
    expect(context).not.toContain('SKILL_STYLE_SENTINEL');
    expect(context).not.toContain('SKILL_PROMPT_SENTINEL');
  });
});
