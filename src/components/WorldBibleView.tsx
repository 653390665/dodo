import React, { useState, useEffect } from 'react';
import { BookOpen, Clock, FileText, Globe, Loader2, MapPin, Package, Plus, Save, Scroll, Shield, Sparkles, Trash2, Upload, Users, Zap } from 'lucide-react';
import { Character, Location, Item, Novel, TimelineEvent, Faction, PowerLevel, SetupTaskDraft, StoryIdeaCard, ContinuationPack, ProjectPreferenceProfile } from '../../shared/types';
import { StoryContractPanel } from './StoryContractPanel';
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
import { subscribeToChanges } from '../lib/db-transport';

import { cn } from '../lib/utils';
import { extractWorldSetupPhase } from '../lib/agents';
import { buildContinuationOverviewState } from '../lib/continuation-overview';
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { SetupTaskCard } from './onboarding/SetupTaskCard';
import { SetupAssistantPanel } from './onboarding/SetupAssistantPanel';
import { ContinuationOverviewPanel } from './ContinuationOverviewPanel';
import { ContinuationPackView } from './ContinuationPackView';
import { CharactersTab } from './world-bible/CharactersTab';
import { LocationsTab } from './world-bible/LocationsTab';
import { ItemsTab } from './world-bible/ItemsTab';
import { FactionsTab } from './world-bible/FactionsTab';
import { PowerLevelsTab } from './world-bible/PowerLevelsTab';
import { TimelineTab } from './world-bible/TimelineTab';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'pack-management' | 'contract' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline'>('overview');
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
    { id: 'contract', icon: Scroll, label: '写作合同' },
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
              <div className="mt-6 rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
                {onboarding.recommendedSkills.length > 0 && (
                  <div className="mb-5 rounded-2xl border border-theme-border bg-theme-bg/40 p-4">
                    <div className="mb-3">
                      <h3 className="text-base font-serif font-bold text-theme-text">推荐 Skill 装配</h3>
                      <p className="mt-1 text-sm text-theme-muted">基于你选中的故事方案，先给这部作品挂上最顺手的 3 张卡。</p>
                    </div>
                    <div className="space-y-3">
                      {onboarding.recommendedSkills.slice(0, 3).map((skill) => (
                        <div key={skill.skillId} className="rounded-2xl border border-theme-border/70 bg-theme-sidebar px-4 py-3">
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
          {isAssistantOpen && (
              <>
                <div
                  onClick={() => setIsAssistantOpen(false)}
                  className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[2px]"
                />
                <div
                  className="fixed right-0 top-0 z-50 h-full w-[420px] max-w-[90vw] border-l border-theme-border bg-theme-sidebar shadow-2xl"
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
                </div>
              </>
            )}
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
        <div className="w-56 border-r border-theme-border/50 bg-theme-sidebar flex flex-col py-4 px-3 shrink-0 gap-2">
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
          {activeTab === 'overview' && (
              <div key="overview">
                <ContinuationOverviewPanel
                  state={overviewState}
                  onImport={() => setActiveTab('pack-management')}
                  onReviewDraft={(packId) => {
                    setRequestedReviewPackId(packId);
                    setActiveTab('pack-management');
                  }}
                  onOpenPackManagement={() => setActiveTab('pack-management')}
                  onOpenWorldSetup={() => setActiveTab('global')}
                  onStartWriting={(packId, prefillIntent) => onStartContinuationWriting?.(packId, prefillIntent)}
                  onStartStoryboard={(packId, prefillIntent) => {
                    const pack = continuationPacks.find((p) => p.id === packId);
                    onEnterStoryboard?.(packId, prefillIntent || (pack ? buildCreationIntentDraft(pack) : undefined));
                  }}
                />
              </div>
            )}

            {activeTab === 'global' && (
              <div key="global" className="max-w-4xl mx-auto space-y-8">
                <div className="bg-theme-sidebar rounded-2xl p-6 shadow-sm border border-theme-border/50">
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

                <div className="bg-theme-sidebar rounded-2xl p-6 shadow-sm border border-theme-border/50">
                  <h2 className="text-lg font-bold text-theme-text mb-4">世界观法则 (World Rules)</h2>
                  <textarea
                    value={worldRules}
                    onChange={e => setWorldRules(e.target.value)}
                    placeholder="例如：修仙体系境界、魔法运转原理、科技文明等级..."
                    className="w-full h-48 p-4 rounded-xl border border-theme-border/50 focus:border-theme-accent outline-none font-serif resize-none"
                  />
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <TimelineTab
                timelineEvents={timelineEvents}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
              />
            )}

            {activeTab === 'characters' && (
              <CharactersTab
                characters={characters}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
                handleGenerateBio={handleGenerateBio}
                generatingBioIds={generatingBioIds}
              />
            )}

            {activeTab === 'locations' && (
              <LocationsTab
                locations={locations}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
              />
            )}

            {activeTab === 'items' && (
              <ItemsTab
                items={items}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
              />
            )}

            {activeTab === 'factions' && (
              <FactionsTab
                factions={factions}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
              />
            )}

            {activeTab === 'pack-management' && (
              <div key="pack-management">
                <ContinuationPackView novel={novel} initialActivePackId={requestedReviewPackId} />
              </div>
            )}

            {activeTab === 'contract' && (
              <div key="contract" className="max-w-3xl mx-auto bg-theme-sidebar rounded-2xl border border-theme-border/50 shadow-md">
                <StoryContractPanel
                  contract={novel.projectPreferenceProfile?.contract || null}
                  onSave={async (newContract) => {
                    const updatedProfile: ProjectPreferenceProfile = {
                      contract: newContract,
                      tags: novel.projectPreferenceProfile?.tags || [],
                      weights: novel.projectPreferenceProfile?.weights || {
                        styleWeight: 1,
                        characterWeight: 1,
                        worldWeight: 1,
                        plotWeight: 1,
                        pacingWeight: 1,
                      },
                      acceptedDimensions: novel.projectPreferenceProfile?.acceptedDimensions || [],
                      rejectedDimensions: novel.projectPreferenceProfile?.rejectedDimensions || [],
                      notes: novel.projectPreferenceProfile?.notes || [],
                      evidenceCount: novel.projectPreferenceProfile?.evidenceCount || 0,
                    };
                    await updateNovel(novel.id, {
                      projectPreferenceProfile: updatedProfile,
                    });
                  }}
                  onClose={() => setActiveTab('overview')}
                />
              </div>
            )}

            {activeTab === 'powerLevels' && (
              <PowerLevelsTab
                powerLevels={powerLevels}
                addEntity={addEntity}
                deleteEntity={deleteEntity}
                updateEntity={updateEntity}
              />
            )}
        </div>
      </div>
    </div>
  );
}
