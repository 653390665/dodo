import React from 'react';
import { Loader2, Wand2, Save, CheckCircle2 } from 'lucide-react';
import type { Skill, AggregatedSkillDeck, BookEvidenceStage } from '../../../shared/types';
import { SkillCardDetails } from './SkillCardDetails';
import { TestDrivePanel } from './TestDrivePanel';
import { EquipPanel } from './EquipPanel';
import { normalizeSkillConfig } from './useBookFactory';

const SKILL_DIMENSIONS = [
  { value: 'style', label: '文笔文风' },
  { value: 'character', label: '人物构建' },
  { value: 'world', label: '世界观打造' },
  { value: 'power', label: '战力设定' },
  { value: 'plot', label: '剧情结构' },
  { value: 'pacing', label: '节奏控制' },
];

const SLOT_RECOMMENDATION = {
  style: { slotLabel: '卡槽 1 · 主笔位', reason: '优先决定整段文字的总笔调，适合做组合里的主声部。', cardType: '主笔文风卡' },
  character: { slotLabel: '卡槽 2 · 人物位', reason: '更适合作为人物塑造滤镜，补足角色说话方式与行为模式。', cardType: '人物驱动卡' },
  world: { slotLabel: '卡槽 2 · 设定位', reason: '适合作为中层背景约束，为主笔卡补充世界观与规则感。', cardType: '世界约束卡' },
  power: { slotLabel: '卡槽 2 · 设定位', reason: '适合作为战力与体系补强卡，避免主笔卡里塞满力量设定。', cardType: '体系爆点卡' },
  plot: { slotLabel: '卡槽 3 · 推进位', reason: '适合放在后段补强剧情推进与爽点结构。', cardType: '剧情推进卡' },
  pacing: { slotLabel: '卡槽 3 · 节奏位', reason: '更适合作为组合尾部调速器，控制快慢与爆点密度。', cardType: '节奏控制卡' },
};

function getDimensionLabel(dimension?: string): string {
  return SKILL_DIMENSIONS.find((item) => item.value === dimension)?.label || '未标注';
}

function getSkillRecommendation(skill: Skill) {
  return SLOT_RECOMMENDATION[skill.primaryDimension || 'style'];
}

function getDimensionBand(score: number): string {
  if (score >= 85) return '高特征';
  if (score >= 70) return '推荐使用';
  if (score >= 55) return '可补位';
  return '弱信号';
}

const EVIDENCE_COVERAGE_LABELS = {
  'full-book-stable': '全书稳定',
  'opening-heavy': '开篇偏强',
  'mid-book-heavy': '中段偏强',
  'climax-heavy': '高潮偏强',
  'weak-evidence': '局部信号',
};

interface BookFactoryOutputProps {
  isAnalyzing: boolean;
  skillCards: Skill[];
  selectedSkillIndex: number;
  onSelectSkillIndex: (idx: number) => void;
  deck: AggregatedSkillDeck | null;
  deckMeta: { mainCardId?: string; supportCount?: number } | null;
  segmentLabels: Array<{ id: string; stage: BookEvidenceStage; label: string }>;
  isSaving: boolean;
  isEditing: boolean;
  onSetIsEditing: (val: boolean) => void;
  editableJson: string;
  onSetEditableJson: (val: string) => void;
  extractionSource: 'fallback' | 'model' | null;
  isModelPending: boolean;
  extractionWarnings: string[];
  extractionStatusNote: string | null;
  selectedSkill: Skill | null;
  updateSelectedSkill: (updater: (skill: Skill) => Skill) => void;
  testInput: string;
  onTestInputChange: (val: string) => void;
  testOutput: string;
  isTesting: boolean;
  showEquipPanel: boolean;
  onSetShowEquipPanel: (val: boolean) => void;
  equipNovelId: string;
  onSetEquipNovelId: (val: string) => void;
  userNovels: any[];
  lastSavedSkillId: string;
  savedDeckIds: string[];
  onTestDrive: () => void;
  onSaveSelectedSkill: () => void;
  onSaveDeck: () => void;
  onEquipDeck: () => void;
  onEquipSkill: () => void;
}

