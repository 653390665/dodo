import { useState, useEffect } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Globe2, Layers3, Loader2, PenLine, Send, Sparkles, Upload, Wand2 } from 'lucide-react';

import { listNovels } from '../lib/novel-client';
import { useStoryCards } from '../hooks/useStoryCards';
import { SourceBadge } from './SourceBadge';
import type { StoryIdeaCard, Novel, StoryPlanningInput } from '../../shared/types';

interface WelcomeViewProps {
  onSelectStoryCard: (card: StoryIdeaCard, planning: StoryPlanningInput) => void;
  onJumpToLibrary: () => void;
  onSelectNovel: (novel: Novel) => void;
  onStartContinuationImport: () => void;
}

const SEED_CARDS = [
  { label: '武侠悬疑', prompt: '我想写一个雨夜酒馆里的复仇故事，主角是个沉默的刀客' },
  { label: '都市情感', prompt: '两个陌生人在深夜便利店的第100次偶遇' },
  { label: '架空幻想', prompt: '一个靠记忆为货币运转的世界，有人开始造假记忆' },
];

const CREATION_FLOW = [
  { label: '灵感', detail: '一句话起点', icon: Sparkles },
  { label: '立项', detail: '作品与第一章', icon: BookOpen },
  { label: '世界观', detail: '设定与人物', icon: Globe2 },
  { label: '技能', detail: '文风与节奏', icon: Wand2 },
  { label: '写作', detail: '分镜到正文', icon: PenLine },
  { label: '审查', detail: '反馈与打磨', icon: CheckCircle2 },
];

