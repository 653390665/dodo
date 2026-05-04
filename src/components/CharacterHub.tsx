import React, { useState, useEffect } from 'react';
import { 
  UserPlus, 
  Trash2, 
  PenTool, 
  Search,
  Users,
  Shield,
  Heart,
  Zap,
  MoreVertical,
  ChevronRight,
  Info
} from 'lucide-react';
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
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { Character } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';

interface CharacterHubProps {
  novelId: string;
}

export function CharacterHub({ novelId }: CharacterHubProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, 'characters'), 
      where('novelId', '==', novelId)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Character));
      setCharacters(data);
    });

    return unsubscribe;
  }, [novelId]);

  const handleAddCharacter = async () => {
    try {
      const docRef = await addDoc(collection(db, 'characters'), {
        novelId,
        name: '新角色',
        role: 'supporting',
        summary: '简单的角色描述',
        traits: [],
        bio: '详细的背景故事...',
        createdAt: Date.now(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'characters');
    }
  };

  const handleUpdate = async (field: keyof Character, value: any) => {
    if (!selectedCharacter) return;
    try {
      const updated = { ...selectedCharacter, [field]: value };
      setSelectedCharacter(updated);
      await updateDoc(doc(db, 'characters', selectedCharacter.id), { [field]: value });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `characters/${selectedCharacter.id}`);
    }
  };

  const filteredCharacters = characters.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const roleColors = {
    protagonist: 'bg-amber-50 text-amber-700 border-amber-200',
    antagonist: 'bg-red-50 text-red-700 border-red-200',
    supporting: 'bg-sage-sidebar/40 text-sage-accent border-sage-border',
    extra: 'bg-white text-sage-muted border-sage-border/50',
  };

  const roleIcons = {
    protagonist: Shield,
    antagonist: Zap,
    supporting: Heart,
    extra: Users,
  };

  return (
    <div className="h-full flex overflow-hidden bg-white">
      {/* List Panel */}
      <div className="w-80 flex flex-col border-r border-sage-border/50 bg-sage-sidebar/10">
        <div className="p-6 border-b border-sage-border/30 bg-white/50 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold text-sage-accent">人物设定</h2>
            <button 
              onClick={handleAddCharacter}
              className="p-2 hover:opacity-90 bg-sage-accent text-white rounded-lg transition-all shadow-sm"
              title="添加角色"
            >
              <UserPlus size={18} />
            </button>
          </div>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-muted group-focus-within:text-sage-accent transition-colors" size={16} />
            <input 
              type="text" 
              placeholder="搜索角色..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-sage-border/40 focus:border-sage-accent rounded-xl text-sm outline-none transition-all shadow-sm text-sage-text placeholder:text-sage-muted"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredCharacters.map((char) => {
            const RoleIcon = roleIcons[char.role];
            return (
              <motion.div
                layout
                key={char.id}
                onClick={() => {
                  setSelectedCharacter(char);
                  setIsEditing(false);
                }}
                className={cn(
                  "group p-4 rounded-2xl cursor-pointer transition-all border flex items-center gap-3",
                  selectedCharacter?.id === char.id 
                    ? "bg-white shadow-md border-sage-border text-sage-text" 
                    : "bg-transparent border-transparent hover:bg-white hover:border-sage-border/30"
                )}
              >
                <div className={cn("p-2 rounded-xl border transition-colors shadow-sm", roleColors[char.role])}>
                  <RoleIcon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{char.name}</p>
                  <p className="text-[10px] text-sage-muted uppercase font-bold tracking-widest">{char.role}</p>
                </div>
                <ChevronRight size={14} className={cn(
                  "transition-all text-sage-muted",
                  selectedCharacter?.id === char.id ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
                )} />
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 flex flex-col bg-paper overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedCharacter ? (
            <motion.div 
              key={selectedCharacter.id}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex-1 flex flex-col h-full p-12 overflow-y-auto"
            >
              <div className="max-w-4xl w-full mx-auto">
                {/* Header */}
                <div className="flex items-start justify-between mb-12">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border shadow-sm", roleColors[selectedCharacter.role])}>
                        {selectedCharacter.role}
                      </span>
                      <div className="h-px w-8 bg-sage-border" />
                      <span className="text-sage-muted text-[10px] font-mono uppercase tracking-tighter">
                        UUID: {selectedCharacter.id.slice(0, 8)}
                      </span>
                    </div>
                    
                    {isEditing ? (
                      <input 
                        className="text-6xl font-serif font-bold bg-transparent border-b-2 border-dashed border-sage-border outline-none w-full focus:border-sage-accent transition-colors pb-2 text-sage-text"
                        value={selectedCharacter.name}
                        autoFocus
                        onChange={(e) => handleUpdate('name', e.target.value)}
                        onBlur={() => setIsEditing(false)}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
                      />
                    ) : (
                      <h1 
                        onClick={() => setIsEditing(true)}
                        className="text-6xl font-serif font-bold cursor-text hover:text-sage-accent transition-colors text-sage-text"
                      >
                        {selectedCharacter.name}
                      </h1>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={async () => {
                        if (confirm('确定要删除这个角色吗？')) {
                          await deleteDoc(doc(db, 'characters', selectedCharacter.id));
                          setSelectedCharacter(null);
                        }
                      }}
                      className="p-3 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-all shadow-sm"
                    >
                      <Trash2 size={20} />
                    </button>
                    <button 
                      className="p-3 bg-white text-sage-muted border border-sage-border/50 rounded-full hover:shadow-md transition-all"
                    >
                      <MoreVertical size={20} />
                    </button>
                  </div>
                </div>

                {/* Content Sections */}
                <div className="grid grid-cols-3 gap-12">
                  <div className="col-span-2 space-y-12">
                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-sage-muted mb-6 flex items-center gap-2">
                        <PenTool size={14} /> 核心梗概
                      </h3>
                      <textarea 
                        value={selectedCharacter.summary}
                        onChange={(e) => handleUpdate('summary', e.target.value)}
                        className="w-full bg-white border border-sage-border/30 hover:border-sage-border focus:border-sage-accent transition-all rounded-2xl p-6 outline-none text-lg leading-relaxed shadow-sm italic text-sage-text"
                        placeholder="一句话描述角色的核心冲突或特色..."
                      />
                    </section>

                    <section className="bg-sage-sidebar/20 p-8 rounded-3xl border border-sage-border/30 backdrop-blur-sm shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-sage-muted mb-6 flex items-center gap-2">
                        <Info size={14} /> 生平背景 (Markdown)
                      </h3>
                      <textarea 
                        value={selectedCharacter.bio}
                        onChange={(e) => handleUpdate('bio', e.target.value)}
                        className="w-full h-96 bg-transparent border-none outline-none resize-none font-sans text-sm leading-relaxed text-sage-text"
                        placeholder="详细的生平故事、社会关系、成长经历..."
                      />
                      <div className="mt-8 pt-8 border-t border-sage-border/20 prose prose-slate prose-sm max-w-none">
                         <h4 className="text-[10px] font-bold uppercase text-sage-muted mb-4 tracking-widest">预览</h4>
                         <div className="text-sage-text font-serif leading-relaxed">
                           <ReactMarkdown>{selectedCharacter.bio}</ReactMarkdown>
                         </div>
                      </div>
                    </section>
                  </div>

                  <div className="space-y-8">
                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-sage-muted mb-6">角色定位</h3>
                      <select 
                        value={selectedCharacter.role}
                        onChange={(e) => handleUpdate('role', e.target.value)}
                        className="w-full bg-white border border-sage-border/50 rounded-xl p-3 outline-none text-sm font-medium shadow-sm transition-all focus:border-sage-accent text-sage-text"
                      >
                        <option value="protagonist">主角 (Protagonist)</option>
                        <option value="antagonist">反派 (Antagonist)</option>
                        <option value="supporting">配角 (Supporting)</option>
                        <option value="extra">龙套 (Extra)</option>
                      </select>
                    </section>

                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-sage-muted mb-6">属性标签</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedCharacter.traits.map((trait, idx) => (
                          <span key={idx} className="px-3 py-1 bg-white border border-sage-border/50 rounded-full text-xs font-medium shadow-sm text-sage-text">
                            {trait}
                          </span>
                        ))}
                        <button 
                          onClick={() => {
                            const t = prompt('添加属性');
                            if (t) handleUpdate('traits', [...selectedCharacter.traits, t]);
                          }}
                          className="px-3 py-1 border border-dashed border-sage-border rounded-full text-xs font-medium text-sage-muted hover:border-sage-accent hover:text-sage-accent transition-all"
                        >
                          + 添加
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-20 text-center">
              <div className="w-24 h-24 bg-sage-sidebar/30 rounded-full flex items-center justify-center mb-6">
                <Users size={32} className="text-sage-border" />
              </div>
              <h2 className="text-2xl font-serif font-bold mb-2 text-sage-accent">未选择角色</h2>
              <p className="text-sage-muted max-w-sm">从左侧列表选择一个角色，或点击“+”号创建一个新的人物设定。</p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
