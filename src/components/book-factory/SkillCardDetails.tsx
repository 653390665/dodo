import React from 'react';
import {
  Globe,
  User,
  Clock,
  Sparkles,
  Flame,
  PenTool,
  Shield,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Award,
  ShieldAlert,
} from 'lucide-react';
import type { Skill, AggregatedSkillDeck, BookEvidenceStage } from '../../../shared/types';
import { evaluateDeconstructionCard } from '../../../shared/lib/deconstruction-scoring';
import { evaluateSkillGovernance, getSkillScoreChannels } from '../../../shared/lib/skill-model';

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

const DECONSTRUCTION_CARD_TYPES = {
  'worldview-card': {
    label: '世界设定卡',
    description: '承载世界观底色、地理、组织与法则设定，为写作提供空间语境约束。',
    bg: 'bg-[oklch(0.38_0.12_230_/_0.1)]',
    border: 'border-[oklch(0.38_0.12_230_/_0.2)]',
    text: 'text-[oklch(0.48_0.15_230)]'
  },
  'character-card': {
    label: '人物驱动卡',
    description: '提取核心角色的说话方式、情绪滤镜与特殊行为偏好，提供对白和动作修饰。',
    bg: 'bg-[oklch(0.6_0.15_300_/_0.1)]',
    border: 'border-[oklch(0.6_0.15_300_/_0.2)]',
    text: 'text-[oklch(0.6_0.18_300)]'
  },
  'pacing-card': {
    label: '节奏控制卡',
    description: '定义句式长短、场景切分与快慢调速器，为主笔卡提供时序密度微调。',
    bg: 'bg-[oklch(0.65_0.18_140_/_0.1)]',
    border: 'border-[oklch(0.65_0.18_140_/_0.2)]',
    text: 'text-[oklch(0.6_0.2_140)]'
  },
  'hook-card': {
    label: '悬念钩子卡',
    description: '设定章节尾段的伏笔、留白与未解冲突，极大提升追读率。',
    bg: 'bg-[oklch(0.55_0.22_40_/_0.1)]',
    border: 'border-[oklch(0.55_0.22_40_/_0.2)]',
    text: 'text-[oklch(0.55_0.22_40)]'
  },
  'conflict-card': {
    label: '矛盾冲突卡',
    description: '定位矛盾引爆点、利益诉求与势力碰撞模型，辅助剧情结构推进。',
    bg: 'bg-[oklch(0.58_0.23_20_/_0.1)]',
    border: 'border-[oklch(0.58_0.23_20_/_0.2)]',
    text: 'text-[oklch(0.58_0.23_20)]'
  },
  'style-card': {
    label: '主笔文风卡',
    description: '主导叙事笔调、常用意象与特色修辞习惯，作为卡组里的主声部。',
    bg: 'bg-[oklch(0.55_0.15_280_/_0.1)]',
    border: 'border-[oklch(0.55_0.15_280_/_0.2)]',
    text: 'text-[oklch(0.55_0.18_280)]'
  },
  'platform-card': {
    label: '平台属性卡',
    description: '对齐番茄/七猫/起点等渠道的读者偏好与禁忌，避免偏离市场生态。',
    bg: 'bg-[oklch(0.45_0.15_180_/_0.1)]',
    border: 'border-[oklch(0.45_0.15_180_/_0.2)]',
    text: 'text-[oklch(0.45_0.18_180)]'
  },
};

const CARD_TYPE_ICONS = {
  'worldview-card': Globe,
  'character-card': User,
  'pacing-card': Clock,
  'hook-card': Sparkles,
  'conflict-card': Flame,
  'style-card': PenTool,
  'platform-card': Shield,
};

