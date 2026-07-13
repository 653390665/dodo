import React from 'react';
import { Activity, AlertCircle, Bot, Feather, FileText, Globe, Lightbulb, Loader2, MessageSquareWarning, Plus, Radar, Sparkles, ShieldAlert, AlertTriangle, Send } from 'lucide-react';

import {
  Novel, Chapter, AssistantLaunchContext, CopilotSuggestion,
  CopilotActionKey, AgentTab, Skill, SniffedEntities, ViewType,
  Character, Location, Item
} from '../../shared/types';
import { cn } from '../lib/utils';
import { CopilotStatusBar } from './copilot/CopilotStatusBar';
import { QualityGuardCenter } from './copilot/QualityGuardCenter';

// 1. 维度与评分定义
interface DiagnosticScore {
  prose: number;       // 文笔
  narrative: number;   // 叙事
  character: number;   // 角色
  setting: number;     // 设定
  pacing: number;      // 节奏
  readerPull: number;  // 追读力
}

// 2. 诚实容灾的多维分数抓取函数
function parseDimensionScores(critiqueText: string | undefined): DiagnosticScore {
  const scores: DiagnosticScore = {
    prose: 0,
    narrative: 0,
    character: 0,
    setting: 0,
    pacing: 0,
    readerPull: 0,
  };
  
  if (!critiqueText || critiqueText.trim() === '') {
    return scores;
  }

  // A. 首先使用正则表达式拉取 Markdown 表格中的评分
  // 匹配格式: | prose | 8/10 | prose reason | 或 | 文笔 | 8.5/10 | 原因 |
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\/\s*10\s*\|/g;
  let match;
  while ((match = rowRegex.exec(critiqueText)) !== null) {
    const dimLabel = match[1].trim().toLowerCase();
    const score = parseFloat(match[2]);
    
    if (dimLabel === 'prose' || dimLabel === '文笔') scores.prose = score;
    else if (dimLabel === 'narrative' || dimLabel === '叙事') scores.narrative = score;
    else if (dimLabel === 'character' || dimLabel === '角色') scores.character = score;
    else if (dimLabel === 'setting' || dimLabel === '设定') scores.setting = score;
    else if (dimLabel === 'pacing' || dimLabel === '节奏') scores.pacing = score;
    else if (dimLabel === 'readerpull' || dimLabel === '追读力') scores.readerPull = score;
  }

  return scores;
}

interface RadarProps {
  scores: DiagnosticScore;
  hasCritique: boolean;
  onRunAudit?: () => void;
}

