import React, { useState, useEffect } from 'react';
import { Character, Location, Item, Novel } from '../types';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Users, MapPin, Package, BookOpen, Plus, Trash2, Save, Globe, Upload, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { extractWorldSetupPhase } from '../lib/agents';

export function WorldBibleView({ novel }: { novel: Novel }) {
  const [activeTab, setActiveTab] = useState<'characters' | 'locations' | 'items' | 'global'>('global');
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  
  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [worldRules, setWorldRules] = useState(novel.worldRules || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const qChars = query(collection(db, 'characters'), where('novelId', '==', novel.id));
    const u1 = onSnapshot(qChars, (snapshot) => {
      setCharacters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Character)));
    });

    const qLocs = query(collection(db, 'locations'), where('novelId', '==', novel.id));
    const u2 = onSnapshot(qLocs, (snapshot) => {
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Location)));
    });

    const qItems = query(collection(db, 'items'), where('novelId', '==', novel.id));
    const u3 = onSnapshot(qItems, (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    setGlobalOutline(novel.globalOutline || '');
    setWorldRules(novel.worldRules || '');

    return () => { u1(); u2(); u3(); };
  }, [novel]);

  const saveGlobalInfo = async () => {
    setIsSaving(true);
    await updateDoc(doc(db, 'novels', novel.id), {
      globalOutline,
      worldRules,
      updatedAt: Date.now()
    });
    setIsSaving(false);
  };

  const addEntity = async (type: 'character' | 'location' | 'item') => {
    const base = { novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() };
    if (type === 'character') {
      await addDoc(collection(db, 'characters'), { ...base, name: '新人物', role: 'supporting', summary: '', traits: [], bio: '' });
    } else if (type === 'location') {
      await addDoc(collection(db, 'locations'), { ...base, name: '新地点', region: '未知区域', description: '' });
    } else {
      await addDoc(collection(db, 'items'), { ...base, name: '新道具', type: '普通道具', description: '' });
    }
  };

  const deleteEntity = async (type: 'character' | 'location' | 'item', id: string) => {
    await deleteDoc(doc(db, type + 's', id));
  };

  const updateEntity = async (type: 'character' | 'location' | 'item', id: string, data: any) => {
    await updateDoc(doc(db, type + 's', id), { ...data, updatedAt: Date.now() });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const text = await file.text();
      const extracted = await extractWorldSetupPhase(text);
      
      const newGlobalOutline = extracted.globalOutline || globalOutline;
      const newWorldRules = extracted.worldRules || worldRules;
      
      await updateDoc(doc(db, 'novels', novel.id), {
        globalOutline: newGlobalOutline,
        worldRules: newWorldRules,
        updatedAt: Date.now()
      });
      setGlobalOutline(newGlobalOutline);
      setWorldRules(newWorldRules);

      if (extracted.characters && Array.isArray(extracted.characters)) {
        for (const char of extracted.characters) {
          await addDoc(collection(db, 'characters'), { ...char, traits: char.traits || [], novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
        }
      }

      if (extracted.locations && Array.isArray(extracted.locations)) {
        for (const loc of extracted.locations) {
          await addDoc(collection(db, 'locations'), { ...loc, novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
        }
      }

      if (extracted.items && Array.isArray(extracted.items)) {
        for (const item of extracted.items) {
          await addDoc(collection(db, 'items'), { ...item, novelId: novel.id, createdAt: Date.now(), updatedAt: Date.now() });
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

  const tabs = [
    { id: 'global', icon: BookOpen, label: '全局设定' },
    { id: 'characters', icon: Users, label: '人物档案' },
    { id: 'locations', icon: MapPin, label: '地点副本' },
    { id: 'items', icon: Package, label: '道具设定' },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-[#F9FAFB]">
      <header className="px-8 py-6 border-b border-sage-border/50 bg-white shadow-sm shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-sage-text flex items-center gap-3">
            <Globe className="text-sage-accent" />
            世界设定集 (World Bible)
          </h1>
          <p className="text-sm text-sage-muted mt-1">「你的AI 专属记忆库，防止小说设定偏离的主心骨」</p>
        </div>
        
        <div className="flex items-center gap-4">
          <input 
            type="file" 
            accept=".txt,.md,.json" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-4 py-2 bg-sage-bg border border-sage-border/80 text-sage-text rounded-xl shadow-sm hover:bg-sage-sidebar transition-all font-medium text-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isImporting ? 'AI 解析中...' : '智能导入设定文档'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-56 border-r border-sage-border/50 bg-white flex flex-col py-4 px-3 shrink-0 gap-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
                activeTab === tab.id 
                  ? "bg-sage-accent text-white shadow-md shadow-sage-accent/20" 
                  : "text-sage-muted hover:bg-sage-sidebar/50 hover:text-sage-text hover:translate-x-1"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
              <span className="ml-auto text-xs opacity-60">
                {tab.id === 'characters' && characters.length}
                {tab.id === 'locations' && locations.length}
                {tab.id === 'items' && items.length}
              </span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          <AnimatePresence mode="wait">
            {activeTab === 'global' && (
              <motion.div key="global" initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="max-w-4xl mx-auto space-y-8">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-sage-border/50">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-sage-text">故事大纲 (Global Outline)</h2>
                    <button onClick={saveGlobalInfo} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-sage-accent text-white rounded-lg text-sm transition-all hover:bg-sage-accent/90 shadow-sm">{isSaving ? '保存中...' : <><Save size={16}/>保存全局设定</>}</button>
                  </div>
                  <textarea 
                    value={globalOutline} 
                    onChange={e => setGlobalOutline(e.target.value)} 
                    placeholder="描述小说的起承转合、主线任务、结局走向..."
                    className="w-full h-64 p-4 rounded-xl border border-sage-border/50 focus:border-sage-accent outline-none font-serif resize-none"
                  />
                </div>
                
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-sage-border/50">
                  <h2 className="text-lg font-bold text-sage-text mb-4">世界观法则 (World Rules)</h2>
                  <textarea 
                    value={worldRules} 
                    onChange={e => setWorldRules(e.target.value)} 
                    placeholder="例如：修仙体系境界、魔法运转原理、科技文明等级..."
                    className="w-full h-48 p-4 rounded-xl border border-sage-border/50 focus:border-sage-accent outline-none font-serif resize-none"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'characters' && (
              <motion.div key="chars" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-sage-text font-serif">登场人物</h2>
                  <button onClick={() => addEntity('character')} className="flex items-center gap-2 px-4 py-2 text-sm bg-sage-text text-white rounded-xl hover:bg-sage-text/90 shadow-md transition-all"><Plus size={16}/>新增角色</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {characters.map(char => (
                    <div key={char.id} className="bg-white p-5 rounded-2xl border border-sage-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('character', char.id)} className="absolute top-4 right-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <input value={char.name} onChange={e=>updateEntity('character', char.id, {name: e.target.value})} className="font-bold text-lg outline-none w-3/4 bg-transparent focus:bg-sage-sidebar/50 rounded px-1" />
                      <select value={char.role} onChange={e=>updateEntity('character', char.id, {role: e.target.value})} className="w-1/2 p-1 text-sm border-b border-sage-border/50 outline-none -mt-2 bg-transparent">
                        <option value="protagonist">主角</option>
                        <option value="antagonist">反派</option>
                        <option value="supporting">配角</option>
                        <option value="extra">龙套</option>
                      </select>
                      <input value={char.summary} onChange={e=>updateEntity('character', char.id, {summary: e.target.value})} placeholder="一句话简介" className="text-sm outline-none bg-transparent focus:bg-sage-sidebar/50 rounded px-1 -mx-1" />
                      <textarea value={char.bio} onChange={e=>updateEntity('character', char.id, {bio: e.target.value})} placeholder="详细背景设定、性格、习惯..." className="text-sm outline-none resize-none h-32 mt-2 bg-sage-sidebar/10 p-2 rounded-lg border border-sage-border/30 focus:border-sage-border" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'locations' && (
              <motion.div key="locs" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-sage-text font-serif">地点与副本</h2>
                  <button onClick={() => addEntity('location')} className="flex items-center gap-2 px-4 py-2 text-sm bg-sage-text text-white rounded-xl hover:bg-sage-text/90 shadow-md transition-all"><Plus size={16}/>新增地点</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {locations.map(loc => (
                    <div key={loc.id} className="bg-white p-5 rounded-2xl border border-sage-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('location', loc.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <div className="flex items-center gap-3 pr-10">
                        <input value={loc.name} onChange={e=>updateEntity('location', loc.id, {name: e.target.value})} className="font-bold text-lg outline-none w-1/2 bg-transparent focus:bg-sage-sidebar/50 rounded px-1" />
                        <span className="text-sage-muted/50">—</span>
                        <input value={loc.region} onChange={e=>updateEntity('location', loc.id, {region: e.target.value})} className="text-sm outline-none w-1/3 bg-transparent text-sage-accent focus:bg-sage-sidebar/50 rounded px-1" placeholder="所属区域" />
                      </div>
                      <textarea value={loc.description} onChange={e=>updateEntity('location', loc.id, {description: e.target.value})} placeholder="环境描写、危险等级、掉落物品、隐藏线索..." className="text-sm outline-none resize-none h-32 bg-sage-sidebar/10 p-3 rounded-xl border border-sage-border/30 focus:border-sage-border mt-2" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'items' && (
              <motion.div key="items" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-sage-text font-serif">道具与物品</h2>
                  <button onClick={() => addEntity('item')} className="flex items-center gap-2 px-4 py-2 text-sm bg-sage-text text-white rounded-xl hover:bg-sage-text/90 shadow-md transition-all"><Plus size={16}/>新增道具</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {items.map(item => (
                    <div key={item.id} className="bg-white p-5 rounded-2xl border border-sage-border/50 shadow-sm flex flex-col gap-3 group relative">
                      <button onClick={()=>deleteEntity('item', item.id)} className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                      <input value={item.name} onChange={e=>updateEntity('item', item.id, {name: e.target.value})} className="font-bold text-[17px] outline-none w-3/4 bg-transparent focus:bg-sage-sidebar/50 rounded px-1" />
                      <input value={item.type} onChange={e=>updateEntity('item', item.id, {type: e.target.value})} className="text-xs text-sage-accent outline-none w-1/2 bg-sage-accent/10 px-2 py-1 rounded-full text-center focus:bg-sage-accent/20 transition-colors" placeholder="道具类型(例如: 法器)" />
                      <textarea value={item.description} onChange={e=>updateEntity('item', item.id, {description: e.target.value})} placeholder="作用、来历、使用代价..." className="text-sm outline-none resize-none h-28 bg-sage-sidebar/10 p-2 rounded-lg border border-sage-border/30 focus:border-sage-border mt-2" />
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
