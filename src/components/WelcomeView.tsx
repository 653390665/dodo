import { useState, useEffect } from 'react';
import { ArrowRight, BookOpen, Brain, Compass, FileCheck, Globe, Layers3, Loader2, Sliders, Sparkles, Upload } from 'lucide-react';
import { cn } from '../lib/utils';

import { listNovels } from '../lib/novel-client';
import { useStoryCards } from '../hooks/useStoryCards';
import { SourceBadge } from './SourceBadge';
import type { StoryIdeaCard, Novel, StoryPlanningInput, ViewType } from '../../shared/types';
import { recommendOpeningGovernance } from '../../shared/lib/prompt-assets-governed';
import type { OpeningRecommendationResult } from '../../shared/lib/prompt-assets-governed';

/**
 * 界面属性定义
 */
interface WelcomeViewProps {
  onSelectStoryCard: (
    card: StoryIdeaCard,
    planning: StoryPlanningInput,
    recommendedTags?: string[],
    targetView?: ViewType,
    activeSeriesId?: string
  ) => void;
  onJumpToLibrary: () => void;
  onSelectNovel: (novel: Novel) => void;
  onStartContinuationImport: () => void;
  onNavigateToFactory?: () => void;
}

/**
 * 快捷开书种子数据
 */
const SEED_CARDS = [
  { label: '武侠悬疑', prompt: '我想写一个雨夜酒馆里的复仇故事，主角是个沉默的刀客' },
  { label: '都市情感', prompt: '两个陌生人在深夜便利店的第100次偶遇' },
  { label: '架空幻想', prompt: '一个靠记忆为货币运转的世界，有人开始造假记忆' },
];

const GENRES = [
  { id: 'urban', label: '都市奇幻', desc: '现代都市、异能觉醒、轻松快节奏', icon: '🌃' },
  { id: 'fantasy', label: '玄幻仙侠', desc: '世界观宏大、法宝修炼、等级晋升', icon: '⚔️' },
  { id: 'mystery', label: '悬疑推理', desc: '悬念环环相扣、多重反转、高智商博弈', icon: '🔍' },
  { id: 'scifi', label: '科幻未来', desc: '星际探索、机械飞升、废土求生', icon: '🚀' },
  { id: 'romance', label: '情感治愈', desc: '细腻唯美、命运纠葛、双向救赎', icon: '🌸' },
];

const PLATFORMS = [
  { id: 'tomato', label: '番茄平台', desc: '主打黄金三章爆发、脑洞大开、极速推进与高能爽点', icon: '🍅' },
  { id: 'yuewen', label: '阅文平台', desc: '适合慢热铺陈、世界观庞大细致、主角长线成长、剧情考究', icon: '📚' },
  { id: 'lofter', label: 'Lofter平台', desc: '人设极为饱满、轻快同人风、注重情绪共鸣、文笔细腻唯美', icon: '✨' },
];

const LENGTHS = [
  { id: 'long', label: '百万长篇', words: 1500000, desc: '波澜壮阔的世界观与升级主线', icon: '🌟' },
  { id: 'medium', label: '中长篇规划', words: 300000, desc: '主线极其明确，节奏紧密不拖沓', icon: '📖' },
  { id: 'short', label: '精致短篇', words: 80000, desc: '戏剧冲突一气呵成，适合极速突进', icon: '✍️' },
];

const STYLES = [
  { id: 'relaxed', label: '轻松爽快', desc: '解压幽默、段子吐槽、高糖无雷无郁闷', icon: '🥳', pacing: 'tight' as const, focus: 'character' as const },
  { id: 'fast', label: '剧情高能', desc: '快节奏推进、高潮不断、悬念丛生绝无尿点', icon: '🔥', pacing: 'tight' as const, focus: 'plot' as const },
  { id: 'deep', label: '厚重深沉', desc: '强烈的史诗宿命感、探讨人性、角色深度挣扎', icon: '🏔️', pacing: 'balanced' as const, focus: 'world' as const },
  { id: 'elegant', label: '文笔典雅', desc: '追求诗意隽永的文字美感、意境深远、古风留白', icon: '🎭', pacing: 'slow-burn' as const, focus: 'character' as const },
];

