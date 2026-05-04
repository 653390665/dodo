import React, { useState, useEffect } from 'react';
import { Upload, BookTemplate, Save, CheckCircle2, ChevronRight, Wand2, Loader2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Skill } from '../types';

export function SkillsStudioView() {
  const [fileContent, setFileContent] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [skillConfig, setSkillConfig] = useState<any>(null);
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'skills'), (snap) => {
      setSavedSkills(snap.docs.map(d => ({ id: d.id, ...d.data() } as Skill)));
    });
    return unsub;
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setFileContent(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    if (!fileContent) return;
    setIsAnalyzing(true);
    
    try {
      const response = await fetch('/api/extract-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fileContent })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setSkillConfig(data);
    } catch (e) {
      console.error(e);
      alert('拆书失败: ' + String(e));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveSkill = async () => {
    if (!skillConfig) return;
    setIsSaving(true);
    try {
      await addDoc(collection(db, 'skills'), {
        ...skillConfig,
        createdAt: Date.now()
      });
      setSkillConfig(null);
      setFileContent("");
      alert("✅ 技能卡牌保存成功");
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'skills');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if(!confirm("确认删除这个技能？")) return;
    try {
      await deleteDoc(doc(db, 'skills', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'skills');
    }
  };

  return (
    <div className="h-full flex flex-col bg-paper relative overflow-hidden">
      <div className="absolute inset-0 bg-sage-accent/5 pointer-events-none" />
      <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto p-8 relative z-10">
        
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-sage-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-sage-accent" />
            拆书工厂 (Book-to-Skill Studio)
          </h1>
          <p className="text-sage-muted mt-2">上传爆款小说样本，AI 自动提炼文风、句法与爽点套路，结晶为你的专属 Skill 卡牌。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left: Input */}
          <div className="bg-white rounded-2xl shadow-sm border border-sage-border overflow-hidden flex flex-col">
            <div className="p-4 bg-sage-sidebar border-b border-sage-border flex justify-between items-center">
              <h3 className="font-bold text-sage-text flex gap-2 items-center"><Upload size={18} /> 上传范例文稿 (1~5万字最佳)</h3>
              <label className="cursor-pointer px-4 py-1.5 bg-sage-text text-white text-xs font-bold rounded-lg hover:bg-sage-text/90 transition-colors">
                选择 TXT 文件
                <input type="file" accept=".txt,.md" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
            <div className="flex-1 p-0 relative min-h-[400px]">
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                placeholder="或直接粘贴小说文本到此处..."
                className="w-full h-full p-6 text-sm text-sage-muted leading-relaxed outline-none resize-none bg-transparent"
              />
            </div>
            <div className="p-4 border-t border-sage-border bg-sage-bg/30">
              <button 
                onClick={handleAnalyze}
                disabled={!fileContent || isAnalyzing}
                className="w-full py-3 bg-sage-accent text-white font-bold rounded-xl shadow-md hover:bg-sage-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 transition-all"
              >
                {isAnalyzing ? (
                  <><Loader2 size={18} className="animate-spin" /> 正在提炼文风模型的灵魂...</>
                ) : (
                  <>开始拆书与萃取 Skill <ChevronRight size={18}/></>
                )}
              </button>
            </div>
            
            {/* Saved Skills Library */}
            <div className="p-4 border-t border-sage-border bg-white flex-1 overflow-y-auto max-h-[300px]">
              <h3 className="text-xs font-bold text-sage-muted uppercase tracking-wider mb-3">已解锁的书籍 Skill 卡牌 ({savedSkills.length})</h3>
              <div className="space-y-2">
                {savedSkills.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-sage-bg/40 border border-sage-border rounded-xl">
                    <div>
                      <h4 className="text-sm font-bold text-sage-text">{s.name}</h4>
                      <p className="text-xs text-sage-muted truncate max-w-[200px]">{s.description}</p>
                    </div>
                    <button onClick={() => handleDeleteSkill(s.id)} className="p-2 text-sage-muted hover:text-red-500 rounded-lg hover:bg-white transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {savedSkills.length === 0 && (
                  <div className="text-xs text-center text-sage-muted/60 p-4 border border-dashed border-sage-border rounded-xl">
                    你还没有通过提炼获得任何写作 Skill
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Output Skill Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-sage-border overflow-hidden flex flex-col h-full opacity-100 min-h-[500px]">
            <div className="p-4 bg-sage-sidebar border-b border-sage-border flex items-center gap-2">
              <BookTemplate size={18} className="text-sage-accent" />
              <h3 className="font-bold text-sage-text">萃取结果 (Skill JSON)</h3>
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              {!skillConfig ? (
                <div className="h-full flex flex-col items-center justify-center text-sage-muted/50">
                  <Wand2 size={48} className="mb-4 opacity-50" />
                  <p>等待拆书结果...</p>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <div>
                    <h2 className="text-2xl font-bold text-sage-text">{skillConfig.name}</h2>
                    <p className="text-sm text-sage-muted mt-1">{skillConfig.description}</p>
                  </div>

                  <div className="bg-sage-bg/50 p-4 rounded-xl border border-sage-border/50">
                    <h4 className="text-xs font-bold text-sage-accent uppercase tracking-wider mb-2">解析维度</h4>
                    <div className="space-y-2 text-sm text-sage-text">
                      <p><strong>笔调 (Style):</strong> {skillConfig.style}</p>
                      <p><strong>节奏 (Pacing):</strong> {skillConfig.pacing}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                       绝对禁止红线 (Negative Rules)
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {skillConfig.bannedWords.map((w: string) => (
                        <span key={w} className="px-2 py-1 bg-red-50 border border-red-100 text-red-600 rounded text-xs line-through">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-sage-accent uppercase tracking-wider mb-2">句式打样 (Few-shots)</h4>
                    <div className="space-y-2">
                      {skillConfig.fewShots.map((s: string, idx: number) => (
                        <div key={idx} className="text-sm text-sage-muted italic bg-white border border-sage-border p-3 rounded-lg border-l-4 border-l-sage-accent">
                          "{s}"
                        </div>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={handleSaveSkill}
                    disabled={isSaving}
                    className="w-full py-3 mt-4 bg-sage-text text-white font-bold rounded-xl shadow-md hover:bg-sage-text/90 flex justify-center items-center gap-2 transition-all disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} 
                    保存至全局技能库
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}