export function BookFactoryOutput({
  isAnalyzing,
  skillCards,
  selectedSkillIndex,
  onSelectSkillIndex,
  deck,
  deckMeta,
  segmentLabels,
  isSaving,
  isEditing,
  onSetIsEditing,
  editableJson,
  onSetEditableJson,
  extractionSource,
  isModelPending,
  extractionWarnings,
  extractionStatusNote,
  selectedSkill,
  updateSelectedSkill,
  testInput,
  onTestInputChange,
  testOutput,
  isTesting,
  showEquipPanel,
  onSetShowEquipPanel,
  equipNovelId,
  onSetEquipNovelId,
  userNovels,
  lastSavedSkillId,
  savedDeckIds,
  onTestDrive,
  onSaveSelectedSkill,
  onSaveDeck,
  onEquipDeck,
  onEquipSkill,
}: BookFactoryOutputProps) {
  return (
    <div className="bg-theme-sidebar rounded-2xl shadow-sm border border-theme-border overflow-hidden flex flex-col h-full opacity-100 min-h-[500px]">
      <div className="p-4 bg-theme-sidebar border-b border-theme-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wand2 size={18} className="text-theme-accent" />
          <h3 className="font-bold text-theme-text">萃取结果 (Skill Deck)</h3>
          {extractionSource === 'fallback' && !isModelPending && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-[10px] font-bold text-amber-700">保底萃取</span>
          )}
          {extractionSource === 'fallback' && isModelPending && (
            <span className="px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-[10px] font-bold text-blue-700 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />保底萃取
            </span>
          )}
          {extractionSource === 'model' && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-[10px] font-bold text-emerald-700">AI 深度萃取</span>
          )}
        </div>
        {selectedSkill && (
          <button
            onClick={() => {
              if (isEditing) {
                try {
                  const parsed = JSON.parse(editableJson);
                  updateSelectedSkill(() => normalizeSkillConfig(parsed));
                  onSetIsEditing(false);
                } catch {
                  alert("JSON 格式错误，请检查后再保存编辑。");
                }
              } else {
                onSetEditableJson(JSON.stringify(selectedSkill, null, 2));
                onSetIsEditing(true);
              }
            }}
            className="text-[10px] bg-theme-sidebar border border-theme-border px-3 py-1 rounded-lg font-bold hover:bg-theme-sidebar transition-all flex items-center gap-1.5"
          >
            {isEditing ? <><CheckCircle2 size={12} className="text-emerald-500" /> 完成编辑</> : <><Wand2 size={12} /> 手动修正 JSON</>}
          </button>
        )}
      </div>

      {(isModelPending || extractionWarnings.length > 0) && (
        <div className="px-4 pb-1">
          {isModelPending && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-2.5 mb-2 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-blue-600" />
              <div className="text-[11px] text-blue-700 font-medium">AI 正在后台深度分析文本风格...结果就绪后自动替换当前卡片。</div>
            </div>
          )}
          {extractionWarnings.map((warning, idx) => (
            <div key={idx} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2 mb-1.5 text-[11px] text-amber-700 leading-relaxed">{warning}</div>
          ))}
        </div>
      )}

      <div className="flex-1 p-6 overflow-y-auto bg-theme-sidebar/50 backdrop-blur-sm">
        {!selectedSkill ? (
          <div className="h-full flex flex-col items-center justify-center text-theme-muted/50">
            <Wand2 size={48} className="mb-4 opacity-50" />
            <p>{isAnalyzing ? '正在拆书...' : '等待拆书结果...'}</p>
            {extractionStatusNote && (
              <p className="text-[11px] text-theme-muted/60 mt-2 max-w-xs text-center">{extractionStatusNote}</p>
            )}
          </div>
        ) : isEditing ? (
          <textarea
            value={editableJson}
            onChange={(e) => onSetEditableJson(e.target.value)}
            className="w-full h-full font-mono text-xs p-4 bg-slate-900 text-emerald-400 rounded-xl leading-relaxed outline-none overflow-y-auto focus:ring-2 ring-theme-accent/50 selection:bg-emerald-500/20"
            spellCheck={false}
          />
        ) : (
          <div className="space-y-6">
            <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">卡组拆解结果</div>
                  <div className="text-xs text-theme-muted mt-1">当前共生成 {skillCards.length} 张技能卡。</div>
                </div>
                {savedDeckIds.length > 0 && (
                  <div className="px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-[11px] font-bold text-emerald-700">Deck 已保存</div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-3">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">主笔卡</div>
                  <div className="mt-2 text-sm font-bold text-theme-text">{deck?.mainCard?.name || '待生成'}</div>
                  {deck?.mainCard?.stabilityScore != null && (
                    <div className="text-[10px] text-theme-accent mt-0.5">稳定性 {deck.mainCard.stabilityScore}%</div>
                  )}
                </div>
                <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-3">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">副卡</div>
                  <div className="mt-2 text-sm font-bold text-theme-text">{deck?.supportCards?.length ?? deckMeta?.supportCount ?? 0} 张</div>
                  {deck?.supportCards?.length ? (
                    <div className="text-[10px] text-theme-muted mt-0.5 truncate">
                      {deck.supportCards.map((c) => c.name).join('、')}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-3">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">取证阶段</div>
                  <div className="mt-2 text-sm font-bold text-theme-text">{segmentLabels.length || 0} 段</div>
                </div>
              </div>
              {deck && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  <button
                    onClick={onSaveDeck}
                    disabled={isSaving || savedDeckIds.length > 0}
                    className="px-4 py-2 rounded-xl bg-theme-accent text-white text-[11px] font-bold hover:bg-theme-accent/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Save size={12} /> {savedDeckIds.length > 0 ? '整组 Deck 已保存' : '保存整组 Deck'}
                  </button>
                  <button
                    onClick={() => { onSetShowEquipPanel(true); onSetEquipNovelId(''); }}
                    className="px-4 py-2 rounded-xl border border-theme-accent text-theme-accent text-[11px] font-bold hover:bg-theme-accent/5 transition-colors"
                  >
                    装备整组 Deck
                  </button>
                </div>
              )}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {skillCards.map((skill, index) => {
                  const rec = getSkillRecommendation(skill);
                  return (
                    <button
                      key={`${skill.name}-${index}`}
                      type="button"
                      onClick={() => onSelectSkillIndex(index)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                        selectedSkillIndex === index ? 'border-theme-accent bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar hover:bg-theme-sidebar/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-theme-text">{skill.name}</div>
                          <div className="text-[10px] text-theme-muted mt-1">
                            {index === 0 && deck ? '主笔卡' : index > 0 && deck ? `副卡 · ${rec.cardType}` : rec.cardType}
                          </div>
                        </div>
                        <div className="text-[10px] font-bold text-theme-accent">{skill.stabilityScore}%</div>
                      </div>
                      <div className="mt-2 rounded-xl bg-theme-sidebar/40 border border-theme-border px-3 py-2">
                        <div className="text-[10px] font-bold text-theme-text">{rec.slotLabel}</div>
                        <div className="text-[10px] text-theme-muted mt-1 leading-relaxed">{rec.reason}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(skill.dimensionTags || []).slice(0, 3).map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded-full bg-theme-sidebar text-[10px] text-theme-muted border border-theme-border">
                            {getDimensionLabel(tag)}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] text-theme-accent font-bold">{getDimensionBand(skill.stabilityScore || 0)}</div>
                      {!!skill.evidenceCoverage && (
                        <div className="mt-2 text-[10px] text-theme-muted">{EVIDENCE_COVERAGE_LABELS[skill.evidenceCoverage]}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <SkillCardDetails selectedSkill={selectedSkill} selectedSkillIndex={selectedSkillIndex} totalCards={skillCards.length} deck={deck} segmentLabels={segmentLabels} />
            <TestDrivePanel selectedSkill={selectedSkill} testInput={testInput} onTestInputChange={onTestInputChange} testOutput={testOutput} isTesting={isTesting} onTestDrive={onTestDrive} />

            <button
              onClick={onSaveSelectedSkill}
              disabled={isSaving || Boolean(deck && savedDeckIds.length > 0)}
              className="w-full py-4 mt-4 bg-theme-text text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:translate-y-[-2px] flex justify-center items-center gap-2 transition-all disabled:opacity-50 active:translate-y-0"
            >
              <CheckCircle2 size={18} />
              {deck ? '单独保存当前卡（通常不需要）' : lastSavedSkillId ? '当前技能卡已保存' : '保存当前技能卡到技能库'}
            </button>

            {showEquipPanel && (
              <EquipPanel deck={deck} savedDeckIds={savedDeckIds} isSaving={isSaving} equipNovelId={equipNovelId} onSetEquipNovelId={onSetEquipNovelId} userNovels={userNovels} onEquipDeck={onEquipDeck} onEquipSkill={onEquipSkill} onCancel={() => onSetShowEquipPanel(false)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
