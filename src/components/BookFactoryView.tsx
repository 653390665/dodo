import React, { useState } from 'react';
import { Upload, BookTemplate, Save, CheckCircle2, ChevronRight, Wand2, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { createSkill } from '../lib/db';

export function BookFactoryView() {
  const [fileContent, setFileContent] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [skillConfig, setSkillConfig] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableJson, setEditableJson] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        let text = "";
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (e) {
          try {
            text = new TextDecoder('gbk').decode(buffer);
          } catch (err) {
            text = new TextDecoder('utf-8').decode(buffer);
          }
        }
        setFileContent(text);
      }
    };
    reader.readAsArrayBuffer(file);
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
      setEditableJson(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(e);
      alert('拆书失败: ' + String(e));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const handleTestDrive = async () => {
    if (!skillConfig || !testInput) return;
    setIsTesting(true);
    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextStr: "这是一个风格模拟测试场景。",
          sceneBeats: testInput,
          skills: [skillConfig],
          maxIterations: 1,
          draftContent: ""
        })
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        const messages = chunkStr.split('\n\n').filter(Boolean);
        for (const msg of messages) {
          if (msg.startsWith('data: ')) {
            try {
              const data = JSON.parse(msg.replace('data: ', ''));
              if (data.type === 'token') {
                streamedText += data.content;
                setTestOutput(streamedText);
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {
      console.error(e);
      alert('模拟失败');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSkill = () => {
    if (!skillConfig) return;
    setIsSaving(true);
    createSkill({
      ...skillConfig,
      id: Date.now().toString(),
      createdAt: Date.now()
    });
    setIsSaving(false);
    alert('技能已保存至技能库！');
  };

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto p-8 relative z-10">
        
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <BookTemplate size={28} className="text-theme-accent" />
            拆书工厂 (Book-to-Skill Studio)
          </h1>
          <p className="text-theme-muted mt-2">上传爆款小说样本，AI 自动提炼文风、句法与爽点套路，结晶为你的专属 Skill 卡牌。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left: Input */}
          <div className="flex flex-col gap-8">
            <div className="bg-white rounded-2xl shadow-sm border border-theme-border overflow-hidden flex flex-col h-full min-h-[500px]">
              <div className="p-4 bg-theme-sidebar border-b border-theme-border flex justify-between items-center">
                <h3 className="font-bold text-theme-text flex gap-2 items-center"><Upload size={18} /> 上传范例文稿</h3>
                <label className="cursor-pointer px-4 py-1.5 bg-theme-text text-white text-xs font-bold rounded-lg hover:bg-theme-text/90 transition-colors">
                  选择 TXT 文件
                  <input type="file" accept=".txt,.md" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              <div className="p-0 relative flex-1">
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  placeholder="或直接粘贴小说文本到此处..."
                  className="w-full h-full p-6 text-sm text-theme-muted leading-relaxed outline-none resize-none bg-transparent"
                />
              </div>
              <div className="p-4 border-t border-theme-border bg-theme-bg/30">
                <button 
                  onClick={handleAnalyze}
                  disabled={!fileContent || isAnalyzing}
                  className="w-full py-4 bg-theme-accent text-white font-bold rounded-xl shadow-md hover:bg-theme-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 transition-all text-lg"
                >
                  {isAnalyzing ? (
                    <><Loader2 size={20} className="animate-spin" /> 正在提炼文风模型的灵魂...</>
                  ) : (
                    <>开始拆书与萃取 Skill <ChevronRight size={20}/></>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right: Output Skill Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-theme-border overflow-hidden flex flex-col h-full opacity-100 min-h-[500px]">
            <div className="p-4 bg-theme-sidebar border-b border-theme-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 size={18} className="text-theme-accent" />
                <h3 className="font-bold text-theme-text">萃取结果 (Skill JSON)</h3>
              </div>
              {skillConfig && (
                <button 
                  onClick={() => {
                    if (isEditing) {
                      try {
                        const parsed = JSON.parse(editableJson);
                        setSkillConfig(parsed);
                        setIsEditing(false);
                      } catch (e) {
                        alert("JSON 格式错误，请检查后再保存编辑。");
                      }
                    } else {
                      setEditableJson(JSON.stringify(skillConfig, null, 2));
                      setIsEditing(true);
                    }
                  }}
                  className="text-[10px] bg-white border border-theme-border px-3 py-1 rounded-lg font-bold hover:bg-theme-sidebar transition-all flex items-center gap-1.5"
                >
                  {isEditing ? <><CheckCircle2 size={12} className="text-emerald-500" /> 完成编辑</> : <><Wand2 size={12} /> 手动修正 JSON</>}
                </button>
              )}
            </div>
            <div className="flex-1 p-6 overflow-y-auto bg-white/50 backdrop-blur-sm">
              {!skillConfig ? (
                <div className="h-full flex flex-col items-center justify-center text-theme-muted/50">
                  <Wand2 size={48} className="mb-4 opacity-50" />
                  <p>等待拆书结果...</p>
                </div>
              ) : isEditing ? (
                <textarea
                  value={editableJson}
                  onChange={(e) => setEditableJson(e.target.value)}
                  className="w-full h-full font-mono text-xs p-4 bg-slate-900 text-emerald-400 rounded-xl leading-relaxed outline-none overflow-y-auto focus:ring-2 ring-theme-accent/50 selection:bg-emerald-500/20"
                  spellCheck={false}
                />
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-theme-text">{skillConfig.name}</h2>
                      <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">Version {skillConfig.version || 1} · 萃取结晶</p>
                    </div>
                    <div className="px-4 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-2xl text-center">
                       <div className="text-xl font-bold text-theme-accent">{skillConfig.stabilityScore}</div>
                       <div className="text-[8px] text-theme-muted uppercase font-bold">稳定性评分</div>
                    </div>
                  </div>

                  <p className="text-sm text-theme-muted italic bg-theme-sidebar/30 p-3 rounded-xl border-l-4 border-theme-accent quote font-serif">
                    “{skillConfig.description}”
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {skillConfig.style && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">描写风格 (Style)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.style}</p>
                      </div>
                    )}
                    {skillConfig.pacing && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">叙事节奏 (Pacing)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.pacing}</p>
                      </div>
                    )}
                    {skillConfig.characterTraits && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">人物特征 (Character)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.characterTraits}</p>
                      </div>
                    )}
                    {skillConfig.worldBuilding && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">世界观与力量 (World)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.worldBuilding}</p>
                      </div>
                    )}
                    {skillConfig.plotPattern && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">剧情爽点套路 (Plot Patterns)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.plotPattern}</p>
                      </div>
                    )}
                    {skillConfig.foreshadowing && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">伏笔与悬念 (Foreshadowing)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{skillConfig.foreshadowing}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {(skillConfig.vocabulary?.length > 0 || skillConfig.corePatterns?.length > 0) && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">核心要素提取</h4>
                        {skillConfig.vocabulary?.length > 0 && (
                          <div className="mb-3">
                            <span className="text-[10px] font-bold text-theme-muted mr-2">特色词汇:</span>
                            <div className="flex flex-wrap gap-2 inline-flex">
                              {skillConfig.vocabulary.map((v: string) => (
                                <span key={v} className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {skillConfig.corePatterns?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-theme-muted mr-2">剧情模式:</span>
                            <div className="flex flex-wrap gap-2 inline-flex">
                              {skillConfig.corePatterns.map((v: string) => (
                                <span key={v} className="px-2 py-0.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-accent rounded text-[10px] font-bold">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="mt-3 text-xs text-theme-muted border-t border-theme-border/50 pt-2 italic">
                          <strong>句式习惯:</strong> {skillConfig.sentenceStructure || '未指定'}
                        </p>
                      </div>
                    )}

                    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                      <h4 className="text-[10px] font-bold text-red-500 uppercase mb-3">绝对禁止红线 (OOC / 毒点)</h4>
                      <div className="flex flex-wrap gap-2">
                        {(skillConfig.bannedElements || skillConfig.bannedWords || []).map((w: string) => (
                          <span key={w} className="px-2 py-0.5 bg-red-50 border border-red-100 text-red-600 rounded text-[10px] line-through">
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                      <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">经典句式提取</h4>
                      <div className="space-y-2">
                        {skillConfig.fewShots.map((s: string, idx: number) => (
                          <div key={idx} className="text-xs text-theme-muted italic p-2 bg-theme-sidebar/10 rounded-lg border-l-2 border-theme-accent/30 font-serif">
                            "{s}"
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                       <h4 className="text-[10px] font-bold text-emerald-700 uppercase mb-1">功能性评估 (Functional Audit)</h4>
                       <p className="text-[11px] text-emerald-600 leading-relaxed font-medium">
                         {skillConfig.evaluationFeedback}
                       </p>
                    </div>

                    <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50 border-dashed">
                       <h4 className="text-[10px] font-bold text-theme-text uppercase mb-2">功能模拟验证 (Test Drive)</h4>
                       <div className="space-y-3">
                         <textarea 
                           value={testInput}
                           onChange={(e) => setTestInput(e.target.value)}
                           placeholder="输入一段普通文本或细纲，测试该技能的风格涂抹能力..."
                           className="w-full h-20 p-2 text-xs bg-white border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-all resize-none"
                         />
                         <button 
                           onClick={handleTestDrive}
                           disabled={isTesting || !testInput}
                           className="w-full py-2 bg-theme-text/10 text-theme-text text-[10px] font-bold rounded-lg border border-theme-text/20 hover:bg-theme-text/20 transition-all flex items-center justify-center gap-2"
                         >
                           {isTesting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} 运行风格涂抹测试
                         </button>
                         {testOutput && (
                            <div className="p-3 bg-white border border-theme-border rounded-lg text-xs text-theme-text italic leading-relaxed font-serif shadow-inner">
                              {testOutput}
                            </div>
                         )}
                       </div>
                    </div>
                  </div>

                  <button 
                    onClick={handleSaveSkill}
                    disabled={isSaving}
                    className="w-full py-4 mt-4 bg-theme-text text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:translate-y-[-2px] flex justify-center items-center gap-2 transition-all disabled:opacity-50 active:translate-y-0"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} 
                    确认功能并保存至技能库
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
