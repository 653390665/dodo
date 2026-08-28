import { useMemo, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';

import type { Skill } from '../../../shared/types';
import { readDraftStream } from '../../lib/draft-stream';
import { toast } from '../../lib/toast';
import { getTrustedSessionCardIds } from '../../lib/capability-governance';

interface SkillTestBenchProps {
  baseSkill: Skill;
  candidates: Skill[];
  novelId: string;
  allSkills: Skill[];
  chapterId?: string;
  databaseGeneration?: number;
  styleConfirmationFingerprint?: string;
}

async function runSkillStream(
  input: string,
  sessionCardIds: string[],
  novelId: string,
  chapterId: string,
  databaseGeneration: number,
  styleConfirmationFingerprint?: string,
) {
  const response = await fetch('/api/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      draftingSurface: 'workspace-draft',
      reviewSurface: 'chapter-review',
      contextStr: '这是能力卡试跑对比场景，不需要扩展世界观，只需要输出风格化正文。',
      sceneBeats: input,
      maxIterations: 1,
      draftContent: '',
      includeCritic: false,
      novelId,
      chapterId,
      databaseGeneration,
      sessionCardIds,
      ...(styleConfirmationFingerprint ? { styleConfirmationFingerprint } : {}),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || '试跑失败');
  }

  return readDraftStream(response);
}

