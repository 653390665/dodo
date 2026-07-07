import React, { useState, useEffect } from 'react';
import { BookOpen, Clock, FileText, Globe, Loader2, MapPin, Package, Scroll, Shield, Upload, Users, Zap, GitBranch, Sparkles, Send, Trash2, X, ChevronRight } from 'lucide-react';
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
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction } from './ui/alert-dialog';
import { GlobalSetupTab } from './world-bible/GlobalSetupTab';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'pack-management' | 'contract' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline'>(() => {
    try {
      const saved = localStorage.getItem('inkflow-world-bible-active-tab');
      if (saved) {
        localStorage.removeItem('inkflow-world-bible-active-tab');
        return saved as 'overview' | 'pack-management' | 'contract' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline';
      }
    } catch {}
    return 'overview';
  });
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
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const [helperOpen, setHelperOpen] = useState(true);
  const [helperMessages, setHelperMessages] = useState<Array<{ id: string; sender: 'user' | 'assistant' | 'system'; text: string }>>([
    { id: 'welcome', sender: 'assistant', text: '你好！我是你的“世界设定对话助手”。你可以在这里通过自然语言描述来添加新设定（例如：“帮我设计一个反派黑羽，擅长控虫，性格阴暗”），我会为你生成高一致性的设定属性，并提供一键确认写入的功能！' }
  ]);
  const [helperInput, setHelperInput] = useState('');
  const [helperLoading, setHelperLoading] = useState(false);
  const [draftEntity, setDraftEntity] = useState<{
    type: 'character' | 'location' | 'item' | 'faction' | 'powerLevel' | 'timeline';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
  } | null>(null);

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

  useEffect(() => {
    if (helperOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [helperMessages, helperLoading, helperOpen]);

  const handleSaveGlobalInfo = async (outline: string, rules: string) => {
    setIsSaving(true);
    await updateNovel(novel.id, { globalOutline: outline, worldRules: rules });
    setGlobalOutline(outline);
    setWorldRules(rules);
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

  const updateEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string, data: Record<string, unknown>) => {
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

  const handleHelperSubmit = async () => {
    if (!helperInput.trim() || helperLoading) return;

    const userText = helperInput.trim();
    const newMsgId = Date.now().toString();
    setHelperMessages(prev => [...prev, { id: newMsgId, sender: 'user', text: userText }]);
    setHelperInput('');
    setHelperLoading(true);

    try {
      const contextCharacters = characters.map(c => `- ${c.name} (${c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : '重要配角'}): ${c.summary}`).join('\n');
      const contextFactions = factions.map(f => `- ${f.name} (领袖: ${f.leader}): ${f.description}`).join('\n');
      const contextPowerLevels = powerLevels.map(p => `- ${p.name} (第${p.tier}重): ${p.characteristics}`).join('\n');
      const contextLocations = locations.map(l => `- ${l.name} (区域: ${l.region}): ${l.description}`).join('\n');

      const systemPrompt = `你是一个顶尖的玄幻/科幻/都市小说世界设定设计师，正在作为“世界设定对话助手 (Bible Agent Helper)”协助作者构建他的小说世界《${novel.title}》。

【全局故事大纲】：
${globalOutline || '无'}

【世界观法则】：
${worldRules || '无'}

【已有角色档案简述】：
${contextCharacters || '无'}

【已有势力简述】：
${contextFactions || '无'}

【已有境界简述】：
${contextPowerLevels || '无'}

【已有点位简述】：
${contextLocations || '无'}

请在理解用户意图的基础上：
1. 给出 150 字内富有文学张力、生动活泼且鼓励创意的设定点评或引入回复。
2. 如果用户希望设计/添加全新的角色、地点、道具、势力、境界、时间线事件，你必须为其生成符合下方定义的 JSON。并且用 [JSON_DATA] 和 [/JSON_DATA] 标签包裹。在 [JSON_DATA] 标记中不要有任何其他字符。

JSON 格式规范：
- 角色 (character):
  { "type": "character", "data": { "name": "角色姓名", "role": "protagonist' | 'supporting' | 'antagonist'", "summary": "核心简介", "traits": ["标签1", "标签2"], "bio": "200字以内背景小传" } }
- 地点 (location):
  { "type": "location", "data": { "name": "地点名称", "region": "所属区域", "description": "环境与危机描述" } }
- 道具 (item):
  { "type": "item", "data": { "name": "道具名称", "type": "道具类型/评级", "description": "异能与来历描述" } }
- 势力 (faction):
  { "type": "faction", "data": { "name": "势力名称", "leader": "掌门或宗主姓名", "territory": "势力总部或地盘", "description": "核心传袭或势力背景描述" } }
- 力量境界 (powerLevel):
  { "type": "powerLevel", "data": { "name": "境界名称", "tier": 1, "characteristics": "外显异象或特色", "description": "修行奥秘描述" } }
- 纪元事件 (timeline):
  { "type": "timeline", "data": { "title": "事件名称", "description": "影响与过程描述", "timestamp": "发生纪元或时间点", "statusTag": "未发生' | '发生中' | '已尘封'", "order": 1 } }

只在需要创建新实体时才返回 JSON 包裹体。请注意：在 [JSON_DATA] 前后可放置你对作者说的话。`;

      const response = await fetch('/api/inspiration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\n作者：${userText}`,
          surface: 'workspace-draft'
        })
      });

      if (!response.ok) {
        throw new Error('API request failed');
      }

      const resData = await response.json();
      const text = resData.text || '';

      const jsonRegex = /\[JSON_DATA\]([\s\S]*?)\[\/JSON_DATA\]/;
      const match = text.match(jsonRegex);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedEntity: any = null;

      if (match && match[1]) {
        try {
          const rawJson = match[1].trim();
          parsedEntity = JSON.parse(rawJson);
          if (parsedEntity.type && parsedEntity.data) {
            setDraftEntity({
              type: parsedEntity.type,
              data: parsedEntity.data
            });
          }
        } catch (err) {
          console.error("Failed to parse agent json data:", err);
        }
      }

      let cleanText = text.replace(/\[JSON_DATA\][\s\S]*?\[\/JSON_DATA\]/, '').trim();
      if (!cleanText) {
        if (parsedEntity) {
          cleanText = `✨ 我已为你设计好「${parsedEntity.data.name || parsedEntity.data.title || '新设定'}」！请在右侧设定单中确认和微调，然后一键写入。`;
        } else {
          cleanText = `抱歉，我未能生成有效的设定数据，请重新描述你的需求。`;
        }
      }

      setHelperMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'assistant',
        text: cleanText
      }]);

    } catch (err) {
      console.error(err);
      setHelperMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'system',
        text: '❌ 与小助手连接失败，请检查网络或配置。'
      }]);
    } finally {
      setHelperLoading(false);
    }
  };

  const handleCommitDraftEntity = async () => {
    if (!draftEntity) return;
    const { type, data } = draftEntity;
    const now = Date.now();
    const id = now.toString();

    try {
      if (type === 'character') {
        await createCharacter({
          id,
          novelId: novel.id,
          name: data.name || '未命名人物',
          role: data.role || 'supporting',
          summary: data.summary || '',
          traits: Array.isArray(data.traits) ? data.traits : [],
          bio: data.bio || '',
          createdAt: now,
          updatedAt: now
        });
      } else if (type === 'location') {
        await createLocation({
          id,
          novelId: novel.id,
          name: data.name || '未命名地点',
          region: data.region || '未知区域',
          description: data.description || '',
          createdAt: now,
          updatedAt: now
        });
      } else if (type === 'item') {
        await createItem({
          id,
          novelId: novel.id,
          name: data.name || '未命名道具',
          type: data.type || '普通道具',
          description: data.description || '',
          createdAt: now,
          updatedAt: now
        });
      } else if (type === 'faction') {
        await createFaction({
          id,
          novelId: novel.id,
          name: data.name || '未命名势力',
          leader: data.leader || '未知',
          territory: data.territory || '未知',
          description: data.description || '',
          createdAt: now,
          updatedAt: now
        });
      } else if (type === 'powerLevel') {
        await createPowerLevel({
          id,
          novelId: novel.id,
          name: data.name || '未命名境界',
          tier: Number(data.tier) || (powerLevels.length > 0 ? Math.max(...powerLevels.map(p => p.tier)) + 1 : 1),
          characteristics: data.characteristics || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now
        });
      } else if (type === 'timeline') {
        await createTimelineEvent({
          id,
          novelId: novel.id,
          title: data.title || '未命名事件',
          description: data.description || '',
          timestamp: data.timestamp || '未知时间',
          statusTag: data.statusTag || '发生中',
          order: Number(data.order) || (timelineEvents.length > 0 ? Math.max(...timelineEvents.map(e => e.order)) + 1 : 1),
          createdAt: now,
          updatedAt: now
        });
      }

      setHelperMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'assistant',
        text: `🎉 成功！已将「${data.name || data.title || '新设定'}」物理写入《${novel.title}》的 SQLite 数据库，并刷新了侧边列表！`
      }]);
      setDraftEntity(null);
    } catch (err) {
      console.error(err);
      alert("写入设定失败，请重试");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdateDraftField = (field: string, value: any) => {
    if (!draftEntity) return;
    setDraftEntity(prev => {
      if (!prev) return null;
      return {
        ...prev,
        data: {
          ...prev.data,
          [field]: value
        }
      };
    });
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
          <button
            onClick={() => setHelperOpen(!helperOpen)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border text-sm font-medium rounded-xl shadow-sm transition-all",
              helperOpen
                ? "bg-theme-accent border-theme-accent text-white hover:bg-theme-accent/90"
                : "bg-theme-bg border-theme-border/80 text-theme-text hover:bg-theme-sidebar"
            )}
          >
            <Sparkles size={16} />
            {helperOpen ? '关闭设定助手' : '开启设定助手'}
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
                <GlobalSetupTab
                  initialGlobalOutline={globalOutline}
                  initialWorldRules={worldRules}
                  isSaving={isSaving}
                  onSave={handleSaveGlobalInfo}
                />
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

        {/* Helper Side Panel */}
        {helperOpen && (
          <div className="w-96 border-l border-theme-border/50 bg-theme-sidebar/60 backdrop-blur-md flex flex-col h-full shrink-0">
            {/* Panel Header */}
            <div className="p-4 border-b border-theme-border/50 bg-theme-sidebar/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-xl bg-theme-accent/10 text-theme-accent flex items-center justify-center">
                  <Sparkles size={16} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-theme-text font-serif">世界设定对话助手</h3>
                  <span className="text-[10px] text-theme-muted block">Bible Agent Helper</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setHelperMessages([
                      { id: 'welcome', sender: 'assistant', text: '你好！我是你的“世界设定对话助手”。你可以在这里通过自然语言描述来添加新设定（例如：“帮我设计一个反派黑羽，擅长控虫，性格阴暗”），我会为你生成高一致性的设定属性，并提供一键确认写入的功能！' }
                    ]);
                    setDraftEntity(null);
                  }}
                  title="清空对话历史"
                  className="size-7 text-theme-muted hover:text-theme-text hover:bg-theme-bg/60 rounded-lg flex items-center justify-center transition-all"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setHelperOpen(false)}
                  title="收起助手"
                  className="size-7 text-theme-muted hover:text-theme-text hover:bg-theme-bg/60 rounded-lg flex items-center justify-center transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Panel Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {helperMessages.map((msg) => {
                if (msg.sender === 'user') {
                  return (
                    <div key={msg.id} className="flex flex-col items-end animate-fade-in">
                      <div className="bg-theme-accent text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-xs max-w-[85%] shadow-sm leading-relaxed whitespace-pre-wrap select-text">
                        {msg.text}
                      </div>
                    </div>
                  );
                } else if (msg.sender === 'assistant') {
                  return (
                    <div key={msg.id} className="flex flex-col items-start animate-fade-in">
                      <div className="bg-theme-bg/60 border border-theme-border/30 backdrop-blur-sm text-theme-text px-3.5 py-2 rounded-2xl rounded-tl-sm text-xs max-w-[85%] shadow-sm leading-relaxed whitespace-pre-wrap select-text">
                        {msg.text}
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div key={msg.id} className="text-center text-[10px] text-theme-muted py-1 bg-theme-sidebar/30 rounded-lg border border-theme-border/10 my-1 px-2 mx-auto">
                      {msg.text}
                    </div>
                  );
                }
              })}
              {helperLoading && (
                <div className="flex items-center gap-1.5 text-theme-muted text-[10px] px-1 animate-pulse">
                  <Loader2 size={12} className="animate-spin text-theme-accent" />
                  <span>助手正在思考并设计中...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* New Setting Confirmation Form Overlay / Card */}
            {draftEntity && (
              <div className="mx-4 mb-4 p-4 rounded-2xl border border-theme-border bg-theme-bg/95 backdrop-blur-md shadow-xl space-y-4 animate-fade-in relative overflow-hidden shrink-0">
                {/* Gradient Border Line */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-theme-accent via-indigo-500 to-cyan-500" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={14} className="text-theme-accent animate-pulse" />
                    <span className="text-xs font-bold text-theme-text">新设定确认单</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-theme-accent/10 text-theme-accent border border-theme-accent/20 capitalize">
                    {draftEntity.type === 'character' && '角色'}
                    {draftEntity.type === 'location' && '地点'}
                    {draftEntity.type === 'item' && '道具'}
                    {draftEntity.type === 'faction' && '势力'}
                    {draftEntity.type === 'powerLevel' && '境界'}
                    {draftEntity.type === 'timeline' && '事件'}
                  </span>
                </div>

                <div className="space-y-3 max-h-56 overflow-y-auto pr-1 text-left scrollbar-thin">
                  {draftEntity.type === 'character' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">姓名</label>
                        <input
                          type="text"
                          value={draftEntity.data.name || ''}
                          onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none focus:border-theme-accent"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">角色定位</label>
                        <select
                          value={draftEntity.data.role || 'supporting'}
                          onChange={(e) => handleUpdateDraftField('role', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        >
                          <option value="protagonist">主角</option>
                          <option value="supporting">配角</option>
                          <option value="antagonist">反派</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">一句话简介</label>
                        <input
                          type="text"
                          value={draftEntity.data.summary || ''}
                          onChange={(e) => handleUpdateDraftField('summary', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">性格特征 (逗号分隔)</label>
                        <input
                          type="text"
                          value={Array.isArray(draftEntity.data.traits) ? draftEntity.data.traits.join('，') : draftEntity.data.traits || ''}
                          onChange={(e) => handleUpdateDraftField('traits', e.target.value.split(/[，,]+/).map(t => t.trim()).filter(Boolean))}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">背景小传</label>
                        <textarea
                          rows={2}
                          value={draftEntity.data.bio || ''}
                          onChange={(e) => handleUpdateDraftField('bio', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}

                  {draftEntity.type === 'location' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">名称</label>
                        <input
                          type="text"
                          value={draftEntity.data.name || ''}
                          onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">所属区域</label>
                        <input
                          type="text"
                          value={draftEntity.data.region || ''}
                          onChange={(e) => handleUpdateDraftField('region', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">环境与危机描述</label>
                        <textarea
                          rows={3}
                          value={draftEntity.data.description || ''}
                          onChange={(e) => handleUpdateDraftField('description', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}

                  {draftEntity.type === 'item' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">名称</label>
                        <input
                          type="text"
                          value={draftEntity.data.name || ''}
                          onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">道具评级/类型</label>
                        <input
                          type="text"
                          value={draftEntity.data.type || ''}
                          onChange={(e) => handleUpdateDraftField('type', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">异能与来历描述</label>
                        <textarea
                          rows={3}
                          value={draftEntity.data.description || ''}
                          onChange={(e) => handleUpdateDraftField('description', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}

                  {draftEntity.type === 'faction' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">势力名称</label>
                        <input
                          type="text"
                          value={draftEntity.data.name || ''}
                          onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">掌门/领袖</label>
                        <input
                          type="text"
                          value={draftEntity.data.leader || ''}
                          onChange={(e) => handleUpdateDraftField('leader', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">总部地盘</label>
                        <input
                          type="text"
                          value={draftEntity.data.territory || ''}
                          onChange={(e) => handleUpdateDraftField('territory', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">宗门传袭与背景</label>
                        <textarea
                          rows={3}
                          value={draftEntity.data.description || ''}
                          onChange={(e) => handleUpdateDraftField('description', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}

                  {draftEntity.type === 'powerLevel' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">境界名称</label>
                        <input
                          type="text"
                          value={draftEntity.data.name || ''}
                          onChange={(e) => handleUpdateDraftField('name', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">等阶级别 (数字)</label>
                        <input
                          type="number"
                          value={draftEntity.data.tier || ''}
                          onChange={(e) => handleUpdateDraftField('tier', Number(e.target.value))}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">外显异象</label>
                        <input
                          type="text"
                          value={draftEntity.data.characteristics || ''}
                          onChange={(e) => handleUpdateDraftField('characteristics', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">修行奥义</label>
                        <textarea
                          rows={2}
                          value={draftEntity.data.description || ''}
                          onChange={(e) => handleUpdateDraftField('description', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}

                  {draftEntity.type === 'timeline' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">事件标题</label>
                        <input
                          type="text"
                          value={draftEntity.data.title || ''}
                          onChange={(e) => handleUpdateDraftField('title', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">时间纪元</label>
                        <input
                          type="text"
                          value={draftEntity.data.timestamp || ''}
                          onChange={(e) => handleUpdateDraftField('timestamp', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">事件状态</label>
                        <select
                          value={draftEntity.data.statusTag || '发生中'}
                          onChange={(e) => handleUpdateDraftField('statusTag', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        >
                          <option value="未发生">未发生</option>
                          <option value="发生中">发生中</option>
                          <option value="已尘封">已尘封</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">排序权重</label>
                        <input
                          type="number"
                          value={draftEntity.data.order || ''}
                          onChange={(e) => handleUpdateDraftField('order', Number(e.target.value))}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-theme-muted">影响与过程描述</label>
                        <textarea
                          rows={2}
                          value={draftEntity.data.description || ''}
                          onChange={(e) => handleUpdateDraftField('description', e.target.value)}
                          className="w-full bg-theme-sidebar/50 border border-theme-border/60 rounded-lg px-2.5 py-1.5 text-xs text-theme-text focus:outline-none resize-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-theme-border/40 shrink-0">
                  <button
                    onClick={() => setDraftEntity(null)}
                    className="flex-1 px-3 py-2 text-xs font-medium border border-theme-border/80 text-theme-muted hover:text-theme-text hover:bg-theme-bg/40 rounded-xl transition-all"
                  >
                    放弃
                  </button>
                  <button
                    onClick={handleCommitDraftEntity}
                    className="flex-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-r from-theme-accent to-indigo-600 hover:opacity-95 rounded-xl shadow-md hover:shadow-theme-accent/20 transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span>一键写入我的世界观</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Chat Input Footer Area */}
            <div className="p-4 border-t border-theme-border/50 bg-theme-sidebar/80 flex flex-col gap-2 shrink-0">
              <div className="relative flex items-center bg-theme-bg/80 border border-theme-border/80 rounded-2xl focus-within:border-theme-accent focus-within:ring-1 focus-within:ring-theme-accent/30 transition-all">
                <textarea
                  value={helperInput}
                  onChange={(e) => setHelperInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleHelperSubmit();
                    }
                  }}
                  placeholder="在此输入您的灵感，如：“帮我设计一个反派黑羽，他是黑水宗宗主，擅长控虫，性格阴暗”..."
                  className="w-full bg-transparent border-0 rounded-2xl pl-4 pr-12 py-3 text-xs text-theme-text placeholder-theme-muted focus:outline-none focus:ring-0 resize-none max-h-24 min-h-[44px]"
                  rows={1}
                />
                <button
                  onClick={handleHelperSubmit}
                  disabled={helperLoading || !helperInput.trim()}
                  className="absolute right-2 bottom-2 size-8 bg-theme-accent text-white rounded-xl flex items-center justify-center hover:bg-theme-accent/90 hover:scale-105 transition-all shadow-md shadow-theme-accent/20 disabled:opacity-40 disabled:scale-100 disabled:shadow-none cursor-pointer"
                >
                  {helperLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-theme-muted text-center leading-normal">
                使用 Shift + Enter 换行，支持直接对话、一键写入。
              </p>
            </div>
          </div>
        )}
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
