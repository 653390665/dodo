import React from 'react';
import { Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import type { Character } from '../../../shared/types';

interface CharactersTabProps {
  characters: Character[];
  addEntity: (type: 'character') => void;
  deleteEntity: (type: 'character', id: string) => void;
  updateEntity: (type: 'character', id: string, data: Partial<Character>) => void;
  handleGenerateBio: (char: Character) => void;
  generatingBioIds: string[];
}

export function CharactersTab({
  characters,
  addEntity,
  deleteEntity,
  updateEntity,
  handleGenerateBio,
  generatingBioIds,
}: CharactersTabProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">登场人物</h2>
        <button
          onClick={() => addEntity('character')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增角色
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        {characters.map((char) => (
          <div
            key={char.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative"
          >
            <button
              onClick={() => deleteEntity('character', char.id)}
              className="absolute top-4 right-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
            >
              <Trash2 size={16} />
            </button>
            <input
              value={char.name}
              onChange={(e) => updateEntity('character', char.id, { name: e.target.value })}
              className="font-bold text-lg outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
            />
            <select
              value={char.role}
              onChange={(e) => updateEntity('character', char.id, { role: e.target.value as any })}
              className="w-1/2 p-1 text-sm border-b border-theme-border/50 outline-none -mt-2 bg-transparent"
            >
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
              <option value="extra">龙套</option>
            </select>
            <input
              value={char.summary}
              onChange={(e) => updateEntity('character', char.id, { summary: e.target.value })}
              placeholder="一句话简介"
              className="text-sm outline-none bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -mx-1"
            />
            <div className="relative group/bio">
              <textarea
                value={char.bio}
                onChange={(e) => updateEntity('character', char.id, { bio: e.target.value })}
                placeholder="详细背景设定、性格、习惯..."
                className="w-full text-sm outline-none resize-none h-40 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-accent transition-all font-serif leading-relaxed"
              />
              <button
                onClick={() => handleGenerateBio(char)}
                disabled={generatingBioIds.includes(char.id)}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-theme-sidebar border border-theme-border/50 text-theme-accent text-xs font-bold rounded-lg shadow-sm hover:bg-theme-accent hover:text-white transition-all opacity-0 group-hover/bio:opacity-100 disabled:opacity-50"
                title="AI 生成背景故事"
              >
                {generatingBioIds.includes(char.id) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                AI 生成背景故事
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
