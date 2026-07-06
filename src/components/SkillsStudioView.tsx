import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, CheckCircle2, PenLine, Sparkles, Wand2 } from 'lucide-react';
import { subscribeToChanges } from '../lib/db-transport';
import { listNovels, updateNovel } from '../lib/novel-client';
import { deleteSkill, syncSkillFeedbackScores, createSkill } from '../lib/skill-client';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import { Skill, Novel, ViewType } from '../../shared/types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/alert-dialog';
import { cn } from '../lib/utils';
import { PROMPT_GOVERNANCE_CATALOG, getAssetEnhancementPackage } from '../../shared/lib/prompt-governance-catalog';
import type { GovernedPromptAsset } from '../../shared/types/prompt-assets-governed';

function PlazaAssetCard({
  asset,
  isImported,
  isCloning,
  isFreeNovel: _isFreeNovel,
  onImport,
}: {
  asset: GovernedPromptAsset;
  isImported: boolean;
  isCloning: boolean;
  isFreeNovel: boolean;
  onImport: () => void;
}) {
  const isPremium = asset.sourceType === 'licensed' || (asset.score !== undefined && asset.score >= 90) || (asset.grade as string) === 'S';

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isImported) return;
    onImport();
  };

  return (
    <div className="bg-theme-sidebar rounded-2xl p-6 border border-theme-border/50 shadow-sm hover:border-theme-border transition-all duration-300 flex flex-col text-left relative overflow-hidden natural-card">
      {isPremium && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-500/10 to-transparent rounded-full -mr-10 -mt-10 blur-xl pointer-events-none" />
      )}

      <div className="flex justify-between items-start mb-3 gap-3 relative z-10">
        <div className="min-w-0">
          <h3 className="font-bold text-theme-text text-base leading-snug truncate flex items-center gap-2">
            {asset.title}
            {isPremium && (
              <span className="shrink-0 relative inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-black tracking-widest bg-gradient-to-r from-[oklch(0.72_0.16_54)] via-[oklch(0.78_0.14_68)] to-[oklch(0.81_0.15_78)] text-white shadow-[0_0_8px_rgba(245,158,11,0.25)] animate-pulse">
                PREMIUM
              </span>
            )}
          </h3>
          <div className="text-[10px] text-theme-muted tracking-wide font-bold mt-1 uppercase flex items-center gap-1">
            评分 {asset.score || 80}点 · 评级 {asset.grade || 'A'}级 · {asset.licenseStatus === 'built-in' ? '官方内置' : asset.licenseStatus === 'public' ? '广场共享' : '商业授权'}
          </div>
        </div>
      </div>

      <div className="text-sm text-theme-muted/90 flex-1 mb-4 leading-relaxed line-clamp-3 min-h-[3em]">
        <span className="font-bold text-theme-text text-xs block mb-1">功能定位:</span>
        {asset.goal || '暂无描述'}
      </div>

      <div className="space-y-2 mb-6 border-t border-theme-border/30 pt-3 relative z-10">
        {asset.successSignal && (
          <div className="text-xs text-theme-muted leading-relaxed">
            <span className="font-bold text-theme-text text-[11px] block">预期成效:</span>
            ✨ {asset.successSignal}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-2">
          {asset.primaryCategory && (
            <span className="px-2 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/40">
              {asset.primaryCategory === 'quality-guardrail' ? '质量防线' :
               asset.primaryCategory === 'utility-tool' ? '功能工具' :
               asset.primaryCategory === 'author-workflow' ? '作者流程' :
               asset.primaryCategory === 'constellation-pack' ? '题材包' :
               asset.primaryCategory === 'platform-criteria' ? '平台维度' : '风格参考'}
            </span>
          )}
          {asset.inputs && asset.inputs.map(input => (
            <span key={input} className="px-2 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/40">
              接收: {input === 'content' ? '正文' : input === 'outline' ? '大纲' : '设定'}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-3 relative z-10">
        {isImported ? (
          <button
            type="button"
            disabled
            className="w-full py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-bold flex items-center justify-center gap-1.5 cursor-default transition-all"
          >
            ✓ 已成功装配至库
          </button>
        ) : (
          <button
            type="button"
            onClick={handleActionClick}
            disabled={isCloning}
            className={cn(
              "w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5",
              isCloning
                ? "bg-theme-border/40 text-theme-muted cursor-wait"
                : isPremium
                  ? "bg-gradient-to-r from-[oklch(0.72_0.16_54)] to-[oklch(0.81_0.15_78)] hover:opacity-95 text-white shadow-sm active:opacity-90"
                  : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5"
            )}
          >
            {isCloning ? (
              <>
                <span className="w-3 h-3 border-2 border-theme-muted border-t-transparent rounded-full animate-spin" />
                装配提炼中...
              </>
            ) : isPremium ? (
              "✨ 立即装配 Premium 卡"
            ) : (
              "装配 / 导入我的技能"
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function cloneAssetToSkill(asset: GovernedPromptAsset): Skill {
  return {
    id: `${asset.id}-clone-${Date.now()}`,
    name: asset.title,
    description: asset.goal || '',
    style: asset.template || '',
    pacing: asset.successSignal || '',
    stabilityScore: asset.score || 85,
    evaluationFeedback: asset.successSignal || '从能力广场导入',
    version: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    accessTier: (asset.sourceType === 'built-in' || asset.sourceType === 'plaza') ? 'free' : 'paid',
    createdAt: Date.now(),
    executionScore: asset.score || 85,
    parentSkillId: asset.id,
  };
}

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

  const filteredPlazaAssets = useMemo(() => {
    return PROMPT_GOVERNANCE_CATALOG.filter((asset) => {
      return (
        asset.placementTier !== 'sanitize-required' &&
        asset.placementTier !== 'research-only' &&
        asset.isWhiteLabeled !== false
      );
    });
  }, []);

  const savedParentIds = useMemo(() => {
    return new Set(savedSkills.map((s) => s.parentSkillId).filter(Boolean) as string[]);
  }, [savedSkills]);

  const groupedAssets = useMemo(() => {
    const groups = {
      builtin: [] as GovernedPromptAsset[],
      plaza: [] as GovernedPromptAsset[],
      premiumFlow: [] as GovernedPromptAsset[],
      premiumDiagnostic: [] as GovernedPromptAsset[],
      premiumDeconstruction: [] as GovernedPromptAsset[],
      premiumAudit: [] as GovernedPromptAsset[],
    };

    filteredPlazaAssets.forEach((asset) => {
      if (asset.sourceType === 'built-in') {
        groups.builtin.push(asset);
      } else if (asset.sourceType === 'plaza') {
        groups.plaza.push(asset);
      } else {
        const pkg = getAssetEnhancementPackage(asset.id);
        const pkgId = pkg?.id || '';
        const title = asset.title || '';

        if (pkgId === 'paid-advanced-audit-patch' || asset.id.includes('audit') || title.includes('审稿') || title.includes('去AI') || title.includes('润色')) {
          groups.premiumAudit.push(asset);
        } else if (pkgId === 'paid-platform-diagnostics' || asset.id.includes('diagnostic') || asset.id.includes('validator') || title.includes('诊断') || title.includes('质检')) {
          groups.premiumDiagnostic.push(asset);
        } else if (pkgId === 'paid-deconstruction-fusion' || asset.id.includes('deconstruct') || title.includes('拆书') || title.includes('融合') || title.includes('风格')) {
          groups.premiumDeconstruction.push(asset);
        } else {
          groups.premiumFlow.push(asset);
        }
      }
    });

    return groups;
  }, [filteredPlazaAssets]);

  const isFreeNovel = useMemo(() => {
    if (!selectedNovel) return true;
    return (
      selectedNovel.projectPreferenceProfile?.commercialMode !== 'paid' &&
      selectedNovel.projectPreferenceProfile?.commercialMode !== 'strict'
    );
  }, [selectedNovel]);



  const handleImportAsset = async (asset: GovernedPromptAsset) => {
    const isPremium = asset.sourceType === 'licensed' || (asset.score !== undefined && asset.score >= 90) || (asset.grade as string) === 'S';

    if (isPremium && isFreeNovel) {
      window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
        detail: {
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: `《${selectedNovel?.title || '未选择小说'}》当前为免费体验作品，无法直接下载/导入高阶 Premium 共享卡【${asset.title}】(评级 ${asset.grade || 'S'}级)。立即升舱解锁无限卡牌装载特权！`,
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

    // 高阶卡牌暗定判定策略 (Implicit paid skill heuristics)
    const isPaid = skill.accessTier === 'paid' ||
                   (skill.executionScore !== undefined && skill.executionScore >= 90) ||
                   !!skill.parentSkillId;

    // 小说免费版判定规则 (Check if novel is in free tier)
    const isFreeNovel = novel.projectPreferenceProfile?.commercialMode !== 'paid' &&
                        novel.projectPreferenceProfile?.commercialMode !== 'strict';

    // 如果是用免费版小说去装备高阶付费技能卡，则拦截并弹出 Premium 升舱弹窗
    // If attempting to mount a premium skill card on a free novel, block and dispatch event
    if (isPaid && isFreeNovel) {
      window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
        detail: {
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: `《${novel.title}》当前为免费体验作品，无法装配高阶 Premium 付费卡【${skill.name}】(评级 S级/传承卡)。立即升舱解锁无限卡牌装载特权！`,
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

  return (
    <div className="h-full flex bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8 relative z-10">

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            技能仓库 (Skills Library)
          </h1>
          <p className="text-theme-muted mt-2">在这里管理您的 AI 专属技能卡牌。打开详情、编辑字段、维护版本谱系。</p>
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
              {/* 我的技能 Tab / My Skills Tab */}
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
              {/* 能力广场 Tab / Plaza Tab */}
              能力广场
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
                  这里还没有装配任何专属 AI 写作技能卡。您可以从零开始萃取名家大师文风，或者直接前往能力广场挑选现成的高品质卡牌。
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
                    去能力广场挑选预设卡
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Plaza Tab Content */}
        {activeTab === 'plaza' && (
          <div className="max-w-6xl mx-auto space-y-12 pb-12">
            {/* Built-in Section */}
            {groupedAssets.builtin.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-theme-accent pl-4">
                  <h2 className="text-lg font-bold text-theme-text">官方免费基础能力</h2>
                  <p className="text-xs text-theme-muted mt-1">大厂算法团队打磨的开箱即用基础模型微调与润色卡，完全免费。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.builtin.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Plaza Section */}
            {groupedAssets.plaza.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-theme-muted pl-4">
                  <h2 className="text-lg font-bold text-theme-text">广场共享技能</h2>
                  <p className="text-xs text-theme-muted mt-1">来自社区创作者共享的优质文风、设定卡。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.plaza.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Premium Flow */}
            {groupedAssets.premiumFlow.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-[oklch(0.72_0.16_54)] pl-4">
                  <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
                    Premium 作者流程包
                    <span className="text-[10px] bg-gradient-to-r from-[oklch(0.72_0.16_54)] to-[oklch(0.81_0.15_78)] text-white px-2 py-0.5 rounded-md uppercase tracking-wider font-black shadow-sm animate-pulse">
                      {/* Premium 专属标识 / Premium Exclusive Badge */}
                      PREMIUM 专属
                    </span>
                  </h2>
                  <p className="text-xs text-theme-muted mt-1">专为商业连载小说打造的体系化叙事与节奏控制流程卡。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.premiumFlow.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Premium Diagnostic */}
            {groupedAssets.premiumDiagnostic.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-[oklch(0.72_0.16_54)] pl-4">
                  <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
                    Premium 平台诊断包
                    <span className="text-[10px] bg-gradient-to-r from-[oklch(0.72_0.16_54)] to-[oklch(0.81_0.15_78)] text-white px-2 py-0.5 rounded-md uppercase tracking-wider font-black shadow-sm animate-pulse">
                      {/* Premium 专属标识 / Premium Exclusive Badge */}
                      PREMIUM 专属
                    </span>
                  </h2>
                  <p className="text-xs text-theme-muted mt-1">针对主流网文平台的商业毒点与逻辑安全高强度体检过滤。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.premiumDiagnostic.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Premium Deconstruction */}
            {groupedAssets.premiumDeconstruction.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-[oklch(0.72_0.16_54)] pl-4">
                  <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
                    Premium 拆书融合包
                    <span className="text-[10px] bg-gradient-to-r from-[oklch(0.72_0.16_54)] to-[oklch(0.81_0.15_78)] text-white px-2 py-0.5 rounded-md uppercase tracking-wider font-black shadow-sm animate-pulse">
                      {/* Premium 专属标识 / Premium Exclusive Badge */}
                      PREMIUM 专属
                    </span>
                  </h2>
                  <p className="text-xs text-theme-muted mt-1">深度拆解神作神髓，将神作精妙的伏笔节奏与场景温度无缝融入笔尖。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.premiumDeconstruction.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Premium Audit */}
            {groupedAssets.premiumAudit.length > 0 && (
              <div className="space-y-4 text-left">
                <div className="border-l-4 border-[oklch(0.72_0.16_54)] pl-4">
                  <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
                    Premium 高级审稿手术包
                    <span className="text-[10px] bg-gradient-to-r from-[oklch(0.72_0.16_54)] to-[oklch(0.81_0.15_78)] text-white px-2 py-0.5 rounded-md uppercase tracking-wider font-black shadow-sm animate-pulse">
                      {/* Premium 专属标识 / Premium Exclusive Badge */}
                      PREMIUM 专属
                    </span>
                  </h2>
                  <p className="text-xs text-theme-muted mt-1">微米级文字手术刀，无痕修补语感瑕疵、去AI腔，极致升华文章张力。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets.premiumAudit.map((asset) => (
                    <PlazaAssetCard
                      key={asset.id}
                      asset={asset}
                      isImported={importedAssetIds.has(asset.id) || savedParentIds.has(asset.id)}
                      isCloning={cloningAssetId === asset.id}
                      isFreeNovel={isFreeNovel}
                      onImport={() => handleImportAsset(asset)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
