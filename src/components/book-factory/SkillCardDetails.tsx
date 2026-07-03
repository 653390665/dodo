import React from 'react';
import type { Skill, AggregatedSkillDeck, BookEvidenceStage } from '../../../shared/types';

const EVIDENCE_COVERAGE_LABELS = {
  'full-book-stable': '全书稳定',
  'opening-heavy': '开篇偏强',
  'mid-book-heavy': '中段偏强',
  'climax-heavy': '高潮偏强',
  'weak-evidence': '局部信号',
};

const EVIDENCE_STAGE_LABELS: Record<BookEvidenceStage, string> = {
  opening: '开篇',
  'early-mid': '前中段',
  mid: '中段',
  'late-mid': '后中段',
  climax: '高潮/收束',
};

const SLOT_RECOMMENDATION = {
  style: { slotLabel: '卡槽 1 · 主笔位', reason: '优先决定整段文字的总笔调，适合做组合里的主声部。', cardType: '主笔文风卡' },
  character: { slotLabel: '卡槽 2 · 人物位', reason: '更适合作为人物塑造滤镜，补足角色说话方式与行为模式。', cardType: '人物驱动卡' },
  world: { slotLabel: '卡槽 2 · 设定位', reason: '适合作为中层背景约束，为主笔卡补充世界观与规则感。', cardType: '世界约束卡' },
  power: { slotLabel: '卡槽 2 · 设定位', reason: '适合作为战力与体系补强卡，避免主笔卡里塞满力量设定。', cardType: '体系爆点卡' },
  plot: { slotLabel: '卡槽 3 · 推进位', reason: '适合放在后段补强剧情推进与爽点结构。', cardType: '剧情推进卡' },
  pacing: { slotLabel: '卡槽 3 · 节奏位', reason: '更适合作为组合尾部调速器，控制快慢与爆点密度。', cardType: '节奏控制卡' },
};

interface SkillCardDetailsProps {
  selectedSkill: Skill;
  selectedSkillIndex: number;
  totalCards: number;
  deck: AggregatedSkillDeck | null;
  segmentLabels: Array<{ id: string; stage: BookEvidenceStage; label: string }>;
}

