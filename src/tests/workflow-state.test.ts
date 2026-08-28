import { describe, expect, test } from 'vitest';
import { deriveProjectWorkflowState, deriveWorkflowState } from '../lib/workflow-state';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';

describe('deriveWorkflowState', () => {
  test('加载中不暴露动作', () => {
    expect(deriveWorkflowState({ loading: true })).toMatchObject({ phase: 'import', primaryAction: null });
  });

  test('approved 资料包未同步时以同步为主动作，但仍允许继续章节阶段', () => {
    const state = deriveWorkflowState({
      loading: false,
      chapter: { content: '', sceneBeats: '' },
      packStatus: 'approved',
      syncState: 'not_started',
    });

    expect(state.phase).toBe('sync');
    expect(state.primaryAction).toBe('sync');
    expect(state.secondaryAction).toBe('planning');
  });

  test('草稿资料包进入资料审阅阶段', () => {
    expect(deriveProjectWorkflowState({ loading: false, chapter: null, packStatus: 'draft' })).toMatchObject({
      phase: 'review',
      primaryAction: 'review',
    });
    expect(deriveWorkflowState({ loading: false, chapter: { content: '' }, packStatus: 'draft' })).toMatchObject({
      phase: 'review',
      primaryAction: 'review',
    });
  });

  test.each(['not_started', 'partial', 'stale'] as const)('%s 需要同步，synced 不重复同步', (syncState) => {
    expect(deriveProjectWorkflowState({ loading: false, chapter: { content: '正文' }, packStatus: 'approved', syncState }).primaryAction).toBe('sync');
    expect(deriveProjectWorkflowState({ loading: false, chapter: { content: '正文' }, packStatus: 'approved', syncState: 'synced' }).primaryAction).not.toBe('sync');
  });

  test('approved 资料包状态未知时不宣称需要同步', () => {
    const state = deriveProjectWorkflowState({
      loading: false,
      chapter: { content: '', sceneBeats: '' },
      packStatus: 'approved',
      syncState: 'unknown',
    });

    expect(state.phase).not.toBe('sync');
    expect(state.primaryAction).not.toBe('sync');
  });

  test('按章节状态派生统一主动作', () => {
    expect(deriveWorkflowState({ loading: false, chapter: { content: '', sceneBeats: '' } }).primaryAction).toBe('generate-plan');
    expect(deriveWorkflowState({ loading: false, chapter: { content: '', sceneBeats: '分镜' } }).primaryAction).toBe('generate-prose');
    expect(deriveWorkflowState({ loading: false, chapter: { content: '正文', sceneBeats: '分镜' } }).primaryAction).toBe('complete-chapter');

    const contentHash = computeChapterWorkflowHash('正文', '分镜');
    const failed = {
      content: '正文', sceneBeats: '分镜',
      workflowMeta: { version: 1 as const, lastAudit: { status: 'fail' as const, contentHash, completedAt: 1, source: 'model' as const } },
    };
    expect(deriveWorkflowState({ loading: false, chapter: failed }).primaryAction).toBe('resolve-issues');

    const passed = {
      content: '正文', sceneBeats: '分镜',
      workflowMeta: { version: 1 as const, lastAudit: { status: 'pass' as const, contentHash, completedAt: 1, source: 'model' as const } },
    };
    expect(deriveWorkflowState({ loading: false, chapter: passed }).primaryAction).toBe('complete-chapter');
  });

  test('内容变化使旧审计过期，精修输出匹配时可进入下一章', () => {
    const staleHash = computeChapterWorkflowHash('旧正文', '分镜');
    const currentHash = computeChapterWorkflowHash('精修正文', '分镜');
    expect(deriveWorkflowState({
      loading: false,
      chapter: {
        content: '精修正文', sceneBeats: '分镜',
        workflowMeta: { version: 1, lastAudit: { status: 'pass', contentHash: staleHash, completedAt: 1, source: 'model' } },
      },
    }).primaryAction).toBe('complete-chapter');
    expect(deriveWorkflowState({
      loading: false,
      chapter: {
        content: '精修正文', sceneBeats: '分镜',
        workflowMeta: {
          version: 1,
          lastAudit: { status: 'fail', contentHash: staleHash, completedAt: 1, source: 'model' },
          lastPolish: { inputHash: staleHash, outputHash: currentHash, completedAt: 2 },
        },
      },
    }).primaryAction).toBe('complete-chapter');
  });

  test.each(['unknown', 'not_run'] as const)('%s 审计状态仍需重新审计', (status) => {
    const contentHash = computeChapterWorkflowHash('正文', '分镜');
    expect(deriveWorkflowState({
      loading: false,
      chapter: {
        content: '正文', sceneBeats: '分镜',
        workflowMeta: { version: 1, lastAudit: { status, contentHash, completedAt: 1, source: 'fallback' } },
      },
      }).primaryAction).toBe('complete-chapter');
  });

  test('reviewState uses current hash as the soft gate', () => {
    const contentHash = computeChapterWorkflowHash('正文', '分镜');
    const issue = { id: 'issue-1', source: 'chapter-audit' as const, category: 'pacing', severity: 'major' as const, explanation: '节奏问题', recommendedCapabilityIds: [], status: 'open' as const, contentHash, createdAt: 1, updatedAt: 1 };
    expect(deriveWorkflowState({ loading: false, chapter: { content: '正文', sceneBeats: '分镜', workflowMeta: { version: 1, reviewState: { schemaVersion: 1, contentHash, issues: [issue], gate: 'needs-action' } } } }).primaryAction).toBe('resolve-issues');
    expect(deriveWorkflowState({ loading: false, chapter: { content: '正文', sceneBeats: '分镜', workflowMeta: { version: 1, reviewState: { schemaVersion: 1, contentHash, issues: [{ ...issue, status: 'accepted-risk' }], gate: 'accepted-risk' } } } }).primaryAction).toBe('complete-chapter');
    expect(deriveWorkflowState({ loading: false, chapter: { content: '新正文', sceneBeats: '分镜', workflowMeta: { version: 1, reviewState: { schemaVersion: 1, contentHash, issues: [issue], gate: 'pass' } } } }).primaryAction).toBe('complete-chapter');
  });

  test('完成门就绪且事实候选已决策时创建下一章', () => {
    const contentHash = computeChapterWorkflowHash('正文', '分镜');
    expect(deriveWorkflowState({ loading: false, chapter: {
      content: '正文', sceneBeats: '分镜', workflowMeta: { version: 1, completionGate: 'ready', completionContentHash: contentHash, factCandidateId: 'candidate-1', factCandidateRunId: 'run-1' },
    } }).primaryAction).toBe('confirm-facts');
    expect(deriveWorkflowState({ loading: false, chapter: {
      content: '正文', sceneBeats: '分镜', workflowMeta: { version: 1, completionGate: 'ready', completionContentHash: contentHash, completionDecisionAt: 1 },
    } }).primaryAction).toBe('create-next-chapter');
    expect(deriveWorkflowState({ loading: false, chapter: {
      content: '正文', sceneBeats: '分镜', workflowMeta: { version: 1, completionGate: 'accepted-risk', completionContentHash: contentHash, factCandidateId: 'candidate-1', factCandidateRunId: 'run-1', reviewState: { schemaVersion: 1, contentHash, issues: [{ id: 'risk-1', source: 'chapter-audit', severity: 'major', explanation: '作者接受的问题', recommendedCapabilityIds: [], status: 'open', contentHash, createdAt: 1, updatedAt: 1 }], gate: 'needs-action' } },
    } }).primaryAction).toBe('confirm-facts');
    expect(deriveWorkflowState({ loading: false, chapter: {
      content: '正文已修改', sceneBeats: '分镜', workflowMeta: { version: 1, completionGate: 'ready', completionContentHash: contentHash },
    } }).primaryAction).toBe('complete-chapter');
    expect(contentHash).toBeTruthy();
  });
});