export function WelcomeView({
  onSelectStoryCard,
  onJumpToLibrary,
  onSelectNovel,
  onStartContinuationImport,
  onNavigateToFactory,
}: WelcomeViewProps) {
  // 受控状态管理
  const [input, setInput] = useState('');
  const [chatContext] = useState('');
  const [recentNovels, setRecentNovels] = useState<Novel[]>([]);
  const [totalNovelCount, setTotalNovelCount] = useState(0); // 动态记录作品库总数
  const [planning, setPlanning] = useState<StoryPlanningInput>({
    expectedWordCount: 300000,
    pacingPreference: 'balanced',
    storyFocus: 'plot',
  });

  // 多步开书助手向导状态
  const [guideStep, setGuideStep] = useState<number>(0); // 0: 灵感与题材, 1: 目标平台, 2: 篇幅与风格
  const [selectedGenre, setSelectedGenre] = useState<string>(''); // 题材
  const [selectedPlatform, setSelectedPlatform] = useState<string>(''); // 平台
  const [selectedLengthLabel, setSelectedLengthLabel] = useState<string>('中长篇规划'); // 篇幅标签
  const [selectedStyleLabel, setSelectedStyleLabel] = useState<string>(''); // 风格标签

  const [showEmptyGuide, setShowEmptyGuide] = useState(() => {
    return localStorage.getItem('inkflow_welcome_empty_guide_closed') !== 'true';
  });

  const [selectedCardForRec, setSelectedCardForRec] = useState<StoryIdeaCard | null>(null);
  const [recResult, setRecResult] = useState<OpeningRecommendationResult | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null | 'unknown'>(null);

  // 新开书拦截确认弹窗与引导气泡状态
  const [showConfirmDetailsModal, setShowConfirmDetailsModal] = useState(false);
  const [confirmModalData, setConfirmModalData] = useState<{
    card: StoryIdeaCard;
    tags: string[];
    useWorkflow: boolean;
    defaultFlowId: string;
  } | null>(null);

  const [showGuidedBubble, setShowGuidedBubble] = useState(false);
  const [bubbleData, setConfirmBubbleData] = useState<{
    card: StoryIdeaCard;
    tags: string[];
    defaultFlowId: string;
  } | null>(null);

  const [confirmedItems, setConfirmedItems] = useState({
    character: true,
    world: true,
    power: true,
    conflict: true,
    platform: true,
  });

  // 加载自定义卡片检索钩子
  const { cards, source, isWaiting, isModelPending, warnings, submit } = useStoryCards({
    planning,
    chatContext,
  });

  // 组件挂载阶段：获取作品库和API Key配置状态
  useEffect(() => {
    listNovels().then((novels) => {
      setTotalNovelCount(novels.length);
      setRecentNovels(novels.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3));
    });
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => setHasApiKey(!!data.hasApiKey))
      .catch(() => setHasApiKey('unknown'));
  }, []);

  /**
   * 点击生成卡片逻辑
   */
  const handleCardClick = (card: StoryIdeaCard) => {
    const result = recommendOpeningGovernance({
      ideaSeed: input || card.hook,
      title: card.hook.slice(0, 18),
      summary: card.whyItWorks,
      targetWordCount: planning.expectedWordCount,
      tags: [],
    });
    setSelectedCardForRec(card);
    setRecResult(result);
  };

  const handleSubmit = async () => {
    if (!input.trim() || isWaiting) return;
    const promptParts = [
      `【核心故事创意】: ${input.trim()}`,
      selectedGenre ? `【主打题材】: ${selectedGenre}` : '',
      selectedPlatform ? `【目标平台】: ${selectedPlatform}` : '',
      selectedLengthLabel ? `【篇幅规划】: ${selectedLengthLabel} (${planning.expectedWordCount}字)` : '',
      selectedStyleLabel ? `【风格偏好】: ${selectedStyleLabel}` : '',
    ].filter(Boolean).join('\n');

    const submitted = await submit(promptParts);
    if (submitted) {
      setInput('');
    }
  };

  /**
   * 快捷灵感种子一键填充并自动跳转至下一步
   */
  const handleSeedClick = (prompt: string, label: string) => {
    setInput(prompt);
    if (label === '武侠悬疑') {
      setSelectedGenre('mystery');
    } else if (label === '都市情感') {
      setSelectedGenre('romance');
    } else if (label === '架空幻想') {
      setSelectedGenre('fantasy');
    }
    // 自动跳转到 Step 1，提供顺滑的多步自适应体验
    setTimeout(() => {
      setGuideStep(1);
    }, 300);
  };

  const hasContent = cards.length > 0;
  const latestNovel = recentNovels[0];

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-theme-bg/25">
      <div className="max-w-6xl mx-auto px-6 py-8 sm:px-8 sm:py-10">

        {/* 全局布局格栅：在大屏幕下采用均衡的 4:8 左右分栏设计 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* ==================== 左栏：系统核心遥测与作品快查 ==================== */}
          <div className="lg:col-span-4 space-y-4">

            {/* 1. Terminal-inspired 终端遥测控制面板 */}
            <div className="bg-theme-sidebar/40 font-mono border border-theme-border/50 rounded-md p-4 text-xs space-y-4 shadow-sm relative overflow-hidden">
              {/* 顶部极简科技装饰条 */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-theme-accent/20 via-theme-accent/50 to-theme-accent/20" />

              <div className="flex items-center justify-between border-b border-theme-border/40 pb-2">
                <span className="font-bold text-theme-accent tracking-wider">AI 创作状态监视器</span>
                {hasApiKey === true ? (
                  <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider">已连接 | CONNECTED</span>
                  </div>
                ) : hasApiKey === 'unknown' || hasApiKey === null ? (
                  <div className="flex items-center gap-1.5 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-[9px] text-amber-500 font-bold uppercase tracking-wider">未知/波动 | STATE_UNKNOWN</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    <span className="text-[9px] text-red-500 font-bold uppercase tracking-wider">本地模式 | LOCAL_RESERVED</span>
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">系统运行状态</span>
                  <span className="text-theme-text font-medium">稳定就绪</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">当前作品总数</span>
                  <span className="text-theme-text font-bold font-mono">{totalNovelCount} 本</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">AI 引擎连接</span>
                  <div>
                    {hasApiKey === null ? (
                      <span className="text-theme-muted">正在检测...</span>
                    ) : hasApiKey === 'unknown' ? (
                      <span className="text-amber-500 font-bold">网络波动/配置未知</span>
                    ) : hasApiKey ? (
                      <span className="text-theme-accent font-bold font-mono text-[10px]">CONNECTED</span>
                    ) : (
                      <span className="text-amber-500 font-bold">LOCAL_RESERVED</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">数据安全保护</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                    <span className="text-theme-text font-medium">自动快照备份中</span>
                  </div>
                </div>

                {/* 专属本地无缝降级指引横幅 */}
                {(hasApiKey === 'unknown' || hasApiKey === false || hasApiKey === null) && (
                  <div className="mt-3.5 p-2.5 bg-amber-500/5 border border-amber-500/15 rounded text-[11px] text-amber-600/90 leading-relaxed font-sans normal-case">
                    <p className="font-bold flex items-center gap-1 mb-0.5">⚠️ 本地无缝降级指引：</p>
                    <p>当前网络连接不稳定或未配置 API Key。系统已自动启用高可用本地降级策略。您的大纲草拟、本地分镜编辑、以及基于本地事务快照的灾备保护等核心功能均 **100% 正常运行**，可直接安心无碍地开展中长篇小说创作。</p>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 紧凑型最近载入作品快捷库入口 */}
            {recentNovels.length > 0 && (
              <div className="bg-theme-sidebar/15 border border-theme-border/40 rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-theme-border/30 pb-2">
                  <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">最近作品归档</span>
                  <button
                    onClick={onJumpToLibrary}
                    className="text-[10px] text-theme-accent font-bold hover:underline transition-all"
                  >
                    查看全部库
                  </button>
                </div>
                <div className="divide-y divide-theme-border/20">
                  {recentNovels.map((novel) => (
                    <button
                      key={novel.id}
                      onClick={() => onSelectNovel(novel)}
                      className="w-full flex items-center justify-between py-2 text-left group transition-all hover:translate-x-0.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen size={12} className="text-theme-muted group-hover:text-theme-accent transition-colors shrink-0" />
                        <span className="text-xs font-medium text-theme-text truncate group-hover:text-theme-accent transition-colors">
                          {novel.title}
                        </span>
                      </div>
                      <span className="text-[9px] text-theme-muted font-mono shrink-0 ml-2">
                        {new Date(novel.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ==================== 右栏：主业务控制台与输入区域 ==================== */}
          <div className="lg:col-span-8 space-y-6">

            {/* 1. 紧凑型精美控制台页眉 */}
            <div className="border-b border-theme-border/30 pb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles size={16} className="text-theme-accent animate-pulse shrink-0" />
                <h1 className="text-lg font-bold text-theme-text tracking-tight font-serif">
                  InkFlow 智能写作终端：一句话开书、长篇设定记忆、拆书技能、深度审稿精修
                </h1>
              </div>
              <p className="text-xs text-theme-muted leading-relaxed">
                自模糊灵感一键重构立项方向，或深度挂载已有资产大纲，流畅跨入高品质正文精写。
              </p>
            </div>

            {totalNovelCount === 0 && showEmptyGuide && (
              <div className="relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-2.5">
                    <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                        新手启航指南
                      </h4>
                      <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                        您好，欢迎进入 InkFlow 创作终端！当前您的书库为空。您可以直接在下方输入新书灵感（如“雨夜酒馆里的复仇故事”）一键智能立项；或点击上方【导入资料续写】以上传世界观与人设。需要 AI 生成时，请在右上角配置您的 API Key。
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.setItem('inkflow_welcome_empty_guide_closed', 'true');
                      setShowEmptyGuide(false);
                    }}
                    className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
                    aria-label="关闭提示"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* 2. 极致磨砂玻璃四大核心创作卡面板 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* 卡片 1: 开新书 */}
              <button
                onClick={() => {
                  const el = document.getElementById('story-seed-input');
                  if (el) {
                    el.focus();
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                className="p-3.5 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/60 hover:bg-theme-sidebar/35 transition-all hover:scale-[1.02] active:scale-[0.98] duration-300 text-left flex flex-col justify-between min-h-[96px] group w-full shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-theme-accent/10 text-theme-accent group-hover:bg-theme-accent group-hover:text-theme-bg transition-colors duration-300">
                    <Sparkles size={14} />
                  </span>
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    开新书
                  </span>
                </div>
                <p className="text-[10px] text-theme-muted leading-relaxed mt-2 line-clamp-2">
                  输入模糊场景思路，由智能规划引擎拆解起步。
                </p>
              </button>

              {/* 卡片 2: 继续当前作品 */}
              <button
                onClick={() => {
                  if (latestNovel) {
                    onSelectNovel(latestNovel);
                  } else {
                    onJumpToLibrary();
                  }
                }}
                className="p-3.5 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/60 hover:bg-theme-sidebar/35 transition-all hover:scale-[1.02] active:scale-[0.98] duration-300 text-left flex flex-col justify-between min-h-[96px] group w-full shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-theme-accent/10 text-theme-accent group-hover:bg-theme-accent group-hover:text-theme-bg transition-colors duration-300">
                    <BookOpen size={14} />
                  </span>
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    继续当前作品
                  </span>
                </div>
                {latestNovel ? (
                  <div className="min-w-0 mt-2">
                    <p className="truncate text-[10px] text-theme-text font-semibold">
                      《{latestNovel.title}》
                    </p>
                    <p className="text-[8px] text-theme-muted font-mono mt-0.5">
                      更新于: {new Date(latestNovel.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-theme-muted leading-relaxed mt-2 line-clamp-2">
                    暂无历史作品，点击进入作品书库。
                  </p>
                )}
              </button>

              {/* 卡片 3: 导入资料续写 */}
              <button
                onClick={onStartContinuationImport}
                className="p-3.5 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/60 hover:bg-theme-sidebar/35 transition-all hover:scale-[1.02] active:scale-[0.98] duration-300 text-left flex flex-col justify-between min-h-[96px] group w-full shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-theme-accent/10 text-theme-accent group-hover:bg-theme-accent group-hover:text-theme-bg transition-colors duration-300">
                    <Upload size={14} />
                  </span>
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    导入资料续写
                  </span>
                </div>
                <p className="text-[10px] text-theme-muted leading-relaxed mt-2 line-clamp-2">
                  上传已有人设、世界设定大纲，一键理顺衔接。
                </p>
              </button>

              {/* 卡片 4: 拆书生成技能 */}
              <button
                onClick={() => onNavigateToFactory?.()}
                className="p-3.5 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/60 hover:bg-theme-sidebar/35 transition-all hover:scale-[1.02] active:scale-[0.98] duration-300 text-left flex flex-col justify-between min-h-[96px] group w-full shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-theme-accent/10 text-theme-accent group-hover:bg-theme-accent group-hover:text-theme-bg transition-colors duration-300">
                    <Layers3 size={14} />
                  </span>
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    拆书生成技能
                  </span>
                </div>
                <p className="text-[10px] text-theme-muted leading-relaxed mt-2 line-clamp-2">
                  解构爆款名著优秀叙事骨架，提取文风卡牌。
                </p>
              </button>
            </div>

            {/* 3. 极具沉浸感的多步骤手风琴开书向导 */}
            <div className="space-y-4">
              {/* 向导系统页眉与指示器 */}
              <div className="flex items-center justify-between bg-theme-sidebar/10 border border-theme-border/30 rounded-xl px-4 py-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <Compass size={14} className="text-theme-accent animate-pulse" />
                  <span className="text-xs font-bold text-theme-text font-serif">开书智导多步向导</span>
                </div>
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((sIndex) => (
                    <button
                      key={sIndex}
                      type="button"
                      onClick={() => setGuideStep(sIndex)}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        guideStep === sIndex ? "w-6 bg-theme-accent" : "w-2 bg-theme-border/60 hover:bg-theme-accent/50"
                      )}
                      aria-label={`跳转至第 ${sIndex + 1} 步`}
                    />
                  ))}
                </div>
              </div>

              {/* 手风琴第一步：创意灵感与主打题材 */}
              <div className="border border-theme-border/40 rounded-xl overflow-hidden bg-theme-sidebar/5 shadow-xs transition-all duration-300 hover:border-theme-accent/20">
                <button
                  type="button"
                  onClick={() => setGuideStep(0)}
                  className="w-full flex items-center justify-between p-4 bg-theme-sidebar/10 hover:bg-theme-sidebar/20 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "size-6 rounded-full flex items-center justify-center font-mono text-xs font-bold transition-all duration-300",
                      guideStep === 0 ? "bg-theme-accent text-theme-bg shadow-sm" : "bg-theme-border/60 text-theme-muted"
                    )}>
                      01
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-theme-text transition-colors">创意灵感与主打题材</h3>
                      <p className="text-[10px] text-theme-muted mt-0.5 font-sans">描述您的小说场景并选择对应的细分题材</p>
                    </div>
                  </div>
                  {guideStep !== 0 && (
                    <div className="text-[10px] font-bold text-theme-accent font-sans bg-theme-accent/5 px-2.5 py-0.5 rounded border border-theme-accent/15 truncate max-w-[200px]">
                      {GENRES.find(g => g.id === selectedGenre)?.label || '未选定题材'} {input ? `| ${input.slice(0, 10)}...` : ''}
                    </div>
                  )}
                </button>

                <div className={cn(
                  "grid transition-all duration-300 ease-out border-theme-border/20",
                  guideStep === 0 ? "grid-rows-[1fr] opacity-100 border-t" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                )}>
                  <div className="overflow-hidden">
                    <div className="p-4 space-y-4">
                      {/* 题材选择列表 */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">
                          01 / 选择主打题材类型
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                          {GENRES.map((g) => {
                            const isSelected = selectedGenre === g.id;
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => setSelectedGenre(g.id)}
                                className={cn(
                                  "p-3 rounded-xl border text-left transition-all duration-300 cursor-pointer relative group flex flex-col justify-between h-24 overflow-hidden",
                                  isSelected
                                    ? "border-theme-accent bg-theme-accent/5 shadow-md shadow-theme-accent/5 ring-1 ring-theme-accent/25"
                                    : "border-theme-border/50 bg-theme-sidebar/15 hover:border-theme-accent/40 hover:bg-theme-sidebar/25"
                                )}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-base">{g.icon}</span>
                                  {isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse shrink-0" />
                                  )}
                                </div>
                                <div className="space-y-0.5 mt-2">
                                  <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                                    {g.label}
                                  </div>
                                  <p className="text-[9px] text-theme-muted line-clamp-1 leading-none font-sans">{g.desc}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 灵感思路录入 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">
                            02 / 激发脑洞创意灵感
                          </span>
                          <span className="text-[9px] text-theme-muted font-sans font-bold">支持 Enter 快捷保存</span>
                        </div>
                        <div className="relative">
                          <textarea
                            id="story-seed-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                // 如果输入有效，自动进入下一步
                                if (input.trim()) {
                                  setGuideStep(1);
                                }
                              }
                            }}
                            placeholder="请描述您的故事雏形，或点击下方的快捷推荐种子...（如：两个陌生人在深夜便利店的第 100 次偶遇）"
                            className="w-full rounded-xl border border-theme-border/50 px-4 py-3 pb-8 text-xs min-h-[90px] bg-theme-sidebar/30 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent/40 leading-relaxed font-sans"
                            disabled={isWaiting}
                          />
                          <div className="absolute bottom-2.5 left-3 text-[9px] text-theme-muted/50 font-mono">
                            按 Enter 锁定灵感并进入下一步
                          </div>
                        </div>
                      </div>

                      {/* 快捷推荐种子 */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <span className="text-[10px] text-theme-muted font-bold font-mono uppercase tracking-wider shrink-0">
                          快速填充种子:
                        </span>
                        {SEED_CARDS.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => handleSeedClick(item.prompt, item.label)}
                            className="text-[10px] px-2.5 py-1 rounded-lg border border-theme-border/60 bg-theme-sidebar/30 hover:border-theme-accent/50 hover:bg-theme-sidebar/80 text-theme-text/85 transition-all cursor-pointer font-sans"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {/* 控制栏 */}
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          disabled={!input.trim() && !selectedGenre}
                          onClick={() => setGuideStep(1)}
                          className="px-4 py-2 rounded-lg bg-theme-text text-white hover:opacity-90 disabled:opacity-20 transition-all font-sans text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          下一步：选择发布平台
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 手风琴第二步：定位目标平台 */}
              <div className="border border-theme-border/40 rounded-xl overflow-hidden bg-theme-sidebar/5 shadow-xs transition-all duration-300 hover:border-theme-accent/20">
                <button
                  type="button"
                  onClick={() => setGuideStep(1)}
                  className="w-full flex items-center justify-between p-4 bg-theme-sidebar/10 hover:bg-theme-sidebar/20 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "size-6 rounded-full flex items-center justify-center font-mono text-xs font-bold transition-all duration-300",
                      guideStep === 1 ? "bg-theme-accent text-theme-bg shadow-sm" : "bg-theme-border/60 text-theme-muted"
                    )}>
                      02
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-theme-text transition-colors">定位目标平台</h3>
                      <p className="text-[10px] text-theme-muted mt-0.5 font-sans">选择契合的文学分发阵地，对齐其独特的爽点大纲规约</p>
                    </div>
                  </div>
                  {guideStep !== 1 && (
                    <div className="text-[10px] font-bold text-theme-accent font-sans bg-theme-accent/5 px-2.5 py-0.5 rounded border border-theme-accent/15 truncate max-w-[200px]">
                      {PLATFORMS.find(p => p.id === selectedPlatform)?.label || '未选定平台'}
                    </div>
                  )}
                </button>

                <div className={cn(
                  "grid transition-all duration-300 ease-out border-theme-border/20",
                  guideStep === 1 ? "grid-rows-[1fr] opacity-100 border-t" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                )}>
                  <div className="overflow-hidden">
                    <div className="p-4 space-y-4">
                      {/* 平台选择矩阵 */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {PLATFORMS.map((p) => {
                          const isSelected = selectedPlatform === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setSelectedPlatform(p.id)}
                              className={cn(
                                "p-4 rounded-xl border text-left transition-all duration-300 cursor-pointer relative group flex flex-col justify-between min-h-[105px] overflow-hidden",
                                isSelected
                                  ? "border-theme-accent bg-theme-accent/5 shadow-md shadow-theme-accent/5 ring-1 ring-theme-accent/25"
                                  : "border-theme-border/50 bg-theme-sidebar/15 hover:border-theme-accent/40 hover:bg-theme-sidebar/25"
                              )}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="text-xl">{p.icon}</span>
                                {isSelected && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse shrink-0" />
                                )}
                              </div>
                              <div className="space-y-1 mt-2">
                                <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                                  {p.label}
                                </div>
                                <p className="text-[10px] text-theme-muted leading-relaxed line-clamp-2 font-sans">{p.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* 控制栏 */}
                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => setGuideStep(0)}
                          className="px-3.5 py-2 rounded-lg border border-theme-border bg-theme-bg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar font-sans text-xs font-bold transition-all cursor-pointer"
                        >
                          返回上一步
                        </button>
                        <button
                          type="button"
                          disabled={!selectedPlatform}
                          onClick={() => setGuideStep(2)}
                          className="px-4 py-2 rounded-lg bg-theme-text text-white hover:opacity-90 disabled:opacity-20 transition-all font-sans text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          下一步：篇幅与文风
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 手风琴第三步：篇幅规划与风格偏好 */}
              <div className="border border-theme-border/40 rounded-xl overflow-hidden bg-theme-sidebar/5 shadow-xs transition-all duration-300 hover:border-theme-accent/20">
                <button
                  type="button"
                  onClick={() => setGuideStep(2)}
                  className="w-full flex items-center justify-between p-4 bg-theme-sidebar/10 hover:bg-theme-sidebar/20 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "size-6 rounded-full flex items-center justify-center font-mono text-xs font-bold transition-all duration-300",
                      guideStep === 2 ? "bg-theme-accent text-theme-bg shadow-sm" : "bg-theme-border/60 text-theme-muted"
                    )}>
                      03
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-theme-text transition-colors">篇幅规划与写作文风</h3>
                      <p className="text-[10px] text-theme-muted mt-0.5 font-sans">锁定字数规模，调配高连贯性的行文格调与故事更重</p>
                    </div>
                  </div>
                  {guideStep !== 2 && (
                    <div className="text-[10px] font-bold text-theme-accent font-sans bg-theme-accent/5 px-2.5 py-0.5 rounded border border-theme-accent/15 truncate max-w-[200px]">
                      {selectedLengthLabel} {selectedStyleLabel ? `| ${selectedStyleLabel}` : ''}
                    </div>
                  )}
                </button>

                <div className={cn(
                  "grid transition-all duration-300 ease-out border-theme-border/20",
                  guideStep === 2 ? "grid-rows-[1fr] opacity-100 border-t" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                )}>
                  <div className="overflow-hidden">
                    <div className="p-4 space-y-4">
                      {/* 篇幅规划 */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">
                          01 / 预计全书总篇幅规模
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {LENGTHS.map((l) => {
                            const isSelected = selectedLengthLabel === l.label;
                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => {
                                  setSelectedLengthLabel(l.label);
                                  setPlanning((prev) => ({
                                    ...prev,
                                    expectedWordCount: l.words,
                                  }));
                                }}
                                className={cn(
                                  "p-3.5 rounded-xl border text-left transition-all duration-300 cursor-pointer relative group flex items-start gap-3",
                                  isSelected
                                    ? "border-theme-accent bg-theme-accent/5 shadow-md shadow-theme-accent/5 ring-1 ring-theme-accent/25"
                                    : "border-theme-border/50 bg-theme-sidebar/15 hover:border-theme-accent/40 hover:bg-theme-sidebar/25"
                                )}
                              >
                                <span className="text-xl shrink-0 mt-0.5">{l.icon}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                                    {l.label}
                                  </div>
                                  <p className="text-[9px] text-theme-muted mt-0.5 font-sans">{l.desc}</p>
                                  <div className="text-[10px] text-theme-accent font-mono font-bold mt-1.5">
                                    {l.words.toLocaleString()} 字
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 风格偏好 */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">
                          02 / 确定核心行文风格调性
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {STYLES.map((s) => {
                            const isSelected = selectedStyleLabel === s.label;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setSelectedStyleLabel(s.label);
                                  setPlanning((prev) => ({
                                    ...prev,
                                    pacingPreference: s.pacing,
                                    storyFocus: s.focus,
                                  }));
                                }}
                                className={cn(
                                  "p-3 rounded-xl border text-left transition-all duration-300 cursor-pointer relative group flex flex-col justify-between h-24 overflow-hidden",
                                  isSelected
                                    ? "border-theme-accent bg-theme-accent/5 shadow-md shadow-theme-accent/5 ring-1 ring-theme-accent/25"
                                    : "border-theme-border/50 bg-theme-sidebar/15 hover:border-theme-accent/40 hover:bg-theme-sidebar/25"
                                )}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-lg">{s.icon}</span>
                                  {isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse shrink-0" />
                                  )}
                                </div>
                                <div className="space-y-0.5 mt-2">
                                  <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                                    {s.label}
                                  </div>
                                  <p className="text-[9px] text-theme-muted line-clamp-1 leading-none font-sans">{s.desc}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 离线降级状态下的警告提示 */}
                      {(hasApiKey === false || hasApiKey === 'unknown') && (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-left flex items-start gap-2.5 font-sans leading-relaxed">
                          <Sparkles size={14} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                              本地降级模式已自动就绪
                            </div>
                            <p className="mt-0.5 text-[9px] text-theme-muted">
                              未检测到 API Key，我们将完全在前端通过本地高可用保底引擎，秒级为您拆解生成离线作品大纲与章节骨架。
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 控制栏与大生成按钮 */}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => setGuideStep(1)}
                          className="px-3.5 py-2 rounded-lg border border-theme-border bg-theme-bg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar font-sans text-xs font-bold transition-all cursor-pointer"
                        >
                          返回上一步
                        </button>
                        <button
                          type="button"
                          disabled={!input.trim() || isWaiting}
                          onClick={handleSubmit}
                          className="px-5 py-2.5 rounded-xl bg-theme-text text-white hover:opacity-95 disabled:opacity-20 transition-all font-sans text-xs font-black tracking-wide flex items-center gap-1.5 shadow-lg cursor-pointer"
                        >
                          {isWaiting ? (
                            <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Sparkles size={13} className="animate-pulse" />
                          )}
                          唤醒灵感，智能开书立项
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. 模型生成等待反馈状态 */}
            {isWaiting && (
              <div className="rounded border border-theme-accent/20 bg-theme-accent/5 p-6 text-center space-y-2 animate-pulse">
                <div className="size-5 border-2 border-theme-accent/30 border-t-theme-accent rounded-full animate-spin mx-auto" />
                <div className="text-xs font-bold text-theme-text">脑洞转化中，系统正在为您构建初始开书方向...</div>
                <p className="text-[10px] text-theme-muted">
                  生成过程大概需要 2 秒。本地保底架构正在搭建，如大语言模型响应成功将自动进行无缝替换。
                </p>
              </div>
            )}

            {/* 5. 解构卡片结果区 */}
            {hasContent && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold text-theme-text uppercase tracking-wider">立项推荐方案方向</h2>
                    {source && <SourceBadge source={source} />}
                  </div>
                  <span className="text-[10px] text-theme-muted">选中其一即可开启主角与作品设定</span>
                </div>

                {/* 异常和后台任务提示状态 */}
                {source === 'fallback' && isModelPending && (
                  <div className="rounded border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                      当前显示为本地算法保底方案。AI 模型仍在大脑后台处理精修版本，完成后将自动实时替换。
                    </p>
                  </div>
                )}

                {source === 'fallback' && !isModelPending && (
                  <div className="rounded border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                    {warnings.length > 0 ? warnings.map((w, i) => <div key={i}>{w}</div>) : '模型未能成功响应，系统将保留本地离线方案。'}
                  </div>
                )}

                {source === 'model' && warnings.length > 0 && (
                  <div className="rounded border border-theme-border bg-theme-sidebar/10 px-4 py-2 text-[10px] text-theme-muted leading-relaxed">
                    {warnings.map((w, i) => <div key={i}>{w}</div>)}
                  </div>
                )}

                {/* 结果立项卡片微观矩阵 */}
                <div className="grid gap-3 md:grid-cols-3">
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleCardClick(card)}
                      className="text-left p-4 rounded border border-theme-border/60 bg-theme-sidebar/30 hover:border-theme-accent hover:shadow-sm transition-all flex flex-col justify-between group"
                    >
                      <div className="space-y-1.5">
                        <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors line-clamp-2 leading-relaxed">
                          {card.hook}
                        </div>
                        <p className="text-[10px] text-theme-muted line-clamp-3 leading-relaxed">
                          {card.whyItWorks}
                        </p>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="text-[9px] font-mono text-theme-muted bg-theme-sidebar/50 px-2 py-0.5 rounded text-center">
                          {card.planningFit.recommendedLength} · {card.planningFit.recommendedFocus} · {card.planningFit.recommendedPacing}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-theme-accent font-bold">
                          <ArrowRight size={10} />
                          一键开始此立项
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ==================== InkFlow 能为您做什么 (Glassmorphism Quad-Grid Highlights) ==================== */}
        <div className="mt-10 pt-8 border-t border-theme-border/20 space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded bg-theme-accent shrink-0" />
            <h2 className="text-sm font-bold text-theme-text uppercase tracking-wider font-sans">
              InkFlow 能为您做什么
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 卡牌 1: 设定记忆 */}
            <div className="p-4 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/50 hover:bg-theme-sidebar/20 transition-all hover:scale-[1.01] duration-300 flex flex-col justify-between group">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 group-hover:bg-indigo-500 group-hover:text-theme-bg transition-colors duration-300 shrink-0">
                    <Brain size={15} />
                  </span>
                  <h3 className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    设定记忆
                  </h3>
                </div>
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  长效检索角色、地点、境界，告别写着写着就崩坏。
                </p>
              </div>
            </div>

            {/* 卡牌 2: 技能装配 */}
            <div className="p-4 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/50 hover:bg-theme-sidebar/20 transition-all hover:scale-[1.01] duration-300 flex flex-col justify-between group">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-theme-bg transition-colors duration-300 shrink-0">
                    <Sliders size={15} />
                  </span>
                  <h3 className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    技能装配
                  </h3>
                </div>
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  千变万化的文风滤镜与创作规则，直接融入生成流。
                </p>
              </div>
            </div>

            {/* 卡牌 3: 题材/平台流程 */}
            <div className="p-4 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/50 hover:bg-theme-sidebar/20 transition-all hover:scale-[1.01] duration-300 flex flex-col justify-between group">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500 group-hover:text-theme-bg transition-colors duration-300 shrink-0">
                    <Compass size={15} />
                  </span>
                  <h3 className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    题材/平台流程
                  </h3>
                </div>
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  官方内置番茄完读模型、起点节奏大纲，一键对齐爆款红线。
                </p>
              </div>
            </div>

            {/* 卡牌 4: 深度审稿去AI味 */}
            <div className="p-4 rounded-xl border border-theme-border/40 backdrop-blur-md bg-theme-sidebar/10 hover:border-theme-accent/50 hover:bg-theme-sidebar/20 transition-all hover:scale-[1.01] duration-300 flex flex-col justify-between group">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 group-hover:bg-rose-500 group-hover:text-theme-bg transition-colors duration-300 shrink-0">
                    <FileCheck size={15} />
                  </span>
                  <h3 className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    深度审稿去AI味
                  </h3>
                </div>
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  资深编辑多维一致性审计，错别字/大路货词汇一键定向精修重写。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== 智能开书治理配置推荐磨砂面板 ==================== */}
        {selectedCardForRec && recResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-bg/60 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-theme-sidebar border border-theme-border/50 max-w-md w-full rounded-lg p-5 shadow-xl relative overflow-hidden flex flex-col gap-4 animate-scale-in max-h-[85vh] overflow-y-auto">

              {/* 高级控制台色边彩条 design */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-theme-accent/20 via-theme-accent to-theme-accent/20" />

              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded bg-theme-accent/10 text-theme-accent border border-theme-accent/20 shrink-0">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-theme-text">智能开书配置推荐</h3>
                    <p className="text-[9px] text-theme-muted font-mono">INKFLOW GOVERNANCE ENGINE</p>
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedCardForRec(null); setRecResult(null); }}
                  className="text-theme-muted hover:text-theme-text text-xs p-1"
                >
                  ✕
                </button>
              </div>

              <div className="border-t border-theme-border/20 my-0.5" />

              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider block mb-1">选定主线 hook</span>
                  <p className="text-xs font-bold text-theme-text leading-relaxed">《{selectedCardForRec.hook.slice(0, 18)}》</p>
                </div>

                <div>
                  <span className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider block mb-1">自适应挂载分析</span>
                  <p className="text-[11px] text-theme-muted leading-relaxed bg-theme-bg/30 p-2.5 rounded border border-theme-border/30">
                    {recResult.explanation}
                  </p>
                </div>

                <div>
                  <span className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider block mb-1.5">流程引擎引导规划</span>
                  <div className="flex flex-col gap-2">

                    {/* 智能匹配工作流 */}
                    <div className="flex items-center justify-between p-2.5 rounded border border-theme-accent/20 bg-theme-accent/5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex size-5 items-center justify-center rounded bg-theme-accent/10 text-theme-accent text-[10px] shrink-0 font-serif">⚡</span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-theme-text truncate">
                            {recResult.activeSeriesId === 'tomato-platform-flow' ? '番茄脑洞文爆款创作流' :
                             recResult.activeSeriesId === 'xiaofeiji-novel-flow' ? '长篇商业连载流程' :
                             '通用型多阶智能创作流'}
                          </div>
                          <div className="text-[9px] text-theme-muted truncate">
                            {recResult.activeSeriesId === 'tomato-platform-flow' ? '契合快节奏签约、黄金三章爆发设定' :
                             recResult.activeSeriesId === 'xiaofeiji-novel-flow' ? '聚焦精细大纲拟定、多视角人物重塑' :
                             '全链路覆盖灵感卡片、分镜精细打磨和质检'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-theme-accent/10 text-theme-accent shrink-0 ml-2">工作流</span>
                    </div>

                    {/* 自适应题材标签 */}
                    {recResult.tagsToApply.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {recResult.tagsToApply.map(tag => (
                          <span key={tag} className="text-[9px] font-bold px-2 py-0.5 rounded bg-theme-sidebar border border-theme-border/50 text-theme-text flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-theme-accent animate-pulse" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-theme-border/20 my-0.5" />

              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <button
                  onClick={() => {
                    const card = selectedCardForRec;
                    setSelectedCardForRec(null);
                    setRecResult(null);
                    
                    // 前置拦截：打开“生成设定确认单”
                    setConfirmModalData({
                      card,
                      tags: [],
                      useWorkflow: false,
                      defaultFlowId: 'generic-novel-flow'
                    });
                    setShowConfirmDetailsModal(true);
                  }}
                  className="px-3 py-2 rounded border border-theme-border bg-theme-bg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar text-[11px] font-bold transition-all text-center"
                >
                  跳过流程推荐开书
                </button>
                <button
                  onClick={() => {
                    const card = selectedCardForRec;
                    const tags = recResult.tagsToApply;
                    const defaultFlowId = recResult.activeSeriesId || 'generic-novel-flow';
                    setSelectedCardForRec(null);
                    setRecResult(null);
                    
                    // 前置拦截：打开“生成设定确认单”
                    setConfirmModalData({
                      card,
                      tags,
                      useWorkflow: true,
                      defaultFlowId
                    });
                    setShowConfirmDetailsModal(true);
                  }}
                  className="px-3 py-2 rounded bg-theme-text text-white hover:opacity-90 text-[11px] font-bold transition-all flex items-center justify-center gap-1"
                >
                  <Sparkles size={11} />
                  接受治理规划立项
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ==================== 1. 生成设定确认单 (Setting Confirmation Checklist) ==================== */}
        {showConfirmDetailsModal && confirmModalData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-bg/80 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-theme-sidebar border border-theme-border/50 max-w-lg w-full rounded-2xl p-6 shadow-2xl relative overflow-hidden flex flex-col gap-5 animate-scale-in max-h-[90vh] overflow-y-auto text-left">
              {/* Decorative line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500/30 via-amber-500 to-amber-500/30" />

              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
                    <FileCheck size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
                      生成设定确认单
                      <span className="text-[9px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-widest font-mono">
                        CONFIRM CHECKLIST
                      </span>
                    </h3>
                    <p className="text-[10px] text-theme-muted mt-0.5">请勾选并确认即将导入设定工坊的虚构资产清单</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowConfirmDetailsModal(false); setConfirmModalData(null); }}
                  className="text-theme-muted hover:text-theme-text text-xs p-1"
                >
                  ✕
                </button>
              </div>

              <div className="border-t border-theme-border/20 my-0.5" />

              <div className="space-y-3.5 text-xs">
                {/* Checklist items */}
                <div className="flex items-start gap-3 p-3 rounded-xl border border-theme-border/40 bg-theme-bg/30">
                  <input
                    type="checkbox"
                    id="chk-char"
                    checked={confirmedItems.character}
                    onChange={(e) => setConfirmedItems({ ...confirmedItems, character: e.target.checked })}
                    className="mt-1 accent-amber-500"
                  />
                  <label htmlFor="chk-char" className="flex-1 cursor-pointer select-none">
                    <div className="font-bold text-theme-text flex items-center gap-1.5">
                      <span>待导入角色 (Protagonist)</span>
                      <span className="text-[8px] px-1 py-0.2 bg-theme-sidebar rounded text-theme-muted border border-theme-border/20">角色库</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed line-clamp-2">
                      主角设定: {confirmModalData.card.protagonist || '自动生成核心主角，挂载至第一章主角人设卡。'}
                    </p>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-theme-border/40 bg-theme-bg/30">
                  <input
                    type="checkbox"
                    id="chk-world"
                    checked={confirmedItems.world}
                    onChange={(e) => setConfirmedItems({ ...confirmedItems, world: e.target.checked })}
                    className="mt-1 accent-amber-500"
                  />
                  <label htmlFor="chk-world" className="flex-1 cursor-pointer select-none">
                    <div className="font-bold text-theme-text flex items-center gap-1.5">
                      <span>世界观设定 (World Seed)</span>
                      <span className="text-[8px] px-1 py-0.2 bg-theme-sidebar rounded text-theme-muted border border-theme-border/20">虚构创世</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed line-clamp-2">
                      世界设定: {confirmModalData.card.starterSeeds.worldSeed}
                    </p>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-theme-border/40 bg-theme-bg/30">
                  <input
                    type="checkbox"
                    id="chk-power"
                    checked={confirmedItems.power}
                    onChange={(e) => setConfirmedItems({ ...confirmedItems, power: e.target.checked })}
                    className="mt-1 accent-amber-500"
                  />
                  <label htmlFor="chk-power" className="flex-1 cursor-pointer select-none">
                    <div className="font-bold text-theme-text flex items-center gap-1.5">
                      <span>力量与战力等级体系 (Power System)</span>
                      <span className="text-[8px] px-1 py-0.2 bg-theme-sidebar rounded text-theme-muted border border-theme-border/20">规则树</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed">
                      基于该小说的虚构底层规则及升级序列，自动挂载高连贯性升级限制，保障大后期不崩。
                    </p>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-theme-border/40 bg-theme-bg/30">
                  <input
                    type="checkbox"
                    id="chk-conflict"
                    checked={confirmedItems.conflict}
                    onChange={(e) => setConfirmedItems({ ...confirmedItems, conflict: e.target.checked })}
                    className="mt-1 accent-amber-500"
                  />
                  <label htmlFor="chk-conflict" className="flex-1 cursor-pointer select-none">
                    <div className="font-bold text-theme-text flex items-center gap-1.5">
                      <span>核心冲突与金手指 (Conflict & Hooks)</span>
                      <span className="text-[8px] px-1 py-0.2 bg-theme-sidebar rounded text-theme-muted border border-theme-border/20">大纲规划</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed line-clamp-2">
                      主线冲突: {confirmModalData.card.coreConflict}
                    </p>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-theme-border/40 bg-theme-bg/30">
                  <input
                    type="checkbox"
                    id="chk-plat"
                    checked={confirmedItems.platform}
                    onChange={(e) => setConfirmedItems({ ...confirmedItems, platform: e.target.checked })}
                    className="mt-1 accent-amber-500"
                  />
                  <label htmlFor="chk-plat" className="flex-1 cursor-pointer select-none">
                    <div className="font-bold text-theme-text flex items-center gap-1.5">
                      <span>自适应适配平台标准 (Platform Target)</span>
                      <span className="text-[8px] px-1 py-0.2 bg-theme-sidebar rounded text-theme-muted border border-theme-border/20">白标质检</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed">
                      目标发布: {confirmModalData.useWorkflow && confirmModalData.defaultFlowId === 'tomato-platform-flow' ? '番茄小说爆款规则协议' : '经典网络文学通用标准'}
                    </p>
                  </label>
                </div>
              </div>

              <div className="border-t border-theme-border/20 my-0.5" />

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => { setShowConfirmDetailsModal(false); setConfirmModalData(null); }}
                  className="py-3 rounded-xl border border-theme-border bg-theme-bg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar text-xs font-bold transition-all text-center"
                >
                  取消返回
                </button>
                <button
                  onClick={() => {
                    const data = confirmModalData;
                    setShowConfirmDetailsModal(false);
                    setConfirmModalData(null);
                    
                    // 打开智能引导气泡弹窗
                    setConfirmBubbleData({
                      card: data.card,
                      tags: data.tags,
                      defaultFlowId: data.defaultFlowId
                    });
                    setShowGuidedBubble(true);
                  }}
                  className="py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
                >
                  <Sparkles size={14} />
                  勾选并原子写入设定工坊
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 2. 智能引导气泡弹窗 (Smart Onboarding Guide Bubble) ==================== */}
        {showGuidedBubble && bubbleData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-bg/85 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-theme-sidebar border border-theme-border/50 max-w-md w-full rounded-2xl p-6 shadow-2xl relative overflow-hidden flex flex-col gap-5 animate-scale-in text-left">
              {/* Gold gradient top border */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500" />

              <div className="text-center space-y-2">
                <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center animate-bounce mb-3">
                  <Brain size={22} className="animate-pulse" />
                </div>
                <h3 className="text-base font-bold text-theme-text">✨ 设定已原子写入设定工坊！</h3>
                <p className="text-xs text-theme-muted max-w-sm mx-auto leading-relaxed">
                  大纲结构与角色人设已完美导入底层大库。接下来，您将作为总调度官，选择您的首发创作起点：
                </p>
              </div>

              <div className="border-t border-theme-border/10 my-0.5" />

              <div className="space-y-3">
                <button
                  onClick={() => {
                    const data = bubbleData;
                    setShowGuidedBubble(false);
                    setConfirmBubbleData(null);
                    onSelectStoryCard(data.card, planning, data.tags, 'editor', data.defaultFlowId);
                  }}
                  className="w-full p-4 rounded-xl border border-theme-accent/20 bg-theme-accent/5 hover:bg-theme-accent/10 transition-all duration-150 text-left flex items-start gap-3 group"
                >
                  <div className="p-2 rounded-lg bg-theme-accent/15 text-theme-accent border border-theme-accent/20 group-hover:scale-105 transition-transform shrink-0">
                    <BookOpen size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors flex items-center gap-1.5">
                      <span>📝 起草第一章分镜</span>
                      <span className="text-[9px] bg-theme-accent/10 text-theme-accent px-1.5 py-0.2 rounded font-sans font-bold scale-90">官方推荐</span>
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed">直接跨入高阶正文编辑器，AI 将基于当前设定自动生成第一章的细纲分镜。</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    const data = bubbleData;
                    setShowGuidedBubble(false);
                    setConfirmBubbleData(null);
                    localStorage.setItem('inkflow_auto_open_bible_assistant', 'true');
                    onSelectStoryCard(data.card, planning, data.tags, 'world', data.defaultFlowId);
                  }}
                  className="w-full p-4 rounded-xl border border-theme-border/40 hover:border-theme-accent/35 bg-theme-bg/30 hover:bg-theme-bg/60 transition-all duration-150 text-left flex items-start gap-3 group"
                >
                  <div className="p-2 rounded-lg bg-theme-border/40 text-theme-text border border-theme-border/20 group-hover:scale-105 transition-transform shrink-0">
                    <Globe size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                      🔮 补全世界观与角色
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed">前往设定工坊，开启世界观设定助手引导，逐步细化并锁定主角、世界背景与升级体系。</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    const data = bubbleData;
                    setShowGuidedBubble(false);
                    setConfirmBubbleData(null);
                    onSelectStoryCard(data.card, planning, data.tags, 'workspace', data.defaultFlowId);
                  }}
                  className="w-full p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-all duration-150 text-left flex items-start gap-3 group"
                >
                  <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/20 group-hover:scale-105 transition-transform shrink-0">
                    <Layers3 size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-theme-text group-hover:text-amber-500 transition-colors">
                      ⚡ 启用推荐创作流程
                    </div>
                    <p className="text-[10px] text-theme-muted mt-1 leading-relaxed">
                      挂载 {bubbleData?.defaultFlowId === 'tomato-platform-flow' ? '番茄爆款爽文主流程' : '通用小说主流程'}，进入写作驾驶舱，享受极致多阶导航。
                    </p>
                  </div>
                </button>
              </div>

              <div className="border-t border-theme-border/10 my-0.5" />

              <div className="text-center">
                <button
                  onClick={() => { setShowGuidedBubble(false); setConfirmBubbleData(null); }}
                  className="text-xs text-theme-muted hover:text-theme-text transition-colors"
                >
                  暂不需要，我自己探索
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