export function SkillCardDetails({
  selectedSkill,
  selectedSkillIndex,
  totalCards,
  deck,
  segmentLabels,
}: SkillCardDetailsProps) {
  const rec = SLOT_RECOMMENDATION[selectedSkill.primaryDimension || 'style'];

  return (
    <div className="space-y-6 mt-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-theme-text">{selectedSkill.name}</h2>
          <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">
            Card {selectedSkillIndex + 1} / {totalCards} · Version {selectedSkill.version || 1}
          </p>
        </div>
        <div className="px-4 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-2xl text-center">
          <div className="text-xl font-bold text-theme-accent">{selectedSkill.stabilityScore}</div>
          <div className="text-[8px] text-theme-muted uppercase font-bold">稳定性评分</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-4 py-3">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">卡片类型</div>
          <div className="text-sm font-bold text-theme-text mt-2">
            {selectedSkillIndex === 0 && deck ? '主笔卡（主导叙事基调）' : `副卡 · ${rec.cardType}`}
          </div>
          <div className="text-xs text-theme-muted mt-1">写作职责：{rec.reason}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-4 py-3">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">建议装配位</div>
          <div className="text-sm font-bold text-theme-text mt-2">{rec.slotLabel}</div>
          <div className="text-xs text-theme-muted mt-1 leading-relaxed">{rec.reason}</div>
        </div>
      </div>

      <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50 space-y-3">
        <div>
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">证据覆盖</div>
          <div className="text-xs text-theme-muted mt-1">说明这张卡在整书哪些阶段证据更强。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedSkill.evidenceCoverage && (
            <span className="px-3 py-1.5 rounded-full border border-theme-accent bg-theme-accent/10 text-[11px] font-bold text-theme-accent">
              {EVIDENCE_COVERAGE_LABELS[selectedSkill.evidenceCoverage]}
            </span>
          )}
          {(selectedSkill.evidenceMoments || []).map((moment) => (
            <span key={moment} className="px-3 py-1.5 rounded-full border border-theme-border bg-theme-sidebar text-[11px] text-theme-muted">
              {EVIDENCE_STAGE_LABELS[moment]}
            </span>
          ))}
        </div>
        {segmentLabels.length > 0 && (
          <div className="text-[10px] text-theme-muted leading-relaxed">
            覆盖阶段：{segmentLabels.map((s) => s.label).join(' / ')}
          </div>
        )}
      </div>

      <p className="text-sm text-theme-muted italic bg-theme-sidebar/30 p-3 rounded-xl border-l-4 border-theme-accent quote font-serif">
        “{selectedSkill.description}”
      </p>

      <div className="grid grid-cols-2 gap-4">
        {selectedSkill.style && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">描写风格 (Style)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.style}</p>
          </div>
        )}
        {selectedSkill.pacing && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">叙事节奏 (Pacing)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.pacing}</p>
          </div>
        )}
        {selectedSkill.characterTraits && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">人物特征 (Character)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.characterTraits}</p>
          </div>
        )}
        {selectedSkill.worldBuilding && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">世界观与力量 (World)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.worldBuilding}</p>
          </div>
        )}
        {selectedSkill.plotPattern && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">剧情爽点套路 (Plot Patterns)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.plotPattern}</p>
          </div>
        )}
        {selectedSkill.foreshadowing && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">伏笔与悬念 (Foreshadowing)</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.foreshadowing}</p>
          </div>
        )}
      </div>

      {((selectedSkill.vocabulary?.length ?? 0) > 0 || (selectedSkill.corePatterns?.length ?? 0) > 0) && (
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">核心要素提取</h4>
          {((selectedSkill.vocabulary?.length ?? 0) > 0) && (
            <div className="mb-3">
              <span className="text-[10px] font-bold text-theme-muted mr-2">特色词汇:</span>
              <div className="flex flex-wrap gap-2 inline-flex">
                {selectedSkill.vocabulary?.map((v) => (
                  <span key={v} className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">{v}</span>
                ))}
              </div>
            </div>
          )}
          {((selectedSkill.corePatterns?.length ?? 0) > 0) && (
            <div>
              <span className="text-[10px] font-bold text-theme-muted mr-2">剧情模式:</span>
              <div className="flex flex-wrap gap-2 inline-flex">
                {selectedSkill.corePatterns?.map((v) => (
                  <span key={v} className="px-2 py-0.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-accent rounded text-[10px] font-bold">{v}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-theme-muted border-t border-theme-border/50 pt-2 italic">
            <strong>句式习惯:</strong> {selectedSkill.sentenceStructure || '未指定'}
          </p>
        </div>
      )}

      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <h4 className="text-[10px] font-bold text-red-500 uppercase mb-3">绝对禁止红线 (OOC / 毒点)</h4>
        <div className="flex flex-wrap gap-2">
          {(selectedSkill.bannedElements || selectedSkill.bannedWords || []).map((w) => (
            <span key={w} className="px-2 py-0.5 bg-red-50 border border-red-100 text-red-600 rounded text-[10px] line-through">{w}</span>
          ))}
        </div>
      </div>

      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">经典句式提取</h4>
        <div className="space-y-2">
          {(selectedSkill.fewShots || []).map((s, idx) => (
            <div key={idx} className="text-xs text-theme-muted italic p-2 bg-theme-sidebar/10 rounded-lg border-l-2 border-theme-accent/30 font-serif">"{s}"</div>
          ))}
        </div>
      </div>

      <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
        <h4 className="text-[10px] font-bold text-emerald-700 uppercase mb-1">功能性评估 (Functional Audit)</h4>
        <p className="text-[11px] text-emerald-600 leading-relaxed font-medium">{selectedSkill.evaluationFeedback}</p>
      </div>

      {deck?.methodChain && (
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">方法问答链 (Method Q&A)</h4>
          <p className="text-[10px] text-theme-muted mb-3 leading-relaxed">{deck.methodChain.summary}</p>
          <div className="space-y-3">
            {deck.methodChain.items.map((qa, idx) => (
              <div key={idx} className="rounded-lg border border-theme-border bg-theme-sidebar/10 p-3">
                <div className="text-xs font-bold text-theme-text">Q{idx + 1}: {qa.question}</div>
                <div className="text-xs text-theme-muted mt-1.5 leading-relaxed">{qa.answer}</div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 text-[10px]">
                  <div className="flex gap-2">
                    <span className="font-bold text-theme-accent shrink-0">形式化:</span>
                    <span className="text-theme-muted font-mono">{qa.formalization}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-theme-accent shrink-0">步骤:</span>
                    <span className="text-theme-muted">{qa.steps.join(' → ')}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-theme-accent shrink-0">边界:</span>
                    <span className="text-theme-muted">{qa.boundary}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSkill.whyThisSkillWorks && (
        <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50">
          <h4 className="text-[10px] font-bold text-theme-text uppercase mb-1">为什么这张 Skill 成立</h4>
          <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.whyThisSkillWorks}</p>
        </div>
      )}
    </div>
  );
}
