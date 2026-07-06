import { useState, useEffect } from 'react';
import { ArrowRight, BookOpen, Layers3, Loader2, PenLine, Send, Sparkles, Upload } from 'lucide-react';

import { listNovels } from '../lib/novel-client';
import { useStoryCards } from '../hooks/useStoryCards';
import { SourceBadge } from './SourceBadge';
import type { StoryIdeaCard, Novel, StoryPlanningInput } from '../../shared/types';
import { recommendOpeningGovernance } from '../../shared/lib/prompt-assets-governed';
import type { OpeningRecommendationResult } from '../../shared/lib/prompt-assets-governed';

/**
 * 界面属性定义
 */
interface WelcomeViewProps {
  onSelectStoryCard: (card: StoryIdeaCard, planning: StoryPlanningInput, recommendedTags?: string[]) => void;
  onJumpToLibrary: () => void;
  onSelectNovel: (novel: Novel) => void;
  onStartContinuationImport: () => void;
}

/**
 * 快捷开书种子数据
 */
const SEED_CARDS = [
  { label: '武侠悬疑', prompt: '我想写一个雨夜酒馆里的复仇故事，主角是个沉默的刀客' },
  { label: '都市情感', prompt: '两个陌生人在深夜便利店的第100次偶遇' },
  { label: '架空幻想', prompt: '一个靠记忆为货币运转的世界，有人开始造假记忆' },
];

