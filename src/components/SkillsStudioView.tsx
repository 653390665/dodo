import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, CheckCircle2, PenLine, Sparkles, Wand2 } from 'lucide-react';
import { subscribeToChanges } from '../lib/db-transport';
import { listNovels, updateNovel } from '../lib/novel-client';
import { deleteSkill, syncSkillFeedbackScores } from '../lib/skill-client';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import { Skill, Novel, ViewType } from '../../shared/types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/AlertDialog';

export function SkillsStudioView({
  selectedNovel,
  onNavigate,
}: {
  selectedNovel?: Novel | null;
  onNavigate?: (view: ViewType) => void;
}) {
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillToDeleteId, setSkillToDeleteId] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);

  useEffect(() => {
    const refreshSkills = () => {
      syncSkillFeedbackScores()
        .then(setSavedSkills)
        .catch((err) => console.warn('Failed to load skills:', err));
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
    setSkillToDeleteId(id);
  };

  const executeDeleteSkill = async () => {
    if (skillToDeleteId) {
      await deleteSkill(skillToDeleteId);
      if (selectedSkillId === skillToDeleteId) {
        setSelectedSkillId(null);
      }
      setSkillToDeleteId(null);
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

        <div className="max-w-6xl mx-auto mb-8 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
              <Sparkles size={18} className="text-theme-accent" />
              技能如何影响写作
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { label: '分镜', detail: '影响下一章的场景选择、冲突推进和节奏密度。', icon: BrainCircuit },
                { label: '正文', detail: '约束文风、句法、人物口吻和叙事颗粒度。', icon: PenLine },
                { label: '审查', detail: '帮助 AI 用同一套标准检查跑偏、重复和节奏问题。', icon: CheckCircle2 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-2xl border border-theme-border bg-theme-bg/50 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                      <Icon size={15} className="text-theme-accent" />
                      {item.label}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-theme-muted">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="text-sm font-bold text-theme-text">当前作品装配</div>
            {selectedNovel ? (
              <>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  《{selectedNovel.title}》已装配 {selectedNovel.mountedSkillIds?.length || 0}/3 张技能卡。
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('workspace')}
                  className="mt-4 w-full rounded-2xl bg-theme-text px-4 py-3 text-sm font-bold text-theme-bg transition-opacity hover:opacity-90"
                >
                  回到当前作品工作台
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  先在书库选择作品，再把技能装配到下一章生成链路中。
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('library')}
                  className="mt-4 w-full rounded-2xl border border-theme-border px-4 py-3 text-sm font-bold text-theme-text transition-colors hover:border-theme-accent"
                >
                  去书库选择作品
                </button>
              </>
            )}
          </div>
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
      <AlertDialog open={Boolean(skillToDeleteId)} onOpenChange={(open) => !open && setSkillToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个技能？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将从技能库中删除该写作技能卡，并从所有已装配的作品中解绑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteSkill} className="bg-red-600 hover:bg-red-700 text-white font-bold">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
