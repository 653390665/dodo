import React, { useState, useEffect } from 'react';
import { Character, Location, Item, Novel, TimelineEvent, Faction, PowerLevel, SetupTaskDraft, StoryIdeaCard, ContinuationPack } from '../types';
import {
  listCharacters, createCharacter, updateCharacter, deleteCharacter,
  listLocations, createLocation, updateLocation, deleteLocation,
  listItems, createItem, updateItem, deleteItem,
  listFactions, createFaction, updateFaction, deleteFaction,
  listPowerLevels, createPowerLevel, updatePowerLevel, deletePowerLevel,
  listTimelineEvents, createTimelineEvent, updateTimelineEvent, deleteTimelineEvent,
} from '../lib/world-client';
import { listContinuationPacks } from '../lib/continuation-client';
import { updateNovel } from '../lib/novel-client';
import { subscribeToChanges } from '../lib/db-transport';import Users from 'lucide-react/dist/esm/icons/users.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Zap from 'lucide-react/dist/esm/icons/zap.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from '../lib/motion';
import { extractWorldSetupPhase } from '../lib/agents';
import { buildContinuationOverviewState } from '../lib/continuation-overview';
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { SetupTaskCard } from './onboarding/SetupTaskCard';
import { SetupAssistantPanel } from './onboarding/SetupAssistantPanel';
import { ContinuationOverviewPanel } from './ContinuationOverviewPanel';
import { ContinuationPackView } from './ContinuationPackView';

