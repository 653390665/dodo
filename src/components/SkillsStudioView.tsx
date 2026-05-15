import React, { useState, useEffect, useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import { deleteSkill, subscribeToChanges, syncSkillFeedbackScores, listNovels, updateNovel } from '../lib/api';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import { Skill, Novel } from '../types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';

export function SkillsStudioView() {
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);

  useEffect(() => {
    const refreshSkills = () => {
      syncSkillFeedbackScores()
        .then(setSavedSkills)
        .catch((err) => console.error('Failed to load skills:', err));
    };
    refreshSkills();
    listNovels().then(setUserNovels);
    return subscribeToChanges(refreshSkills);
  }, []);

  const selectedSkill = useMemo(
    () => savedSkills.find((skill) => skill.id === selectedSkillId) || null,
    [savedSkills, selectedSkillId],
  );

  const handleDeleteSkill = async (id: string) => {
    if(!confirm("确认删除这个技能？")) return;
    await deleteSkill(id);
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
    }
  };

  const handleEquipSkill = async (skillId: string, novelId: string) => {
    const novel = userNovels.find((n) => n.id === novelId);
    if (!novel) return;
    const currentIds = novel.mountedSkillIds || [];
    if (currentIds.includes(skillId)) {
      alert('该技能已装备到此作品。');
      return;
    }
    if (currentIds.length >= 3) {
      alert('每个作品最多装备 3 个技能。');
      return;
    }
    const newIds = [...currentIds, skillId];
    await updateNovel(novelId, {
      mountedSkillIds: newIds,
      mountedSkillLoadout: coerceMountedSkillLoadout(newIds),
    });
    setUserNovels((prev) =>
      prev.map((n) =>
        n.id === novelId
          ? { ...n, mountedSkillIds: newIds, mountedSkillLoadout: coerceMountedSkillLoadout(newIds) }
          : n,
      ),
    );
  };

  return (
    <div className="h-full flex bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8 relative z-10">

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            技能仓库 (Skills Library)
          </h1>
          <p className="text-theme-muted mt-2">在这里管理您的 AI 专属技能卡牌。打开详情、编辑字段、维护版本谱系。</p>
        </div>

        <div className="max-w-6xl mx-auto mb-8">
          <SkillMapPanel skills={savedSkills} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {savedSkills.map(s => (
            <SkillCard
              key={s.id}
              skill={s}
              selected={s.id === selectedSkillId}
              onOpen={() => setSelectedSkillId(s.id)}
              onDelete={() => handleDeleteSkill(s.id)}
              userNovels={userNovels}
              onEquip={(novelId) => handleEquipSkill(s.id, novelId)}
            />
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
      <SkillDetailDrawer
        skill={selectedSkill}
        allSkills={savedSkills}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkillId(null)}
        onSelectSkill={(id) => setSelectedSkillId(id)}
      />
    </div>
  );
}