export function WelcomeView({
  onSelectStoryCard,
  onJumpToLibrary,
  onSelectNovel,
  onStartContinuationImport,
}: WelcomeViewProps) {
  // 受控状态管理
  const [input, setInput] = useState('');
  const [chatContext] = useState('');
  const [recentNovels, setRecentNovels] = useState<Novel[]>([]);
  const [totalNovelCount, setTotalNovelCount] = useState(0); // 动态记录作品库总数
  const [planning, setPlanning] = useState<StoryPlanningInput>({
    expectedWordCount: 180000,
    pacingPreference: 'tight',
    storyFocus: 'plot',
  });

  const [selectedCardForRec, setSelectedCardForRec] = useState<StoryIdeaCard | null>(null);
  const [recResult, setRecResult] = useState<OpeningRecommendationResult | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null | 'unknown'>(null);

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

  /**
   * 提交想法处理函数
   */
  const handleSubmit = async () => {
    if (!input.trim() || isWaiting) return;
    const submitted = await submit(input);
    if (submitted) {
      setInput('');
    }
  };

  /**
   * 快捷灵感种子一键填充并提交
   */
  const handleSeedClick = (prompt: string) => {
    setInput(prompt);
    // 稍微延迟，以便用户能看到输入框中填充文字的微动效
    setTimeout(async () => {
      const submitted = await submit(prompt);
      if (submitted) {
        setInput('');
      }
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
                <span className="font-bold text-theme-accent tracking-wider">INKFLOW ENGINE STATUS</span>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider">ACTIVE</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">Workspace Engine</span>
                  <span className="text-theme-text font-medium">v0.9.6 Stable</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">Novel Count</span>
                  <span className="text-theme-text font-bold font-mono">{totalNovelCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">LLM Core Access</span>
                  <div>
                    {hasApiKey === null ? (
                      <span className="text-theme-muted">CHECKING...</span>
                    ) : hasApiKey === 'unknown' ? (
                      <span className="text-amber-500 font-bold">STATE_UNKNOWN</span>
                    ) : hasApiKey ? (
                      <span className="text-theme-accent font-bold">CONNECTED</span>
                    ) : (
                      <span className="text-amber-500 font-bold">LOCAL_RESERVED</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted">Active Backup Logs</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-theme-text font-medium truncate">sqlite_journal.bak</span>
                  </div>
                </div>
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
                  InkFlow 创作终端
                </h1>
              </div>
              <p className="text-xs text-theme-muted leading-relaxed">
                自模糊灵感一键重构立项方向，或深度挂载已有资产大纲，流畅跨入高品质正文精写。
              </p>
            </div>

            {/* 2. 紧凑业务三大核心功能卡网格 */}
            <div className={`grid gap-3 ${latestNovel ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
              {latestNovel && (
                <button
                  onClick={() => onSelectNovel(latestNovel)}
                  className="p-3 rounded-lg border border-theme-border/45 hover:border-theme-accent/60 transition-all bg-theme-sidebar/10 hover:bg-theme-sidebar/40 text-left flex flex-col justify-between h-[82px] group w-full"
                >
                  <div className="flex items-center gap-2">
                    <PenLine size={13} className="text-theme-accent" />
                    <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                      继续最近作品
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] text-theme-muted font-medium">
                      《{latestNovel.title}》
                    </p>
                    <p className="text-[8px] text-theme-muted/60 mt-0.5 font-mono">
                      更新于: {new Date(latestNovel.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </button>
              )}

              <button
                onClick={onStartContinuationImport}
                className="p-3 rounded-lg border border-theme-border/45 hover:border-theme-accent/60 transition-all bg-theme-sidebar/10 hover:bg-theme-sidebar/40 text-left flex flex-col justify-between h-[82px] group w-full"
              >
                <div className="flex items-center gap-2">
                  <Upload size={13} className="text-theme-accent" />
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    导入资料续写
                  </span>
                </div>
                <p className="text-[10px] text-theme-muted leading-relaxed">
                  上传世界大纲、人设或历史正文，一键理顺上下文启动续写。
                </p>
              </button>

              <button
                onClick={() => document.getElementById('story-seed-input')?.focus()}
                className="p-3 rounded-lg border border-theme-border/45 hover:border-theme-accent/60 transition-all bg-theme-sidebar/10 hover:bg-theme-sidebar/40 text-left flex flex-col justify-between h-[82px] group w-full"
              >
                <div className="flex items-center gap-2">
                  <Layers3 size={13} className="text-theme-accent" />
                  <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    从灵感创建
                  </span>
                </div>
                <p className="text-[10px] text-theme-muted leading-relaxed">
                  输入模糊思路场景，由分析引擎为您拆解 3 类起步立项通道。
                </p>
              </button>
            </div>

            {/* 3. 灵感录入与规划引擎控制台面板 */}
            <div className="bg-theme-sidebar/10 border border-theme-border/40 rounded-lg p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
                <span className="text-xs font-bold text-theme-text/90 tracking-wide">灵感转化引擎 & 规划设定</span>
                <span className="text-[9px] text-theme-muted font-mono tracking-widest">PLANNING_CORE v1.0</span>
              </div>

              {/* 三列超紧凑规划设置格栅 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border border-theme-border bg-theme-sidebar/20 px-3 py-1.5 text-left">
                  <span className="text-[9px] text-theme-muted block mb-1">预计总篇幅</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={10000}
                      step={10000}
                      value={planning.expectedWordCount}
                      onChange={(e) =>
                        setPlanning((prev) => ({
                          ...prev,
                          expectedWordCount: Math.max(10000, Number(e.target.value) || 10000),
                        }))
                      }
                      className="w-full bg-transparent text-xs text-theme-text outline-none font-bold font-mono"
                    />
                    <span className="text-[9px] text-theme-muted shrink-0">字</span>
                  </div>
                </div>

                <div className="rounded border border-theme-border bg-theme-sidebar/20 px-3 py-1.5 text-left">
                  <span className="text-[9px] text-theme-muted block mb-1">推进节奏</span>
                  <select
                    value={planning.pacingPreference}
                    onChange={(e) =>
                      setPlanning((prev) => ({
                        ...prev,
                        pacingPreference: e.target.value as StoryPlanningInput['pacingPreference'],
                      }))
                    }
                    className="w-full bg-transparent text-xs text-theme-text outline-none font-bold"
                  >
                    <option value="tight">紧推进</option>
                    <option value="balanced">均衡推进</option>
                    <option value="slow-burn">慢热铺陈</option>
                  </select>
                </div>

                <div className="rounded border border-theme-border bg-theme-sidebar/20 px-3 py-1.5 text-left">
                  <span className="text-[9px] text-theme-muted block mb-1">当前核心更重</span>
                  <select
                    value={planning.storyFocus}
                    onChange={(e) =>
                      setPlanning((prev) => ({
                        ...prev,
                        storyFocus: e.target.value as StoryPlanningInput['storyFocus'],
                      }))
                    }
                    className="w-full bg-transparent text-xs text-theme-text outline-none font-bold"
                  >
                    <option value="plot">剧情推进</option>
                    <option value="character">人物关系</option>
                    <option value="world">世界设定</option>
                  </select>
                </div>
              </div>

              {/* API 缺失时的极简本地状态横幅 */}
              {(hasApiKey === false || hasApiKey === 'unknown') && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 text-left flex items-start gap-2">
                  <Sparkles size={13} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      {hasApiKey === 'unknown' ? '配置状态未知，可继续本地编辑' : '本地引擎辅助模式已就绪'}
                    </div>
                    <p className="mt-0.5 text-[9px] text-theme-muted leading-relaxed">
                      {hasApiKey === 'unknown'
                        ? '网络请求失败，未检测到最新密钥。您可以继续使用本地大纲及全流程规划，或在右上角设置中进行配置。'
                        : '未检测到配置密钥。您仍可通过本地保底逻辑建立大纲、章节骨架及全流程规划。需要更精准生成时，请在右上角设置中进行配置。'}
                    </p>
                  </div>
                </div>
              )}

              {/* 精美输入框组合 */}
              <div className="relative">
                <textarea
                  id="story-seed-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="说点你的模糊思路吧... 例如：主角带有时间倒流能力、深夜便利店的第100次偶遇..."
                  className="w-full rounded border border-theme-border px-4 py-3 pb-8 text-xs min-h-[90px] bg-theme-sidebar/40 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-theme-accent/40"
                  disabled={isWaiting}
                />
                <div className="absolute bottom-2.5 left-3 text-[9px] text-theme-muted/50 font-mono">
                  按 Enter 发送，Shift+Enter 换行
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isWaiting}
                  className="absolute bottom-2 right-2 p-1.5 rounded bg-theme-text text-white hover:opacity-95 disabled:opacity-20 transition-opacity"
                >
                  {isWaiting ? (
                    <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send size={12} />
                  )}
                </button>
              </div>

              {/* 极其轻量化的快捷灵感胶囊推荐 */}
              {!hasContent && !isWaiting && (
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span className="text-[10px] text-theme-muted font-bold font-mono uppercase tracking-wider mr-1">
                    快捷推荐种子:
                  </span>
                  {SEED_CARDS.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => handleSeedClick(item.prompt)}
                      className="text-[10px] px-2.5 py-0.5 rounded border border-theme-border/60 bg-theme-sidebar/30 hover:border-theme-accent/50 hover:bg-theme-sidebar/80 text-theme-text/85 transition-all"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
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
                             recResult.activeSeriesId === 'xiaofeiji-novel-flow' ? '小飞鸡作者全套打磨流' :
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
                    onSelectStoryCard(selectedCardForRec, planning);
                    setSelectedCardForRec(null);
                    setRecResult(null);
                  }}
                  className="px-3 py-2 rounded border border-theme-border bg-theme-bg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar text-[11px] font-bold transition-all text-center"
                >
                  跳过流程推荐开书
                </button>
                <button
                  onClick={() => {
                    onSelectStoryCard(selectedCardForRec, planning, recResult.tagsToApply);
                    setSelectedCardForRec(null);
                    setRecResult(null);
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

      </div>
    </div>
  );
}