export function WelcomeView({ onSelectStoryCard, onJumpToLibrary, onSelectNovel, onStartContinuationImport }: WelcomeViewProps) {
  const [input, setInput] = useState('');
  const [chatContext] = useState('');
  const [recentNovels, setRecentNovels] = useState<Novel[]>([]);
  const [planning, setPlanning] = useState<StoryPlanningInput>({
    expectedWordCount: 180000,
    pacingPreference: 'tight',
    storyFocus: 'plot',
  });

  const { cards, source, isWaiting, isModelPending, warnings, submit } = useStoryCards({
    planning,
    chatContext,
  });

  useEffect(() => {
    listNovels().then((novels) =>
      setRecentNovels(novels.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)),
    );
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || isWaiting) return;
    const submitted = await submit(input);
    if (submitted) {
      setInput('');
    }
  };

  const handleSeedClick = (prompt: string) => {
    setInput(prompt);
    // Small delay so the user sees the textarea fill before submission
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
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-5xl mx-auto px-5 py-10 sm:px-8 sm:py-12">
        {/* 欢迎区 */}
        <div className="text-center mb-12">
          <Sparkles size={40} className="mx-auto mb-4 text-theme-accent" />
          <h1 className="text-3xl font-serif font-bold text-theme-text mb-3">
            InkFlow 小说创作工作台
          </h1>
          <p className="text-theme-muted text-sm max-w-md mx-auto">
            从一个模糊灵感开始，落成作品、设定、技能卡和可继续打磨的章节。
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {CREATION_FLOW.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="rounded-2xl border border-theme-border bg-theme-sidebar px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
                    <Icon size={14} />
                  </span>
                  <span className="text-[10px] font-bold text-theme-muted">0{index + 1}</span>
                </div>
                <div className="mt-3 text-sm font-bold text-theme-text">{step.label}</div>
                <div className="mt-1 text-[11px] text-theme-muted">{step.detail}</div>
              </div>
            );
          })}
        </div>

        <div className="mb-8 grid gap-3 md:grid-cols-3">
          {latestNovel && (
            <button
              onClick={() => onSelectNovel(latestNovel)}
              className="rounded-2xl border border-theme-accent/30 bg-theme-accent/5 px-5 py-4 text-left hover:border-theme-accent/60 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-theme-sidebar p-2 text-theme-accent border border-theme-accent/10">
                  <PenLine size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                    继续最近作品
                    <ArrowRight size={14} className="text-theme-accent" />
                  </div>
                  <p className="mt-1 truncate text-xs text-theme-muted">
                    《{latestNovel.title}》 · {new Date(latestNovel.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </button>
          )}
          <button
            onClick={onStartContinuationImport}
            className="w-full rounded-2xl border border-theme-accent/20 bg-theme-accent/5 px-5 py-4 text-left hover:border-theme-accent/40 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-theme-sidebar p-2 text-theme-accent border border-theme-accent/10">
                <Upload size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                  导入资料续写
                  <ArrowRight size={14} className="text-theme-accent" />
                </div>
                <p className="mt-1 text-xs text-theme-muted leading-5">
                  上传世界观、大纲、任务或已有正文，整理后直接进入续写。
                </p>
              </div>
            </div>
          </button>
          <button
            onClick={() => document.getElementById('story-seed-input')?.focus()}
            className="w-full rounded-2xl border border-theme-border bg-theme-sidebar px-5 py-4 text-left hover:border-theme-accent/40 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-theme-bg p-2 text-theme-accent border border-theme-border">
                <Layers3 size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-bold text-theme-text group-hover:text-theme-accent transition-colors">
                  从灵感创建
                  <ArrowRight size={14} className="text-theme-accent" />
                </div>
                <p className="mt-1 text-xs text-theme-muted leading-5">
                  输入一个场景，生成 3 个可立项方向。
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* 快捷种子——单击直接发送 */}
        {!hasContent && !isWaiting && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            {SEED_CARDS.map((item) => (
              <button
                key={item.label}
                onClick={() => handleSeedClick(item.prompt)}
                className="p-4 rounded-xl border border-theme-border bg-theme-sidebar hover:border-theme-accent/40 hover:shadow-sm transition-all text-left group"
              >
                <div className="text-xs font-bold text-theme-accent mb-1">{item.label}</div>
                <div className="text-xs text-theme-muted line-clamp-2">{item.prompt}</div>
              </button>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div className="relative">
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <label className="rounded-2xl border border-theme-border bg-theme-sidebar px-4 py-3 text-left">
              <div className="text-[11px] font-bold text-theme-muted mb-2">预计总字数</div>
              <div className="flex items-center gap-2">
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
                  className="w-full bg-transparent text-sm text-theme-text outline-none"
                />
                <span className="text-xs text-theme-muted shrink-0">字</span>
              </div>
            </label>
            <label className="rounded-2xl border border-theme-border bg-theme-sidebar px-4 py-3 text-left">
              <div className="text-[11px] font-bold text-theme-muted mb-2">推进节奏</div>
              <select
                value={planning.pacingPreference}
                onChange={(e) =>
                  setPlanning((prev) => ({
                    ...prev,
                    pacingPreference: e.target.value as StoryPlanningInput['pacingPreference'],
                  }))
                }
                className="w-full bg-transparent text-sm text-theme-text outline-none"
              >
                <option value="tight">紧推进</option>
                <option value="balanced">均衡推进</option>
                <option value="slow-burn">慢热铺陈</option>
              </select>
            </label>
            <label className="rounded-2xl border border-theme-border bg-theme-sidebar px-4 py-3 text-left">
              <div className="text-[11px] font-bold text-theme-muted mb-2">当前更重</div>
              <select
                value={planning.storyFocus}
                onChange={(e) =>
                  setPlanning((prev) => ({
                    ...prev,
                    storyFocus: e.target.value as StoryPlanningInput['storyFocus'],
                  }))
                }
                className="w-full bg-transparent text-sm text-theme-text outline-none"
              >
                <option value="plot">剧情推进</option>
                <option value="character">人物关系</option>
                <option value="world">世界设定</option>
              </select>
            </label>
          </div>
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
            placeholder="随便说说你的想法，模糊的也行..."
            className="w-full rounded-2xl border border-theme-border px-5 py-4 text-sm min-h-[80px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
            disabled={isWaiting}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isWaiting}
            className="absolute bottom-3 right-3 p-2.5 rounded-xl bg-theme-text text-white hover:opacity-90 disabled:opacity-30 transition-opacity"
          >
            {isWaiting ? (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <p className="text-[10px] text-theme-muted/60 text-center mt-3">
          按 Enter 发送，Shift+Enter 换行 · 系统会生成 3 个可直接立项的故事方向
        </p>

        {/* 等待首次响应 — 醒目提示"正在处理" */}
        {isWaiting && (
          <div className="mt-8 rounded-2xl border border-theme-accent/20 bg-theme-accent/5 p-6 text-center">
            <div className="w-10 h-10 border-2 border-theme-accent/30 border-t-theme-accent rounded-full animate-spin mx-auto mb-3" />
            <div className="text-sm font-bold text-theme-text">
              正在分析你的想法，马上给你草案
            </div>
            <div className="text-xs text-theme-muted mt-1">
              预计 2 秒内展示本地保底方向，然后 AI 在后台生成更优版本...
            </div>
          </div>
        )}

        {/* 方案卡展示 — 不依赖 isWaiting，到货即渲染 */}
        {hasContent && (
          <div className="mt-10 space-y-4">
            {/* 标题行 + 来源徽章 */}
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-lg font-serif font-bold text-theme-text">
                选一个方向，创建新作品
              </h2>
              {source && <SourceBadge source={source} />}
            </div>
            <p className="text-xs text-theme-muted text-center -mt-2">
              会结合你的篇幅与推进规划，自动创建作品、第一章骨架和主角设定
            </p>

            {/* 保底 / AI 正在后台工作的提示 */}
            {source === 'fallback' && isModelPending && (
              <div className="mt-4 mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 text-center flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <div>
                  <div>当前为本地保底草案，已覆盖你的故事关键词。</div>
                  <div className="mt-0.5 text-amber-500">
                    AI 模型仍在后台生成更优版本，返回后自动替换。
                  </div>
                </div>
              </div>
            )}

            {/* 保底但模型已完成/失败 */}
            {source === 'fallback' && !isModelPending && (
              <div className="mt-4 mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 text-center">
                {warnings.length > 0 ? warnings.map((w, i) => <div key={i}>{w}</div>) : '模型未返回，保留本地保底草案。'}
              </div>
            )}

            {/* 模型成功但有 side warnings（如 needs_clarification） */}
            {source === 'model' && warnings.length > 0 && (
              <div className="mt-4 mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 text-center">
                {warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}

            {/* 卡片网格 */}
            <div className="grid gap-4 xl:grid-cols-3 mt-6">
              {cards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onSelectStoryCard(card, planning)}
                  className="text-left p-5 rounded-2xl border border-theme-border bg-theme-sidebar hover:border-theme-accent hover:shadow-md transition-all group"
                >
                  <div className="text-sm font-bold text-theme-text mb-2 group-hover:text-theme-accent transition-colors">
                    {card.hook}
                  </div>
                  <div className="text-xs text-theme-muted line-clamp-3 mb-3">
                    {card.whyItWorks}
                  </div>
                  <div className="mb-3 rounded-xl bg-theme-sidebar/20 px-3 py-2 text-[11px] text-theme-muted">
                    {card.planningFit.recommendedLength} · {card.planningFit.recommendedFocus} · {card.planningFit.recommendedPacing}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-theme-accent font-bold">
                    <ArrowRight size={12} />
                    选这个方向
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 已有作品快捷入口 */}
        {recentNovels.length > 0 && !hasContent && !isWaiting && (
          <div className="mt-12 pt-8 border-t border-theme-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-theme-muted uppercase tracking-wider">最近作品</h2>
              <button
                onClick={onJumpToLibrary}
                className="text-xs text-theme-accent font-bold hover:underline"
              >
                查看全部
              </button>
            </div>
            <div className="space-y-2">
              {recentNovels.map((novel) => (
                <button
                  key={novel.id}
                  onClick={() => onSelectNovel(novel)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-theme-border bg-theme-sidebar hover:border-theme-accent/40 hover:shadow-sm transition-all text-left"
                >
                  <BookOpen size={16} className="text-theme-muted shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-theme-text truncate">{novel.title}</div>
                    <div className="text-[10px] text-theme-muted">
                      {novel.status === 'ongoing' ? '连载中' : novel.status}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
