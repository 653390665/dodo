import React, { useState } from 'react';
import { Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import type { Character } from '../../../shared/types';
import type { ArtifactCandidate, CharacterCore } from '../../../shared/types/creative-artifacts';
import { CHARACTER_CORE_GAP_LABELS, diagnoseCharacterCore } from '../../../shared/lib/character-core';
import type { CapabilityRecommendationResult } from '../../../shared/types/capability-recommendation';
import { ContextualCapabilityRecommendation } from '../ContextualCapabilityRecommendation';

interface CharactersTabProps {
  characters: Character[];
  addEntity: (type: 'character') => void;
  deleteEntity: (type: 'character', id: string) => void;
  updateEntity: (type: 'character', id: string, data: Partial<Character>) => void;
  handleGenerateBio: (char: Character) => void;
  generatingBioIds: string[];
  generatingCandidateIds?: string[];
  candidatesByCharacterId?: Record<string, ArtifactCandidate<CharacterCore> | undefined>;
  onGenerateCandidate?: (character: Character) => void;
  onPreviewCandidate?: (candidate: ArtifactCandidate<CharacterCore>) => void;
  onAcceptCandidate?: (candidate: ArtifactCandidate<CharacterCore>) => void;
  onRejectCandidate?: (candidate: ArtifactCandidate<CharacterCore>) => void;
  recommendationsByCharacterId?: Record<string, CapabilityRecommendationResult | undefined>;
  onDismissRecommendation?: (character: Character, result: CapabilityRecommendationResult) => void;
  onOpenCapabilityStore?: () => void;
}

export function CharactersTab({
  characters,
  addEntity,
  deleteEntity,
  updateEntity,
  handleGenerateBio,
  generatingBioIds,
  generatingCandidateIds = [],
  candidatesByCharacterId = {},
  onGenerateCandidate,
  onPreviewCandidate,
  onAcceptCandidate,
  onRejectCandidate,
  recommendationsByCharacterId = {},
  onDismissRecommendation,
  onOpenCapabilityStore,
}: CharactersTabProps) {
  const [previewedCandidateIds, setPreviewedCandidateIds] = useState<string[]>([]);
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">登场人物</h2>
        <button
          onClick={() => addEntity('character')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增角色
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        {characters.map((char) => {
          const candidate = candidatesByCharacterId[char.id];
          const gaps = diagnoseCharacterCore(char.core || {});
          const recommendation = recommendationsByCharacterId[char.id];
          return <div
            key={char.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative"
          >
            <button
              onClick={() => deleteEntity('character', char.id)}
              className="absolute top-4 right-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
              aria-label="删除角色"
            >
              <Trash2 size={16} />
            </button>
            <input
              value={char.name}
              onChange={(e) => updateEntity('character', char.id, { name: e.target.value })}
              className="font-bold text-lg outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
            />
            <select
              value={char.role}
              onChange={(e) => updateEntity('character', char.id, { role: e.target.value as Character['role'] })}
              className="w-1/2 p-1 text-sm border-b border-theme-border/50 outline-none -mt-2 bg-transparent"
            >
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
              <option value="extra">龙套</option>
            </select>
            <input
              value={char.summary}
              onChange={(e) => updateEntity('character', char.id, { summary: e.target.value })}
              placeholder="一句话简介"
              className="text-sm outline-none bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -mx-1"
            />
            <div className="relative group/bio">
              <textarea
                value={char.bio}
                onChange={(e) => updateEntity('character', char.id, { bio: e.target.value })}
                placeholder="详细背景设定、性格、习惯..."
                className="w-full text-sm outline-none resize-none h-40 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-accent transition-all font-serif leading-relaxed"
              />
              <button
                onClick={() => handleGenerateBio(char)}
                disabled={generatingBioIds.includes(char.id)}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-theme-sidebar border border-theme-border/50 text-theme-accent text-xs font-bold rounded-lg shadow-sm hover:bg-theme-accent hover:text-white transition-all opacity-0 group-hover/bio:opacity-100 disabled:opacity-50"
                title="AI 生成背景故事"
              >
                {generatingBioIds.includes(char.id) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                AI 生成背景故事
              </button>
            </div>
            <section className="border-t border-theme-border/40 pt-3 text-xs text-theme-text/75 space-y-2" aria-label={`${char.name}结构化设定审阅`}>
              <p><span className="font-semibold text-theme-text">当前小传：</span>{char.bio || '未填写'}</p>
              <p><span className="font-semibold text-theme-text">结构缺口：</span>{gaps.length ? gaps.map((gap) => CHARACTER_CORE_GAP_LABELS[gap]).join('、') : '无'}</p>
              {recommendation?.primary && !candidate ? <ContextualCapabilityRecommendation
                result={recommendation}
                onSelect={() => onGenerateCandidate?.(char)}
                onDismiss={() => onDismissRecommendation?.(char, recommendation)}
                onOpenStore={onOpenCapabilityStore}
              /> : null}
              {candidate && <>
                <div aria-label="候选字段差异" className="space-y-1">
                  {candidate.diff.fields.length
                    ? candidate.diff.fields.map((field) => <p key={`${field.path}-${field.kind}`}>{field.path || '根字段'}：{field.kind}</p>)
                    : <p>候选未改变结构字段</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => {
                    setPreviewedCandidateIds((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]);
                    onPreviewCandidate?.(candidate);
                  }} className="underline" aria-label="预览角色候选">预览</button>
                  <button type="button" onClick={() => onAcceptCandidate?.(candidate)} className="underline" aria-label="接受角色候选">接受</button>
                  <button type="button" onClick={() => onRejectCandidate?.(candidate)} className="underline" aria-label="拒绝角色候选">拒绝</button>
                </div>
                {previewedCandidateIds.includes(candidate.id) && (
                  <div role="region" className="border-l-2 border-theme-accent/40 pl-2" aria-label="角色候选预览">
                    {candidate.proposedContent || candidate.diff.fields.map((field) => `${field.path}: ${String(field.after ?? '')}`).join('；')}
                  </div>
                )}
              </>}
              {!candidate && onGenerateCandidate && !recommendation?.primary && (
                <button
                  type="button"
                  onClick={() => onGenerateCandidate(char)}
                  disabled={generatingCandidateIds.includes(char.id)}
                  className="inline-flex items-center gap-1 text-theme-accent underline disabled:opacity-50"
                  aria-label="生成角色结构候选"
                >
                  {generatingCandidateIds.includes(char.id) ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {generatingCandidateIds.includes(char.id) ? '生成中' : '重塑角色结构'}
                </button>
              )}
            </section>
          </div>
        })}
      </div>
    </div>
  );
}
