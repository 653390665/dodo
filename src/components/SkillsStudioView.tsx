import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, CheckCircle2, PenLine, Sparkles, Wand2, X, ShieldAlert, ArrowDown, Lock } from 'lucide-react';
import { subscribeToChanges } from '../lib/db-transport';
import { listNovels, updateNovel } from '../lib/novel-client';
import { deleteSkill, syncSkillFeedbackScores, createSkill } from '../lib/skill-client';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import { Skill, Novel, ViewType, ProjectPreferenceProfile } from '../../shared/types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/alert-dialog';
import { cn } from '../lib/utils';
import { CURATED_PRODUCT_SKILLS, sanitizeWhiteLabelText, SKILL_SERIES_FLOWS } from '../../shared/lib/prompt-governance-catalog';
import type { CuratedProductSkill, SkillSeriesFlow } from '../../shared/lib/prompt-governance-catalog';
import { useNovelStore } from '../stores/novel-store';

function PlazaAssetCard({
  asset,
  isImported,
  isCloning,
  selectedNovel: _selectedNovel,
  isFreeNovel: _isFreeNovel,
  onImport,
  onEquip,
  onDirectExec,
}: {
  asset: CuratedProductSkill;
  isImported: boolean;
  isCloning: boolean;
  selectedNovel: Novel | null;
  isFreeNovel: boolean;
  onImport: () => void;
  onEquip: () => void;
  onDirectExec: () => void;
}) {
  const isPremium = asset.sourceType === 'licensed';
  const cleanTitle = sanitizeWhiteLabelText(asset.title);
  const cleanGoal = sanitizeWhiteLabelText(asset.goal || '暂无描述');
  const cleanSignal = sanitizeWhiteLabelText(asset.successSignal || '');

  return (
    <div className="bg-theme-sidebar rounded-lg p-5 border border-theme-border/40 hover:border-theme-border/85 hover:shadow-md transition-all duration-200 flex flex-col text-left relative overflow-hidden">
      {isPremium && (
        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-amber-500/5 to-transparent rounded-full -mr-8 -mt-8 blur-lg pointer-events-none" />
      )}

      <div className="flex justify-between items-start mb-3 gap-3 relative z-10">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-theme-text text-sm leading-snug flex items-center gap-2">
            <span className="truncate">{cleanTitle}</span>
            {isPremium && (
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                PREMIUM
              </span>
            )}
          </h3>
          <div className="text-[10px] text-theme-muted tracking-wide font-mono mt-1 uppercase flex items-center gap-1.5">
            <span>SCORE {asset.score || 80}</span>
            <span className="text-theme-border/60">|</span>
            <span>GRADE {asset.grade || 'A'}</span>
            <span className="text-theme-border/60">|</span>
            <span className="text-[9px] px-1 py-0.2 bg-theme-bg rounded text-theme-muted">
              {asset.sourceType === 'built-in' ? '官方免费' : asset.sourceType === 'plaza' ? '广场免费' : 'Premium'}
            </span>
          </div>
        </div>
      </div>

      <div className="text-xs text-theme-muted/90 flex-1 mb-4 leading-relaxed min-h-[3em]">
        <span className="font-bold text-theme-text text-[11px] block mb-0.5">功能定位:</span>
        <p className="line-clamp-3">{cleanGoal}</p>
      </div>

      <div className="space-y-2 mb-4 border-t border-theme-border/20 pt-3 relative z-10">
        {cleanSignal && (
          <div className="text-[11px] text-theme-muted leading-relaxed">
            <span className="font-bold text-theme-text text-[11px] block mb-0.5">预期成效:</span>
            <p className="line-clamp-2">✨ {cleanSignal}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-2">
          {asset.primaryCategory && (
            <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/30 font-sans">
              {asset.primaryCategory === 'quality-guardrail' ? '质量防线' :
               asset.primaryCategory === 'utility-tool' ? '功能工具' :
               asset.primaryCategory === 'author-workflow' ? '作者流程' :
               asset.primaryCategory === 'constellation-pack' ? '题材包' :
               asset.primaryCategory === 'platform-criteria' ? '平台维度' : '风格参考'}
            </span>
          )}
          {asset.inputs && asset.inputs.map(input => (
            <span key={input} className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/30 font-sans">
              接收: {input === 'content' ? '正文' : input === 'outline' ? '大纲' : '设定'}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-2 relative z-10">
        {asset.actionType === 'direct-exec' ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDirectExec(); }}
            className="w-full py-2 rounded bg-theme-text hover:opacity-90 text-theme-bg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1"
          >
            立即运行一键审润
          </button>
        ) : asset.actionType === 'equip' ? (
          <button
            type="button"
            disabled={isCloning}
            onClick={(e) => { e.stopPropagation(); onEquip(); }}
            className={cn(
              "w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1",
              isCloning
                ? "bg-theme-border/30 text-theme-muted cursor-wait"
                : isPremium
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5"
            )}
          >
            {isCloning ? "静默装配提炼中..." : "装配至当前作品"}
          </button>
        ) : isImported ? (
          <button
            type="button"
            disabled
            className="w-full py-2 rounded bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-bold flex items-center justify-center gap-1 cursor-default"
          >
            ✓ 已成功导入
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onImport(); }}
            disabled={isCloning}
            className={cn(
              "w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1",
              isCloning
                ? "bg-theme-border/30 text-theme-muted cursor-wait"
                : isPremium
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5"
            )}
          >
            {isCloning ? "导入中..." : "导入至本地技能库"}
          </button>
        )}
      </div>
    </div>
  );
}

