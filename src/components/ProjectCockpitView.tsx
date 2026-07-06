import React, { useState, useEffect } from 'react';
import {
  BookOpen, Sparkles, BrainCircuit, Plus, ArrowRight,
  User, Compass, FileText,
  AlertCircle, ShieldCheck, Database, Layers, RefreshCw
} from 'lucide-react';
import { Novel, Chapter, ChapterMetadata, Character, Location, Item, Faction, Skill, ContinuationPack } from '../../shared/types';
import { cn } from '../lib/utils';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems,
  listFactions, listContinuationPacks, listSkills, getNovel, createChapter
} from '../lib/api';
import { ScrollArea } from './ui/scroll-area';
import { toast } from '../lib/toast';

interface ProjectCockpitViewProps {
  novel: Novel;
  onNavigate: (view: 'welcome' | 'library' | 'editor' | 'world' | 'skills' | 'factory' | 'continuation-import') => void;
  onStartCockpitAction?: (action: 'planning' | 'production' | 'resume', targetChapterId?: string) => void;
  onSelectChapter?: (chapter: Chapter | null) => void;
  onStartContinuationWriting?: (packId: string) => void;
  onEnterStoryboard?: (packId: string) => void;
}

export function ProjectCockpitView({
  novel: initialNovel,
  onNavigate,
  onStartCockpitAction,
  onSelectChapter,
  onStartContinuationWriting,
  onEnterStoryboard,
}: ProjectCockpitViewProps) {
  const [novel, setNovel] = useState<Novel>(initialNovel);
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [latestFullChapter, setLatestFullChapter] = useState<Chapter | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [packs, setPacks] = useState<ContinuationPack[]>([]);
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        freshNovel,
        freshChapters,
        freshCharacters,
        freshLocations,
        freshItems,
        freshFactions,
        freshPacks,
        freshSkills
      ] = await Promise.all([
        getNovel(initialNovel.id),
        listChaptersMetadata(initialNovel.id),
        listCharacters(initialNovel.id),
        listLocations(initialNovel.id),
        listItems(initialNovel.id),
        listFactions(initialNovel.id),
        listContinuationPacks(initialNovel.id),
        listSkills()
      ]);

      if (freshNovel) {
        setNovel(freshNovel);
      }
      setChapters(freshChapters);
      setCharacters(freshCharacters);
      setLocations(freshLocations);
      setItems(freshItems);
      setFactions(freshFactions);
      setPacks(freshPacks);
      setAllSkills(freshSkills);

      // Lazy load latest full chapter content asynchronously
      const latestMeta = [...freshChapters].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
      if (latestMeta) {
        getChapter(latestMeta.id).then((fullCh) => {
          setLatestFullChapter(fullCh || null);
        }).catch((err) => {
          console.warn('Failed to lazy load latest chapter full content:', err);
        });
      } else {
        setLatestFullChapter(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchProjectData();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount or initialNovel change
  }, [initialNovel.id]);

  // Compute stats
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  const getMountedSkillIds = (): string[] => {
    const idsFromLoadout = (novel.mountedSkillLoadout || [])
      .map(item => item.skillId)
      .filter((id): id is string => !!id);

    if (idsFromLoadout.length > 0) {
      return idsFromLoadout;
    }

    return novel.mountedSkillIds || [];
  };

  const activeMountedSkillIds = getMountedSkillIds();
  const mountedSkills = allSkills.filter(s => activeMountedSkillIds.includes(s.id));
  const worldEntitiesCount = characters.length + locations.length + items.length + factions.length;

  const latestChapter = [...chapters].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;

  // Handles Quick Creation of First Chapter
  const handleCreateFirstChapter = async () => {
    try {
      const newCh: Chapter = {
        id: `ch-${Date.now()}`,
        novelId: novel.id,
        title: '第一章',
        volumeName: '正文',
        content: '',
        sceneBeats: '',
        order: 1,
        wordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await createChapter(newCh);
      if (onSelectChapter) {
        onSelectChapter(newCh);
      }
      onNavigate('editor');
    } catch {
      toast('创建作品第一章失败，请稍后重试', 'error');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-paper p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-theme-accent border-t-transparent" />
          <div className="text-sm font-bold text-theme-muted">正在装载创作工作台...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-paper p-8">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="mx-auto text-red-600" size={40} />
          <h3 className="text-lg font-bold text-theme-text">装载数据出错</h3>
          <p className="text-xs text-theme-muted leading-relaxed">{error}</p>
          <button
            onClick={fetchProjectData}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-theme-bg bg-theme-text rounded-lg hover:bg-theme-text/90 transition-colors"
          >
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-paper flex flex-col min-h-0 relative select-none">
      {/* Cockpit Header */}
      <div className="shrink-0 border-b border-theme-border/60 bg-theme-bg/30 px-6 py-6 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-theme-accent/15 text-theme-accent border border-theme-accent/25 uppercase tracking-wide">作品总览</span>
              <h1 className="text-2xl font-serif font-black text-theme-text leading-tight">{novel.title}</h1>
            </div>
            <p className="text-xs text-theme-muted max-w-3xl leading-relaxed mt-1">
              {novel.summary || '暂无作品简介。可以在「我的书库」或编辑器中修改简介。'}
            </p>
          </div>
          <button
            onClick={() => onNavigate('library')}
            className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-muted hover:text-theme-text hover:bg-theme-border/30 transition-colors shrink-0 font-medium cursor-pointer"
          >
            切换作品
          </button>
        </div>

        {/* Global Outline Insight */}
        {novel.globalOutline && (
          <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-xs leading-relaxed text-theme-muted/80">
            <span className="font-bold text-theme-text">核心主线/大纲：</span>
            {novel.globalOutline.length > 150 ? `${novel.globalOutline.slice(0, 150)}...` : novel.globalOutline}
          </div>
        )}
      </div>

      {/* Grid Dashboard Content */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full px-6 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6 pb-6 items-start">

            {/* Left Column: Stats & Operations */}
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-1">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">总字数</div>
                  <div className="text-xl font-serif font-black text-theme-text">{totalWords.toLocaleString()} <span className="text-xs font-normal text-theme-muted">字</span></div>
                </div>
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-1">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">章节数</div>
                  <div className="text-xl font-serif font-black text-theme-text">{chapters.length} <span className="text-xs font-normal text-theme-muted">章</span></div>
                </div>
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-1">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">设定条目</div>
                  <div className="text-xl font-serif font-black text-theme-text">{worldEntitiesCount} <span className="text-xs font-normal text-theme-muted">个</span></div>
                </div>
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-1">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">最近活跃</div>
                  <div className="text-[11px] font-medium text-theme-text mt-1.5 truncate">
                    {latestChapter ? latestChapter.title : '尚无创作记录'}
                  </div>
                </div>
              </div>

              {/* Next Actions CTA Panel */}
              <div className="rounded-3xl border border-theme-border bg-theme-sidebar/40 p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-theme-text">下一步动作推荐</h3>
                  <p className="text-[11px] text-theme-muted mt-1 leading-relaxed">
                    工作台根据您当前作品资产的状态，为您生成的最佳写作/设定路径。
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {chapters.length === 0 ? (
                    <button
                      onClick={handleCreateFirstChapter}
                      className="col-span-2 flex items-center justify-between p-4 rounded-2xl bg-theme-text text-theme-bg shadow hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-bold flex items-center gap-1.5">
                          <Plus size={16} /> 新建作品第一章
                        </div>
                        <p className="text-[10px] opacity-75">当前还没有任何章节。快创建你的第一章正文！</p>
                      </div>
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          if (onSelectChapter && latestChapter) {
                            onSelectChapter(latestChapter as unknown as Chapter);
                          }
                          if (onStartCockpitAction && latestChapter) {
                            onStartCockpitAction('resume', latestChapter.id);
                          } else {
                            onNavigate('editor');
                          }
                        }}
                        className="flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                            <BookOpen size={14} className="text-theme-accent" /> 继续写作最近章节
                          </div>
                          <p className="text-[10px] text-theme-muted truncate max-w-[200px]">
                            {latestChapter ? `进入「${latestChapter.title}」编辑器` : '返回写作页'}
                          </p>
                        </div>
                        <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                      </button>

                      <button
                        onClick={() => {
                          if (onSelectChapter && latestChapter) {
                            onSelectChapter(latestChapter as unknown as Chapter);
                          }
                          if (onStartCockpitAction && latestChapter) {
                            onStartCockpitAction('planning', latestChapter.id);
                          } else {
                            onNavigate('editor');
                          }
                        }}
                        className="flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                            <Sparkles size={14} className="text-theme-accent" /> 补充分镜 / Beats
                          </div>
                          <p className="text-[10px] text-theme-muted">使用 AI 智能规划或精修本章分镜</p>
                        </div>
                        <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                      </button>

                      <button
                        onClick={() => {
                          if (onSelectChapter && latestChapter) {
                            onSelectChapter(latestChapter as unknown as Chapter);
                          }
                          if (onStartCockpitAction && latestChapter) {
                            onStartCockpitAction('production', latestChapter.id);
                          } else {
                            onNavigate('editor');
                          }
                        }}
                        className="flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                            <Sparkles size={14} className="text-theme-accent" /> 自动生产一章
                          </div>
                          <p className="text-[10px] text-theme-muted">使用 AI 智能体根据大纲/分镜自动化排版生产正文</p>
                        </div>
                        <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => onNavigate('world')}
                    className="flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                        <Compass size={14} className="text-theme-accent" /> 补充世界观设定
                      </div>
                      <p className="text-[10px] text-theme-muted">
                        {worldEntitiesCount > 0 ? `当前已有 ${worldEntitiesCount} 个条目` : '添加核心人物、地点或组织关系'}
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                  </button>

                  <button
                    onClick={() => onNavigate('skills')}
                    className="flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                        <BrainCircuit size={14} className="text-theme-accent" /> 装配写作技能卡
                      </div>
                      <p className="text-[10px] text-theme-muted">
                        {mountedSkills.length > 0 ? `已挂载 ${mountedSkills.length} 张写作滤镜` : '装配词风、叙事、审计规则技能卡'}
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                  </button>

                  <button
                    onClick={() => onNavigate('continuation-import')}
                    className="col-span-1 sm:col-span-2 flex items-center justify-between p-4 rounded-2xl border border-theme-border bg-paper hover:bg-theme-sidebar/40 hover:scale-[1.01] active:scale-95 transition-all text-left group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                        <FileText size={14} className="text-theme-accent" /> 导入前文参考资料包
                      </div>
                      <p className="text-[10px] text-theme-muted">
                        {packs.length > 0 ? `已有 ${packs.length} 个资料包可供续写参考` : '导入已有小说前文或大纲，使 AI 获得长效续写记忆'}
                      </p>
                    </div>
                    <ArrowRight size={14} className="text-theme-muted group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>

              {/* Status Warning Alerts */}
              {(chapters.length === 0 || mountedSkills.length === 0 || worldEntitiesCount === 0 || packs.length === 0) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                  <div className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
                    <AlertCircle size={14} /> 创作准备自检提示
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-amber-700">
                    {chapters.length === 0 && (
                      <div className="flex items-center gap-1">
                        <div className="size-1 rounded-full bg-amber-500" />
                        <span>未创建章节，AI 无法嗅探当前写作位置</span>
                      </div>
                    )}
                    {mountedSkills.length === 0 && (
                      <div className="flex items-center gap-1">
                        <div className="size-1 rounded-full bg-amber-500" />
                        <span>无已挂载技能，AI 生成将使用通用默认语气</span>
                      </div>
                    )}
                    {worldEntitiesCount === 0 && (
                      <div className="flex items-center gap-1">
                        <div className="size-1 rounded-full bg-amber-500" />
                        <span>未录入任何角色/地点，AI 将无法做背景设定关联</span>
                      </div>
                    )}
                    {packs.length === 0 && (
                      <div className="flex items-center gap-1">
                        <div className="size-1 rounded-full bg-amber-500" />
                        <span>缺少参考资料包，AI 生成可能会丧失长效记忆</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: AI Context Receipt & Assets */}
            <div className="space-y-6">
              {/* AI Context Receipt Panel */}
              <div className="rounded-3xl border border-theme-border bg-theme-sidebar/30 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-theme-border pb-3">
                  <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-600" /> AI 上下文凭证 (Context Receipt)
                  </h3>
                  <span className="text-[9px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">数据已同步</span>
                </div>

                {/* Section 1: Available Assets */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">1. 可用上下文资产 (库缓存)</div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-theme-text">
                    <div className="p-2 rounded-xl bg-paper border border-theme-border/50 flex justify-between">
                      <span className="text-theme-muted">技能卡牌：</span>
                      <span className="font-bold">{mountedSkills.length} 张可用</span>
                    </div>
                    <div className="p-2 rounded-xl bg-paper border border-theme-border/50 flex justify-between">
                      <span className="text-theme-muted">参考前文：</span>
                      <span className="font-bold">{packs.length} 个资料包</span>
                    </div>
                    <div className="p-2 rounded-xl bg-paper border border-theme-border/50 flex justify-between">
                      <span className="text-theme-muted">设定条目：</span>
                      <span className="font-bold">{worldEntitiesCount} 个条目</span>
                    </div>
                    <div className="p-2 rounded-xl bg-paper border border-theme-border/50 flex justify-between">
                      <span className="text-theme-muted">全局主线：</span>
                      <span className={cn("font-bold", novel.globalOutline ? "text-emerald-700" : "text-theme-muted")}>
                        {novel.globalOutline ? "已就绪" : "未录入"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Actually Used */}
                <div className="space-y-2 pt-2 border-t border-theme-border/50">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">2. 本次写作生成实际使用</div>

                  <div className="space-y-2">
                    {/* Continuation Pack injection status */}
                    <div className="p-2.5 rounded-xl bg-paper border border-theme-border/60 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-theme-text font-bold flex items-center gap-1.5">
                          <Database size={12} className="text-theme-muted" /> 参考前文资料
                        </span>
                        <span className={cn("font-bold text-[9px] px-1.5 py-0.5 rounded", packs.length > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                          {packs.length > 0 ? "默认绑定" : "未绑定"}
                        </span>
                      </div>
                      <p className="text-[10px] text-theme-muted leading-relaxed">
                        {packs.length > 0
                          ? `将默认使用最新资料包「${packs[0].title}」内所有导入的前文。`
                          : '资料包可用但未绑定。生成时仅参考编辑器内最近的章节前文。'}
                      </p>
                    </div>

                    {/* Skills injection status */}
                    <div className="p-2.5 rounded-xl bg-paper border border-theme-border/60 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-theme-text font-bold flex items-center gap-1.5">
                          <BrainCircuit size={12} className="text-theme-muted" /> 写作风骨约束
                        </span>
                        <span className={cn("font-bold text-[9px] px-1.5 py-0.5 rounded", mountedSkills.length > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                          {mountedSkills.length > 0 ? "已挂载" : "未挂载"}
                        </span>
                      </div>
                      <p className="text-[10px] text-theme-muted leading-relaxed">
                        {mountedSkills.length > 0
                          ? `已加载 ${mountedSkills.length} 张技能卡规则，AI 将严格遵循对应词风、叙事结构。`
                          : '使用系统通用模型默认语气生成正文。'}
                      </p>
                    </div>

                    {/* World bible matching status */}
                    <div className="p-2.5 rounded-xl bg-paper border border-theme-border/60 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-theme-text font-bold flex items-center gap-1.5">
                          <User size={12} className="text-theme-muted" /> 设定记忆载入
                        </span>
                        <span className="font-bold text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">自动嗅探</span>
                      </div>
                      <p className="text-[10px] text-theme-muted leading-relaxed">
                        写作生成时，AI 将自动嗅探分镜或正文中出现的人物、地点名词，智能唤醒对应设定记忆。
                      </p>
                    </div>

                    {/* Beats injection status */}
                    <div className="p-2.5 rounded-xl bg-paper border border-theme-border/60 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-theme-text font-bold flex items-center gap-1.5">
                          <Layers size={12} className="text-theme-muted" /> 章节分镜规划
                        </span>
                        <span className={cn("font-bold text-[9px] px-1.5 py-0.5 rounded", latestFullChapter?.sceneBeats ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                          {latestFullChapter?.sceneBeats ? "分镜锁定" : "无分镜规划"}
                        </span>
                      </div>
                      <p className="text-[10px] text-theme-muted leading-relaxed">
                        {latestFullChapter?.sceneBeats
                          ? '已锁定本章分镜 Beats 进行定向内容扩写。'
                          : '没有录入本章分镜大纲。大模型生成正文时将进行自由推演。'}
                      </p>
                    </div>

                  </div>
                </div>
              </div>

              {/* Context Assets Panel */}
              <div className="rounded-3xl border border-theme-border bg-theme-sidebar/30 p-5 space-y-4">
                <h3 className="text-sm font-bold text-theme-text">当前项目资产明细</h3>

                <div className="space-y-4">
                  {/* Skill Cards mounted */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">已装配写作卡</div>
                    <div className="flex flex-wrap gap-1.5">
                      {mountedSkills.map(s => (
                        <span
                          key={s.id}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-theme-border bg-paper text-theme-text flex items-center gap-1 shadow-sm"
                        >
                          <BrainCircuit size={10} className="text-theme-accent" />
                          {s.name}
                        </span>
                      ))}
                      {mountedSkills.length === 0 && (
                        <div className="text-xs text-theme-muted py-1">未装配技能卡，可前往技能仓库挑选。</div>
                      )}
                    </div>
                  </div>

                  {/* Memory Files */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">活跃前文资料包</div>
                    <div className="space-y-1.5">
                      {packs.map(p => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-theme-border/50 bg-paper text-xs gap-3 group"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="truncate font-medium text-theme-text">{p.title}</span>
                            <span className="text-[9px] text-theme-muted mt-0.5">{(p.sourceDocuments || []).length} 篇文档</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                            {onEnterStoryboard && (
                              <button
                                onClick={() => onEnterStoryboard(p.id)}
                                className="px-2 py-1 rounded text-[10px] font-bold border border-theme-border bg-theme-sidebar hover:bg-theme-border/40 text-theme-text flex items-center gap-1 cursor-pointer transition-colors"
                                title="用此资料包进行章节分镜大纲规划"
                              >
                                分镜规划
                              </button>
                            )}
                            {onStartContinuationWriting && (
                              <button
                                onClick={() => onStartContinuationWriting(p.id)}
                                className="px-2 py-1 rounded text-[10px] font-bold text-theme-bg bg-theme-text hover:bg-theme-text/90 flex items-center gap-1 cursor-pointer transition-colors"
                                title="用此资料包做前文参考带入正文续写"
                              >
                                带入生产
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {packs.length === 0 && (
                        <div className="text-xs text-theme-muted py-1">无活跃的资料续写参考文件。</div>
                      )}
                    </div>
                  </div>

                  {/* World bible core entities */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">世界设定活跃人物与组织</div>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Characters */}
                      <div className="p-3 rounded-2xl border border-theme-border/50 bg-paper space-y-1">
                        <div className="text-[9px] font-bold text-theme-muted flex items-center gap-1 uppercase tracking-wider">
                          <User size={10} /> 核心人物
                        </div>
                        <div className="text-sm font-serif font-black text-theme-text">{characters.length} <span className="text-[10px] font-normal text-theme-muted">人</span></div>
                      </div>
                      {/* Factions */}
                      <div className="p-3 rounded-2xl border border-theme-border/50 bg-paper space-y-1">
                        <div className="text-[9px] font-bold text-theme-muted flex items-center gap-1 uppercase tracking-wider">
                          <Compass size={10} /> 地理与组织
                        </div>
                        <div className="text-sm font-serif font-black text-theme-text">{locations.length + factions.length} <span className="text-[10px] font-normal text-theme-muted">个</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
