import React, { useState, useEffect } from 'react';
import { BookOpen, Clock, FileText, Globe, Loader2, MapPin, Package, Save, Scroll, Shield, Upload, Users, Zap, GitBranch } from 'lucide-react';
import { Character, Location, Item, Novel, TimelineEvent, Faction, PowerLevel, SetupTaskDraft, StoryIdeaCard, ContinuationPack, ProjectPreferenceProfile, EntityRelationship } from '../../shared/types';
import { StoryContractPanel } from './StoryContractPanel';
import {
  listCharacters, createCharacter, updateCharacter, deleteCharacter,
  listLocations, createLocation, updateLocation, deleteLocation,
  listItems, createItem, updateItem, deleteItem,
  listFactions, createFaction, updateFaction, deleteFaction,
  listPowerLevels, createPowerLevel, updatePowerLevel, deletePowerLevel,
  listTimelineEvents, createTimelineEvent, updateTimelineEvent, deleteTimelineEvent,
  listEntityRelationshipsClient,
} from '../lib/world-client';
import { listContinuationPacks } from '../lib/continuation-client';
import { updateNovel } from '../lib/novel-client';
import { subscribeToChanges } from '../lib/db-transport';

import { cn } from '../lib/utils';
import { buildContinuationOverviewState } from '../lib/continuation-overview';
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { WorldBibleOnboarding } from './WorldBibleOnboarding';
import { ContinuationOverviewPanel } from './ContinuationOverviewPanel';
import { ContinuationPackView } from './ContinuationPackView';
import { CharactersTab } from './world-bible/CharactersTab';
import { LocationsTab } from './world-bible/LocationsTab';
import { ItemsTab } from './world-bible/ItemsTab';
import { FactionsTab } from './world-bible/FactionsTab';
import { PowerLevelsTab } from './world-bible/PowerLevelsTab';
import { TimelineTab } from './world-bible/TimelineTab';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction } from './ui/AlertDialog';

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
  const [requestedReviewPackId, setRequestedReviewPackId] = useState<string | null>(null);
  const [showRelationshipAlert, setShowRelationshipAlert] = useState(false);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);

  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [worldRules, setWorldRules] = useState(novel.worldRules || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [generatingBioIds, setGeneratingBioIds] = useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const [characters, locations, items, timelineEvents, factions, powerLevels, packs, relationships] = await Promise.all([
        listCharacters(novel.id),
        listLocations(novel.id),
        listItems(novel.id),
        listTimelineEvents(novel.id),
        listFactions(novel.id),
        listPowerLevels(novel.id),
        listContinuationPacks(novel.id),
        listEntityRelationshipsClient(novel.id),
      ]);
      setCharacters(characters);
      setLocations(locations);
      setItems(items);
      setTimelineEvents(timelineEvents);
      setFactions(factions);
      setPowerLevels(powerLevels);
      setContinuationPacks(packs);
      setRelationships(relationships);
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
    } catch {
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
        } catch {
          alert("导入失败，文档格式不正确或解析出错");
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch {
      alert("导入失败，文档格式不正确或解析出错");
      setIsImporting(false);
    }
  };

  const overviewState = buildContinuationOverviewState(continuationPacks);

  const isWorldBibleEmpty =
    characters.length === 0 &&
    locations.length === 0 &&
    items.length === 0 &&
    factions.length === 0 &&
    powerLevels.length === 0 &&
    timelineEvents.length === 0 &&
    relationships.length === 0;

  const renderColdStart = () => {
    return (
      <div className="max-w-3xl mx-auto py-16 px-6 flex flex-col items-center justify-center text-center space-y-8 bg-transparent">
        <div className="w-16 h-16 bg-theme-accent/10 text-theme-accent rounded-full flex items-center justify-center animate-pulse">
          <Globe size={32} />
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-serif font-black text-theme-text">初始化您的《{novel.title}》设定集</h2>
          <p className="text-sm text-theme-muted max-w-lg leading-relaxed mx-auto">
            当前设定集内空空如也。AI 无法在此嗅探到您笔下世界的人物和规则。推荐通过以下动作快速冷启动，让您的作品拥有丰满的底蕴：
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-4">
          <button
            onClick={async () => {
              await addEntity('character');
              setActiveTab('characters');
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Users size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">添加第一个人物</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">设定主角姓名、身份和背景小传</span>
          </button>

          <button
            onClick={async () => {
              await addEntity('location');
              setActiveTab('locations');
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <MapPin size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">添加第一个地点</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">勾勒故事发生的新手村或世界地理</span>
          </button>

          <button
            onClick={() => {
              const totalEntities = characters.length + locations.length + items.length + factions.length;
              if (totalEntities < 2) {
                setShowRelationshipAlert(true);
              } else {
                setActiveTab('characters');
              }
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <GitBranch size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">建立第一条关系</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">关联主角与配角的爱恨情仇或阵营归属</span>
          </button>
        </div>

        <div className="pt-6 text-xs text-theme-muted">
          或者您也可以点击右上角的 <strong className="text-theme-text font-bold">“智能导入设定文档”</strong>，由 AI 为您一键完成大纲与设定的多层析拆解。
        </div>
      </div>
    );
  };
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
    return <WorldBibleOnboarding onboarding={onboarding} />;
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
          {isWorldBibleEmpty &&
          activeTab !== 'pack-management' &&
          activeTab !== 'contract' &&
          activeTab !== 'global' ? (
            renderColdStart()
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      <AlertDialog open={showRelationshipAlert} onOpenChange={setShowRelationshipAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>无法建立关系</AlertDialogTitle>
            <AlertDialogDescription>
              请先添加至少两个设定实体（如人物或地点），然后才能在对应档案中建立它们之间的关系。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => {
              setShowRelationshipAlert(false);
              setActiveTab('characters');
            }}>去添加人物</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