function cloneAssetToSkill(asset: CuratedProductSkill): Skill {
  return {
    id: `${asset.id}-clone-${Date.now()}`,
    name: asset.title,
    description: asset.goal || '',
    style: 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER',
    pacing: asset.successSignal || '',
    stabilityScore: asset.score || 85,
    evaluationFeedback: asset.successSignal || '从能力货架导入',
    version: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    accessTier: (asset.sourceType === 'built-in' || asset.sourceType === 'plaza') ? 'free' : 'paid',
    createdAt: Date.now(),
    executionScore: asset.score || 85,
    parentSkillId: asset.parentSkillId,
  };
}

const goldenFlowMetadata: Record<string, { target: string; output: string; color: string }> = {
  'xiaofeiji-novel-flow': {
    target: '精品长篇写手 / 进阶故事创作者',
    output: '高张力万字大纲 & 极高粘性前三章正文',
    color: 'from-orange-500/10 to-amber-500/10 border-amber-500/30'
  },
  'tomato-platform-flow': {
    target: '番茄平台写手 / 爆款爽文追随者',
    output: '黄金三章快速过签大纲 & 高频金手指爽点正文',
    color: 'from-red-500/10 to-orange-500/10 border-red-500/30'
  },
  'generic-novel-flow': {
    target: '传统网文作者 / 新手通俗写手',
    output: '标准三要素设定 & 结构扎实的百万字通俗大纲',
    color: 'from-blue-500/10 to-teal-500/10 border-blue-500/30'
  },
  'book-deconstruction-flow': {
    target: '大神文风研习者 / 精准流派复刻者',
    output: '神作精髓拆解报告 & 强因果节奏伏笔线索图谱',
    color: 'from-purple-500/10 to-pink-500/10 border-purple-500/30'
  }
};

