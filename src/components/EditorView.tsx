import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  Settings, 
  Save, 
  Plus, 
  Trash2,
  FileText,
  PanelRight,
  Maximize2,
  Minimize2,
  Cloud,
  Bot,
  Brain,
  MessageSquareWarning,
  Sparkles,
  Loader2,
  ListOrdered,
  Feather,
  History,
  Globe,
  Search,
  Wand2,
  CheckCircle2,
  Radar,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Folder,
  FolderOpen,
  Lightbulb,
  Eye,
  Activity
} from 'lucide-react';
import { Novel, Chapter, Character, Item, Location, ChapterVersion, Skill, TimelineEvent, Faction, PowerLevel } from '../types';
import {
  listChapters, createChapter, updateChapter, deleteChapter,
  listCharacters, createCharacter,
  listLocations, createLocation,
  listItems, createItem,
  listFactions,
  listPowerLevels,
  listTimelineEvents,
  listChapterVersions, createChapterVersion,
  listSkills, updateNovel, getNovel,
  subscribeToChanges
} from '../lib/api';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { editorAgentPhase, writerAgentPhase, criticAgentPhase, AgentContext, buildContextPrompt } from '../lib/agents';
import ReactMarkdown from 'react-markdown';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';


interface EditorViewProps {
  novel: Novel;
  onBack: () => void;
}