export function SkillTestBench({
  baseSkill,
  candidates,
  novelId,
  allSkills,
  chapterId,
  databaseGeneration,
  styleConfirmationFingerprint,
}: SkillTestBenchProps) {
  const [input, setInput] = useState('');
  const [candidateId, setCandidateId] = useState<string>('');
  const [baseOutput, setBaseOutput] = useState('');
  const [candidateOutput, setCandidateOutput] = useState('');
  const [compareMode, setCompareMode] = useState<'single-skill' | 'combo'>('single-skill');
  const [runningMode, setRunningMode] = useState<'single' | 'compare' | null>(null);

  const candidateSkill = useMemo(
    () => candidates.find((skill) => skill.id === candidateId) || null,
    [candidateId, candidates],
  );

  async function handleRun(mode: 'single' | 'compare') {
    if (!input.trim()) return;
    if (!novelId) {
      toast('请先选择作品，再运行会消耗额度的能力卡试跑。', 'info');
      return;
    }
    if (!chapterId || databaseGeneration === undefined) {
      toast('能力卡试跑需要绑定当前章节和数据库版本，请从章节编辑器进入。', 'info');
      return;
    }

    const baseSessionCardIds = getTrustedSessionCardIds(
      [baseSkill.id, baseSkill.parentSkillId || ''],
      allSkills,
    );
    if (!baseSessionCardIds.length) {
      toast('当前能力卡尚未保存为可运行版本，暂不能试跑。', 'info');
      return;
    }

    setRunningMode(mode);
    setBaseOutput('');
    setCandidateOutput('');

    try {
      const primary = await runSkillStream(
        input,
        baseSessionCardIds,
        novelId,
        chapterId,
        databaseGeneration,
        styleConfirmationFingerprint,
      );
      setBaseOutput(primary);

      if (mode === 'compare' && candidateSkill) {
        const candidateSessionCardIds = getTrustedSessionCardIds(
          [candidateSkill.id, candidateSkill.parentSkillId || ''],
          allSkills,
        );
        if (!candidateSessionCardIds.length) {
          throw new Error('对比能力卡尚未保存为可运行版本，暂不能试跑');
        }
        const secondary = await runSkillStream(
          input,
          compareMode === 'combo'
            ? [...new Set([...baseSessionCardIds, ...candidateSessionCardIds])]
            : candidateSessionCardIds,
          novelId,
          chapterId,
          databaseGeneration,
          styleConfirmationFingerprint,
        );
        setCandidateOutput(secondary);
      }
    } catch (error) {
      toast(`试跑失败: ${String(error)}`, 'error');
    } finally {
      setRunningMode(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">试跑对比台</div>
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="输入一段细纲、对白或普通文本，测试当前能力卡版本的涂抹效果..."
        className="w-full min-h-[92px] rounded-xl border border-theme-border px-4 py-3 text-sm bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!input.trim() || !novelId || !chapterId || databaseGeneration === undefined || runningMode !== null}
            onClick={() => handleRun('single')}
            className="flex-1 rounded-xl bg-theme-text text-white px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {runningMode === 'single' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            运行当前版本
          </button>
          <button
            type="button"
            disabled={!input.trim() || !novelId || !chapterId || databaseGeneration === undefined || !candidateSkill || runningMode !== null}
            onClick={() => handleRun('compare')}
            className="flex-1 rounded-xl bg-theme-accent text-white px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {runningMode === 'compare' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            对比试跑
          </button>
        </div>
        <select
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          className="rounded-xl border border-theme-border px-3 py-2.5 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
        >
          <option value="">选择对比版本</option>
          {candidates
            .filter((skill) => skill.id !== baseSkill.id)
            .map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.fusionMeta
                  ? `${skill.name}（融合候选）`
                  : `v${skill.version || 1} · ${skill.description || skill.name}`}
              </option>
            ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCompareMode('single-skill')}
          className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
            compareMode === 'single-skill'
              ? 'border-theme-accent bg-theme-accent/10 text-theme-accent'
              : 'border-theme-border bg-theme-sidebar text-theme-muted hover:bg-theme-sidebar/20'
          }`}
        >
          单卡对比
        </button>
        <button
          type="button"
          onClick={() => setCompareMode('combo')}
          className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
            compareMode === 'combo'
              ? 'border-theme-accent bg-theme-accent/10 text-theme-accent'
              : 'border-theme-border bg-theme-sidebar text-theme-muted hover:bg-theme-sidebar/20'
          }`}
        >
          组合试跑
        </button>
        <div className="text-[11px] text-theme-muted self-center">
          {compareMode === 'combo'
            ? '右侧输出将使用：当前版本 + 候选卡'
            : '右侧输出将使用：候选卡单独试跑'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
          <div className="text-[11px] font-bold text-theme-muted mb-2">原始输入</div>
          <div className="text-sm text-theme-text/80 leading-relaxed whitespace-pre-wrap min-h-[120px]">
            {input || '等待输入测试片段'}
          </div>
        </div>
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
          <div className="text-[11px] font-bold text-theme-muted mb-2">
            {baseSkill.fusionMeta
              ? `${baseSkill.name} · 融合候选`
              : `当前能力卡 · v${baseSkill.version || 1}`}
          </div>
          <div className="text-sm text-theme-text/80 leading-relaxed whitespace-pre-wrap min-h-[120px]">
            {baseOutput || '等待运行当前版本'}
          </div>
        </div>
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
          <div className="text-[11px] font-bold text-theme-muted mb-2">
            {candidateSkill
              ? compareMode === 'combo'
                ? `组合能力卡 · ${baseSkill.fusionMeta ? baseSkill.name : `当前 v${baseSkill.version || 1}`} + ${candidateSkill.fusionMeta ? candidateSkill.name : `v${candidateSkill.version || 1}`}`
                : candidateSkill.fusionMeta
                  ? `对比能力卡 · ${candidateSkill.name}（融合候选）`
                  : `对比能力卡 · v${candidateSkill.version || 1}`
              : '对比能力卡'}
          </div>
          <div className="text-sm text-theme-text/80 leading-relaxed whitespace-pre-wrap min-h-[120px]">
            {candidateOutput ||
              (compareMode === 'combo'
                ? '选择一个候选卡后，可查看当前版本与候选卡的组合效果'
                : '选择一个历史版本后可对比试跑')}
          </div>
        </div>
      </div>
    </div>
  );
}