export function SkillsStudioView({
  selectedNovel,
  onNavigate,
}: {
  selectedNovel?: Novel | null;
  onNavigate?: (view: ViewType) => void;
}) {
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillToDeleteId, setSkillToDeleteId] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);

  const [activeTab, setActiveTab] = useState<'mySkills' | 'plaza'>('mySkills');
  const [importedAssetIds, setImportedAssetIds] = useState<Set<string>>(new Set());
  const [cloningAssetId, setCloningAssetId] = useState<string | null>(null);
  const [selectedFlowDetail, setSelectedFlowDetail] = useState<SkillSeriesFlow | null>(null);

  const handleActivateFlow = async (flowId: string) => {
    if (!selectedNovel) {
      alert('请先选择或创建一个小说作品。');
      return;
    }

    const isPaidFlow = flowId !== 'generic-novel-flow';

    if (isPaidFlow && isFreeNovel) {
      window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
        detail: {
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: `《${selectedNovel.title}》当前为免费体验作品，无法直接启用 Premium 专属高级创作流程。立即升级解锁 Premium 创作特权！`,
          novelId: selectedNovel.id,
        }
      }));
      return;
    }

    try {
      const updatedProfile: ProjectPreferenceProfile = {
        tags: [],
        weights: {
          styleWeight: 0.5,
          characterWeight: 0.5,
          worldWeight: 0.5,
          plotWeight: 0.5,
          pacingWeight: 0.5,
        },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        ...(selectedNovel.projectPreferenceProfile || {}),
        activeSeriesId: flowId,
      };

      await updateNovel(selectedNovel.id, {
        projectPreferenceProfile: updatedProfile,
      });

      // Update the local list so the state is immediately reactive
      setUserNovels((prev) =>
        prev.map((n) =>
          n.id === selectedNovel.id
            ? { ...n, projectPreferenceProfile: updatedProfile }
            : n,
        ),
      );

      // Trigger standard navigation to workspace/editor
      onNavigate?.('workspace');
    } catch (err) {
      console.warn('Failed to activate flow:', err);
    }
  };

  useEffect(() => {
    const refreshSkills = () => {
      syncSkillFeedbackScores()
        .then(setSavedSkills)
        .catch((err) => console.warn('Failed to load skills:', err));
    };
    refreshSkills();
    listNovels().then(setUserNovels);
    return subscribeToChanges(refreshSkills);
  }, []);

  const selectedSkill = useMemo(
    () => savedSkills.find((skill) => skill.id === selectedSkillId) || null,
    [savedSkills, selectedSkillId],
  );

  const handleDeleteSkill = async (id: string) => {
    setSkillToDeleteId(id);
  };

  const executeDeleteSkill = async () => {
    if (skillToDeleteId) {
      await deleteSkill(skillToDeleteId);
      if (selectedSkillId === skillToDeleteId) {
        setSelectedSkillId(null);
      }
      setSkillToDeleteId(null);
    }
  };

  const [selectedCategory, setSelectedCategory] = useState<'opening' | 'bible' | 'prose' | 'audit' | 'de-ai' | 'platform' | 'style' | 'deconstruct'>('opening');
  const setContinuationLaunchState = useNovelStore((state) => state.setContinuationLaunchState);

  const filteredCuratedSkills = useMemo(() => {
    return CURATED_PRODUCT_SKILLS.filter(s => s.curatedCategory === selectedCategory);
  }, [selectedCategory]);

  const savedParentIds = useMemo(() => {
    return new Set(savedSkills.map((s) => s.parentSkillId).filter(Boolean) as string[]);
  }, [savedSkills]);

  const isFreeNovel = !selectedNovel || (
    selectedNovel.projectPreferenceProfile?.commercialMode !== 'paid' &&
    selectedNovel.projectPreferenceProfile?.commercialMode !== 'strict'
  );

  const handleImportAsset = async (asset: CuratedProductSkill) => {
    const isPremium = asset.sourceType === 'licensed';

    if (isPremium && isFreeNovel) {
      window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
        detail: {
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: `《${selectedNovel?.title || '未选择作品'}》当前为免费体验作品，无法直接使用或导入 Premium 专属能力【${asset.title}】。立即升级解锁 Premium 创作特权！`,
          novelId: selectedNovel?.id || '',
        }
      }));
      return;
    }

    if (importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)) return;
    setCloningAssetId(asset.id);

    await new Promise((resolve) => setTimeout(resolve, 400));

    try {
      const newSkill = cloneAssetToSkill(asset);
      await createSkill(newSkill);

      const updated = await syncSkillFeedbackScores();
      setSavedSkills(updated);

      setImportedAssetIds((prev) => {
        const next = new Set(prev);
        next.add(asset.id);
        return next;
      });
    } catch (err) {
      console.warn('Failed to clone asset:', err);
    } finally {
      setCloningAssetId(null);
    }
  };

  const handleEquipSkill = async (skillId: string, novelId: string) => {
    const novel = userNovels.find((n) => n.id === novelId);
    if (!novel) return;

    const skill = savedSkills.find((s) => s.id === skillId);
    if (!skill) return;

    const isPaid = skill.accessTier === 'paid' || skill.sourceType === 'licensed';

    const isFreeNovel = novel.projectPreferenceProfile?.commercialMode !== 'paid' &&
                        novel.projectPreferenceProfile?.commercialMode !== 'strict';

    if (isPaid && isFreeNovel) {
      window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
        detail: {
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: `《${novel.title}》当前为免费体验作品，无法装配 Premium 专属技能【${skill.name}】。立即升级解锁 Premium 创作特权！`,
          novelId: novel.id,
        }
      }));
      return;
    }

    const currentIds = novel.mountedSkillIds || [];
    if (currentIds.includes(skillId)) {
      alert('该技能已装备到此作品。');
      return;
    }
    if (currentIds.length >= 3) {
      alert('每个作品最多装备 3 个技能。');
      return;
    }
    const newIds = [...currentIds, skillId];
    await updateNovel(novelId, {
      mountedSkillIds: newIds,
      mountedSkillLoadout: coerceMountedSkillLoadout(newIds),
    });
    setUserNovels((prev) =>
      prev.map((n) =>
        n.id === novelId
          ? { ...n, mountedSkillIds: newIds, mountedSkillLoadout: coerceMountedSkillLoadout(newIds) }
          : n,
      ),
    );
  };

  const handleEquipAsset = async (asset: CuratedProductSkill) => {
    if (!selectedNovel) {
      alert('请先选择一个作品再进行装备。');
      return;
    }

    let localSkill = savedSkills.find(s => s.parentSkillId === asset.id || s.name === asset.title);

    if (!localSkill) {
      const isPremium = asset.sourceType === 'licensed';
      if (isPremium && isFreeNovel) {
        window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
          detail: {
            limitType: 'extractSkill',
            count: 5,
            max: 5,
            error: `《${selectedNovel.title}》当前为免费体验作品，无法装配 Premium 专属技能【${asset.title}】。立即升级解锁 Premium 创作特权！`,
            novelId: selectedNovel.id,
          }
        }));
        return;
      }

      setCloningAssetId(asset.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const newSkill = cloneAssetToSkill(asset);
        await createSkill(newSkill);
        const updated = await syncSkillFeedbackScores();
        setSavedSkills(updated);
        localSkill = updated.find(s => s.parentSkillId === asset.id || s.name === asset.title);
        setImportedAssetIds((prev) => {
          const next = new Set(prev);
          next.add(asset.id);
          return next;
        });
      } catch (err) {
        console.warn('Failed to auto-clone asset during equip:', err);
        return;
      } finally {
        setCloningAssetId(null);
      }
    }

    if (localSkill) {
      await handleEquipSkill(localSkill.id, selectedNovel.id);
    }
  };

  const handleDirectExec = (asset: CuratedProductSkill) => {
    const source = asset.curatedCategory === 'audit' ? 'cockpit-audit' : 'cockpit-polish';
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    setContinuationLaunchState({
      approvedPackId: '',
      launchToken: now,
      shouldOpenProductionPanel: true,
      source
    });
    onNavigate?.('workspace');
  };

  return (
    <div className="h-full flex bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8 relative z-10">

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            能力商店 (Skills Studio)
          </h1>
          <p className="text-theme-muted mt-2">在这里管理您的 AI 专属技能，或者在能力商店中挑选和启用高级名家创作主流程与技能包。</p>
        </div>

        <div className="max-w-6xl mx-auto mb-8 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
              <Sparkles size={18} className="text-theme-accent" />
              技能如何影响写作
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { label: '分镜', detail: '影响下一章的场景选择、冲突推进和节奏密度。', icon: BrainCircuit },
                { label: '正文', detail: '约束文风、句法、人物口吻和叙事颗粒度。', icon: PenLine },
                { label: '审查', detail: '帮助 AI 用同一套标准检查跑偏、重复和节奏问题。', icon: CheckCircle2 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-2xl border border-theme-border bg-theme-bg/50 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                      <Icon size={15} className="text-theme-accent" />
                      {item.label}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-theme-muted">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="text-sm font-bold text-theme-text">当前作品装配</div>
            {selectedNovel ? (
              <>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  《{selectedNovel.title}》已装配 {
                    selectedNovel.mountedSkillLoadout
                      ? selectedNovel.mountedSkillLoadout.filter(slot => slot.skillId).length
                      : (selectedNovel.mountedSkillIds?.length || 0)
                  }/3 张技能卡。
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('workspace')}
                  className="mt-4 w-full rounded-2xl bg-theme-text px-4 py-3 text-sm font-bold text-theme-bg transition-opacity hover:opacity-90"
                >
                  回到当前作品工作台
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  先在书库选择作品，再把技能装配到下一章生成链路中。
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('library')}
                  className="mt-4 w-full rounded-2xl border border-theme-border px-4 py-3 text-sm font-bold text-theme-text transition-colors hover:border-theme-accent"
                >
                  去书库选择作品
                </button>
              </>
            )}
          </div>
        </div>

        {/* TAB Switcher */}
        <div className="max-w-6xl mx-auto mb-8 flex justify-center border-b border-theme-border/30 pb-px">
          <div className="flex gap-8">
            <button
              type="button"
              onClick={() => setActiveTab('mySkills')}
              className={cn(
                "pb-4 text-base font-bold transition-all relative",
                activeTab === 'mySkills'
                  ? "text-theme-text font-black"
                  : "text-theme-muted hover:text-theme-text"
              )}
            >
              我的技能
              {activeTab === 'mySkills' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-theme-accent rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plaza')}
              className={cn(
                "pb-4 text-base font-bold transition-all relative flex items-center gap-1.5",
                activeTab === 'plaza'
                  ? "text-theme-text font-black"
                  : "text-theme-muted hover:text-theme-text"
              )}
            >
              <Sparkles size={14} className={cn("text-amber-500", activeTab === 'plaza' && "animate-pulse")} />
              能力商店
              {activeTab === 'plaza' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* MySkills Tab Content */}
        {activeTab === 'mySkills' && (
          <>
            {savedSkills.length > 0 && (
              <>
                <div className="max-w-6xl mx-auto mb-8">
                  <SkillMapPanel skills={savedSkills} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6 max-w-6xl mx-auto">
                  {savedSkills.map(s => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      selected={s.id === selectedSkillId}
                      onOpen={() => setSelectedSkillId(s.id)}
                      onDelete={() => handleDeleteSkill(s.id)}
                      userNovels={userNovels}
                      onEquip={(novelId) => handleEquipSkill(s.id, novelId)}
                    />
                  ))}
                </div>
              </>
            )}

            {savedSkills.length === 0 && (
              <div className="mt-12 text-center text-theme-muted/60 p-16 border-2 border-dashed border-theme-border rounded-3xl bg-theme-sidebar/30 max-w-2xl mx-auto flex flex-col items-center">
                <div className="w-16 h-16 rounded-2xl bg-theme-accent/10 flex items-center justify-center text-theme-accent mb-6">
                  <Wand2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-theme-text mb-2">你的技能库空空如也</h3>
                <p className="text-sm max-w-md text-theme-muted mb-8 leading-relaxed">
                  这里还没有装配任何专属 AI 写作技能卡。您可以从零开始萃取名家大师文风，或者直接前往能力商店挑选现成的高品质卡牌。
                </p>
                <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('factory')}
                    className="px-6 py-3 rounded-2xl bg-theme-text text-theme-bg font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles size={15} />
                    去拆书工厂提炼新技能
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('plaza')}
                    className="px-6 py-3 rounded-2xl border border-theme-border hover:border-theme-accent text-theme-text hover:text-theme-accent hover:bg-theme-accent/5 font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <BrainCircuit size={15} />
                    去能力商店挑选预设卡
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Plaza Tab Content */}
        {activeTab === 'plaza' && (
          <div className="max-w-6xl mx-auto space-y-8 pb-12 text-left">
            {/* 黄金长篇名家创作主航道 */}
            <div className="space-y-4">
              <div className="border-l-2 border-amber-500 pl-3.5">
                <h2 className="text-base font-bold text-theme-text flex items-center gap-2">
                  <Sparkles size={16} className="text-amber-500 animate-pulse" />
                  黄金长篇名家创作主航道
                </h2>
                <p className="text-[11px] text-theme-muted mt-1">
                  挂载业界顶尖名家写作生命线，从灵感脑洞到十万字大纲及前三章爆款正文，全链路自适应导航。
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {SKILL_SERIES_FLOWS.filter(f => ['xiaofeiji-novel-flow', 'tomato-platform-flow', 'generic-novel-flow', 'book-deconstruction-flow'].includes(f.id)).map((flow) => {
                  const meta = goldenFlowMetadata[flow.id] || { target: '通用作者', output: '全生命周期大纲正文', color: 'from-theme-border/20 to-theme-border/10 border-theme-border/30' };
                  const isActive = selectedNovel?.projectPreferenceProfile?.activeSeriesId === flow.id;
                  const isPaid = flow.id !== 'generic-novel-flow';
                  const isLocked = isPaid && isFreeNovel;

                  return (
                    <div
                      key={flow.id}
                      className={cn(
                        "relative rounded-xl p-5 border bg-gradient-to-br flex flex-col justify-between transition-all duration-200 group text-left",
                        meta.color,
                        isActive
                          ? "ring-1 ring-emerald-500/50 border-emerald-500/40 bg-emerald-500/[0.02]"
                          : "hover:border-theme-border/80 hover:shadow-sm"
                      )}
                    >
                      <div>
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h3 className="font-bold text-theme-text text-sm group-hover:text-theme-accent transition-colors flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{flow.name}</span>
                          </h3>
                          <div className="flex gap-1 shrink-0">
                            {isActive && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                启用中
                              </span>
                            )}
                            {isLocked && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                PREMIUM
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-[11px] text-theme-muted mb-3 line-clamp-2 min-h-[2rem]">
                          {flow.description}
                        </p>

                        <div className="space-y-1.5 mb-4 text-[10px]">
                          <div>
                            <span className="text-theme-muted block">适用人群:</span>
                            <span className="text-theme-text font-medium">{meta.target}</span>
                          </div>
                          <div>
                            <span className="text-theme-muted block">预期产物:</span>
                            <span className="text-theme-text font-medium">{meta.output}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedFlowDetail(flow)}
                        className={cn(
                          "w-full py-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1",
                          isActive
                            ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/20"
                            : isLocked
                              ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                              : "bg-theme-text text-theme-bg hover:opacity-90"
                        )}
                      >
                        查看流程详情
                        {isActive && <CheckCircle2 size={12} className="text-emerald-500" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-theme-border/20 my-4" />

            {/* 8大创作者航道 Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-theme-border/25 pb-4">
              {([
                { id: 'opening', label: '开篇策划', desc: '开局爽点与简介' },
                { id: 'bible', label: '智能设定', desc: '虚构创世与群像' },
                { id: 'prose', label: '黄金正文', desc: '口语主笔与对白' },
                { id: 'audit', label: '深度审稿', desc: '情节审阅与质检' },
                { id: 'de-ai', label: '废话去AI', desc: '套话净化与动作' },
                { id: 'platform', label: '平台特化', desc: '主流渠道毒点质检' },
                { id: 'style', label: '题材风格', desc: '克氏诡秘与古风' },
                { id: 'deconstruct', label: '名作拆书', desc: '神作拆解与融入' },
              ] as const).map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex flex-col items-start gap-0.5 border text-left",
                      isSelected
                        ? "bg-theme-sidebar border-theme-accent text-theme-text shadow-sm"
                        : "bg-transparent border-transparent text-theme-muted hover:text-theme-text hover:bg-theme-sidebar/30"
                    )}
                  >
                    <span>{cat.label}</span>
                    <span className="text-[9px] font-normal opacity-80 scale-90 origin-left block truncate max-w-[120px]">
                      {cat.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 货架卡网格 */}
            <div className="space-y-4">
              <div className="border-l-2 border-theme-accent pl-3.5 mb-6">
                <h2 className="text-base font-bold text-theme-text">
                  {selectedCategory === 'opening' ? '开篇策划航道' :
                   selectedCategory === 'bible' ? '智能设定航道' :
                   selectedCategory === 'prose' ? '黄金正文航道' :
                   selectedCategory === 'audit' ? '深度审稿航道' :
                   selectedCategory === 'de-ai' ? '废话去AI航道' :
                   selectedCategory === 'platform' ? '平台特化航道' :
                   selectedCategory === 'style' ? '题材风格航道' : '名作拆书航道'}
                </h2>
                <p className="text-[11px] text-theme-muted mt-1">
                  {selectedCategory === 'opening' ? '高张力爆款开局，番茄与起点平台强适配，一键吸睛大纲展开器。' :
                   selectedCategory === 'bible' ? '高密度世界观创世，立体配角设定，战力规则与爽点机制逻辑闭环。' :
                   selectedCategory === 'prose' ? '去除大模型书面腔，让主笔更通俗、更有画面感，动作与对白交织自然。' :
                   selectedCategory === 'audit' ? '情节因果、因果链条体检，揪出网文毒点与软化情节，输出深度重写报告。' :
                   selectedCategory === 'de-ai' ? '微米级净化一切废话，彻底洗白机械翻译套话，让AI生成回归真人作家质感。' :
                   selectedCategory === 'platform' ? '针对不同阅读平台的核心指标、毒点和偏好进行专项质检，确保数据完美。' :
                   selectedCategory === 'style' ? '导入特定题材的独创风格资产与氛围质感，从克系到古风应有尽有。' : '精细化肢解传世神作的起承转合，将其灵魂精髓骨肉无缝融合于当前章节。'}
                </p>
              </div>

              {filteredCuratedSkills.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredCuratedSkills.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      selectedNovel={selectedNovel || null}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                      onEquip={() => handleEquipAsset(asset)}
                      onDirectExec={() => handleDirectExec(asset)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-theme-muted text-xs border border-dashed border-theme-border rounded-lg">
                  该航道暂无精品卡，敬请期待
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedFlowDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop with backdrop-blur */}
          <div 
            className="absolute inset-0 bg-theme-bg/60 backdrop-blur-md transition-opacity" 
            onClick={() => setSelectedFlowDetail(null)}
          />
          
          {/* Glassmorphism Container */}
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-theme-sidebar/95 border border-theme-border/60 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-theme-border/30 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-theme-accent/10 text-theme-accent">
                    <BrainCircuit size={18} />
                  </span>
                  <h2 className="text-xl font-serif font-bold text-theme-text">{selectedFlowDetail.name}</h2>
                </div>
                <p className="text-xs text-theme-muted mt-1.5 leading-relaxed">{selectedFlowDetail.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFlowDetail(null)}
                className="p-1.5 rounded-lg hover:bg-theme-border/20 text-theme-muted hover:text-theme-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content with Custom Scrollbar */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="relative pl-6 border-l-2 border-theme-border/50 space-y-8">
                {selectedFlowDetail.steps.map((step, idx) => {
                  return (
                    <div key={step.id} className="relative group text-left">
                      {/* Timeline Dot */}
                      <span className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-theme-accent bg-theme-bg flex items-center justify-center text-[9px] font-black text-theme-accent font-mono shadow-sm group-hover:scale-110 transition-transform">
                        {step.stepNumber}
                      </span>

                      {/* Step Header */}
                      <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                        <h4 className="font-bold text-sm text-theme-text">{step.name}</h4>
                        <span className="text-[9px] font-mono text-theme-muted uppercase tracking-wider bg-theme-bg px-1.5 py-0.5 rounded border border-theme-border/45">
                          {step.input} ➔ {step.output}
                        </span>
                      </div>

                      {/* Step Description */}
                      <p className="text-xs text-theme-muted leading-relaxed mb-3 pr-2">
                        {step.description}
                      </p>

                      {/* Quality Gate with amber-themed badge */}
                      {step.qualityGate && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/5 text-amber-500 border border-amber-500/10 text-[10px]">
                          <ShieldAlert size={11} className="shrink-0 text-amber-500/80 animate-pulse" />
                          <span className="font-bold shrink-0">质量门栏:</span>
                          <span className="font-sans line-clamp-1 text-amber-500/90">{step.qualityGate}</span>
                        </div>
                      )}

                      {/* Visual Arrow Connector (except last one) */}
                      {idx < selectedFlowDetail.steps.length - 1 && (
                        <div className="absolute -left-[27px] bottom-[-22px] text-theme-border/40">
                          <ArrowDown size={10} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Bar */}
            <div className="p-6 border-t border-theme-border/30 bg-theme-bg/30 flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedFlowDetail(null)}
                className="flex-1 py-2.5 text-xs font-bold border border-theme-border hover:border-theme-text rounded-xl text-theme-text transition-all bg-transparent"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedFlowDetail(null);
                  handleActivateFlow(selectedFlowDetail.id);
                }}
                className={cn(
                  "flex-1 py-2.5 text-xs font-bold rounded-xl text-white transition-all flex items-center justify-center gap-1.5",
                  (selectedFlowDetail.id !== 'generic-novel-flow' && isFreeNovel)
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-theme-accent hover:opacity-90"
                )}
              >
                {(selectedFlowDetail.id !== 'generic-novel-flow' && isFreeNovel) && <Lock size={12} />}
                激活该创作主流程
              </button>
            </div>
          </div>
        </div>
      )}

      <SkillDetailDrawer
        skill={selectedSkill}
        allSkills={savedSkills}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkillId(null)}
        onSelectSkill={(id) => setSelectedSkillId(id)}
      />
      <AlertDialog open={Boolean(skillToDeleteId)} onOpenChange={(open) => !open && setSkillToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个技能？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将从技能库中删除该写作技能卡，并从所有已装配的作品中解绑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteSkill} className="bg-red-600 hover:bg-red-700 text-white font-bold">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
