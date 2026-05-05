import React, { useState, useEffect } from 'react';
import { Wand2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { listSkills, deleteSkill, subscribe } from '../lib/db';
import { Skill } from '../types';

export function SkillsStudioView() {
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);

  useEffect(() => {
    setSavedSkills(listSkills());
    return subscribe(() => setSavedSkills(listSkills()));
  }, []);

  const handleDeleteSkill = (id: string) => {
    if(!confirm("确认删除这个技能？")) return;
    deleteSkill(id);
  };

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto p-8 relative z-10">
        
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            技能仓库 (Skills Library)
          </h1>
          <p className="text-theme-muted mt-2">在这里管理您的 AI 专属技能卡牌。您可以在创作时将它们挂载为灵感引擎。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {savedSkills.map(s => (
            <motion.div 
              key={s.id} 
              whileHover={{ y: -4 }}
              className="bg-white rounded-2xl p-6 border border-theme-border shadow-sm flex flex-col group relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-theme-text text-lg">{s.name}</h3>
                  <div className="text-[10px] text-theme-muted tracking-widest uppercase font-bold mt-1">
                    v{s.version || 1} · {s.stabilityScore}% 稳定性
                  </div>
                </div>
                <button 
                  onClick={() => handleDeleteSkill(s.id)} 
                  className="p-2 text-theme-muted hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="text-sm text-theme-muted/80 flex-1 mb-4 italic line-clamp-3">"{s.description}"</p>
              
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {s.vocabulary?.slice(0, 3).map((v: string) => (
                  <span key={v} className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">
                    {v}
                  </span>
                ))}
                {(s.vocabulary?.length || 0) > 3 && (
                  <span className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">
                    +{s.vocabulary!.length - 3}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
        
        {savedSkills.length === 0 && (
          <div className="mt-12 text-center text-theme-muted/60 p-16 border-2 border-dashed border-theme-border rounded-2xl bg-theme-sidebar/30">
            <Wand2 size={48} className="mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-bold mb-2">技能库空空如也</h3>
            <p>请前往「拆书工厂」萃取您的首张技能卡牌</p>
          </div>
        )}
      </div>
    </div>
  );
}