const GRADE_CONFIG = {
  S: {
    text: 'text-[oklch(0.62_0.25_20)]',
    bg: 'bg-[oklch(0.62_0.25_20_/_0.06)]',
    border: 'border-[oklch(0.62_0.25_20_/_0.25)]',
    glow: 'shadow-[0_0_20px_oklch(0.62_0.25_20_/_0.15)]',
    label: '神级 S',
    description: '极高转写证据，完美无敏感实体泄露与AI模板废话，转译可用性极佳。'
  },
  A: {
    text: 'text-[oklch(0.68_0.19_75)]',
    bg: 'bg-[oklch(0.68_0.19_75_/_0.06)]',
    border: 'border-[oklch(0.68_0.19_75_/_0.25)]',
    glow: 'shadow-[0_0_12px_oklch(0.68_0.19_75_/_0.12)]',
    label: '卓越 A',
    description: '证据充足，白璧微瑕。存在轻微实体泄露或套话，但不影响主体使用。'
  },
  B: {
    text: 'text-[oklch(0.58_0.15_230)]',
    bg: 'bg-[oklch(0.58_0.15_230_/_0.06)]',
    border: 'border-[oklch(0.58_0.15_230_/_0.25)]',
    glow: '',
    label: '合格 (B-Tier)',
    description: '基础转译合格，但少数FewShot过短，或有明显的网文名人名字泄露。'
  },
  C: {
    text: 'text-[oklch(0.58_0.18_15)]',
    bg: 'bg-[oklch(0.58_0.18_15_/_0.06)]',
    border: 'border-[oklch(0.58_0.18_15_/_0.25)]',
    glow: '',
    label: '薄弱 (C-Tier)',
    description: '警告：缺乏FewShot示例，或者充满大量AI说车轱辘话与套路废话。'
  },
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
  const [showScoreDetails, setShowScoreDetails] = React.useState(false);

  const report = evaluateDeconstructionCard(selectedSkill);
  const scoreChannels = getSkillScoreChannels(selectedSkill);
  const governance = evaluateSkillGovernance(selectedSkill);
  const gradeInfo = GRADE_CONFIG[report.grade];
  const hasDeductions =
    report.details.evidenceDeductions.length > 0 ||
    report.details.transferabilityDeductions.length > 0 ||
    report.details.safetyDeductions.length > 0;

  const isDeconstructionCard = !!selectedSkill.deconstructionCardType;
  const cardTypeInfo = selectedSkill.deconstructionCardType ? DECONSTRUCTION_CARD_TYPES[selectedSkill.deconstructionCardType] : null;
  const IconComponent = selectedSkill.deconstructionCardType ? CARD_TYPE_ICONS[selectedSkill.deconstructionCardType] : null;

  return (
    <div className="space-y-6 mt-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-theme-text">{selectedSkill.name}</h2>
          <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">
            拆书卡 {selectedSkillIndex + 1} / {totalCards} · 版本 {selectedSkill.version || 1}
          </p>
        </div>
        <div className="px-4 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-2xl text-center">
          <div className="text-xl font-bold text-theme-accent">{scoreChannels.coldStartScore ?? '—'}</div>
          <div className="text-[8px] text-theme-muted uppercase font-bold">冷启动分</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-3 py-2 text-theme-muted md:col-span-2">
          <div className="font-bold text-theme-text">治理门禁</div>
          <div className={governance.status === 'ready' ? 'text-emerald-600' : 'text-amber-600'}>
            {governance.status === 'ready' ? '可用' : '需复核'}
          </div>
          {governance.reasons.length > 0 && <div className="mt-1">{governance.reasons.join('；')}</div>}
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-3 py-2 text-theme-muted">
          <div className="font-bold text-theme-text">冷启动证据</div>
          <div>分值 <span className="font-bold text-theme-text">{scoreChannels.coldStartScore ?? '—'}</span></div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-3 py-2 text-theme-muted">
          <div className="font-bold text-theme-text">真实使用反馈</div>
          <div>{scoreChannels.observedPerformance
            ? <>使用反馈 <span className="font-bold text-theme-text">{scoreChannels.observedPerformance.score}</span>（{scoreChannels.observedPerformance.sampleSize} 次）</>
            : <><div>暂无使用反馈</div><div>样本量 0</div></>}</div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-3 py-2 text-theme-muted">
          证据稳定度 <span className="font-bold text-theme-text">{scoreChannels.evidenceStabilityScore ?? '—'}</span>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-3 py-2 text-theme-muted">
          <div className="font-bold text-theme-text">当前场景适配</div>
          <div>作品能力中心应用配置后计算</div>
        </div>
      </div>

      {/* 拆解卡健康打分与去污染面板 */}
      <div className={`p-5 rounded-2xl border transition-all duration-300 ${gradeInfo.border} ${gradeInfo.bg} ${gradeInfo.glow}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Award className={`w-5 h-5 ${gradeInfo.text}`} aria-hidden="true" />
              <h3 className="font-bold text-sm text-theme-text">拆解卡质量健康评估</h3>
            </div>
            <p className="text-xs text-theme-muted leading-relaxed max-w-[65ch]">
              {gradeInfo.description}
            </p>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-14 h-14 rounded-2xl border ${gradeInfo.border} flex items-center justify-center font-bold text-3xl font-serif ${gradeInfo.text} bg-theme-sidebar shadow-inner`}>
              {report.grade}
            </div>
            <span className="text-[10px] font-bold text-theme-muted mt-1.5">{report.score} / 100</span>
          </div>
        </div>

        {/* 满分或扣分项提示 */}
        <div className="mt-4 pt-3 border-t border-theme-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!hasDeductions ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                <span className="text-xs text-emerald-600 font-medium">白璧无瑕！该卡未检测到任何命名实体泄露或 AI 腔套话，纯净度完美。</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <span className="text-xs text-amber-600 font-medium">检测到有待优化的潜在泄露与 AI 套话红线，可展开查看明细。</span>
              </>
            )}
          </div>
          {hasDeductions && (
            <button
              onClick={() => setShowScoreDetails(!showScoreDetails)}
              className="text-xs font-bold text-theme-accent hover:underline flex items-center gap-1"
            >
              {showScoreDetails ? '折叠明细' : '查看扣分明细'}
              {showScoreDetails ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          )}
        </div>

        {/* 扣分明细折叠区 */}
        {showScoreDetails && hasDeductions && (
          <div className="mt-3 pt-3 border-t border-theme-border/30 space-y-3 animate-fade-in">
            {/* 1. 证据覆盖 */}
            {report.details.evidenceDeductions.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex justify-between">
                  <span>证据效力评分 (Evidence Base)</span>
                  <span className="text-red-500">{report.details.evidenceScore} / 30分</span>
                </div>
                <div className="space-y-1">
                  {report.details.evidenceDeductions.map((deduction, idx) => (
                    <div key={deduction + idx} className="flex items-center gap-2 text-xs text-theme-text/80 bg-theme-sidebar/50 px-3 py-1.5 rounded-lg border border-theme-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      <span>{deduction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. 实体净化 */}
            {report.details.transferabilityDeductions.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex justify-between">
                  <span>实体去污染净化 (Transferability & Entity Shield)</span>
                  <span className="text-red-500">{report.details.transferabilityScore} / 35分</span>
                </div>
                <div className="space-y-1">
                  {report.details.transferabilityDeductions.map((deduction, idx) => (
                    <div key={deduction + idx} className="flex items-center gap-2 text-xs text-theme-text/80 bg-theme-sidebar/50 px-3 py-1.5 rounded-lg border border-theme-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      <span>{deduction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 去 AI 腔 */}
            {report.details.safetyDeductions.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex justify-between">
                  <span>去 AI 腔/防套路特征 (Pollution Safety & Anti-Slop)</span>
                  <span className="text-red-500">{report.details.safetyScore} / 35分</span>
                </div>
                <div className="space-y-1">
                  {report.details.safetyDeductions.map((deduction, idx) => (
                    <div key={deduction + idx} className="flex items-center gap-2 text-xs text-theme-text/80 bg-theme-sidebar/50 px-3 py-1.5 rounded-lg border border-theme-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      <span>{deduction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`rounded-xl border px-4 py-3 ${isDeconstructionCard && cardTypeInfo ? `${cardTypeInfo.border} ${cardTypeInfo.bg}` : 'border-theme-border bg-theme-sidebar/25'}`}>
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
            {IconComponent && <IconComponent className={`w-3.5 h-3.5 ${cardTypeInfo?.text || ''}`} aria-hidden="true" />}
            <span>卡片类型</span>
          </div>
          <div className={`text-sm font-bold mt-2 ${isDeconstructionCard && cardTypeInfo ? cardTypeInfo.text : 'text-theme-text'}`}>
            {isDeconstructionCard && cardTypeInfo ? cardTypeInfo.label : (selectedSkillIndex === 0 && deck ? '主笔卡（主导叙事基调）' : `辅卡 · ${rec.cardType}`)}
          </div>
          <div className="text-xs text-theme-muted mt-1 leading-relaxed">
            {isDeconstructionCard && cardTypeInfo ? cardTypeInfo.description : `写作作用：${rec.reason}`}
          </div>
        </div>
        <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-4 py-3">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">建议加入位置</div>
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
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">描写风格</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.style}</p>
          </div>
        )}
        {selectedSkill.pacing && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">叙事节奏</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.pacing}</p>
          </div>
        )}
        {selectedSkill.characterTraits && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">人物特征</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.characterTraits}</p>
          </div>
        )}
        {selectedSkill.worldBuilding && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">世界观与力量</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.worldBuilding}</p>
          </div>
        )}
        {selectedSkill.plotPattern && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">剧情爽点套路</h4>
            <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.plotPattern}</p>
          </div>
        )}
        {selectedSkill.foreshadowing && (
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
            <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">伏笔与悬念</h4>
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
            <div key={s + idx} className="text-xs text-theme-muted italic p-2 bg-theme-sidebar/10 rounded-lg border-l-2 border-theme-accent/30 font-serif">"{s}"</div>
          ))}
        </div>
      </div>

      <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
        <h4 className="text-[10px] font-bold text-emerald-700 uppercase mb-1">功能性评估</h4>
        <p className="text-[11px] text-emerald-600 leading-relaxed font-medium">{selectedSkill.evaluationFeedback}</p>
      </div>

      {deck?.methodChain && (
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">方法问答链</h4>
          <p className="text-[10px] text-theme-muted mb-3 leading-relaxed">{deck.methodChain.summary}</p>
          <div className="space-y-3">
            {deck.methodChain.items.map((qa, idx) => (
              <div key={qa.question + idx} className="rounded-lg border border-theme-border bg-theme-sidebar/10 p-3">
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
          <h4 className="text-[10px] font-bold text-theme-text uppercase mb-1">为什么这张拆书卡成立</h4>
          <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.whyThisSkillWorks}</p>
        </div>
      )}
    </div>
  );
}
