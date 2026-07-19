import React, { useState, useEffect } from 'react';
import {
  BookOpen, Sparkles, BrainCircuit, Plus, ArrowRight,
  User, Compass, FileText,
  AlertCircle, ShieldCheck, Database, Layers, RefreshCw
} from 'lucide-react';
import { Novel, Chapter, ChapterMetadata, Character, Location, Item, Faction, Skill, ContinuationPack } from '../../shared/types';
import { cn } from '../lib/utils';
import { logger } from '../lib/client-logger';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems,
  listFactions, listContinuationPacks, listSkills, getNovel, createChapter
} from '../lib/api';
import { ScrollArea } from './ui/scroll-area';
import { toast } from '../lib/toast';
import { useAppStore } from '../stores/app-store';
import { computeCockpitRecommendations } from '../lib/cockpit-recommendations';
import { downloadDbBackup } from '../lib/download-client';

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
  onNavigate: (view: 'welcome' | 'library' | 'editor' | 'world' | 'skills' | 'factory' | 'continuation-import', initialNovelId?: string) => void;
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
          logger.warn('Failed to lazy load latest chapter full content:', err);
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
          code: "INIT_GENESIS",
          title: "创建作品第一章",
          description: "当前作品还没有任何章节。立即开启创作，AI 智能体将全程协助您构建正文！",
          why: "当前作品尚未创建任何章节，AI 协作无从起笔",
          output: "一键生成首章占位，自动初始化新书规划目录",
          influence: "完成后解锁分镜 Beats 规划、前文导入以及技能卡装配",
          onClick: handleCreateFirstChapter
        };
      case 'add_world_setting':
        return {
          icon: <Compass size={14} />,
          code: "SYNC_WORLD_BIBLE",
          title: "补充世界观设定",
          description: worldEntitiesCount > 0
            ? `当前已沉淀 ${worldEntitiesCount} 个设定条目。继续扩充人物、背景或组织关联，让故事更立体！`
            : "为这本作品添加首批角色、地点或势力设定。AI 写作时能自动检索这些信息，避免设定冲突。",
          why: worldEntitiesCount > 0
            ? "已有部分设定，但还需继续扩充以丰富 AI 协作生成的背景深度"
            : "当前作品设定为空，大模型在生成正文时容易偏离背景或产生幻觉",
          output: "录入或扩充人物人设、地点、门派、法宝、境界等世界观设定",
          influence: "开启 AI 在写作正文时的自动上下文设定匹配，避免逻辑崩坏",
          onClick: () => onNavigate('world')
        };
      case 'import_continuation':
        return {
          icon: <FileText size={14} />,
          code: "MEM_INJECTION",
          title: "导入前文参考资料",
          description: "导入已有作品碎片、大纲或大文本，AI 自动整理提炼成续写包，让创作自带完美长效记忆。",
          why: "缺乏前文记忆参考包，AI 续写的长效检索范围与语境连贯性受限",
          output: "上传或贴入已有的大纲或正文碎片，生成结构化知识索引",
          influence: "赋予 AI 长达数十万字的长效关联记忆，自动保持上下文叙事统一",
          onClick: () => onNavigate('continuation-import', novel.id)
        };
      case 'resume_editor':
        return {
          icon: <BookOpen size={14} />,
          code: "RES_EDITOR",
          title: "继续写作最近章节",
          description: latestChapter
            ? `进入「${latestChapter.title}」编辑器。无论是修补分镜还是直接创作正文，精彩故事从不停歇。`
            : "打开编辑器工作台，随时查看或编辑作品正文内容。",
          why: "有未完成或最近修改的章节，需要继续润色或正文书写",
          output: "直接进入主编辑器工作台，查看或编辑章节正文",
          influence: "进入主创作流，是深度审稿、大纲对齐与一键精修的前置入口",
          onClick: () => {
            if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
              onSelectChapter(latestFullChapter);
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
          code: "LOAD_SKILL_PRESET",
          title: "装配写作能力卡牌",
          description: mountedSkills.length > 0
            ? `当前已启用 ${mountedSkills.length} 张创意滤镜。前往装配库，调整特定的写作词风或大纲规约。`
            : "前往能力商店，为 AI 助手装配文笔风格、安全红线、特定叙事模式等高级写作能力。",
          why: "尚未启用任何写作能力，AI 扩写目前将使用通用默认文风",
          output: "前往能力商店挑选文风卡、爆款逻辑、爽点规约或安全红线",
          influence: "直接注入 AI 提示词底层，让每次生成都带有特定平台的爆款风格",
          onClick: () => onNavigate('skills')
        };
      case 'planning_beats':
        return {
          icon: <Sparkles size={14} />,
          code: "PLAN_BEATS",
          title: "规划本章分镜 / Beats",
          description: "使用 AI 智能规划镜头。将最新一章的情节拆解为镜号、Beats 细纲，写作更胸有成竹。",
          why: "最新一章尚未规划剧情分镜（Beats），直接写正文易偏离节奏",
          output: "AI 辅助将核心情节拆解为精细的分镜大纲与节奏细纲",
          influence: "为接下来的正文智能极速扩写提供坚实且高可控的剧情骨架",
          onClick: () => {
            if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
              onSelectChapter(latestFullChapter);
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
          code: "PROD_CONTENT",
          title: "智能扩写生产正文",
          description: "分镜 Beats 已经骨骼丰满！立即让 AI 写作智能体对各镜头执行高还原度正文极速扩写。",
          why: "当前章节的分镜 Beats 已就绪，适合一键扩充正文",
          output: "AI 智能体基于分镜骨架执行高还原、极速正文段落扩写",
          influence: "快速产出首版初稿，等待下一步的资深审稿人多维一致性审计",
          onClick: () => {
            if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
              onSelectChapter(latestFullChapter);
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
          code: "AUDIT_LINT",
          title: "对本章进行审稿",
          description: "正文已初具雏形。邀请 AI 资深审稿人执行深度审计，找出词风 AI 味、设定硬伤与逻辑死角。",
          why: "正文已初具雏形，需要检测错别字、设定硬伤与 AI 味词汇",
          output: "AI 资深编辑在后台进行错字、常识、文风、设定的一致性审计",
          influence: "生成多维度的审稿批注报告，并解锁接下来的定向润色与精修",
          onClick: () => {
            if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
              onSelectChapter(latestFullChapter);
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
          code: "POLISH_CONTENT",
          title: "一键精修局部润色",
          description: "根据最新审稿意见，针对性地对问题段落执行一键或逐步重构润色，彻底打磨精益求精。",
          why: "审稿已完成，需要针对问题段落或文风AI味进行针对性精修",
          output: "AI 定向润色重写，一键去除机械词汇、修补设定漏洞",
          influence: "打磨产出高品质的完读正文，并可以开始冷备份或发布",
          onClick: () => {
            if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
              onSelectChapter(latestFullChapter);
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
          code: "EXPORT_DB_BACKUP",
          title: "一键离线冷备份",
          description: "写作成果至上！点击极速导出并冷备当前的数据快照备份包，防范任何数据意外损坏丢失。",
          why: "为了防范网络死锁、断电或异常故障导致本地数据损坏",
          output: "基于一致性事务快照技术导出完整的高可用离线备份包",
          influence: "确保全书写作资产 100% 绝对安全，可随时进行恢复或迁移",
          onClick: () => { void downloadDbBackup().catch((err) => toast(`导出备份失败: ${err instanceof Error ? err.message : '未知错误'}`, 'error')); }
        };
      case 'deconstruct_flow_step1':
        return {
          icon: <BrainCircuit size={14} />,
          code: "DECONSTRUCT_STEP1",
          title: "神作高爽节奏拆解",
          description: "激活拆书转化流：检测到您的作品处于高爽小说创作阶段。建议立即导入神作样本文本，由 AI 提炼拆解其标志性的高爽剧情节奏并一键装配为专属能力卡！",
          why: "已激活「拆书转化工作流」，首要任务是拆解并学习爆款神作的节奏结构",
          output: "导入样本文本，提炼出神作高爽剧情节奏与叙事模式",
          influence: "完成后自动将提炼出的卡牌装备到本书，并解锁下一阶段「神作金句修辞润色」",
          onClick: () => {
            useAppStore.getState().setFactoryIntent({ activeSeriesId: 'book-deconstruction-flow', stepId: 'step1' });
            onNavigate('factory');
          }
        };
      case 'deconstruct_flow_step2':
        return {
          icon: <BrainCircuit size={14} />,
          code: "DECONSTRUCT_STEP2",
          title: "神作金句修辞润色",
          description: "拆书转化流第二阶段：已成功装配爽点节奏卡！接下来建议继续通过拆书车间导入神作样本，提炼神作的顶奢修辞、爆款词风与金句技巧，装备为词风滤镜。",
          why: "第一阶段节奏卡已装备，需进一步提炼其标志性修辞与词风以完全融会贯通",
          output: "分析神作样本中的顶奢金句、修辞风格与极简对话技巧",
          influence: "完成后自动装备专属修辞词风滤镜，彻底打通去 AI 味的高级润色模块",
          onClick: () => {
            useAppStore.getState().setFactoryIntent({ activeSeriesId: 'book-deconstruction-flow', stepId: 'step2' });
            onNavigate('factory');
          }
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
              {/* NextActionCard: Adaptive Next Decision Prompt / 创作大脑自适应下一步行动卡 */}
              {chapters.length > 0 && latestChapter && (
                <div className="relative overflow-hidden rounded-xl border border-theme-accent/30 bg-gradient-to-br from-theme-accent/10 via-theme-sidebar/10 to-transparent p-5 space-y-4 shadow-[0_4px_24px_-4px_rgba(var(--color-accent),0.08)] transition-all duration-300 hover:border-theme-accent/50 hover:shadow-[0_4px_28px_-2px_rgba(var(--color-accent),0.12)] group/next-card">
                  {/* Futuristic decorative micro-elements / 未来科技感微型装饰元素 */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-theme-accent/5 rounded-full blur-2xl pointer-events-none transition-transform duration-500 group-hover/next-card:scale-125" />
                  <div className="absolute -left-12 -bottom-12 w-32 h-32 bg-theme-accent/5 rounded-full blur-3xl pointer-events-none" />

                  {/* Subtle technical corner marks / 精致科技感拐角符号 */}
                  <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t border-l border-theme-accent/40 rounded-tl-sm" />
                  <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t border-r border-theme-accent/40 rounded-tr-sm" />
                  <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l border-theme-accent/40 rounded-bl-sm" />
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r border-theme-accent/40 rounded-br-sm" />

                  <div className="flex items-center justify-between border-b border-theme-border/30 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-accent/40 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-theme-accent" />
                      </span>
                      <span className="text-[10px] font-mono font-bold text-theme-accent uppercase tracking-widest">
                        COGNITIVE BRAIN COPILOT / 创作大脑下一步行动决策建议
                      </span>
                    </div>
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold rounded bg-theme-accent/15 text-theme-accent border border-theme-accent/20 uppercase tracking-wider">
                      ADAPTIVE DECISION
                    </span>
                  </div>

                  <div className="space-y-2">
                    {/* Immersive decision title with literary typography / 富有文学韵律的自适应大标题 */}
                    <h3 className="text-sm sm:text-base font-serif font-black text-theme-text leading-relaxed tracking-wide">
                      您的第一章已生成，检测到有 2 个未解悬念，建议立即进行‘去 AI 味’精修或撰写第二章分镜。
                    </h3>
                    <p className="text-[11px] text-theme-muted/90 leading-relaxed max-w-[70ch] font-sans">
                      InkFlow 资深审稿引擎已对最新正文进行深度一致性扫描，检测到词风尚存机械痕迹及可继续深挖的剧情线。建议通过以下通道静默直达编辑器，一键润色。
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1.5">
                    {/* Primary Dark Button: 一键精修润色 */}
                    <button
                      onClick={() => {
                        if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
                          onSelectChapter(latestFullChapter);
                        }
                        if (onStartCockpitAction && latestChapter) {
                          // Launches full custom-polish automated stream / 启动一键去AI味精修流
                          onStartCockpitAction('polish', latestChapter.id);
                        } else {
                          onNavigate('editor');
                        }
                      }}
                      className="px-4 py-2.5 bg-theme-text text-theme-bg hover:bg-theme-text/90 active:scale-[0.98] text-xs font-black rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-md font-sans cursor-pointer tracking-wider"
                    >
                      <Sparkles size={14} className="text-theme-accent animate-pulse" />
                      一键「去AI味」精修润色
                    </button>

                    {/* Secondary Ghost Button: 深度质量审计 */}
                    <button
                      onClick={() => {
                        if (onSelectChapter && latestFullChapter?.id === latestChapter?.id) {
                          onSelectChapter(latestFullChapter);
                        }
                        if (onStartCockpitAction && latestChapter) {
                          // Launches full quality audit stream / 启动后台质量审计流
                          onStartCockpitAction('audit', latestChapter.id);
                        } else {
                          onNavigate('editor');
                        }
                      }}
                      className="px-4 py-2.5 border border-theme-border/80 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 hover:border-theme-accent/30 active:scale-[0.98] text-xs font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer font-sans"
                    >
                      <BrainCircuit size={14} className="text-theme-muted group-hover/next-card:text-theme-accent transition-colors" />
                      深度质量审计
                    </button>
                  </div>
                </div>
              )}

              {/* Next Actions CTA Panel */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-theme-border/40 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
                      当前建议行动序列
                    </h3>
                    <p className="text-[10px] text-theme-muted">自适应 AI 引擎提供的下一步高优先级创作指令</p>
                  </div>
                  <span className="text-[9px] font-mono border border-theme-border/60 bg-theme-sidebar/30 text-theme-muted px-2 py-0.5 rounded uppercase tracking-wide">
                    自适应创作助手建议
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
                      activeSeriesId: novel.projectPreferenceProfile?.activeSeriesId,
                      completedSteps: novel.projectPreferenceProfile?.tags || [],
                    }).slice(0, 3);

                    return recommendations.map((id: string, index: number) => {
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

                            {/* Beautiful Glassmorphism properties grid */}
                            <div className="grid grid-cols-1 gap-2 p-3 my-2 rounded-lg bg-theme-sidebar/15 border border-theme-border/30 text-[11px] leading-relaxed font-sans">
                              <div>
                                <span className="font-bold text-theme-accent">为什么建议：</span>
                                <span className="text-theme-muted">{cardData.why}</span>
                              </div>
                              <div>
                                <span className="font-bold text-theme-accent">点了会产出什么：</span>
                                <span className="text-theme-muted">{cardData.output}</span>
                              </div>
                              <div>
                                <span className="font-bold text-theme-accent">会影响下一步什么：</span>
                                <span className="text-theme-muted">{cardData.influence}</span>
                              </div>
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
                        <div
                          key={id}
                          data-testid={`queued-step-${id}`}
                          onClick={cardData.onClick}
                          className="group/step relative pl-6 space-y-2 cursor-pointer block text-left w-full bg-transparent p-0 focus:outline-none"
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

                          {/* Compact properties for Queued Actions */}
                          <div className="grid grid-cols-1 gap-1 pl-2.5 border-l border-theme-border/30 text-[10px] text-theme-muted/80 group-hover/step:border-theme-accent/30 transition-colors font-sans">
                            <div>
                              <span className="font-semibold text-theme-text/80">建议：</span>
                              <span>{cardData.why}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-theme-text/80">产出：</span>
                              <span>{cardData.output}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-theme-text/80">后续：</span>
                              <span>{cardData.influence}</span>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-theme-border/40 divide-x divide-y sm:divide-y-0 divide-theme-border/40 bg-theme-sidebar/10 rounded-xl overflow-hidden shadow-xs opacity-80 hover:opacity-100 transition-opacity">
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono font-sans font-bold">总字数 / WORDS</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{totalWords.toLocaleString()}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10 border-t border-theme-border/40 sm:border-t-0">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono font-sans font-bold">章节数 / CHAPTERS</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{chapters.length}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono font-sans font-bold">设定条目 / ENTITIES</div>
                  <div className="text-xl font-mono font-bold text-theme-text tabular-nums">{worldEntitiesCount}</div>
                </div>
                <div className="p-4 space-y-1 bg-theme-bg/10">
                  <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider font-mono font-sans font-bold">最近活跃 / ACTIVE</div>
                  <div className="text-[11px] font-mono font-medium text-theme-text truncate leading-relaxed pt-0.5" title={latestChapter ? latestChapter.title : '尚无创作记录'}>
                    {latestChapter ? latestChapter.title : 'N/A'}
                  </div>
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
              {/* 当前上下文收据 (Context Receipt) */}
              <div className="border border-dashed border-theme-border/60 bg-theme-sidebar/5 backdrop-blur-md rounded-xl p-5 font-mono space-y-4 shadow-sm relative overflow-hidden">
                {/* Vintage Top Highlight Edge */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-theme-accent/40 via-theme-accent to-theme-accent/40" />

                <div className="flex items-center justify-between border-b border-dashed border-theme-border/40 pb-2">
                  <span className="text-xs font-bold text-theme-text uppercase tracking-wider">INKFLOW CONTEXT RECEIPT</span>
                  <span className="text-[9px] text-theme-muted">#202607</span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center">
                    <span className="text-theme-muted">章节总数 [Chapters]</span>
                    <span className="text-theme-text font-bold">{chapters.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-theme-muted">设定条目 [World Bible Items]</span>
                    <span className="text-theme-text font-bold">{worldEntitiesCount}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-theme-muted">已挂载技能 [Mounted Skills]</span>
                    <span className="text-theme-text font-bold">{mountedSkills.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-theme-muted">导入资料包 [Continuation Packs]</span>
                    <span className="text-theme-text font-bold">{packs.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-theme-muted">最新审计状态 [Audit Status]</span>
                    <span className={cn("font-bold px-1.5 py-0.5 rounded-sm text-[10px]", latestFullChapter?.critique?.trim() ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
                      {latestFullChapter?.critique?.trim() ? "已审计" : "待审计/未开始"}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-theme-border/40 pt-2 flex flex-col items-center justify-center gap-1">
                  <div className="text-[9px] text-theme-muted/40 font-bold select-none tracking-widest leading-none">
                    |||||| | ||||| | |||| ||| || | |||| ||||
                  </div>
                  <span className="text-[8px] text-theme-muted/50 tracking-wider">INKFLOW CONTEXT ENGINE VER 1.2.0</span>
                </div>
              </div>

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
                    <div className="text-[10px] text-theme-muted/80 italic py-0.5">未装配任何词风卡，可前往能力商店挑选。</div>
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