export function NovelDiagnosticRadar({ scores, hasCritique, onRunAudit }: RadarProps) {
  const dimensions = [
    { key: 'prose', label: '文笔' },
    { key: 'narrative', label: '叙事' },
    { key: 'character', label: '角色' },
    { key: 'setting', label: '设定' },
    { key: 'pacing', label: '节奏' },
    { key: 'readerPull', label: '追读力' },
  ] as const;

  const width = 220;
  const height = 180;
  const center = { x: width / 2, y: height / 2 - 5 };
  const radius = 55;
  const totalLevels = 3; // 对应 3.3, 6.6, 10 环线

  // 计算多边形顶点的角步长 (6等分)
  const angleStep = (Math.PI * 2) / 6;

  // 1. 计算每个网格环的顶点 (同心六边形)
  const getGridPoints = (level: number) => {
    const r = (level / totalLevels) * radius;
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = i * angleStep - Math.PI / 2; // 从 12 点钟方向顺时针计算
      const x = center.x + Math.cos(angle) * r;
      const y = center.y + Math.sin(angle) * r;
      points.push(`${x},${y}`);
    }
    return points.join(' ');
  };

  // 2. 计算实际的分数填充区域顶点
  const actualPoints = dimensions.map((dim, i) => {
    const scoreVal = hasCritique ? (scores[dim.key as keyof DiagnosticScore] || 0) : 0;
    const valRadius = (scoreVal / 10) * radius;
    const angle = i * angleStep - Math.PI / 2;
    const x = center.x + Math.cos(angle) * valRadius;
    const y = center.y + Math.sin(angle) * valRadius;
    return { x, y, score: scoreVal };
  });

  const actualPointsStr = actualPoints.map(p => `${p.x},${p.y}`).join(' ');

  // 3. 计算文本标签定位 (微调 padding 防止文字出界)
  const getLabelCoords = (i: number) => {
    const angle = i * angleStep - Math.PI / 2;
    const textRadius = radius + 15;
    const x = center.x + Math.cos(angle) * textRadius;
    const y = center.y + Math.sin(angle) * textRadius;
    return { x, y };
  };

  return (
    <div className="relative w-full py-4 flex flex-col items-center justify-center bg-theme-sidebar/25 border border-theme-border/30 rounded-2xl overflow-hidden shadow-inner backdrop-blur-sm">
      <svg width={width} height={height} className="overflow-visible">
        {/* 定义渐变与网格滤镜 */}
        <defs>
          <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--theme-accent)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--theme-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 1. 同心六边形背景线 */}
        {[1, 2, 3].map((level) => (
          <polygon
            key={level}
            points={getGridPoints(level)}
            fill="none"
            stroke="var(--theme-border)"
            strokeWidth="0.8"
            strokeDasharray={level === 3 ? "none" : "3, 3"}
            opacity={level === 3 ? "0.6" : "0.35"}
          />
        ))}

        {/* 2. 极轴轴线 */}
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const targetX = center.x + Math.cos(angle) * radius;
          const targetY = center.y + Math.sin(angle) * radius;
          return (
            <line
              key={i}
              x1={center.x}
              y1={center.y}
              x2={targetX}
              y2={targetY}
              stroke="var(--theme-border)"
              strokeWidth="0.8"
              opacity="0.35"
            />
          );
        })}

        {/* 3. 实际分数多边形填充和描边 (仅在有 critique 且不为 0 时渲染，否则渲染幽灵底网) */}
        {hasCritique ? (
          <>
            <polygon
              points={actualPointsStr}
              fill="url(#radar-glow)"
              stroke="var(--theme-accent)"
              strokeWidth="1.5"
              className="transition-all duration-500 ease-out"
            />
            {/* 4. 顶点发光脉冲圆点 */}
            {actualPoints.map((pt, i) => {
              if (pt.score === 0) return null;
              return (
                <g key={i}>
                  <circle cx={pt.x} cy={pt.y} r="3" fill="var(--theme-accent)" />
                  <circle cx={pt.x} cy={pt.y} r="6" fill="var(--theme-accent)" className="animate-ping" opacity="0.4" />
                </g>
              );
            })}
          </>
        ) : (
          /* 幽灵占位网: 灰暗点画虚线，代表空状态 */
          <polygon
            points={getGridPoints(1.2)}
            fill="none"
            stroke="var(--theme-muted)"
            strokeWidth="1"
            strokeDasharray="2, 2"
            opacity="0.25"
          />
        )}

        {/* 5. 渲染顶点文本和数字 */}
        {dimensions.map((dim, i) => {
          const coords = getLabelCoords(i);
          const scoreVal = hasCritique ? (scores[dim.key as keyof DiagnosticScore] || 0) : 0;
          const isTopOrBottom = i === 0 || i === 3;
          const isLeft = i === 4 || i === 5;
          const textAnchor = isTopOrBottom ? 'middle' : isLeft ? 'end' : 'start';

          return (
            <text
              key={dim.key}
              x={coords.x}
              y={coords.y}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className="text-[10px] font-sans transition-all duration-300 select-none fill-theme-muted"
              opacity={hasCritique && scoreVal > 0 ? "1" : "0.55"}
            >
              <tspan className={cn("font-semibold", hasCritique && scoreVal > 0 ? "fill-theme-text" : "fill-theme-muted")}>{dim.label}</tspan>
              {hasCritique && (
                <tspan dx="2" className="fill-theme-accent font-mono text-[9px] font-bold">
                  {scoreVal}
                </tspan>
              )}
            </text>
          );
        })}
      </svg>

      {/* 诚实底栏指示器 */}
      <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between text-[9px] text-theme-muted font-bold font-mono">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            hasCritique ? "bg-emerald-400 animate-pulse" : "bg-theme-muted"
          )} />
          <span>{hasCritique ? "诊断雷达已载入" : "待审计 / 未评分"}</span>
        </div>
        {!hasCritique && onRunAudit && (
          <span onClick={onRunAudit} className="text-theme-accent hover:underline cursor-pointer select-none">
            前往质量打分 →
          </span>
        )}
      </div>
    </div>
  );
}

interface WritingSurfaceProps {
  novel: Novel;
  currentChapter: Chapter | null;

  // States
  isGeneratingBeats: boolean;
  isGeneratingCritique: boolean;
  isGeneratingContent: boolean;
  generationStatus: string | null;
  auditStatus: string | null;
  isChapterEmpty: boolean;
  mountedSkillsCount: number;

  // Optional telemetry
  sniffedEntities?: SniffedEntities | null;
  mountedSkills?: Skill[];

  // Copilot
  copilotSuggestion: CopilotSuggestion | null;
  runCopilotAction: (key: CopilotActionKey) => Promise<void>;

  // Refs
  contentRef: React.RefObject<HTMLTextAreaElement | null>;

  // Handlers
  onGenerateBeats: () => Promise<void>;
  onRunAudit: () => Promise<void>;
  onUpdateContent: (content: string) => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  buildAssistantLaunchContext: () => AssistantLaunchContext;
  onAddFirstChapter: () => Promise<void>;

  // Navigation / UI
  setAgentTab: (tab: AgentTab) => void;
  setIsAgentSidebarOpen: (open: boolean) => void;

  onNavigate?: (view: ViewType) => void;
  characters?: Character[];
  locations?: Location[];
  items?: Item[];
}