export function EditorView({ novel, onBack }: EditorViewProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [expandedVolumes, setExpandedVolumes] = useState<string[]>(['正文卷']);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
  const [agentTab, setAgentTab] = useState<'outline' | 'planning' | 'quality' | 'trace' | 'bible' | 'skills' | 'versions' | 'ideas' | 'foreshadowing' | 'pacing'>('outline');
  const [bibleSearch, setBibleSearch] = useState('');
  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [expectedWordCount, setExpectedWordCount] = useState<number | ''>('');
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [librarySkills, setLibrarySkills] = useState<Skill[]>([]);
  const [mountedSkillIds, setMountedSkillIds] = useState<string[]>(novel.mountedSkillIds || []);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingCritique, setIsGeneratingCritique] = useState(false);
  
  // Entity Sniffing
  const [isSniffing, setIsSniffing] = useState(false);
  const [sniffedEntities, setSniffedEntities] = useState<{ activeExisting: string[], newEntities: { name: string, type: string, context: string }[] } | null>(null);
  const [addingEntityNames, setAddingEntityNames] = useState<string[]>([]);
  const [userIntent, setUserIntent] = useState('');

  const handleAddSniffedEntity = async (ent: any) => {
    setAddingEntityNames(prev => [...prev, ent.name]);
    try {
      const response = await fetch('/api/generate-entity-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ent)
      });
      const data = await response.json();
      
      const now = Date.now();
      
      if (data.entityType === 'character') {
         await createCharacter({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           role: data.role || 'supporting',
           summary: data.summary || '',
           traits: data.traits || [],
           bio: data.bio || '',
           createdAt: now,
           updatedAt: now
         });
      } else if (data.entityType === 'location') {
         await createLocation({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           region: data.region || '',
           description: data.description || '',
           createdAt: now,
           updatedAt: now
         });
      } else if (data.entityType === 'item') {
         await createItem({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           type: data.type || '',
           description: data.description || '',
           createdAt: now,
           updatedAt: now
         });
      }

      // Remove from sniffedEntities.newEntities
      setSniffedEntities(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          newEntities: prev.newEntities.filter(e => e.name !== ent.name)
        };
      });
    } catch (error) {
       console.error("Failed to add entity", error);
       alert("添加失败：" + (error as Error).message);
    } finally {
       setAddingEntityNames(prev => prev.filter(n => n !== ent.name));
    }
  };
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const isAnyGenerating = isGeneratingContent || isGeneratingBeats || isGeneratingCritique || isSniffing || isGeneratingOutline;
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const beatsSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const outlineSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!novel?.id) return;

    const fetchAll = async () => {
      const freshChapters = await listChapters(novel.id);
      setChapters(freshChapters);
      setCurrentChapter(prev => {
        if (!prev && freshChapters.length > 0) return freshChapters[0];
        if (prev) {
          const matched = freshChapters.find(c => c.id === prev.id);
          if (matched) {
            return {
              ...matched,
              content: prev.content,
            };
          }
          return prev;
        }
        return prev;
      });
      const [characters, locations, items, factions, powerLevels, timelineEvents, librarySkills] = await Promise.all([
        listCharacters(novel.id),
        listLocations(novel.id),
        listItems(novel.id),
        listFactions(novel.id),
        listPowerLevels(novel.id),
        listTimelineEvents(novel.id),
        listSkills()
      ]);
      setCharacters(characters);
      setLocations(locations);
      setItems(items);
      setFactions(factions);
      setPowerLevels(powerLevels);
      setTimelineEvents(timelineEvents);
      setLibrarySkills(librarySkills);
      const fresh = await getNovel(novel.id);
      if (fresh) setMountedSkillIds(fresh.mountedSkillIds || []);
    };
    fetchAll();
    return subscribeToChanges(fetchAll);
  }, [novel?.id]);

  const toggleSkillMount = async (skillId: string) => {
    const isMounted = mountedSkillIds.includes(skillId);
    let newIds: string[];
    if (isMounted) {
      newIds = mountedSkillIds.filter(id => id !== skillId);
    } else {
      newIds = [...mountedSkillIds, skillId];
    }

    setMountedSkillIds(newIds);
    await updateNovel(novel.id, { mountedSkillIds: newIds });
  };

  useEffect(() => {
    if (!currentChapter) {
      setVersions([]);
      return;
    }
    const fetchVersions = async () => {
      setVersions(await listChapterVersions(currentChapter.id));
    };
    fetchVersions();
    return subscribeToChanges(fetchVersions);
  }, [currentChapter?.id]);

  const handleSaveVersion = async (author: 'user' | 'writer-agent' | 'editor-agent' | 'auto') => {
    if (!currentChapter) return;
    await createChapterVersion({
      id: Date.now().toString(),
      chapterId: currentChapter.id,
      content: currentChapter.content,
      wordCount: currentChapter.wordCount,
      author,
      createdAt: Date.now()
    });
  };

  const handleRestoreVersion = (version: ChapterVersion) => {
    if (!confirm('确定要回滚到此版本吗？这将覆盖当前正文内容！')) return;
    handleUpdateContent(version.content);
  };

  const buildAgentContext = (): AgentContext => {
    let previousChaptersSummary = '';
    if (currentChapter) {
       const previousChapters = chapters
        .filter(c => c.order < currentChapter.order)
        .sort((a, b) => b.order - a.order)
        .slice(0, 3) // last 3 chapters
        .reverse();

       if (previousChapters.length > 0) {
           previousChaptersSummary = previousChapters.map(c => `【${c.title}】:\n<分镜纲要>${c.sceneBeats || '无'}</分镜纲要>\n`).join('\n');
       } else {
           previousChaptersSummary = "这是本作最初阶段，暂无前情提要。";
       }
    }
    const mountedSkills = librarySkills.filter(s => mountedSkillIds.includes(s.id));
    return { 
      novel, 
      characters, 
      locations, 
      items, 
      timelineEvents, 
      factions,
      powerLevels,
      previousChaptersSummary, 
      activeEntityNames: sniffedEntities?.activeExisting,
      mountedSkills
    };
  };

  const handleRunAudit = async () => {
    if (!currentChapter) return;
    setIsGeneratingCritique(true);
    try {
      const mountedSkills = librarySkills.filter(s => mountedSkillIds.includes(s.id));
      const context = buildAgentContext();
      const contextStr = buildContextPrompt(context);

      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftContent: currentChapter.content,
          sceneBeats: currentChapter.sceneBeats,
          contextStr,
          skills: mountedSkills
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setCurrentChapter(prev => prev ? { ...prev, critique: data.feedback } : null);
      await updateChapter(currentChapter.id, { critique: data.feedback });
    } catch (e) {
      console.error(e);
      alert('审计失败: ' + String(e));
    } finally {
      setIsGeneratingCritique(false);
    }
  };

  const handleGenerateBeats = async () => {
    if (!currentChapter) return;
    setIsGeneratingBeats(true);
    try {
      const context = buildAgentContext();
      const beats = await editorAgentPhase(userIntent || `关于章节「${currentChapter.title}」的大纲`, context);
      
      const updated = { ...currentChapter, sceneBeats: beats };
      setCurrentChapter(updated);
      await updateChapter(currentChapter.id, { sceneBeats: beats });
      setUserIntent('');
    } catch (error) {
      console.error(error);
      alert('生成分镜失败：' + (error as Error).message);
    } finally {
      setIsGeneratingBeats(false);
    }
  };

  const handleGenerateOutline = async () => {
    setIsGeneratingOutline(true);
    try {
      const response = await fetch('/api/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: novel.title,
          worldRules: novel.worldRules,
          seedOutline: globalOutline,
          expectedWordCount
        })
      });
      const data = await response.json();
      if (data.outline) {
        setGlobalOutline(data.outline);
        await updateNovel(novel.id, { globalOutline: data.outline });
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (e) {
      console.error(e);
      alert('大纲生成失败');
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const handleGenerateContent = async () => {
    if (!currentChapter || !currentChapter.sceneBeats) return;
    setIsGeneratingContent(true);
    let originalWordCount = currentChapter.wordCount;
    const baseContent = currentChapter.content ? currentChapter.content + '\n\n' : '';
    let currentStreamedText = '';
    let lastCritique = '';

    try {
      // Use only mounted skills
      const mountedSkills = librarySkills.filter(s => mountedSkillIds.includes(s.id));

      const context = buildAgentContext();
      const contextStr = buildContextPrompt(context);

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextStr,
          sceneBeats: currentChapter.sceneBeats,
          skills: mountedSkills,
          maxIterations: 2,
          draftContent: ""
        })
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        
        // SSE responses can have multiple lines of "data: {...}\n\n"
        const messages = chunkStr.split('\\n\\n').filter(Boolean);
        for (const msg of messages) {
          if (msg.startsWith('data: ')) {
            const dataStr = msg.replace('data: ', '');
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'token') {
                currentStreamedText += data.content;
                const fullText = baseContent + currentStreamedText;
                
                // Optimistically update purely the UI so we see it appearing
                setCurrentChapter(prev => prev ? { 
                  ...prev, 
                  content: fullText,
                  wordCount: fullText.replace(/\\s/g, '').length
                } : null);

                // Scroll to bottom
                if (contentRef.current) {
                  contentRef.current.scrollTop = contentRef.current.scrollHeight;
                }
              } else if (data.type === 'critic_done') {
                console.log("Critic feedback:", data.feedback, "IsValid:", data.isValid);
                lastCritique = data.feedback;
                // Also save it locally to the chapter object so the side panel shows it
                setCurrentChapter(prev => prev ? { ...prev, critique: data.feedback } : null);
              } else if (data.type === 'error') {
                console.error("Orchestration error:", data.message);
              }
            } catch (e) {
              // Ignore incomplete JSON chunks boundary issues
            }
          }
        }
      }

      // Final save when done
      const fullText = baseContent + currentStreamedText;
      const finalWordCount = fullText.replace(/\\s/g, '').length;
      
      setCurrentChapter(prev => prev ? { 
        ...prev, 
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      } : null);

      await updateChapter(currentChapter.id, {
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      });

      // Save AI result as version
      await createChapterVersion({
        id: Date.now().toString(),
        chapterId: currentChapter.id,
        content: fullText,
        wordCount: finalWordCount,
        author: 'writer-agent',
        createdAt: Date.now()
      });

    } catch (error) {
      console.error(error);
      alert('生成正文失败：' + (error as Error).message);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const handleSniffEntities = async () => {
    if (!currentChapter) return;
    setIsSniffing(true);
    try {
      const existingNames = [...characters.map(c => c.name), ...locations.map(l => l.name), ...items.map(i => i.name)].filter(Boolean);
      const textToScan = `${currentChapter.sceneBeats || ''}\n${currentChapter.content || ''}`;
      
      const response = await fetch('/api/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToScan, existingNames })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setSniffedEntities(data);
    } catch (e) {
      console.error(e);
      alert('嗅探失败');
    } finally {
      setIsSniffing(false);
    }
  };



  const handleAddChapter = async (targetVolumeName?: string) => {
    const newOrder = chapters.length + 1;
    const volumeName = targetVolumeName || currentChapter?.volumeName || '正文卷';
    const newId = Date.now().toString();
    await createChapter({
      id: newId,
      novelId: novel.id,
      volumeName,
      title: `第 ${newOrder} 章`,
      content: '',
      order: newOrder,
      wordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (!expandedVolumes.includes(volumeName)) {
      setExpandedVolumes(prev => [...prev, volumeName]);
    }
  };

  const handleUpdateContent = (newContent: string) => {
    if (!currentChapter) return;
    
    // Optimistic update for UI
    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    
    // Debounced sync to local DB
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    
    setIsSyncing(true);
    setSyncSuccess(false);
    syncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(currentChapter.id, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length
      });
      setIsSyncing(false);
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2000);
    }, 1000);
  };

  const handleDeleteChapter = async (id: string) => {
    if (!confirm('确定要删除这一章吗？')) return;
    await deleteChapter(id);
    if (currentChapter?.id === id) {
      setCurrentChapter(chapters.find(c => c.id !== id) || null);
    }
  };

  const groupedChapters = React.useMemo(() => {
    const groups: { volumeName: string; chapters: Chapter[] }[] = [];
    const volMap = new Map<string, Chapter[]>();
    
    chapters.forEach(c => {
      const vName = c.volumeName || '正文卷';
      if (!volMap.has(vName)) {
        volMap.set(vName, []);
        groups.push({ volumeName: vName, chapters: volMap.get(vName)! });
      }
      volMap.get(vName)!.push(c);
    });
    return groups;
  }, [chapters]);

  const toggleVolume = (vName: string) => {
    setExpandedVolumes(prev => 
      prev.includes(vName) ? prev.filter(v => v !== vName) : [...prev, vName]
    );
  };

  return (
    <div className={cn(
      "h-full flex overflow-hidden transition-all duration-700",
      isFullscreen ? "fixed inset-0 z-[100] bg-parchment" : "bg-white"
    )}>
      {/* Chapter List Sidebar */}
      <AnimatePresence initial={false}>
        {!isFullscreen && isSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex flex-col border-r border-theme-border bg-transparent overflow-hidden"
          >
            <div className="p-4 border-b border-theme-border bg-transparent sticky top-0 z-10 flex items-center justify-between">
              <button 
                onClick={onBack}
                className="p-2 hover:bg-theme-border rounded-lg text-theme-muted transition-colors"
                title="返回书库"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-sm font-bold uppercase tracking-widest text-theme-muted truncate max-w-[120px]">{novel.title}</h2>
              <button 
                onClick={() => handleAddChapter()}
                className="p-2 hover:opacity-90 bg-theme-accent text-white rounded-lg transition-all"
                title="新建章节"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {groupedChapters.map(group => (
                <div key={group.volumeName} className="space-y-1">
                  {/* Volume Header */}
                  <div 
                    onClick={() => toggleVolume(group.volumeName)}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-theme-border/30 rounded-lg text-theme-text transition-colors group/vol"
                  >
                    {expandedVolumes.includes(group.volumeName) ? (
                      <FolderOpen size={14} className="text-theme-muted" />
                    ) : (
                      <Folder size={14} className="text-theme-muted" />
                    )}
                    <span className="text-xs font-bold truncate flex-1">{group.volumeName}</span>
                    <span className="text-[10px] text-theme-muted opacity-0 group-hover/vol:opacity-100 transition-opacity">
                      {group.chapters.length}章
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleAddChapter(group.volumeName); }}
                      className="opacity-0 group-hover/vol:opacity-100 p-1 hover:text-theme-accent transition-opacity ml-1 shrink-0"
                      title="在此卷中添加"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {/* Volume Chapters */}
                  {expandedVolumes.includes(group.volumeName) && (
                    <div className="pl-3 relative before:absolute before:left-3.5 before:top-0 before:bottom-0 before:w-px before:bg-theme-border/50 space-y-1">
                      {group.chapters.map((chapter) => (
                        <div key={chapter.id} className="relative">
                          <div 
                            onClick={() => setCurrentChapter(chapter)}
                            className={cn(
                              "group px-3 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between ml-2",
                              currentChapter?.id === chapter.id 
                                ? "bg-white shadow-sm border border-theme-border text-theme-text relative before:absolute before:-left-3.5 before:top-1/2 before:-mt-px before:w-3 before:h-0.5 before:bg-theme-accent z-10" 
                                : "text-theme-muted hover:bg-theme-border/40 z-10"
                            )}
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-sm font-medium truncate">{chapter.title}</span>
                            </div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-600 transition-opacity ml-2 shrink-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          
                          {/* Third Level: Beats */}
                          {currentChapter?.id === chapter.id && chapter.sceneBeats && (
                            <div className="pl-7 mt-0.5 space-y-1 mb-2 relative before:absolute before:left-[17px] before:top-0 before:-bottom-2 before:w-px before:bg-theme-border/30">
                              {chapter.sceneBeats.split('\n').filter(b => b.trim().length > 0).slice(0, 4).map((beat, i) => (
                                <div key={i} className="text-[10px] text-theme-muted truncate relative before:absolute before:-left-2.5 before:top-1/2 before:-mt-px before:w-2 before:h-px before:bg-theme-border/30">
                                  {beat.replace(/^[-* 0-9.]+\s*/, '').trim() || beat}
                                </div>
                              ))}
                              {chapter.sceneBeats.split('\n').filter(b => b.trim().length > 0).length > 4 && (
                                <div className="text-[9px] text-theme-muted/50 pl-0.5">...</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Content Area */}
      <div className={cn(
        "flex-1 flex flex-col relative overflow-hidden transition-colors duration-500",
        isFullscreen ? "bg-parchment" : "bg-paper"
      )}>
        {/* Editor Toolbar */}
        <div className={cn(
          "h-14 px-6 border-b flex items-center justify-between transition-all duration-500 z-10",
          isFullscreen 
            ? "bg-transparent border-transparent opacity-0 hover:opacity-100" 
            : "bg-transparent border-theme-border"
        )}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-theme-border/50 rounded-lg text-theme-muted"
            >
              <PanelRight size={18} className={cn(!isSidebarOpen && "rotate-180")} />
            </button>
            <div className="h-4 w-px bg-theme-border/50" />
            <div className="flex flex-col -gap-1">
              <input 
                type="text"
                value={currentChapter?.volumeName || ''}
                onChange={(e) => {
                  if (!currentChapter) return;
                  const newVol = e.target.value;
                  setCurrentChapter({ ...currentChapter, volumeName: newVol });
                  
                  if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
                  titleSyncTimeoutRef.current = setTimeout(async () => {
                    await updateChapter(currentChapter.id, { volumeName: newVol });
                  }, 1000);
                }}
                className="bg-transparent border-none outline-none font-sans text-[10px] text-theme-muted focus:ring-0 w-48 hover:bg-theme-border/30 rounded px-1 -ml-1 transition-colors"
                placeholder="所属卷（默认为正文卷）"
              />
              <input 
                type="text"
                value={currentChapter?.title || ''}
                onChange={(e) => {
                  if (!currentChapter) return;
                  const newTitle = e.target.value;
                  setCurrentChapter({ ...currentChapter, title: newTitle });
                  
                  if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
                  titleSyncTimeoutRef.current = setTimeout(async () => {
                    await updateChapter(currentChapter.id, { title: newTitle });
                  }, 1000);
                }}
                className="bg-transparent border-none outline-none font-serif text-lg font-medium focus:ring-0 w-64 text-theme-text px-1 -ml-1 hover:bg-theme-border/30 rounded transition-colors"
                placeholder="章节标题"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              {isAnyGenerating ? (
                <motion.div 
                   key="generating"
                   initial={{ opacity: 0, scale: 0.9 }}
                   animate={{ opacity: 1, scale: 1 }}
                   exit={{ opacity: 0, scale: 0.9 }}
                   className="flex items-center gap-2 text-xs font-bold text-theme-accent mr-2 px-3 py-1.5 bg-theme-accent/10 rounded-full"
                 >
                   <Loader2 size={14} className="animate-spin" />
                   AI 响应中...
                 </motion.div>
              ) : isSyncing ? (
                <motion.div 
                  key="syncing"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-xs text-theme-muted mr-2 font-mono"
                >
                  <Cloud size={14} className="animate-pulse" />
                  保存中...
                </motion.div>
              ) : syncSuccess ? (
                <motion.div 
                  key="success"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-xs text-emerald-500 mr-2 font-mono"
                >
                  <CheckCircle2 size={14} />
                  保存成功
                </motion.div>
              ) : null}
            </AnimatePresence>
            <button 
              onClick={() => setIsAgentSidebarOpen(!isAgentSidebarOpen)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isAgentSidebarOpen 
                  ? "bg-theme-accent text-white" 
                  : "hover:bg-theme-border/50 text-theme-muted"
              )}
              title="智能助理"
            >
              <Bot size={18} />
            </button>
            <button 
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-theme-border/50 rounded-lg text-theme-muted transition-colors"
              title="全屏模式"
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button className="p-2 hover:bg-theme-border/50 rounded-lg text-theme-muted">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Writing Surface */}
        <div className="flex-1 overflow-y-auto px-4 md:px-12 py-16 scroll-smooth flex flex-col relative">
          <div className={cn(
            "w-full flex-1 flex flex-col relative transition-all duration-500",
            isAgentSidebarOpen && "max-w-3xl mx-auto"
          )}>
            {currentChapter ? (
              <>
                {(!currentChapter.content || currentChapter.content.trim() === '') && (
                  <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh]">
                    <div className="flex flex-col items-center justify-center bg-white/80 p-8 rounded-3xl shadow-lg border border-theme-border/50 backdrop-blur-sm">
                      <button
                        onClick={() => setIsAgentSidebarOpen(true)}
                        className="px-8 py-5 bg-theme-accent text-white font-bold rounded-2xl shadow-xl hover:shadow-2xl hover:-translate-y-2 transition-all flex items-center gap-4 group"
                      >
                        <Bot size={32} className="text-white/90 group-hover:scale-110 transition-transform" />
                        <span className="text-xl">唤起 AI 智能管家</span>
                      </button>
                      <p className="mt-6 text-sm text-theme-muted font-serif">或者直接在下方文本框点击开始书写</p>
                    </div>
                    <div className="w-full flex-1 min-h-[30vh] relative z-10 p-2 md:p-8">
                      <textarea
                        ref={contentRef}
                        value={currentChapter.content || ''}
                        onChange={(e) => handleUpdateContent(e.target.value)}
                        placeholder="在此起草你的灵感..."
                        className="w-full h-full min-h-[30vh] bg-white rounded-2xl shadow-sm border border-theme-border/50 outline-none resize-none writing-surface text-theme-text placeholder:text-theme-muted/40 transition-all font-serif p-8 hover:border-theme-accent/30 focus:border-theme-accent/50 focus:shadow-md"
                      />
                    </div>
                  </div>
                )}
                {currentChapter.content && currentChapter.content.trim() !== '' && (
                <div className="w-full flex-1 h-full min-h-[70vh] relative z-10 p-2 md:p-8">
                  <textarea
                    ref={contentRef}
                    value={currentChapter.content || ''}
                    onChange={(e) => handleUpdateContent(e.target.value)}
                    placeholder="在此起草你的灵感..."
                    className="w-full h-full min-h-[70vh] bg-white rounded-2xl shadow-sm border border-theme-border/50 outline-none resize-none writing-surface text-theme-text placeholder:text-theme-muted/40 transition-all font-serif p-8 hover:border-theme-accent/30 focus:border-theme-accent/50 focus:shadow-md"
                  />
                </div>
                )}
              </>
            ) : (
              <div id="editor-empty-state" className="flex-1 flex flex-col items-center justify-center text-theme-muted opacity-100 min-h-[60vh] bg-white rounded-3xl shadow-sm border border-theme-border m-4 md:m-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-theme-sidebar/50 to-theme-border/20 z-0" />
                <div className="z-10 flex flex-col items-center">
                  <div className="w-24 h-24 bg-theme-accent/10 rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <FileText size={40} className="text-theme-accent" />
                  </div>
                  <h3 className="text-3xl font-serif text-theme-text mb-3 font-black tracking-tight">准备开始创作</h3>
                  <p className="mb-10 font-sans text-base text-theme-muted max-w-md text-center leading-relaxed">当前作品还没有任何章节，请点击下方按钮一键开始您的第一章，或者唤起智能管家协助构思。</p>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <button
                      onClick={async () => {
                        const newChapId = Date.now().toString();
                        const newChap: Chapter = {
                          id: newChapId,
                          title: '第一章',
                          content: '',
                          wordCount: 0,
                          order: chapters.length,
                          volumeName: '默认卷',
                          novelId: novel.id,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        };
                        setChapters(prev => [...prev, newChap]);
                        setCurrentChapter(newChap);

                        await createChapter({
                          ...newChap,
                          createdAt: Date.now(),
                          updatedAt: Date.now()
                        });
                        setTimeout(() => {
                           if (contentRef.current) {
                             contentRef.current.focus();
                           }
                        }, 200);
                      }}
                      className="px-8 py-4 bg-theme-accent text-white hover:bg-theme-accent/90 rounded-2xl flex items-center gap-3 transition-all hover:scale-105 font-bold shadow-lg text-lg"
                    >
                      <Plus size={22} />
                      新建章节并写作
                    </button>
                    <button
                      onClick={() => setIsAgentSidebarOpen(true)}
                      className="px-8 py-4 bg-white border-2 border-theme-accent/20 hover:border-theme-accent text-theme-accent hover:bg-theme-accent/5 rounded-2xl flex items-center gap-3 transition-all hover:-translate-y-1 font-bold shadow-md text-lg"
                    >
                      <Bot size={22} />
                      唤起 AI 智能管家
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Word Counter & Status */}
        <div className="h-10 px-6 border-t border-theme-border flex items-center justify-between bg-white text-[10px] font-bold uppercase tracking-widest text-theme-muted">
          <div className="flex items-center gap-6">
            <span>字数: {currentChapter?.wordCount || 0}</span>
            <span>更新: {currentChapter ? new Date(currentChapter.updatedAt).toLocaleTimeString() : '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-600 shadow-[0_0_5px_rgba(22,163,74,0.3)]" />
            本地已保存
          </div>
        </div>
      </div>

      {/* Agent Sidebar */}
      <AnimatePresence initial={false}>
        {!isFullscreen && isAgentSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex flex-col border-l border-theme-border bg-transparent overflow-hidden z-20"
          >
            {/* Tabs */}
            <div className="flex overflow-x-auto no-scrollbar p-3 gap-1 border-b border-theme-border bg-transparent sticky top-0 z-10 shrink-0">
              <button
                onClick={() => setAgentTab('ideas')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'ideas'
                    ? "bg-theme-text text-white"
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Lightbulb size={12} /> 灵感
              </button>
              <button
                onClick={() => setAgentTab('foreshadowing')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'foreshadowing'
                    ? "bg-theme-text text-white"
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Eye size={12} /> 伏笔
              </button>
              <button
                onClick={() => setAgentTab('pacing')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'pacing'
                    ? "bg-theme-text text-white"
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Activity size={12} /> 节奏
              </button>
              <button
                onClick={() => setAgentTab('outline')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'outline'
                    ? "bg-theme-text text-white"
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <ListOrdered size={12} /> 故事大纲
              </button>
              <button 
                onClick={() => setAgentTab('planning')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'planning' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Brain size={12} /> 分镜
              </button>
              <button 
                onClick={() => setAgentTab('quality')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'quality' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <MessageSquareWarning size={12} /> 质量
              </button>
              <button 
                onClick={() => setAgentTab('trace')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'trace' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <History size={12} /> 追踪
              </button>
              <button 
                onClick={() => setAgentTab('bible')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'bible' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Globe size={12} /> 记忆库
              </button>
              <button 
                onClick={() => setAgentTab('skills')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'skills' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <Wand2 size={12} /> 技能挂载
              </button>
              <button 
                onClick={() => setAgentTab('versions')}
                className={cn(
                  "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
                  agentTab === 'versions' 
                    ? "bg-theme-text text-white" 
                    : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
                )}
              >
                <History size={12} /> 历史版本
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 scroll-smooth">
              <AnimatePresence mode="wait">
                {agentTab === 'ideas' && (
                  <motion.div key="ideas" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <IdeaFragmentBoard novelId={novel.id} compact />
                  </motion.div>
                )}
                {agentTab === 'foreshadowing' && (
                  <motion.div key="foreshadowing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <ForeshadowingPanel novelId={novel.id} />
                  </motion.div>
                )}
                {agentTab === 'pacing' && (
                  <motion.div key="pacing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <PacingDashboard novelId={novel.id} />
                  </motion.div>
                )}
                {agentTab === 'outline' ? (
                  <motion.div 
                    key="outline"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
                          <FileText size={14} className="text-theme-accent" />
                          全局大纲 (Global Outline)
                        </h3>
                      </div>
                      
                      <div className="flex gap-2 mb-3">
                        <div className="flex-1 relative">
                          <input 
                            type="number"
                            placeholder="预计总字数 (如: 1000000)"
                            value={expectedWordCount}
                            onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || '')}
                            className="w-full text-[10px] p-2 bg-white border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-all pl-2 pr-6"
                          />
                          <span className="absolute right-2 top-[7px] text-[10px] text-theme-muted">字</span>
                        </div>
                        <button
                          onClick={handleGenerateOutline}
                          disabled={!expectedWordCount || isGeneratingOutline}
                          className="px-3 py-1.5 bg-theme-accent text-white text-[10px] font-bold rounded-lg hover:bg-theme-accent/90 disabled:opacity-50 transition-all flex items-center gap-1.5"
                        >
                          {isGeneratingOutline ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 智能排盘
                        </button>
                      </div>

                      <textarea
                        value={globalOutline}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGlobalOutline(val);
                          if (outlineSyncTimeoutRef.current) clearTimeout(outlineSyncTimeoutRef.current);
                          outlineSyncTimeoutRef.current = setTimeout(async () => {
                             await updateNovel(novel.id, { globalOutline: val });
                          }, 1000);
                        }}
                        placeholder="在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击“智能排盘”由 AI 为您生成卷轴级大纲..."
                        className="w-full h-40 bg-white border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 outline-none focus:border-theme-accent transition-all resize-none shadow-sm font-serif leading-relaxed"
                      />
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">章节快速导航</h3>
                      <div className="space-y-1.5 pb-8">
                        {chapters.map((chap, idx) => (
                          <button
                            key={chap.id}
                            onClick={() => setCurrentChapter(chap)}
                            className={cn(
                              "w-full text-left p-3 rounded-xl border transition-all flex flex-col gap-1",
                              currentChapter?.id === chap.id 
                                ? "bg-theme-accent/5 border-theme-accent shadow-sm" 
                                : "bg-white border-theme-border/40 hover:border-theme-accent/20"
                            )}
                          >
                            <div className="flex justify-between items-center">
                              <span className={cn("text-xs font-bold", currentChapter?.id === chap.id ? "text-theme-accent" : "text-theme-text")}>
                                第 {idx + 1} 章: {chap.title}
                              </span>
                              <span className="text-[9px] text-theme-muted">{chap.wordCount} 字</span>
                            </div>
                            {chap.sceneBeats && (
                              <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                                {chap.sceneBeats.substring(0, 50)}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : agentTab === 'planning' ? (
                  <motion.div 
                    key="planning"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="space-y-4">
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
                          <ListOrdered size={14} className="text-theme-accent" />
                          创作意图
                        </h3>
                        <textarea
                          value={userIntent}
                          onChange={(e) => setUserIntent(e.target.value)}
                          placeholder="描述这一章你想写什么，比如：主角在酒馆偶遇了女二..."
                          className="w-full h-24 bg-white border border-theme-border rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-muted/60 outline-none focus:border-theme-accent transition-all resize-none shadow-sm"
                        />
                        <button 
                          onClick={handleGenerateBeats}
                          disabled={isGeneratingBeats || !currentChapter}
                          className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                          {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
                        </button>
                      </div>

                      {currentChapter && (
                        <div className="space-y-3">
                          <div className={cn(
                            "bg-white p-5 rounded-2xl border border-theme-border/40 shadow-sm relative overflow-hidden group",
                            !currentChapter.sceneBeats && "opacity-50"
                          )}>
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">当前场景分镜规划</h3>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleGenerateContent}
                                  disabled={isGeneratingContent || !currentChapter.sceneBeats}
                                  className="flex items-center gap-1.5 px-3 py-1 bg-theme-accent text-white rounded-lg text-[10px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 transition-all"
                                >
                                  {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Feather size={10} />}
                                  AI 扩写正文
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!contentRef.current || !currentChapter) return;
                                    const start = contentRef.current.selectionStart;
                                    const end = contentRef.current.selectionEnd;
                                    if (start === end) {
                                      alert("请先在右侧区域选中一段您需要改写的文字，然后再点击此按钮。");
                                      return;
                                    }
                                    const selectedText = currentChapter.content.substring(start, end);
                                    
                                    const instruction = prompt("请输入改写要求（如：更加通俗易懂，或者更有文学色彩），留空则由 AI 自动润色：");
                                    if (instruction === null) return;
                                    
                                    setIsGeneratingContent(true);
                                    try {
                                      const response = await fetch('/api/rewrite', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          text: selectedText,
                                          instruction,
                                          contextStr: buildContextPrompt(buildAgentContext())
                                        })
                                      });
                                      if (!response.ok) throw new Error("Rewrite failed.");
                                      const data = await response.json();
                                      
                                      const newText = currentChapter.content.substring(0, start) + data.text + currentChapter.content.substring(end);
                                      handleUpdateContent(newText);
                                      
                                      // Save version after rewrite
                                      await createChapterVersion({
                                        id: Date.now().toString(),
                                        chapterId: currentChapter.id,
                                        content: newText,
                                        wordCount: newText.replace(/\s/g, '').length,
                                        author: 'user',
                                        createdAt: Date.now()
                                      });
                                    } catch (e) {
                                      console.error(e);
                                      alert("改写失败，请稍后重试。");
                                    } finally {
                                      setIsGeneratingContent(false);
                                    }
                                  }}
                                  disabled={isGeneratingContent}
                                  className="flex items-center gap-1.5 px-3 py-1 bg-theme-sidebar text-theme-text rounded-lg text-[10px] font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-all"
                                >
                                  <Sparkles size={10} />
                                  选中改写
                                </button>
                              </div>
                            </div>
                            <textarea 
                              value={currentChapter.sceneBeats || ''}
                              onChange={(e) => {
                                const newBeats = e.target.value;
                                setCurrentChapter(prev => prev ? { ...prev, sceneBeats: newBeats } : null);
                                
                                if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
                                beatsSyncTimeoutRef.current = setTimeout(async () => {
                                  await updateChapter(currentChapter.id, {
                                    sceneBeats: newBeats
                                  });
                                }, 1000);
                              }}
                              placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."
                              className="w-full h-64 bg-theme-sidebar/10 border-none p-0 text-sm text-theme-text placeholder:text-theme-muted/40 outline-none resize-none scrollbar-none font-serif leading-relaxed"
                            />
                          </div>
                          
                          {isGeneratingContent && (
                            <div className="flex items-center justify-center p-4 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 text-xs text-theme-muted gap-2">
                              <Loader2 size={14} className="animate-spin" /> Writer Agent 正在执笔中...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : agentTab === 'quality' ? (
                  <motion.div 
                    key="quality"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                     <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm flex flex-col items-center justify-center text-center">
                        <Bot size={32} className="text-theme-accent mb-3 opacity-80" />
                        <h3 className="text-sm font-bold text-theme-text mb-1">AI 批判性阅读</h3>
                        <p className="text-xs text-theme-muted mb-4 max-w-[200px]">审查当前章节的逻辑漏洞、人物OOC及节奏问题。</p>
                        <button 
                          onClick={handleRunAudit}
                          disabled={isGeneratingCritique || !currentChapter}
                          className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isGeneratingCritique ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareWarning size={16} />}
                          {isGeneratingCritique ? '审计中...\n(这可能需要1分钟)' : 'AI 审计'}
                        </button>
                     </div>

                     {currentChapter?.critique && (
                        <div className="prose prose-sm prose-slate prose-p:leading-relaxed max-w-none bg-red-50/50 p-5 rounded-2xl border border-red-100 shadow-sm">
                          <ReactMarkdown>{currentChapter.critique}</ReactMarkdown>
                        </div>
                      )}
                  </motion.div>
                ) : agentTab === 'bible' ? (
                  <motion.div 
                    key="bible"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                     <div className="sticky top-0 bg-white/50 backdrop-blur z-10 pb-2">
                       <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" size={14} />
                         <input 
                           type="text" 
                           placeholder="检索角色、地点、道具..." 
                           value={bibleSearch}
                           onChange={e => setBibleSearch(e.target.value)}
                           className="w-full pl-9 pr-4 py-2 bg-white border border-theme-border rounded-xl text-sm placeholder:text-theme-muted/50 focus:border-theme-accent outline-none shadow-sm transition-all"
                         />
                       </div>
                     </div>
                     <div className="space-y-3 pb-8">
                       {/* Characters */}
                       {characters.filter(c => c.name.includes(bibleSearch) || c.summary.includes(bibleSearch)).map(char => (
                         <div key={char.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-theme-text">{char.name}</div>
                             <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">角色 - {char.role}</div>
                           </div>
                           <div className="text-xs font-semibold text-theme-accent mb-2">{char.summary}</div>
                           {char.bio && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{char.bio}</div>}
                         </div>
                       ))}
                       {/* Locations */}
                       {locations.filter(l => l.name.includes(bibleSearch) || l.description.includes(bibleSearch)).map(loc => (
                         <div key={loc.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-theme-text">{loc.name}</div>
                             <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">地点</div>
                           </div>
                           <div className="text-xs font-semibold text-theme-accent mb-2">{loc.region}</div>
                           {loc.description && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{loc.description}</div>}
                         </div>
                       ))}
                       {/* Items */}
                       {items.filter(i => i.name.includes(bibleSearch) || i.description.includes(bibleSearch)).map(item => (
                         <div key={item.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-theme-text">{item.name}</div>
                             <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">道具</div>
                           </div>
                           <div className="text-xs font-semibold text-theme-accent mb-2">{item.type}</div>
                           {item.description && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{item.description}</div>}
                         </div>
                       ))}
                       {(characters.length === 0 && locations.length === 0 && items.length === 0) && (
                         <div className="text-center text-xs text-theme-muted opacity-60 p-4 border border-dashed border-theme-border rounded-xl">
                           暂无设定数据，请前往书库添加
                         </div>
                       )}
                     </div>
                  </motion.div>
                ) : agentTab === 'skills' ? (
                  <motion.div 
                    key="skills"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                     {/* Flavor Summary Card */}
                     <div className="bg-theme-text text-white p-5 rounded-3xl shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-theme-accent/20 blur-3xl -mr-10 -mt-10 group-hover:bg-theme-accent/40 transition-all" />
                        <div className="relative z-10">
                          <div className="flex justify-between items-center mb-3">
                            <h3 className="text-xs font-bold uppercase tracking-widest opacity-60">当前叙事 DNA (Narrative DNA)</h3>
                            <div className="flex items-center gap-2">
                               <div className="text-right">
                                 <div className="text-lg font-bold text-theme-accent">
                                   {mountedSkillIds.length > 0 
                                     ? Math.round(librarySkills.filter(s => mountedSkillIds.includes(s.id)).reduce((acc, s) => acc + (s.stabilityScore || 80), 0) / mountedSkillIds.length) 
                                     : 0}%
                                 </div>
                                 <div className="text-[8px] uppercase tracking-tighter opacity-50 font-bold">风格协调度</div>
                               </div>
                            </div>
                          </div>
                          
                          <p className="text-sm font-serif leading-relaxed mb-4 min-h-[40px]">
                            {mountedSkillIds.length === 0 ? (
                              <span className="opacity-40 italic">尚未加载任何文风插件，当前为系统默认笔调...</span>
                            ) : (
                              <>
                                以 <span className="text-theme-accent font-bold underline decoration-theme-accent/30 underline-offset-4">
                                  {librarySkills.find(s => s.id === mountedSkillIds[0])?.name}
                                </span> 为叙事基调，
                                {mountedSkillIds.length > 1 && (
                                  <>融合了 <span className="text-theme-accent font-bold">{librarySkills.find(s => s.id === mountedSkillIds[1])?.name}</span> 的节奏逻辑，</>
                                )}
                                {mountedSkillIds.length > 2 && (
                                  <>并在描写层覆盖了 <span className="text-theme-accent font-bold">{librarySkills.find(s => s.id === mountedSkillIds[2])?.name}</span> 的辞藻色彩。</>
                                )}
                                整体呈现出一种 <span className="text-emerald-400 font-bold">
                                  {librarySkills.filter(s => mountedSkillIds.includes(s.id)).map(s => s.style.split('、')[0]).join('与')}
                                </span> 的独特质感。
                              </>
                            )}
                          </p>

                          <div className="flex gap-2">
                            {[0, 1, 2].map((slotIdx) => {
                              const skillId = mountedSkillIds[slotIdx];
                              const skill = librarySkills.find(s => s.id === skillId);
                              return (
                                <div 
                                  key={slotIdx}
                                  className={cn(
                                    "flex-1 h-14 rounded-xl border border-white/10 flex flex-col items-center justify-center gap-1 transition-all",
                                    skill ? "bg-white/10 border-white/30" : "bg-black/20 border-dashed border-white/10"
                                  )}
                                >
                                  {skill ? (
                                    <>
                                      <div className="text-[10px] font-bold truncate max-w-[80px]">{skill.name}</div>
                                      <div className="w-1 h-1 rounded-full bg-theme-accent shadow-[0_0_8px_white]" />
                                    </>
                                  ) : (
                                    <div className="text-[9px] opacity-30 font-bold uppercase">卡槽 {slotIdx + 1}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                     </div>

                     {/* Library Section */}
                     <div className="space-y-4">
                       <div className="flex justify-between items-center px-1">
                          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">技能仓库 (Skill Deck)</h3>
                          <span className="text-[9px] text-theme-muted bg-theme-sidebar px-2 py-0.5 rounded-full border border-theme-border">
                            容量: {mountedSkillIds.length}/3
                          </span>
                       </div>

                       <div className="grid grid-cols-1 gap-4 pb-12">
                         {librarySkills.map(skill => {
                           const isMounted = mountedSkillIds.includes(skill.id);
                           const slotIndex = mountedSkillIds.indexOf(skill.id);

                           return (
                             <motion.div 
                               key={skill.id} 
                               whileHover={{ y: -4, scale: 1.02 }}
                               onClick={() => {
                                 if (isMounted || mountedSkillIds.length < 3) {
                                   toggleSkillMount(skill.id);
                                 }
                               }}
                               className={cn(
                                 "p-5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden",
                                 isMounted 
                                   ? "bg-gradient-to-br from-theme-accent/10 to-white border-theme-accent shadow-lg shadow-theme-accent/5 ring-1 ring-theme-accent/20" 
                                   : "bg-white border-theme-border/40 hover:border-theme-accent/30 hover:shadow-md"
                               )}
                             >
                               {/* Card Header */}
                               <div className="flex justify-between items-start mb-3">
                                 <div className="flex flex-col">
                                   <div className={cn(
                                     "text-sm font-bold tracking-tight",
                                     isMounted ? "text-theme-accent" : "text-theme-text"
                                   )}>
                                     {skill.name}
                                   </div>
                                   <div className="text-[8px] text-theme-muted uppercase font-bold tracking-tighter">
                                     v{skill.version || 1} · Style Blueprint
                                   </div>
                                 </div>
                                 <div className="text-right">
                                   <div className={cn("text-xs font-black", isMounted ? "text-theme-accent" : "text-theme-muted")}>
                                     {skill.stabilityScore}%
                                   </div>
                                   <div className="text-[7px] text-theme-muted uppercase font-bold">Stability</div>
                                 </div>
                               </div>

                               {/* Description */}
                               <p className="text-[10px] text-theme-muted line-clamp-2 leading-relaxed mb-4 min-h-[2.4em]">
                                 {skill.description}
                               </p>

                               {/* Footer Badges */}
                               <div className="flex justify-between items-center">
                                 <div className="flex gap-1.5">
                                   <span className="text-[9px] px-2 py-0.5 bg-theme-sidebar rounded-full text-theme-muted border border-theme-border/30 font-medium">
                                     {skill.style.split('、')[0]}
                                   </span>
                                   <span className="text-[9px] px-2 py-0.5 bg-theme-sidebar rounded-full text-theme-muted border border-theme-border/30 font-medium">
                                     {skill.pacing.substring(0, 4)}...
                                   </span>
                                 </div>
                                 
                                 {isMounted ? (
                                   <div className="flex items-center gap-1 text-[10px] font-bold text-theme-accent">
                                     <span className="text-[8px] opacity-40">SLOT</span> #{slotIndex + 1}
                                   </div>
                                 ) : (
                                   <div className="text-[9px] font-bold text-theme-muted/40 group-hover:text-theme-accent/60 flex items-center gap-1 transition-all">
                                      点击装载 <ChevronRight size={10} />
                                   </div>
                                 )}
                               </div>

                               {/* Visual Polish */}
                               {isMounted && (
                                 <div className="absolute top-0 right-0 w-24 h-24 bg-theme-accent/5 rounded-full -mr-12 -mt-12 blur-2xl" />
                               )}
                             </motion.div>
                           );
                         })}

                         {librarySkills.length === 0 && (
                            <div className="text-center py-16 px-8 border-2 border-dashed border-theme-border/30 rounded-3xl bg-theme-sidebar/10">
                              <Wand2 size={32} className="mx-auto mb-3 opacity-20 text-theme-text" />
                              <p className="text-xs text-theme-muted font-bold">尚未在“拆书工厂”萃取任何 Skill</p>
                              <p className="text-[9px] text-theme-muted/60 mt-1">上传名家文稿，解析其文字灵魂</p>
                            </div>
                         )}
                       </div>
                     </div>
                  </motion.div>
                ) : agentTab === 'versions' ? (
                  <motion.div 
                    key="versions"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                     <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                          <h3 className="text-xs font-bold text-theme-text">章节时光机 (Time Machine)</h3>
                          <button 
                            onClick={() => handleSaveVersion('user')}
                            disabled={!currentChapter || !currentChapter.content}
                            className="text-[10px] bg-theme-text text-white px-2 py-1 rounded shadow-sm hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1"
                          >
                            <Save size={10} /> 存为快照
                          </button>
                        </div>
                        <p className="text-[10px] text-theme-muted">记录每一次重大的 AI 扩写或用户保存。</p>
                     </div>

                     <div className="space-y-3 pb-8">
                       {versions.sort((a, b) => b.createdAt - a.createdAt).map(version => (
                         <div 
                           key={version.id} 
                           className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm relative group overflow-hidden"
                         >
                           <div className="flex justify-between items-start mb-2">
                             <div>
                               <div className="text-[10px] font-bold text-theme-accent uppercase">
                                 {version.author === 'writer-agent' ? '🤖 AI 辅笔' : '👤 手动存档'}
                               </div>
                               <div className="text-[9px] text-theme-muted">
                                 {new Date(version.createdAt).toLocaleString()}
                               </div>
                             </div>
                             <button 
                               onClick={() => handleRestoreVersion(version)}
                               className="px-2 py-1 bg-theme-bg text-theme-text text-[9px] font-bold rounded border border-theme-border hover:bg-theme-sidebar transition-colors"
                             >
                               还原此版本
                             </button>
                           </div>
                           <div className="text-[10px] text-theme-muted line-clamp-3 leading-relaxed bg-theme-sidebar/10 p-2 rounded italic">
                             {version.content.substring(0, 150)}...
                           </div>
                           <div className="mt-2 text-[9px] font-medium text-theme-muted/60">
                             字数: {version.wordCount}
                           </div>
                         </div>
                       ))}

                       {versions.length === 0 && (
                          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
                             暂无历史版本记录
                          </div>
                       )}
                     </div>
                  </motion.div>
                ) : (
                   <motion.div 
                    key="trace"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                     <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
                             <Search size={14} className="text-theme-accent" />
                             本章设定嗅探器 (Entity Sniper)
                          </h3>
                        </div>
                        <p className="text-[10px] text-theme-muted leading-relaxed mb-4">
                          扫描本章分镜与正文，自动抓取出场人物、地点与道具，并与设定库进行比对。
                        </p>
                        
                        <button 
                          onClick={handleSniffEntities}
                          disabled={!currentChapter || isSniffing}
                          className="w-full py-2 bg-theme-accent text-white rounded-xl text-[10px] font-bold shadow-sm hover:bg-theme-accent/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isSniffing ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />} 
                          {isSniffing ? '正在全息扫描...' : '立即嗅探本章实体'}
                        </button>
                     </div>

                     {sniffedEntities && (
                       <div className="space-y-4 pb-8">
                         {/* Active Existing Entities */}
                         <div className="bg-white rounded-xl border border-theme-border p-4 shadow-sm">
                           <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
                             <CheckCircle2 size={12} className="text-emerald-500" /> 
                             已入库活跃实体 ({sniffedEntities.activeExisting.length})
                           </h4>
                           {sniffedEntities.activeExisting.length === 0 ? (
                             <div className="text-[9px] text-theme-muted italic">本章未提及存量设定。</div>
                           ) : (
                             <div className="flex flex-wrap gap-1.5">
                               {sniffedEntities.activeExisting.map((name: string, i: number) => (
                                 <span key={i} className="text-[9px] px-2 py-1 bg-theme-sidebar border border-theme-border rounded hover:bg-theme-border/30 cursor-default transition-colors">
                                   {name}
                                 </span>
                               ))}
                             </div>
                           )}
                           <p className="text-[8px] text-theme-muted mt-3">
                             * 这些对象将被自动注入到本章的生成上下文（Pruning）。
                           </p>
                         </div>

                         {/* New Suspicious Entities */}
                         <div className="bg-white rounded-xl border border-theme-border p-4 shadow-sm">
                           <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
                             <AlertCircle size={12} className="text-amber-500" /> 
                             未记录野生实体 ({sniffedEntities.newEntities.length})
                           </h4>
                           {sniffedEntities.newEntities.length === 0 ? (
                             <div className="text-[9px] text-theme-muted italic">未发现新增“野生”设定。</div>
                           ) : (
                             <div className="space-y-2.5">
                               {sniffedEntities.newEntities.map((ent: any, i: number) => (
                                 <div key={i} className="flex flex-col gap-1.5 p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg group">
                                   <div className="flex justify-between items-center">
                                     <span className="text-[10px] font-bold text-amber-900">{ent.name}</span>
                                     <span className="text-[8px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded uppercase font-bold tracking-wider">
                                       {ent.type}
                                     </span>
                                   </div>
                                   <p className="text-[9px] text-amber-800/80 leading-relaxed">
                                     上下文：{ent.context}
                                   </p>
                                   <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                     <button 
                                       onClick={() => handleAddSniffedEntity(ent)} 
                                       disabled={addingEntityNames.includes(ent.name)}
                                       className="text-[10px] flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 rounded shadow-sm font-bold disabled:opacity-50 transition-colors"
                                     >
                                       {addingEntityNames.includes(ent.name) ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                                       {addingEntityNames.includes(ent.name) ? '正在生成词条...' : '添加到 World Bible'}
                                     </button>
                                   </div>
                                 </div>
                               ))}
                             </div>
                           )}
                         </div>
                       </div>
                     )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Bottom Status Bar */}
      <div className="h-8 bg-white border-t border-theme-border px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[10px] text-theme-muted">
            <BookOpen size={10} className="text-theme-accent" />
            <span className="font-bold">世界观已就位</span>
          </div>
          <div className="h-3 w-[1px] bg-theme-border/50" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-theme-muted">挂载技能:</span>
            <div className="flex gap-1">
              {librarySkills.filter(s => mountedSkillIds.includes(s.id)).map(s => (
                <span key={s.id} className="text-[9px] px-1.5 py-0.5 bg-theme-accent/10 text-theme-accent rounded-full border border-theme-accent/20 font-bold">
                  {s.name}
                </span>
              ))}
              {mountedSkillIds.length === 0 && <span className="text-[9px] text-theme-muted/40 italic">未挂载任何文风插件</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-theme-muted font-medium">
          <span>
            预计 token 消耗: <span className="text-theme-accent font-bold">~2.4k</span>
          </span>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>AI 核心已连接</span>
          </div>
        </div>
      </div>
    </div>
  );
}
