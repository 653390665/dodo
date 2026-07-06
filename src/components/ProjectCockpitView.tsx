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

interface ComputeRecommendationsParams {
  chaptersCount: number;
  worldEntitiesCount: number;
  hasBeats: boolean;
  hasContent: boolean;
  hasCritique: boolean;
}

function computeCockpitRecommendations(params: ComputeRecommendationsParams): string[] {
  const { chaptersCount, worldEntitiesCount, hasBeats, hasContent, hasCritique } = params;
  if (chaptersCount === 0) {
    return ['create_first_chapter', 'add_world_setting', 'import_continuation'];
  }
  if (worldEntitiesCount < 2) {
    return ['add_world_setting', 'resume_editor', 'mount_skill'];
  }
  if (!hasBeats) {
    return ['planning_beats', 'add_world_setting', 'mount_skill'];
  }
  if (!hasContent) {
    return ['production_content', 'planning_beats', 'mount_skill'];
  }
  if (!hasCritique) {
    return ['start_audit', 'polish_content', 'resume_editor'];
  }
  return ['polish_content', 'resume_editor', 'export_db_backup'];
}

function createFirstChapterPayload(novelId: string): Chapter {
  const timestamp = Date.now();
  return {
    id: `ch-${timestamp}`,
    novelId,
    title: '第一章',
    volumeName: '正文',
    content: '',
    sceneBeats: '',
    order: 1,
    wordCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

interface ProjectCockpitViewProps {
  novel: Novel;
  onNavigate: (view: 'welcome' | 'library' | 'editor' | 'world' | 'skills' | 'factory' | 'continuation-import') => void;
  onStartCockpitAction?: (action: 'planning' | 'production' | 'resume' | 'audit' | 'polish', targetChapterId?: string) => void;
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

  const getContextSaturation = (): number => {
    let score = 0;
    if (packs.length > 0) score += 25;
    if (mountedSkills.length > 0) score += 25;
    if (worldEntitiesCount > 0) {
      score += worldEntitiesCount >= 5 ? 20 : 10;
    }
    if (latestFullChapter?.sceneBeats?.trim()) score += 20;
    if (novel.globalOutline?.trim()) score += 10;
    return score;
  };
  const saturation = getContextSaturation();

  // Handles Quick Creation of First Chapter
  const handleCreateFirstChapter = async () => {
    try {
      const newCh = createFirstChapterPayload(novel.id);
      await createChapter(newCh);
      if (onSelectChapter) {
        onSelectChapter(newCh);
      }
      onNavigate('editor');
    } catch {
      toast('创建作品第一章失败，请稍后重试', 'error');
    }
  };

  const getRecommendationDetails = (id: string) => {
    switch (id) {
      case 'create_first_chapter':
        return {
          icon: <Plus size={14} />,
          code: "CMD::INIT_GENESIS",
          title: "创建作品第一章",
          description: "当前作品还没有任何章节。立即开启创作，AI 智能体将全程协助您构建正文！",
          onClick: handleCreateFirstChapter
        };
      case 'add_world_setting':
        return {
          icon: <Compass size={14} />,
          code: "CMD::SYNC_WORLD_BIBLE",
          title: "补充世界观设定",
          description: worldEntitiesCount > 0
            ? `当前已沉淀 ${worldEntitiesCount} 个设定条目。继续扩充人物、背景或组织关联，让故事更立体！`
            : "为这本作品添加首批角色、地点或势力设定。AI 写作时能自动检索这些信息，避免设定冲突。",
          onClick: () => onNavigate('world')
        };
      case 'import_continuation':
        return {
          icon: <FileText size={14} />,
          code: "CMD::MEM_INJECTION",
          title: "导入前文参考资料",
          description: "导入已有作品碎片、大纲或大文本，AI 自动整理提炼成续写包，让创作自带完美长效记忆。",
          onClick: () => onNavigate('continuation-import')
        };
      case 'resume_editor':
        return {
          icon: <BookOpen size={14} />,
          code: "CMD::RES_EDITOR",
          title: "继续写作最近章节",
          description: latestChapter
            ? `进入「${latestChapter.title}」编辑器。无论是修补分镜还是直接创作正文，精彩故事从不停歇。`
            : "打开编辑器工作台，随时查看或编辑作品正文内容。",
          onClick: () => {
            if (onSelectChapter && latestChapter) {
              onSelectChapter(latestChapter as unknown as Chapter);
            }
            if (onStartCockpitAction && latestChapter) {
              onStartCockpitAction('resume', latestChapter.id);
            } else {
              onNavigate('editor');
            }
          }
        };
      case 'mount_skill':
        return {
          icon: <BrainCircuit size={14} />,
          code: "CMD::LOAD_SKILL_PRESET",
          title: "装配写作技能滤镜",
          description: mountedSkills.length > 0
            ? `当前已启用 ${mountedSkills.length} 张创意滤镜。前往装配库，调整特定的写作词风或大纲规约。`
            : "前往技能卡仓库，为 AI 助手装配文笔风格、安全红线、特定叙事模式等高级技能滤镜。",
          onClick: () => onNavigate('skills')
        };
      case 'planning_beats':
        return {
          icon: <Sparkles size={14} />,
          code: "CMD::PLAN_BEATS",
          title: "规划本章分镜 / Beats",
          description: "使用 AI 智能规划镜头。将最新一章的情节拆解为镜号、Beats 细纲，写作更胸有成竹。",
          onClick: () => {
            if (onSelectChapter && latestChapter) {
              onSelectChapter(latestChapter as unknown as Chapter);
            }
            if (onStartCockpitAction && latestChapter) {
              onStartCockpitAction('planning', latestChapter.id);
            } else {
              onNavigate('editor');
            }
          }
        };
      case 'production_content':
        return {
          icon: <Sparkles size={14} />,
          code: "CMD::PROD_CONTENT",
          title: "智能扩写生产正文",
          description: "分镜 Beats 已经骨骼丰满！立即让 AI 写作智能体对各镜头执行高还原度正文极速扩写。",
          onClick: () => {
            if (onSelectChapter && latestChapter) {
              onSelectChapter(latestChapter as unknown as Chapter);
            }
            if (onStartCockpitAction && latestChapter) {
              onStartCockpitAction('production', latestChapter.id);
            } else {
              onNavigate('editor');
            }
          }
        };
      case 'start_audit':
        return {
          icon: <ShieldCheck size={14} />,
          code: "CMD::AUDIT_LINT",
          title: "对本章进行审稿",
          description: "正文已初具雏形。邀请 AI 资深审稿人执行深度审计，找出词风 AI 味、设定硬伤与逻辑死角。",
          onClick: () => {
            if (onSelectChapter && latestChapter) {
              onSelectChapter(latestChapter as unknown as Chapter);
            }
            if (onStartCockpitAction && latestChapter) {
              onStartCockpitAction('audit', latestChapter.id);
            } else {
              onNavigate('editor');
            }
          }
        };
      case 'polish_content':
        return {
          icon: <Sparkles size={14} />,
          code: "CMD::POLISH_CONTENT",
          title: "一键精修局部润色",
          description: "根据最新审稿意见，针对性地对问题段落执行一键或逐步重构润色，彻底打磨精益求精。",
          onClick: () => {
            if (onSelectChapter && latestChapter) {
              onSelectChapter(latestChapter as unknown as Chapter);
            }
            if (onStartCockpitAction && latestChapter) {
              onStartCockpitAction('polish', latestChapter.id);
            } else {
              onNavigate('editor');
            }
          }
        };
      case 'export_db_backup':
        return {
          icon: <Database size={14} />,
          code: "CMD::EXPORT_DB_BACKUP",
          title: "一键离线冷备份",
          description: "写作成果至上！点击极速导出并冷备当前的 SQLite 数据库包，防范任何数据意外损坏丢失。",
          onClick: () => window.open('/api/db/export-file', '_blank')
        };
      default:
        return null;
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
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-theme-border/40 divide-x divide-y sm:divide-y-0 divide-theme-border/40 bg-theme-sidebar/10 rounded-xl overflow-hidden shadow-xs">
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">WORDS / 总字数</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{totalWords.toLocaleString()}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10 border-t border-theme-border/40 sm:border-t-0">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">CHAPTERS / 章节数</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{chapters.length}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">ENTITIES / 设定条目</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{worldEntitiesCount}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono">ACTIVE / 最近活跃</div>
                  <div className="text-[11px] font-mono font-medium text-theme-text truncate leading-relaxed pt-0.5" title={latestChapter ? latestChapter.title : '尚无创作记录'}>
                    {latestChapter ? latestChapter.title : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Next Actions CTA Panel */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-theme-border/40 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
                      Operation Guide / 创作执行序列
                    </h3>
                    <p className="text-[10px] text-theme-muted">自适应 AI 引擎提供的下一步高优先级创作指令</p>
                  </div>
                  <span className="text-[9px] font-mono border border-theme-border/60 bg-theme-sidebar/30 text-theme-muted px-2 py-0.5 rounded uppercase tracking-wide">
                    Adaptive Guide
                  </span>
                </div>

                <div className="relative pl-3 space-y-6 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[1px] before:bg-theme-border/30">
                  {(() => {
                    const recommendations = computeCockpitRecommendations({
                      chaptersCount: chapters.length,
                      worldEntitiesCount,
                      hasBeats: !!latestFullChapter?.sceneBeats?.trim(),
                      hasContent: !!latestFullChapter?.content?.trim(),
                      hasCritique: !!latestFullChapter?.critique?.trim(),
                    }).slice(0, 3);

                    return recommendations.map((id, index) => {
                      const isPrimary = index === 0;
                      const cardData = getRecommendationDetails(id);
                      if (!cardData) return null;

                      if (isPrimary) {
                        return (
                          <div key={id} className="relative pl-6 space-y-2">
                            {/* Bullet Dot */}
                            <div className="absolute -left-[12px] top-1.5">
                              <span className="relative flex h-4 w-4 items-center justify-center">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-accent/30 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-theme-accent" />
                              </span>
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-mono font-bold text-theme-accent uppercase tracking-wider">Step 01 / ACTIVE ACTION</span>
                                <h4 className="text-sm font-bold text-theme-text">{cardData.title}</h4>
                              </div>
                              <p className="text-[11px] text-theme-muted leading-relaxed">
                                {cardData.description}
                              </p>
                            </div>

                            {/* Solid high-precision trigger button */}
                            <button
                              onClick={cardData.onClick}
                              className="w-full mt-3 px-4 py-2.5 rounded border border-theme-accent/25 bg-theme-accent text-theme-bg font-mono font-semibold text-xs flex items-center justify-between group cursor-pointer transition-all duration-150 active:opacity-95 shadow-sm tracking-wider"
                            >
                              <div className="flex items-center gap-2">
                                {cardData.icon}
                                <span className="font-sans font-bold">{cardData.title}</span>
                              </div>
                              <div className="flex items-center gap-1.5 opacity-90 text-[10px] uppercase font-bold">
                                <span>{cardData.code}</span>
                                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform duration-150" />
                              </div>
                            </button>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={id}
                          onClick={cardData.onClick}
                          className="group/step relative pl-6 space-y-1.5 cursor-pointer block text-left w-full bg-transparent border-none p-0 focus:outline-none"
                        >
                          {/* Idle Bullet Dot */}
                          <div className="absolute -left-[11px] top-1">
                            <span className="flex size-3.5 items-center justify-center bg-theme-border/20 rounded-full border border-theme-border/40">
                              <span className="size-1 rounded-full bg-theme-muted/50" />
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider">Step 0{index + 1} / QUEUED</span>
                              <h4 className="text-xs font-bold text-theme-text group-hover/step:text-theme-accent transition-colors">{cardData.title}</h4>
                            </div>
                            <span className="text-[9px] font-mono text-theme-muted/80 group-hover/step:text-theme-text transition-colors flex items-center gap-0.5">
                              {cardData.code}
                              <ArrowRight size={10} className="group-hover/step:translate-x-0.5 transition-transform" />
                            </span>
                          </div>
                          <p className="text-[10px] text-theme-muted leading-relaxed pr-2">
                            {cardData.description}
                          </p>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Diagnostic Warning Alerts */}
              {(chapters.length === 0 || mountedSkills.length === 0 || worldEntitiesCount === 0 || packs.length === 0) && (
                <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4 space-y-2">
                  <div className="text-[10px] font-bold text-amber-500 flex items-center gap-1.5 font-mono uppercase tracking-wider">
                    <AlertCircle size={12} /> System Diagnostics / 创作前就绪诊断
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-theme-muted/90">
                    {chapters.length === 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                        <span>首章未创建，AI 写作位置未锁定</span>
                      </div>
                    )}
                    {mountedSkills.length === 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                        <span>无挂载技能，AI 生成将使用通用默认语气</span>
                      </div>
                    )}
                    {worldEntitiesCount === 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                        <span>未录入任何角色设定，大模型无法做背景匹配</span>
                      </div>
                    )}
                    {packs.length === 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                        <span>缺少前文资料包，长效记忆受到限制</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: AI Context Infusion Matrix & Assets */}
            <div className="space-y-6">
              {/* Context Infusion Matrix Table */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-theme-border/40 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <Layers size={14} className="text-theme-accent" />
                      Context Infusion Matrix / 注入矩阵
                    </h3>
                    <p className="text-[10px] text-theme-muted">检测并可视化当前装载进入 AI 的语境与设定数据</p>
                  </div>
                  <span className="text-[9px] font-mono border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-sm uppercase tracking-wider">
                    Live Syncing
                  </span>
                </div>

                {/* Matrix Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-theme-border/20 text-[9px] text-theme-muted uppercase tracking-wider font-mono">
                        <th className="pb-2 font-medium">Injected Asset / 注入资产</th>
                        <th className="pb-2 font-medium text-center w-20">Status</th>
                        <th className="pb-2 font-medium text-right w-24">Influence Weight</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/10 text-[11px]">
                      {/* Characters */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">01.</span>
                          <span>Characters / 角色设定库</span>
                          <span className="text-[9px] font-mono text-theme-muted">({characters.length})</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", characters.length > 0 ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{characters.length > 0 ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {characters.length > 0 ? "MEDIUM" : "NONE"}
                        </td>
                      </tr>
                      {/* Locations & Factions */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">02.</span>
                          <span>Locations & Factions / 场景与组织</span>
                          <span className="text-[9px] font-mono text-theme-muted">({locations.length + factions.length})</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", (locations.length + factions.length) > 0 ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{(locations.length + factions.length) > 0 ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {(locations.length + factions.length) > 0 ? "MEDIUM" : "NONE"}
                        </td>
                      </tr>
                      {/* Mounted Skills */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">03.</span>
                          <span>Mounted Skills / 智能卡挂载</span>
                          <span className="text-[9px] font-mono text-theme-muted">({mountedSkills.length})</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", mountedSkills.length > 0 ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{mountedSkills.length > 0 ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {mountedSkills.length > 0 ? "HIGH" : "NONE"}
                        </td>
                      </tr>
                      {/* Continuation Pack */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">04.</span>
                          <span>Continuation Pack / 资料参考包</span>
                          <span className="text-[9px] font-mono text-theme-muted">({packs.length})</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", packs.length > 0 ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{packs.length > 0 ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {packs.length > 0 ? "HIGH" : "NONE"}
                        </td>
                      </tr>
                      {/* Chapter Beats */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">05.</span>
                          <span>Chapter Beats / 章节分镜规划</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", latestFullChapter?.sceneBeats?.trim() ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{latestFullChapter?.sceneBeats?.trim() ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {latestFullChapter?.sceneBeats?.trim() ? "HIGH" : "NONE"}
                        </td>
                      </tr>
                      {/* Global Outline */}
                      <tr className="group hover:bg-theme-sidebar/5 transition-colors">
                        <td className="py-2.5 font-medium text-theme-text flex items-center gap-1.5">
                          <span className="text-theme-muted/50 font-mono">06.</span>
                          <span>Global Outline / 核心主线大纲</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", novel.globalOutline?.trim() ? "bg-emerald-500" : "bg-theme-muted/40")} />
                            <span className="font-mono text-[9px] uppercase">{novel.globalOutline?.trim() ? "Active" : "Inactive"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[10px] text-theme-muted">
                          {novel.globalOutline?.trim() ? "MEDIUM" : "NONE"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Context Saturation Index Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-theme-border/20 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-theme-muted font-mono font-bold uppercase tracking-wider text-[9px]">Context Saturation Index</span>
                    <span className="text-[10px] text-theme-muted/70">代表当前小说上下文的装配健全度</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <div className="w-24 h-1.5 rounded-sm bg-theme-border/20 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-sm transition-all duration-500",
                          saturation >= 70 ? "bg-emerald-500" : saturation >= 40 ? "bg-amber-500" : "bg-red-500"
                        )}
                        style={{ width: `${saturation}%` }}
                      />
                    </div>
                    <span className="font-bold text-theme-text whitespace-nowrap">{saturation}% Healthy</span>
                  </div>
                </div>
              </div>

              {/* Mounted Skills Detail */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                    <BrainCircuit size={12} className="text-theme-accent" />
                    Mounted Skills / 已装配写作卡
                  </span>
                  <span className="text-[10px] font-mono text-theme-muted">{mountedSkills.length} Card(s)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {mountedSkills.map(s => (
                    <span
                      key={s.id}
                      className="px-2 py-0.5 text-[10px] font-mono font-medium rounded border border-theme-border/40 bg-theme-bg/40 text-theme-text flex items-center gap-1 shadow-xs"
                    >
                      <span className="size-1 rounded-full bg-theme-accent" />
                      {s.name}
                    </span>
                  ))}
                  {mountedSkills.length === 0 && (
                    <div className="text-[10px] text-theme-muted/80 italic py-0.5">未装配任何词风卡，可前往技能仓库挑选。</div>
                  )}
                </div>
              </div>

              {/* Continuation Packs Detail */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                    <Database size={12} className="text-theme-accent" />
                    Continuation Packs / 活跃资料包
                  </span>
                  <span className="text-[10px] font-mono text-theme-muted">{packs.length} Active</span>
                </div>
                <div className="space-y-1.5">
                  {packs.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2 rounded border border-theme-border/40 bg-theme-bg/20 text-xs gap-3 group"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-medium text-theme-text text-[11px]">{p.title}</span>
                        <span className="text-[9px] font-mono text-theme-muted mt-0.5">{(p.sourceDocuments || []).length} DOCS</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                        {onEnterStoryboard && (
                          <button
                            onClick={() => onEnterStoryboard(p.id)}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-theme-border bg-theme-sidebar hover:bg-theme-border/40 text-theme-text transition-colors cursor-pointer"
                            title="用此资料包进行章节分镜大纲规划"
                          >
                            分镜
                          </button>
                        )}
                        {onStartContinuationWriting && (
                          <button
                            onClick={() => onStartContinuationWriting(p.id)}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold text-theme-bg bg-theme-text hover:opacity-90 transition-colors cursor-pointer"
                            title="用此资料包做前文参考带入正文续写"
                          >
                            带入
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {packs.length === 0 && (
                    <div className="text-[10px] text-theme-muted/80 italic py-0.5">无活跃的资料续写参考包。</div>
                  )}
                </div>
              </div>

              {/* World Bible Entities Summary */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-3">
                <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                  <User size={12} className="text-theme-accent" />
                  World Bible / 设定集总览
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded border border-theme-border/30 bg-theme-bg/20 space-y-0.5">
                    <div className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider">Characters / 核心人物</div>
                    <div className="text-sm font-mono font-bold text-theme-text">{characters.length} <span className="text-[9px] font-sans font-normal text-theme-muted">人</span></div>
                  </div>
                  <div className="p-2.5 rounded border border-theme-border/30 bg-theme-bg/20 space-y-0.5">
                    <div className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider">Locations / 场景与组织</div>
                    <div className="text-sm font-mono font-bold text-theme-text">{locations.length + factions.length} <span className="text-[9px] font-sans font-normal text-theme-muted">个</span></div>
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