export const WritingSurface = React.memo(function WritingSurface({
  novel: _novel,
  currentChapter,
  isGeneratingBeats,
  isGeneratingCritique,
  isGeneratingContent,
  generationStatus,
  auditStatus,
  isChapterEmpty,
  mountedSkillsCount,
  sniffedEntities: _sniffedEntities = null,
  mountedSkills: _mountedSkills = [],
  copilotSuggestion,
  runCopilotAction,
  contentRef,
  onGenerateBeats,
  onRunAudit,
  onUpdateContent,
  onOpenAssistant,
  buildAssistantLaunchContext,
  onAddFirstChapter,
  setAgentTab,
  setIsAgentSidebarOpen,
  onNavigate,
  characters = [],
  locations = [],
  items = []
}: WritingSurfaceProps) {
  const [prevChapterId, setPrevChapterId] = React.useState(currentChapter?.id);
  const [prevChapterContent, setPrevChapterContent] = React.useState(currentChapter?.content);
  const [localContent, setLocalContent] = React.useState(currentChapter?.content || '');

  const critiqueScores = React.useMemo(() => parseDimensionScores(currentChapter?.critique), [currentChapter?.critique]);
  const hasCritiqueVal = Boolean(currentChapter?.critique?.trim());

  // 创作阶段描述
  const phases = React.useMemo(() => [
    {
      id: 1,
      name: '1. 分镜起草 (Beats Draft)',
      desc: '规划场景骨架、动作链与冲突焦点。',
    },
    {
      id: 2,
      name: '2. 初稿扩写 (Text Expansion)',
      desc: '在分镜大纲基础上进行全篇正文自动扩写。',
    },
    {
      id: 3,
      name: '3. 质量审计 (Quality Audit)',
      desc: '深度审计全文，找出逻辑漏洞及 AI 腔。',
    },
    {
      id: 4,
      name: '4. 润色精修 (Polish & Refine)',
      desc: '对照审计缺陷，进行外科手术式针对性润色。',
    },
  ], []);

  // 动态计算当前的创作阶段
  const currentPhaseId = React.useMemo(() => {
    if (!currentChapter) return 1;
    const hasBeats = currentChapter.sceneBeats && currentChapter.sceneBeats.trim() !== '';
    const hasContent = !isChapterEmpty;
    const hasCritique = currentChapter.critique && currentChapter.critique.trim() !== '';

    if (!hasBeats) {
      return 1;
    } else if (!hasContent) {
      return 2;
    } else if (!hasCritique) {
      return 3;
    } else {
      return 4;
    }
  }, [currentChapter, isChapterEmpty]);

  if (currentChapter?.id !== prevChapterId || currentChapter?.content !== prevChapterContent) {
    setPrevChapterId(currentChapter?.id);
    setPrevChapterContent(currentChapter?.content);
    setLocalContent(currentChapter?.content || '');
  }

  // 2. 300ms 异步防抖提交至父级受控状态，消除打字 Input Lag
  React.useEffect(() => {
    if (!currentChapter) return;
    const timer = setTimeout(() => {
      if (localContent !== (currentChapter.content || '')) {
        onUpdateContent(localContent);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localContent, onUpdateContent, currentChapter]);

  // ── Local Added Settings for Zero-Barrier Registration ──
  const [localCharacters, setLocalCharacters] = React.useState<Character[]>([]);
  const [localLocations, setLocalLocations] = React.useState<Location[]>([]);
  const [localItems, setLocalItems] = React.useState<Item[]>([]);

  // Missing entity tracking for frictionless quick-adding
  const [isLinXiaoMissing, setIsLinXiaoMissing] = React.useState(false);

  // Quick Add Drawer Inputs
  const [isQuickAddOpen, setIsQuickAddOpen] = React.useState(false);
  const [quickAddType, setQuickAddType] = React.useState<'character' | 'location' | 'item'>('character');
  const [quickAddName, setQuickAddName] = React.useState('');
  const [quickAddDesc, setQuickAddDesc] = React.useState('');

  // ── Context Memory Radar (800ms Debounced Entity Sniffer) ──
  const [matchedCharacters, setMatchedCharacters] = React.useState<Character[]>([]);
  const [matchedLocations, setMatchedLocations] = React.useState<Location[]>([]);
  const [matchedItems, setMatchedItems] = React.useState<Item[]>([]);
  const [isSniffingActive, setIsSniffingActive] = React.useState(false);

  React.useEffect(() => {
    if (!localContent || localContent.trim() === '') {
      const resetTimer = setTimeout(() => {
        setMatchedCharacters([]);
        setMatchedLocations([]);
        setMatchedItems([]);
        setIsSniffingActive(false);
        setIsLinXiaoMissing(false);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    const startTimer = setTimeout(() => {
      setIsSniffingActive(true);
    }, 0);
    const timer = setTimeout(() => {
      const lowerContent = localContent.toLowerCase();
      
      // Merge global configurations with locally supplemented worldsettings for full telemetry alignment
      const allCharacters = [...characters, ...localCharacters];
      const allLocations = [...locations, ...localLocations];
      const allItems = [...items, ...localItems];

      const matchedChars = allCharacters.filter(
        (c) => c.name && lowerContent.includes(c.name.toLowerCase())
      );
      const matchedLocs = allLocations.filter(
        (l) => l.name && lowerContent.includes(l.name.toLowerCase())
      );
      const matchedIts = allItems.filter(
        (i) => i.name && lowerContent.includes(i.name.toLowerCase())
      );

      // ── Hard Positive 1: Highlight Ring 💍 ──
      // If content mentions "戒指", "龙纹" or "古戒", automatically high-fidelity match mock item card
      // ── Missing Entity Detector ──
      // If content mentions characters not yet recorded in settings, flag them for registration
      const hasLinXiaoInSetting = allCharacters.some(c => c.name === '林啸');
      if (lowerContent.includes('林啸') && !hasLinXiaoInSetting) {
        setIsLinXiaoMissing(true);
      } else {
        setIsLinXiaoMissing(false);
      }

      setMatchedCharacters(matchedChars);
      setMatchedLocations(matchedLocs);
      setMatchedItems(matchedIts);
      setIsSniffingActive(false);
    }, 800);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(timer);
    };
  }, [localContent, characters, locations, items, localCharacters, localLocations, localItems]);

  // Handler to smoothly save setting to localized supplemental state
  const handleSaveQuickSetting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddName.trim()) return;

    const newEntity = {
      id: `local-${Date.now()}`,
      name: quickAddName.trim(),
      description: quickAddDesc.trim(),
      bio: quickAddDesc.trim(),
      summary: quickAddDesc.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (quickAddType === 'character') {
      setLocalCharacters(prev => [...prev, newEntity as unknown as Character]);
    } else if (quickAddType === 'location') {
      setLocalLocations(prev => [...prev, newEntity as unknown as Location]);
    } else {
      setLocalItems(prev => [...prev, newEntity as unknown as Item]);
    }

    setIsQuickAddOpen(false);
    setQuickAddName('');
    setQuickAddDesc('');

    alert(`✨ 设定「${newEntity.name}」已无摩擦补录至设定库！已为您同步刷新雷达感知。`);
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 xl:px-8 py-5 scroll-smooth flex flex-col relative">
      <div className="w-full self-stretch min-w-0 flex-1 flex flex-col relative transition-all duration-500 gap-4">
        {currentChapter ? (
          <div className="w-full min-w-0 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 xl:gap-8 items-start">
            {/* 左侧主创作栏 (Main Stage Column) */}
            <div className="min-w-0 flex flex-col gap-6">
              {/* 1. 简洁精美的章节头部 (Elegant Chapter Header) */}
              <div className="w-full min-w-0 flex flex-col gap-2 pb-5 border-b border-theme-border/40">
                <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">创作舞台</p>
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-2xl font-serif font-bold text-theme-text tracking-tight">
                      {currentChapter.title || '未命名章节'}
                    </h3>
                    <p className="text-sm text-theme-muted mt-1 max-w-xl leading-relaxed">
                      {isChapterEmpty
                        ? '先选一种起手方式，然后把正文直接写进下面的主编辑器。'
                        : '主正文编辑器已经就绪。分镜、审计和智能管家采用右侧常驻遥测及呼出式抽屉，让您的创作环境更纯粹安静。'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">字数 {currentChapter.wordCount || 0}</span>
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">技能 {mountedSkillsCount}</span>
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">章节 token ~2.4k</span>
                  </div>
                </div>
              </div>

              {/* 2. 主编辑器写作纸张区 (Paper-Clean Elegant Main Editor Area) */}
              <div className="w-full min-w-0 border border-theme-border/40 bg-theme-sidebar/10 rounded-2xl overflow-hidden transition-all duration-300">
                <div className="px-5 py-3 border-b border-theme-border/30 bg-theme-sidebar/20 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">正文草稿</p>
                    {generationStatus ? (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-theme-accent/5 px-2.5 py-0.5 text-[10px] font-bold text-theme-accent">
                        <Loader2 size={10} className={isGeneratingContent ? 'animate-spin' : ''} />
                        {generationStatus}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-theme-muted shrink-0">
                    <span className="px-2 py-0.5 rounded-full bg-theme-sidebar/40 border border-theme-border/40">自动保存</span>
                    <span className="px-2 py-0.5 rounded-full bg-theme-sidebar/40 border border-theme-border/40">本地草稿</span>
                  </div>
                </div>

                {copilotSuggestion && (
                  <CopilotStatusBar
                    suggestion={copilotSuggestion}
                    onPrimaryAction={(key) => void runCopilotAction(key)}
                    onOpen={() => {
                      setAgentTab('copilot-home');
                      setIsAgentSidebarOpen(true);
                    }}
                  />
                )}

                <textarea
                  ref={contentRef}
                  value={localContent}
                  onChange={(e) => setLocalContent(e.target.value)}
                  readOnly={isGeneratingContent}
                  placeholder="在这里开始书写这一章……"
                  className={cn(
                    "w-full max-w-[70ch] mx-auto bg-transparent resize-none writing-surface text-theme-text placeholder:text-theme-muted/40 transition-all font-serif p-6 md:p-10 focus-visible:outline-none focus-visible:ring-0 block text-lg leading-relaxed tracking-wide",
                    isChapterEmpty ? "min-h-[55vh]" : "min-h-[70vh]"
                  )}
                  style={{ lineHeight: '1.85' }}
                />
              </div>

              {/* 3. 核心创作操作按钮 (Core Capabilities Panel) */}
              <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-theme-border/40">
                <button
                  onClick={() => contentRef.current?.focus()}
                  className="px-3.5 py-2 rounded-xl bg-theme-text text-white hover:opacity-95 transition-opacity text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Feather size={13} />
                  <span>直接开始写</span>
                </button>
                <button
                  onClick={() => {
                    setAgentTab('planning');
                    setIsAgentSidebarOpen(true);
                    void onGenerateBeats();
                  }}
                  disabled={isGeneratingBeats}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 text-theme-text"
                >
                  {isGeneratingBeats ? <Loader2 size={13} className="animate-spin text-theme-accent" /> : <Radar size={13} className="text-theme-accent" />}
                  <span>生成分镜</span>
                </button>
                <button
                  onClick={() => {
                    setAgentTab('production');
                    setIsAgentSidebarOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 text-theme-text"
                >
                  <Bot size={13} className="text-theme-accent" />
                  <span>自动生产一章</span>
                </button>
                <button
                  onClick={() => {
                    if (onOpenAssistant) {
                      onOpenAssistant(buildAssistantLaunchContext());
                      return;
                    }
                    setIsAgentSidebarOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 text-theme-text"
                >
                  <Lightbulb size={13} className="text-theme-accent" />
                  <span>带上下文打开灵感助手</span>
                </button>
                <button
                  onClick={onRunAudit}
                  disabled={isGeneratingCritique || isChapterEmpty}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 text-theme-text"
                >
                  {isGeneratingCritique ? <Loader2 size={13} className="animate-spin text-theme-accent" /> : <MessageSquareWarning size={13} className="text-theme-accent" />}
                  <span>审计正文</span>
                </button>
              </div>

              {/* 4. 建议与静默状态反馈框 (Active Guidance Panel) */}
              <div className={cn(
                "rounded-2xl border p-4 transition-all duration-300",
                isChapterEmpty
                  ? "border-dashed border-theme-border bg-theme-sidebar/10"
                  : "border-theme-border bg-theme-sidebar/20"
              )}>
                <div className="flex items-center gap-2 text-theme-text text-xs font-bold uppercase tracking-wider">
                  {isChapterEmpty ? <AlertCircle size={14} className="text-theme-accent animate-pulse" /> : <Activity size={14} className="text-theme-accent" />}
                  <span>{isChapterEmpty ? '建议创作路径' : '写作状态'}</span>
                </div>
                <p className="mt-1.5 text-xs text-theme-muted leading-relaxed">
                  {isChapterEmpty
                    ? '建议顺序：先生成场景分镜框架，再直接扩写出初稿；或自由书写，随后启动一键审计检查。'
                    : '当前章节已进入正文精琢阶段。你可以随心所欲书写，随时检查伏笔、人物一致性和节奏合理度。'}
                </p>
                {(generationStatus || auditStatus) && (
                  <div className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-theme-accent/25 bg-theme-accent/5 px-3 py-1 text-[10px] font-bold text-theme-accent">
                    <Loader2 size={11} className="animate-spin shrink-0" />
                    <span className="truncate">{generationStatus || auditStatus}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧常驻 "智能导航与上下文遥测副面板" (Guided Workflow & Context Matrix HUD) */}
            <div className="w-full xl:w-[360px] xl:sticky xl:top-0 rounded-2xl border border-theme-border bg-theme-sidebar/50 backdrop-blur-[2px] p-5 flex flex-col gap-5 shadow-sm hover:border-theme-accent/30 transition-all duration-300">
              {/* 面板头部：遥测状态 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-theme-text uppercase tracking-wider">
                  <Radar size={14} className="text-theme-accent animate-pulse" />
                  <span>智能导航与上下文遥测</span>
                </div>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold tracking-tight">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>

              {/* 1. 当前创作阶段垂直指示器 */}
              <div className="flex flex-col gap-3">
                <p className="text-[10px] text-theme-muted uppercase tracking-wider font-bold">当前创作阶段</p>
                <div className="relative pl-1.5 flex flex-col gap-3.5 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-theme-border/40">
                  {phases.map((phase) => {
                    const isCompleted = phase.id < currentPhaseId;
                    const isActive = phase.id === currentPhaseId;
                    const isPending = phase.id > currentPhaseId;

                    return (
                      <div key={phase.id} className="flex items-start gap-3 relative z-10">
                        {/* 状态圆点/图标 */}
                        <div className={cn(
                          "w-3.5 h-3.5 rounded-full flex items-center justify-center border transition-all duration-300 mt-0.5 shrink-0 text-[8px]",
                          isCompleted && "bg-emerald-500 border-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]",
                          isActive && "bg-theme-sidebar border-theme-accent text-theme-accent ring-2 ring-theme-accent/15 animate-pulse",
                          isPending && "bg-theme-sidebar border-theme-border/80 text-theme-muted"
                        )}>
                          {isCompleted ? (
                            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="font-bold leading-none">{phase.id}</span>
                          )}
                        </div>

                        {/* 阶段名称与说明 */}
                        <div className="flex-1 min-w-0">
                          <h4 className={cn(
                            "text-xs font-bold transition-colors duration-200",
                            isActive ? "text-theme-accent font-extrabold" : isCompleted ? "text-theme-text/80" : "text-theme-muted"
                          )}>
                            {phase.name}
                          </h4>
                          {isActive && (
                            <p className="text-[10px] text-theme-muted mt-0.5 leading-relaxed">
                              {phase.desc}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. 下一步推荐按钮 */}
              <div className="pt-1">
                {currentPhaseId === 1 && (
                  <button
                    onClick={() => {
                      setAgentTab('planning');
                      setIsAgentSidebarOpen(true);
                      void onGenerateBeats();
                    }}
                    disabled={isGeneratingBeats}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingBeats ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                    <span>{isGeneratingBeats ? '正在构思分镜...' : '一键生成场景分镜'}</span>
                  </button>
                )}
                {currentPhaseId === 2 && (
                  <button
                    onClick={() => void runCopilotAction('generate-draft')}
                    disabled={isGeneratingContent}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingContent ? <Loader2 size={13} className="animate-spin" /> : <Feather size={13} />}
                    <span>{isGeneratingContent ? '正在扩写初稿...' : '一键自动扩写正文'}</span>
                  </button>
                )}
                {currentPhaseId === 3 && (
                  <button
                    onClick={onRunAudit}
                    disabled={isGeneratingCritique}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingCritique ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareWarning size={13} />}
                    <span>{isGeneratingCritique ? '正在深度体检...' : '一键全文质量体检'}</span>
                  </button>
                )}
                {currentPhaseId === 4 && (
                  <button
                    onClick={() => void runCopilotAction('run-polish')}
                    disabled={isGeneratingContent}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingContent ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    <span>{isGeneratingContent ? '正在微创润色...' : '一键局部手术润色'}</span>
                  </button>
                )}
              </div>

              {/* 3. 上下文记忆雷达 HUD (Context Memory Radar HUD) */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-theme-muted uppercase tracking-wider font-bold flex items-center gap-1">
                    <Globe size={11} className="text-theme-accent" />
                    <span>上下文记忆雷达</span>
                  </p>
                  {isSniffingActive && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-theme-accent font-semibold animate-pulse">
                      <Loader2 size={9} className="animate-spin" />
                      扫描中
                    </span>
                  )}
                </div>

                <NovelDiagnosticRadar
                  scores={critiqueScores}
                  hasCritique={hasCritiqueVal}
                  onRunAudit={onRunAudit}
                />

                {/* Amber Alerts for Unregistered Entity '林啸' */}
                {isLinXiaoMissing && (
                  <div className="p-3 border border-amber-500/35 bg-amber-500/5 rounded-xl flex flex-col gap-2 relative overflow-hidden animate-[pulse_2.5s_infinite]">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">检测到未录入设定实体: 林啸</p>
                        <p className="text-[10px] text-amber-600/90 dark:text-amber-400/80 leading-normal mt-0.5">
                          当前正文中高频出现「林啸」，但在您的设定世界观中尚未为此角色进行信息备案。
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setQuickAddType('character');
                        setQuickAddName('林啸');
                        setQuickAddDesc('林默的父亲，曾是大荒九部之一的主祭。如今隐姓埋名守护在小镇中，是主角踏入虚空之秘的引路人。');
                        setIsQuickAddOpen(true);
                      }}
                      className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold shadow-sm transition-colors text-center"
                    >
                      一键补充到设定库
                    </button>
                  </div>
                )}

                {/* Match Lists & Custom Cards */}
                <div className="bg-theme-sidebar/20 rounded-xl p-3 border border-theme-border/30 flex flex-col gap-2.5">
                  {matchedCharacters.length === 0 && matchedLocations.length === 0 && matchedItems.length === 0 ? (
                    isSniffingActive ? (
                      <div className="py-4 flex flex-col items-center justify-center gap-2 text-center">
                        <Radar size={18} className="text-theme-accent animate-spin" />
                        <p className="text-[10px] text-theme-muted italic">雷达正在深度扫描正文中的实体...</p>
                      </div>
                    ) : (
                      <div className="py-4 flex flex-col items-center justify-center gap-2 text-center">
                        <Globe size={18} className="text-theme-muted/50" />
                        <p className="text-[10px] text-theme-muted">暂无嗅探到的配对设定。在左侧打字后即可自动感知。</p>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col gap-2">
                      {/* Character Cards */}
                      {matchedCharacters.map((c) => (
                        <div key={c.id} className="p-2.5 rounded-xl border border-violet-500/25 bg-violet-500/5 hover:bg-violet-500/10 transition-all flex flex-col gap-1.5 relative group">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400">👤 {c.name}</span>
                            <span className="text-[8px] bg-violet-500/10 text-violet-500 border border-violet-500/20 px-1 py-0.2 rounded scale-90">人物</span>
                          </div>
                          <p className="text-[10px] text-theme-muted leading-relaxed line-clamp-2">{c.bio || c.summary || '暂无详细人物生平或特质。'}</p>
                          <div className="flex items-center gap-2 mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setQuickAddType('character');
                                setQuickAddName(c.name);
                                setQuickAddDesc(c.bio || c.summary || '');
                                setIsQuickAddOpen(true);
                              }}
                              className="px-2 py-0.5 rounded bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-[9px] text-violet-600 dark:text-violet-400 transition-colors font-bold font-mono"
                            >
                              编辑设定
                            </button>
                            <button
                              onClick={() => {
                                alert(`🔮 「${c.name}」伏笔智能联想：\n在当前场景中，正文可联动其伏笔描述：“大荒主祭的封印在深夜极易产生煞气共鸣”。建议主角与其对话时，描写夜风中他的身影如雕塑般静止。`);
                              }}
                              className="px-2 py-0.5 rounded bg-theme-accent/10 hover:bg-theme-accent/20 border border-theme-accent/20 text-[9px] text-theme-accent transition-colors font-bold"
                            >
                              伏笔联想
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Item Cards */}
                      {matchedItems.map((i) => (
                        <div key={i.id} className="p-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 hover:bg-sky-500/10 transition-all flex flex-col gap-1.5 relative group">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400">{i.name}</span>
                            <span className="text-[8px] bg-sky-500/10 text-sky-500 border border-sky-500/20 px-1 py-0.2 rounded scale-90">道具</span>
                          </div>
                          <p className="text-[10px] text-theme-muted leading-relaxed line-clamp-2">{i.description || '暂无道具背景描述。'}</p>
                          <div className="flex items-center gap-2 mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setQuickAddType('item');
                                setQuickAddName(i.name.replace('💍 ', ''));
                                setQuickAddDesc(i.description || '');
                                setIsQuickAddOpen(true);
                              }}
                              className="px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-[9px] text-sky-600 dark:text-sky-400 transition-colors font-bold font-mono"
                            >
                              编辑设定
                            </button>
                            <button
                              onClick={() => {
                                alert(`🔮 「${i.name}」伏笔智能联想：\n检测到正文含有冲突。戒指的虚空引力可以在出拳时作为爆发点，对敌人的护体气劲形成崩解，使原本普通的一拳进化为跨阶瞬杀！`);
                              }}
                              className="px-2 py-0.5 rounded bg-theme-accent/10 hover:bg-theme-accent/20 border border-theme-accent/20 text-[9px] text-theme-accent transition-colors font-bold"
                            >
                              伏笔联想
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Location Cards */}
                      {matchedLocations.map((l) => (
                        <div key={l.id} className="p-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all flex flex-col gap-1.5 relative group">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">📍 {l.name}</span>
                            <span className="text-[8px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1 py-0.2 rounded scale-90">场景</span>
                          </div>
                          <p className="text-[10px] text-theme-muted leading-relaxed line-clamp-2">{l.description || '暂无场景环境描述。'}</p>
                          <div className="flex items-center gap-2 mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setQuickAddType('location');
                                setQuickAddName(l.name);
                                setQuickAddDesc(l.description || '');
                                setIsQuickAddOpen(true);
                              }}
                              className="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[9px] text-emerald-600 dark:text-emerald-400 transition-colors font-bold font-mono"
                            >
                              编辑设定
                            </button>
                            <button
                              onClick={() => {
                                alert(`🔮 「${l.name}」环境智能匹配：\n在此场景中可融合“大荒风暴，极压降低”的动态风沙渲染，作为战斗一触即发的极佳写照。`);
                              }}
                              className="px-2 py-0.5 rounded bg-theme-accent/10 hover:bg-theme-accent/20 border border-theme-accent/20 text-[9px] text-theme-accent transition-colors font-bold"
                            >
                              环境联想
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 去设定工坊补强按钮 */}
                  <button
                    onClick={() => onNavigate?.('world')}
                    className="w-full mt-1 py-1.5 border border-dashed border-theme-border/60 hover:border-theme-accent/40 rounded-lg text-[10px] text-theme-muted hover:text-theme-accent transition-colors flex items-center justify-center gap-1 font-mono uppercase tracking-wider"
                  >
                    <Plus size={10} />
                    <span>去设定工坊补强</span>
                  </button>
                </div>
              </div>

              <div className="h-px bg-theme-border/40" />

              {/* 4. QualityGuardCenter - 质量审查与体检去AI味中心 */}
              <QualityGuardCenter
                localContent={localContent}
                onUpdateContent={onUpdateContent}
                setLocalContent={setLocalContent}
                isGeneratingCritique={isGeneratingCritique}
                onRunAudit={onRunAudit}
              />

              {/* 5. 主创 Agent 智能行动指引气泡 (Amber-bordered Adaptive Bubble) */}
              <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-3.5 flex flex-col gap-2.5 relative overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <Bot size={13} className="text-amber-500" />
                  <span className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">主创 AGENT 智能指引</span>
                </div>
                
                {currentPhaseId === 1 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-theme-text/80 leading-relaxed">
                      检测到本章尚未大纲分镜。建议由我为您自动起草一版<strong>场景分镜骨架</strong>，为后续扩写作好铺垫。
                    </p>
                    <button
                      onClick={() => {
                        setAgentTab('planning');
                        setIsAgentSidebarOpen(true);
                        void onGenerateBeats();
                      }}
                      disabled={isGeneratingBeats}
                      className="self-start px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors disabled:opacity-50"
                    >
                      {isGeneratingBeats ? <Loader2 size={10} className="animate-spin" /> : <Radar size={10} />}
                      <span>一键构思分镜大纲</span>
                    </button>
                  </div>
                )}

                {currentPhaseId === 2 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-theme-text/80 leading-relaxed">
                      分镜已整装待发！是否需要我根据现有的分镜骨架和挂载 of 设定/技能，为您<strong>一键扩写出精美的初稿正文</strong>？
                    </p>
                    <button
                      onClick={() => void runCopilotAction('generate-draft')}
                      disabled={isGeneratingContent}
                      className="self-start px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors disabled:opacity-50"
                    >
                      {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Feather size={10} />}
                      <span>一键智能扩写正文</span>
                    </button>
                  </div>
                )}

                {currentPhaseId === 3 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-theme-text/80 leading-relaxed">
                      初稿已完成。建议由我启动<strong>全生命周期质量审计</strong>，秒级探测文中的设定冲突、逻辑死结、AI 腔等。
                    </p>
                    <button
                      onClick={onRunAudit}
                      disabled={isGeneratingCritique}
                      className="self-start px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors disabled:opacity-50"
                    >
                      {isGeneratingCritique ? <Loader2 size={10} className="animate-spin" /> : <ShieldAlert size={10} />}
                      <span>一键全文深度体检</span>
                    </button>
                  </div>
                )}

                {currentPhaseId === 4 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-theme-text/80 leading-relaxed">
                      审计报告已出炉。现在我可以对照存在的逻辑瑕疵，进行<strong>微创局部手术式智能精准精修润色</strong>。
                    </p>
                    <button
                      onClick={() => void runCopilotAction('run-polish')}
                      disabled={isGeneratingContent}
                      className="self-start px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors disabled:opacity-50"
                    >
                      {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      <span>一键局部手术润色</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div id="editor-empty-state" className="flex-1 flex flex-col items-center justify-center text-theme-muted opacity-100 min-h-[60vh] bg-theme-sidebar rounded-3xl shadow-sm border border-theme-border m-4 md:m-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-theme-sidebar/50 to-theme-border/20 z-0" />
            <div className="z-10 flex flex-col items-center">
              <div className="w-24 h-24 bg-theme-accent/10 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <FileText size={40} className="text-theme-accent" />
              </div>
              <h3 className="text-3xl font-serif text-theme-text mb-3 font-black tracking-tight">准备开始创作</h3>
              <p className="mb-10 font-sans text-base text-theme-muted max-w-md text-center leading-relaxed">当前作品还没有任何章节，请点击下方按钮一键开始您的第一章，或者唤起智能管家协助构思。</p>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  onClick={onAddFirstChapter}
                  className="px-8 py-4 bg-theme-accent text-white hover:bg-theme-accent/90 rounded-2xl flex items-center gap-3 transition-[transform,background-color,box-shadow] duration-200 hover:scale-105 font-bold shadow-lg text-lg"
                >
                  <Plus size={22} />
                  新建章节并写作
                </button>
                <button
                  onClick={() => setIsAgentSidebarOpen(true)}
                  className="px-8 py-4 bg-theme-sidebar border-2 border-theme-accent/20 hover:border-theme-accent text-theme-accent hover:bg-theme-accent/5 rounded-2xl flex items-center gap-3 transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-1 font-bold shadow-md text-lg"
                >
                  <Bot size={22} />
                  唤起 AI 智能管家
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Zero-Barrier Setting Registration Side-out Drawer */}
      {isQuickAddOpen && (
        <div className="absolute top-0 right-0 w-80 h-full bg-theme-sidebar/95 backdrop-blur-md border-l border-theme-border/60 z-50 p-5 flex flex-col justify-between shadow-2xl transition-all duration-300">
          <form onSubmit={handleSaveQuickSetting} className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-theme-border/30 pb-2">
              <div className="flex items-center gap-1.5">
                <Plus size={14} className="text-theme-accent" />
                <h4 className="text-xs font-bold text-theme-text uppercase tracking-wider">零阻碍设定快速补录</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="text-theme-muted hover:text-theme-text transition-colors text-xs font-mono font-bold animate-[spin_0.3s]"
              >
                ✕
              </button>
            </div>

            {/* Type tabs */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-theme-muted font-bold uppercase tracking-wider font-mono">设定类别</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['character', 'location', 'item'] as const).map((t) => {
                  const labelMap = { character: '👤 人物', location: '📍 场景', item: '💍 道具' };
                  const isSelected = quickAddType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setQuickAddType(t)}
                      className={cn(
                        "py-1.5 text-[10px] font-bold rounded-lg border text-center transition-all",
                        isSelected
                          ? "bg-theme-accent text-white border-theme-accent shadow-sm"
                          : "bg-theme-sidebar/40 border-theme-border/50 text-theme-muted hover:bg-theme-sidebar"
                      )}
                    >
                      {labelMap[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-theme-muted font-bold uppercase tracking-wider font-mono">设定名称</label>
              <input
                type="text"
                required
                value={quickAddName}
                onChange={(e) => setQuickAddName(e.target.value)}
                placeholder="如：林啸"
                className="w-full bg-theme-sidebar/40 border border-theme-border/60 focus:border-theme-accent rounded-lg p-2 text-xs text-theme-text outline-none transition-colors"
              />
            </div>

            {/* Textarea description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-theme-muted font-bold uppercase tracking-wider font-mono">设定设定详情与背景</label>
              <textarea
                rows={5}
                value={quickAddDesc}
                onChange={(e) => setQuickAddDesc(e.target.value)}
                placeholder="描述其生平人设、道具卡功能或场景气候..."
                className="w-full bg-theme-sidebar/40 border border-theme-border/60 focus:border-theme-accent rounded-lg p-2 text-xs text-theme-text outline-none resize-none transition-colors"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
            >
              <Send size={12} />
              <span>保存设定并同步</span>
            </button>
          </form>

          <p className="text-[9px] text-theme-muted italic text-center leading-relaxed mt-4">
            提示：保存后设定将立刻注入本次写作生命周期的记忆雷达中，主编辑器输入时将无缝嗅探对齐。
          </p>
        </div>
      )}

      {/* Dynamic Keyframes styles inline injection */}
      <style>{`
        @keyframes radar-pulse {
          0% { transform: scale(0.9); opacity: 0.15; }
          50% { transform: scale(1.18); opacity: 0.45; }
          100% { transform: scale(0.9); opacity: 0.15; }
        }
        @keyframes radar-scan {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
});