export function WorldBibleView({
  novel,
  onboarding,
  onStartContinuationWriting,
  onEnterStoryboard,
}: {
  novel: Novel;
  onboarding?: {
    card?: StoryIdeaCard;
    tasks: SetupTaskDraft[];
    activeTask?: SetupTaskDraft;
    onSelectTask: (key: SetupTaskDraft['key']) => void;
    onConfirmTask: (key: SetupTaskDraft['key']) => void;
    assistantInput: string;
    onAssistantInputChange: (value: string) => void;
    onAssistantSubmit: () => void;
    assistantLoading: boolean;
    completedCount: number;
    canEnterEditor: boolean;
    onEnterEditor: () => void;
    recommendedSkills: Array<{
      skillId: string;
      skillName: string;
      reason: string;
    }>;
    acceptedRecommendedSkills: boolean;
    onAcceptRecommendedSkills: () => void;
  };
  onStartContinuationWriting?: (approvedPackId: string, prefillIntent?: string) => void;
  onEnterStoryboard?: (approvedPackId: string, continuationTask?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pack-management' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline'>('overview');
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [requestedReviewPackId, setRequestedReviewPackId] = useState<string | null>(null);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);

  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [worldRules, setWorldRules] = useState(novel.worldRules || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [generatingBioIds, setGeneratingBioIds] = useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const [characters, locations, items, timelineEvents, factions, powerLevels, packs] = await Promise.all([
        listCharacters(novel.id),
        listLocations(novel.id),
        listItems(novel.id),
        listTimelineEvents(novel.id),
        listFactions(novel.id),
        listPowerLevels(novel.id),
        listContinuationPacks(novel.id),
      ]);
      setCharacters(characters);
      setLocations(locations);
      setItems(items);
      setTimelineEvents(timelineEvents);
      setFactions(factions);
      setPowerLevels(powerLevels);
      setContinuationPacks(packs);
      setGlobalOutline(novel.globalOutline || '');
      setWorldRules(novel.worldRules || '');
    };
    fetchAll();
    return subscribeToChanges(fetchAll);
  }, [novel]);

  const saveGlobalInfo = async () => {
    setIsSaving(true);
    await updateNovel(novel.id, { globalOutline, worldRules });
    setIsSaving(false);
  };

  const addEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel') => {
    const now = Date.now();
    const id = now.toString();
    if (type === 'character') {
      await createCharacter({ id, novelId: novel.id, name: '新人物', role: 'supporting', summary: '', traits: [], bio: '', createdAt: now, updatedAt: now });
    } else if (type === 'location') {
      await createLocation({ id, novelId: novel.id, name: '新地点', region: '未知区域', description: '', createdAt: now, updatedAt: now });
    } else if (type === 'item') {
      await createItem({ id, novelId: novel.id, name: '新道具', type: '普通道具', description: '', createdAt: now, updatedAt: now });
    } else if (type === 'timeline') {
      const highestOrder = timelineEvents.length > 0 ? Math.max(...timelineEvents.map(e => e.order)) : 0;
      await createTimelineEvent({ id, novelId: novel.id, title: '新事件', description: '', timestamp: '未知时间', statusTag: '发生中', order: highestOrder + 1, createdAt: now, updatedAt: now });
    } else if (type === 'faction') {
      await createFaction({ id, novelId: novel.id, name: '新势力', leader: '未知', territory: '未知', description: '', createdAt: now, updatedAt: now });
    } else if (type === 'powerLevel') {
      const highestTier = powerLevels.length > 0 ? Math.max(...powerLevels.map(e => e.tier)) : 0;
      await createPowerLevel({ id, novelId: novel.id, name: '新境界', tier: highestTier + 1, characteristics: '', description: '', createdAt: now, updatedAt: now });
    }
  };

  const deleteEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string) => {
    if (type === 'character') await deleteCharacter(id);
    else if (type === 'location') await deleteLocation(id);
    else if (type === 'item') await deleteItem(id);
    else if (type === 'timeline') await deleteTimelineEvent(id);
    else if (type === 'faction') await deleteFaction(id);
    else if (type === 'powerLevel') await deletePowerLevel(id);
  };

  const updateEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string, data: any) => {
    if (type === 'character') await updateCharacter(id, data);
    else if (type === 'location') await updateLocation(id, data);
    else if (type === 'item') await updateItem(id, data);
    else if (type === 'timeline') await updateTimelineEvent(id, data);
    else if (type === 'faction') await updateFaction(id, data);
    else if (type === 'powerLevel') await updatePowerLevel(id, data);
  };

  const handleGenerateBio = async (char: Character) => {
    if (!char.name || char.name === '新人物') {
      alert("请先设置角色姓名");
      return;
    }

    setGeneratingBioIds(prev => [...prev, char.id]);
    try {
      const response = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...char, globalOutline, worldRules })
      });
      const data = await response.json();
      if (data.bio) {
        updateEntity('character', char.id, { bio: data.bio });
      }
    } catch (err) {
      console.error(err);
      alert("生物生成失败，请重试");
    } finally {
      setGeneratingBioIds(prev => prev.filter(id => id !== char.id));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const result = event.target?.result as string;
          const base64Data = result.split(',')[1];

          const response = await fetch('/api/parse-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              filedata: base64Data
            })
          });

          if (!response.ok) throw new Error("Upload failed.");
          const extracted = await response.json();

          const newGlobalOutline = extracted.globalOutline || globalOutline;
          const newWorldRules = extracted.worldRules || worldRules;

          await updateNovel(novel.id, {
            globalOutline: newGlobalOutline,
            worldRules: newWorldRules
          });
          setGlobalOutline(newGlobalOutline);
          setWorldRules(newWorldRules);

          if (extracted.characters && Array.isArray(extracted.characters)) {
            for (const char of extracted.characters) {
              await createCharacter({ ...char, id: Date.now().toString(), traits: char.traits || [], novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          if (extracted.locations && Array.isArray(extracted.locations)) {
            for (const loc of extracted.locations) {
              await createLocation({ ...loc, id: Date.now().toString(), novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          if (extracted.items && Array.isArray(extracted.items)) {
            for (const item of extracted.items) {
              await createItem({ ...item, id: Date.now().toString(), novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          if (extracted.factions && Array.isArray(extracted.factions)) {
            for (const faction of extracted.factions) {
              await createFaction({ ...faction, id: Date.now().toString(), novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          if (extracted.powerLevels && Array.isArray(extracted.powerLevels)) {
            for (const pl of extracted.powerLevels) {
              await createPowerLevel({ ...pl, id: Date.now().toString(), novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          if (extracted.timelineEvents && Array.isArray(extracted.timelineEvents)) {
            for (const evt of extracted.timelineEvents) {
              await createTimelineEvent({ ...evt, id: Date.now().toString(), novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
            }
          }

          alert("设定文档导入解析成功！");
        } catch (err) {
          console.error(err);
          alert("导入失败，文档格式不正确或解析出错");
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert("导入失败，文档格式不正确或解析出错");
      setIsImporting(false);
    }
  };

  const overviewState = buildContinuationOverviewState(continuationPacks);
  const tabs = [
    { id: 'overview', icon: FileText, label: '总览' },
    { id: 'pack-management', icon: Upload, label: '资料包管理' },
    { id: 'global', icon: BookOpen, label: '世界设定' },
    { id: 'characters', icon: Users, label: '人物档案' },
    { id: 'locations', icon: MapPin, label: '地点副本' },
    { id: 'items', icon: Package, label: '道具设定' },
    { id: 'factions', icon: Shield, label: '势力设定' },
    { id: 'powerLevels', icon: Zap, label: '力量体系' },
    { id: 'timeline', icon: Clock, label: '纪元与时间线' },
  ] as const;

  if (onboarding) {
    return (
      <div className="h-full flex flex-col bg-transparent">
        <header className="px-8 py-6 border-b border-theme-border flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
              <Globe className="text-theme-accent" />
              设定记忆引导
            </h1>
            <p className="text-sm text-theme-muted mt-1">先把这部作品的骨架立住，再进入正式创作舞台。</p>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-theme-text">{onboarding.completedCount} / 3 项核心设定已确认</div>
            <p className="mt-1 text-xs text-theme-muted">
              至少确认 3 项后即可进入正文写作
            </p>
          </div>
        </header>

        <div className="px-8 py-5 border-b border-theme-border/60 bg-theme-bg/40">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-bold text-theme-text">当前阶段：故事方案已选，正在补全设定骨架</span>
            <span className="text-theme-muted">{Math.min(onboarding.completedCount, 3)} / 3</span>
          </div>
          <div className="h-2 rounded-full bg-theme-sidebar">
            <div
              className="h-2 rounded-full bg-theme-accent transition-all"
              style={{ width: `${Math.min((onboarding.completedCount / 3) * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden px-8 py-8 relative">
          <div className="h-full">
            <section className="h-full overflow-y-auto pr-1">
              <div className="mb-5">
                <h2 className="text-2xl font-serif font-bold text-theme-text">关键设定任务</h2>
                <p className="mt-1 text-sm text-theme-muted">左侧确认故事骨架，右侧随时插话干预设定走向。</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {onboarding.tasks.map((task) => (
                  <SetupTaskCard
                    key={task.key}
                    task={task}
                    active={task.key === onboarding.activeTask?.key}
                    onSelect={() => onboarding.onSelectTask(task.key)}
                    onConfirm={() => onboarding.onConfirmTask(task.key)}
                  />
                ))}
              </div>
              <div className="mt-6 rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
                {onboarding.recommendedSkills.length > 0 && (
                  <div className="mb-5 rounded-2xl border border-theme-border bg-theme-bg/40 p-4">
                    <div className="mb-3">
                      <h3 className="text-base font-serif font-bold text-theme-text">推荐 Skill 装配</h3>
                      <p className="mt-1 text-sm text-theme-muted">基于你选中的故事方案，先给这部作品挂上最顺手的 3 张卡。</p>
                    </div>
                    <div className="space-y-3">
                      {onboarding.recommendedSkills.slice(0, 3).map((skill) => (
                        <div key={skill.skillId} className="rounded-2xl border border-theme-border/70 bg-white px-4 py-3">
                          <div className="text-sm font-bold text-theme-text">{skill.skillName}</div>
                          <p className="mt-1 text-xs leading-5 text-theme-muted">{skill.reason}</p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={onboarding.onAcceptRecommendedSkills}
                      disabled={onboarding.acceptedRecommendedSkills}
                      className="mt-4 w-full rounded-full bg-theme-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {onboarding.acceptedRecommendedSkills ? '已装配推荐 Skill' : '一键接受推荐 Skill'}
                    </button>
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-serif font-bold text-theme-text">放行到创作舞台</h3>
                    <p className="mt-1 text-sm text-theme-muted">
                      {onboarding.canEnterEditor
                        ? '骨架已经够稳，可以带着这套设定进入正文。'
                        : `还差 ${Math.max(3 - onboarding.completedCount, 0)} 项核心设定确认。`}
                    </p>
                  </div>
                  <button
                    onClick={onboarding.onEnterEditor}
                    disabled={!onboarding.canEnterEditor}
                    className="rounded-full bg-theme-accent px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    进入创作舞台
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Floating entry for Setup Assistant */}
          {!isAssistantOpen && (
            <button
              onClick={() => setIsAssistantOpen(true)}
              className="fixed bottom-8 right-8 z-40 flex items-center gap-2 rounded-full bg-theme-accent px-6 py-3 font-bold text-white shadow-xl transition-all hover:scale-105 active:scale-95 group"
            >
              <Sparkles size={18} className="group-hover:animate-pulse" />
              设定助手
            </button>
          )}

          {/* Setup Assistant Drawer */}
          <AnimatePresence>
            {isAssistantOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsAssistantOpen(false)}
                  className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[2px]"
                />
                <motion.div
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="fixed right-0 top-0 z-50 h-full w-[420px] max-w-[90vw] border-l border-theme-border bg-white shadow-2xl"
                >
                  <SetupAssistantPanel
                    selectedTask={onboarding.activeTask}
                    summaryCard={onboarding.card}
                    textareaValue={onboarding.assistantInput}
                    onTextareaChange={onboarding.onAssistantInputChange}
                    onSubmit={onboarding.onAssistantSubmit}
                    submitting={onboarding.assistantLoading}
                    onClose={() => setIsAssistantOpen(false)}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-transparent">
      <header className="px-8 py-6 border-b border-theme-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
            <Globe className="text-theme-accent" />
            设定与续写
          </h1>
          <p className="text-sm text-theme-muted mt-1">先看当前续写状态，再进入资料包管理或设定资产维护。</p>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".txt,.md,.json,.docx"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-4 py-2 bg-theme-bg border border-theme-border/80 text-theme-text rounded-xl shadow-sm hover:bg-theme-sidebar transition-all font-medium text-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isImporting ? 'AI 解析中...' : '智能导入设定文档'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-56 border-r border-theme-border/50 bg-white flex flex-col py-4 px-3 shrink-0 gap-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
                activeTab === tab.id
                  ? "bg-theme-accent text-white shadow-md shadow-theme-accent/20"
                  : "text-theme-muted hover:bg-theme-sidebar/50 hover:text-theme-text hover:translate-x-1"
              )}
              >
                <tab.icon size={18} />
                {tab.label}
                <span className="ml-auto text-xs opacity-60">
                  {tab.id === 'pack-management' && continuationPacks.length}
                  {tab.id === 'characters' && characters.length}
                  {tab.id === 'locations' && locations.length}
                  {tab.id === 'items' && items.length}
                {tab.id === 'timeline' && timelineEvents.length}
              </span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
                <ContinuationOverviewPanel
                  state={overviewState}
                  onImport={() => setActiveTab('pack-management')}
                  onReviewDraft={(packId) => {
                    setRequestedReviewPackId(packId);
                    setActiveTab('pack-management');
                  }}
                  onOpenPackManagement={() => setActiveTab('pack-management')}
                  onOpenWorldSetup={() => setActiveTab('global')}
                  onStartWriting={(packId) => onStartContinuationWriting?.(packId)}
                  onStartStoryboard={(packId, prefillIntent) => {
                    const pack = continuationPacks.find((p) => p.id === packId);
                    onEnterStoryboard?.(packId, prefillIntent || (pack ? buildCreationIntentDraft(pack) : undefined));
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'global' && (
              <motion.div key="global" initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="max-w-4xl mx-auto space-y-8">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-theme-border/50">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-theme-text">故事大纲 (Global Outline)</h2>
                    <button onClick={saveGlobalInfo} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-theme-accent text-white rounded-lg text-sm transition-all hover:bg-theme-accent/90 shadow-sm">{isSaving ? '保存中...' : <><Save size={16}/>保存全局设定</>}</button>
                  </div>
                  <textarea
                    value={globalOutline}
                    onChange={e => setGlobalOutline(e.target.value)}
                    placeholder="描述小说的起承转合、主线任务、结局走向..."
                    className="w-full h-64 p-4 rounded-xl border border-theme-border/50 focus:border-theme-accent outline-none font-serif resize-none"
                  />
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-theme-border/50">
                  <h2 className="text-lg font-bold text-theme-text mb-4">世界观法则 (World Rules)</h2>
                  <textarea
                    value={worldRules}
                    onChange={e => setWorldRules(e.target.value)}
                    placeholder="例如：修仙体系境界、魔法运转原理、科技文明等级..."
                    className="w-full h-48 p-4 rounded-xl border border-theme-border/50 focus:border-theme-accent outline-none font-serif resize-none"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'timeline' && (
              <motion.div key="timeline" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-4xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">纪元与时间线</h2>
                  <button onClick={() => addEntity('timeline')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增时间节点</button>
                </div>
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-theme-border before:to-transparent">
                  {timelineEvents.map((evt, idx) => (
                    <div key={evt.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group border-none">
                      {/* Timeline Dot */}
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-theme-accent text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 mx-auto absolute left-0 md:left-1/2 transform -translate-x-0 cursor-move">
                         <span className="text-xs font-bold">{idx + 1}</span>
                      </div>

                      {/* Event Card */}
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] ml-14 md:ml-0 bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 relative transition-all hover:shadow-md hover:border-theme-accent/50 z-10">
                        <button onClick={()=>deleteEntity('timeline', evt.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>

                        <div className="flex flex-wrap items-center gap-2 pr-8">
                          <input
                            value={evt.timestamp}
                            onChange={e=>updateEntity('timeline', evt.id, {timestamp: e.target.value})}
                            className="font-mono text-sm font-bold text-theme-accent bg-theme-accent/10 px-2 py-1 rounded w-32 outline-none focus:bg-theme-accent/20 transition-colors"
                            placeholder="如: 第一纪元"
                          />
                          <input
                            value={evt.statusTag || ''}
                            onChange={e=>updateEntity('timeline', evt.id, {statusTag: e.target.value})}
                            className="font-bold text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded w-24 outline-none focus:ring-1 focus:ring-amber-300"
                            placeholder="状态:进行中"
                          />
                        </div>

                        <input
                          value={evt.title}
                          onChange={e=>updateEntity('timeline', evt.id, {title: e.target.value})}
                          className="font-bold text-lg outline-none w-full bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -ml-1 mt-1"
                          placeholder="大事件名称"
                        />

                        <textarea
                          value={evt.description}
                          onChange={e=>updateEntity('timeline', evt.id, {description: e.target.value})}
                          placeholder="事件详细描述、影响、关联人物..."
                          className="text-sm outline-none resize-none h-24 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border leading-relaxed"
                        />

                        {/* Fast Reorder Actions */}
                        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 flex items-center bg-white shadow-sm border border-theme-border/50 rounded-full px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                          <button
                            onClick={() => {
                              if (idx > 0) {
                                const prev = timelineEvents[idx - 1];
                                updateEntity('timeline', evt.id, {order: prev.order});
                                updateEntity('timeline', prev.id, {order: evt.order});
                              }
                            }}
                            className="text-[10px] text-theme-text px-2 py-0.5 hover:bg-theme-sidebar rounded"
                          >↑ 前移</button>
                          <span className="text-theme-border">|</span>
                          <button
                            onClick={() => {
                              if (idx < timelineEvents.length - 1) {
                                const next = timelineEvents[idx + 1];
                                updateEntity('timeline', evt.id, {order: next.order});
                                updateEntity('timeline', next.id, {order: evt.order});
                              }
                            }}
                            className="text-[10px] text-theme-text px-2 py-0.5 hover:bg-theme-sidebar rounded"
                          >↓ 后移</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {timelineEvents.length === 0 && (
                     <div className="text-center py-12 text-theme-muted text-sm italic">暂无时间节点，点击“新增时间节点”开始记录。</div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'characters' && (
              <motion.div key="chars" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">登场人物</h2>
                  <button onClick={() => addEntity('character')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增角色</button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
                  {characters.map(char => (
                    <div key={char.id} className="bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('character', char.id)} className="absolute top-4 right-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <input value={char.name} onChange={e=>updateEntity('character', char.id, {name: e.target.value})} className="font-bold text-lg outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1" />
                      <select value={char.role} onChange={e=>updateEntity('character', char.id, {role: e.target.value})} className="w-1/2 p-1 text-sm border-b border-theme-border/50 outline-none -mt-2 bg-transparent">
                        <option value="protagonist">主角</option>
                        <option value="antagonist">反派</option>
                        <option value="supporting">配角</option>
                        <option value="extra">龙套</option>
                      </select>
                      <input value={char.summary} onChange={e=>updateEntity('character', char.id, {summary: e.target.value})} placeholder="一句话简介" className="text-sm outline-none bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -mx-1" />
                      <div className="relative group/bio">
                        <textarea value={char.bio} onChange={e=>updateEntity('character', char.id, {bio: e.target.value})} placeholder="详细背景设定、性格、习惯..." className="w-full text-sm outline-none resize-none h-40 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-accent transition-all font-serif leading-relaxed" />
                        <button
                          onClick={() => handleGenerateBio(char)}
                          disabled={generatingBioIds.includes(char.id)}
                          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-theme-border/50 text-theme-accent text-xs font-bold rounded-lg shadow-sm hover:bg-theme-accent hover:text-white transition-all opacity-0 group-hover/bio:opacity-100 disabled:opacity-50"
                          title="AI 生成背景故事"
                        >
                          {generatingBioIds.includes(char.id) ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          AI 生成背景故事
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'locations' && (
              <motion.div key="locs" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">地点与副本</h2>
                  <button onClick={() => addEntity('location')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增地点</button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
                  {locations.map(loc => (
                    <div key={loc.id} className="bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('location', loc.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <div className="flex items-center gap-3 pr-10">
                        <input value={loc.name} onChange={e=>updateEntity('location', loc.id, {name: e.target.value})} className="font-bold text-lg outline-none w-1/2 bg-transparent focus:bg-theme-sidebar/50 rounded px-1" />
                        <span className="text-theme-muted/50">—</span>
                        <input value={loc.region} onChange={e=>updateEntity('location', loc.id, {region: e.target.value})} className="text-sm outline-none w-1/3 bg-transparent text-theme-accent focus:bg-theme-sidebar/50 rounded px-1" placeholder="所属区域" />
                      </div>
                      <textarea value={loc.description} onChange={e=>updateEntity('location', loc.id, {description: e.target.value})} placeholder="环境描写、危险等级、掉落物品、隐藏线索..." className="text-sm outline-none resize-none h-32 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border mt-2" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'items' && (
              <motion.div key="items" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">道具与物品</h2>
                  <button onClick={() => addEntity('item')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增道具</button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6">
                  {items.map(item => (
                    <div key={item.id} className="bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('item', item.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <input value={item.name} onChange={e=>updateEntity('item', item.id, {name: e.target.value})} className="font-bold text-[17px] outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1" />
                      <input value={item.type} onChange={e=>updateEntity('item', item.id, {type: e.target.value})} className="text-xs text-theme-accent outline-none w-1/2 bg-theme-accent/10 px-2 py-1 rounded-full text-center focus:bg-theme-accent/20 transition-colors" placeholder="道具类型(例如: 法器)" />
                      <textarea value={item.description} onChange={e=>updateEntity('item', item.id, {description: e.target.value})} placeholder="作用、来历、使用代价..." className="text-sm outline-none resize-none h-28 bg-theme-sidebar/10 p-2 rounded-lg border border-theme-border/30 focus:border-theme-border mt-2" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'factions' && (
              <motion.div key="factions" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">势力设定</h2>
                  <button onClick={() => addEntity('faction')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增势力</button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
                  {factions.map(faction => (
                    <div key={faction.id} className="bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('faction', faction.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <input value={faction.name} onChange={e=>updateEntity('faction', faction.id, {name: e.target.value})} className="font-bold text-lg outline-none w-1/2 bg-transparent focus:bg-theme-sidebar/50 rounded px-1" />
                      <div className="flex gap-2">
                        <input value={faction.leader} onChange={e=>updateEntity('faction', faction.id, {leader: e.target.value})} className="text-sm font-bold outline-none w-1/2 bg-theme-sidebar border-b border-theme-border focus:border-theme-accent px-2 py-1 rounded" placeholder="首领/重要成员" />
                        <input value={faction.territory} onChange={e=>updateEntity('faction', faction.id, {territory: e.target.value})} className="text-sm outline-none w-1/2 bg-theme-sidebar border-b border-theme-border focus:border-theme-accent px-2 py-1 rounded" placeholder="据点/势力范围" />
                      </div>
                      <textarea value={faction.description} onChange={e=>updateEntity('faction', faction.id, {description: e.target.value})} placeholder="势力背景、组织架构、行事风格..." className="text-sm outline-none resize-none h-32 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border mt-2" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'pack-management' && (
              <motion.div key="pack-management" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ContinuationPackView novel={novel} initialActivePackId={requestedReviewPackId} />
              </motion.div>
            )}

            {activeTab === 'powerLevels' && (
              <motion.div key="powerLevels" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-theme-text font-serif">境界/力量体系</h2>
                  <button onClick={() => addEntity('powerLevel')} className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"><Plus size={16}/>新增境界</button>
                </div>
                <div className="flex flex-col gap-4">
                  {powerLevels.map((lvl, idx) => (
                    <div key={lvl.id} className="bg-white p-5 rounded-2xl border border-theme-border/50 shadow-sm flex items-start gap-4 group relative">
                      <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                        <span className="w-8 h-8 flex items-center justify-center bg-theme-sidebar text-theme-accent font-bold rounded-full bg-theme-accent/10">{lvl.tier}</span>
                        <div className="flex gap-1 text-[10px]">
                          <button onClick={() => updateEntity('powerLevel', lvl.id, {tier: lvl.tier - 1})} className="text-theme-muted hover:text-theme-accent disabled:opacity-30">↑</button>
                          <button onClick={() => updateEntity('powerLevel', lvl.id, {tier: lvl.tier + 1})} className="text-theme-muted hover:text-theme-accent disabled:opacity-30">↓</button>
                        </div>
                      </div>
                      <div className="flex-1 flex flex-col gap-2 relative">
                        <button onClick={()=>deleteEntity('powerLevel', lvl.id)} className="absolute top-0 right-0 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                        <input value={lvl.name} onChange={e=>updateEntity('powerLevel', lvl.id, {name: e.target.value})} className="font-bold text-xl outline-none w-1/3 bg-transparent focus:bg-theme-sidebar/50 rounded px-1" placeholder="境界名称 (例如: 筑基期)" />
                        <input value={lvl.characteristics} onChange={e=>updateEntity('powerLevel', lvl.id, {characteristics: e.target.value})} className="text-sm font-medium text-theme-accent outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -mx-1" placeholder="阶段特征 (例如: 寿元三百，可御空飞行)" />
                        <textarea value={lvl.description} onChange={e=>updateEntity('powerLevel', lvl.id, {description: e.target.value})} placeholder="详细说明该等级的力量表现、突破条件等..." className="text-sm outline-none resize-none h-20 bg-theme-sidebar/10 p-2 rounded-lg border border-theme-border/30 focus:border-theme-border" />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
