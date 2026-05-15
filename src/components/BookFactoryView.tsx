import React, { useState, useEffect } from 'react';
import { Upload, BookTemplate, Save, CheckCircle2, ChevronRight, Wand2, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { createSkill, extractSkill, listNovels, updateNovel, checkSkillExtractionJob } from '../lib/api';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import type { Skill, SkillDimension, SkillDeckCard, AggregatedSkillDeck, Novel, BookEvidenceStage, SkillEvidenceCoverage } from '../types';

const SKILL_DIMENSIONS: Array<{ value: SkillDimension; label: string }> = [
  { value: 'style', label: '文笔文风' },
  { value: 'character', label: '人物构建' },
  { value: 'world', label: '世界观打造' },
  { value: 'power', label: '战力设定' },
  { value: 'plot', label: '剧情结构' },
  { value: 'pacing', label: '节奏控制' },
];

const SLOT_RECOMMENDATION: Record<
  SkillDimension,
  { slotLabel: string; reason: string; cardType: string }
> = {
  style: {
    slotLabel: '卡槽 1 · 主笔位',
    reason: '优先决定整段文字的总笔调，适合做组合里的主声部。',
    cardType: '主笔文风卡',
  },
  character: {
    slotLabel: '卡槽 2 · 人物位',
    reason: '更适合作为人物塑造滤镜，补足角色说话方式与行为模式。',
    cardType: '人物驱动卡',
  },
  world: {
    slotLabel: '卡槽 2 · 设定位',
    reason: '适合作为中层背景约束，为主笔卡补充世界观与规则感。',
    cardType: '世界约束卡',
  },
  power: {
    slotLabel: '卡槽 2 · 设定位',
    reason: '适合作为战力与体系补强卡，避免主笔卡里塞满力量设定。',
    cardType: '体系爆点卡',
  },
  plot: {
    slotLabel: '卡槽 3 · 推进位',
    reason: '适合放在后段补强剧情推进与爽点结构。',
    cardType: '剧情推进卡',
  },
  pacing: {
    slotLabel: '卡槽 3 · 节奏位',
    reason: '更适合作为组合尾部调速器，控制快慢与爆点密度。',
    cardType: '节奏控制卡',
  },
};

function getDimensionLabel(dimension?: SkillDimension): string {
  return SKILL_DIMENSIONS.find((item) => item.value === dimension)?.label || '未标注';
}

function getSkillRecommendation(skill: Skill) {
  return SLOT_RECOMMENDATION[skill.primaryDimension || 'style'];
}

function getDimensionBand(score: number): string {
  if (score >= 85) return '高特征';
  if (score >= 70) return '推荐使用';
  if (score >= 55) return '可补位';
  return '弱信号';
}

function normalizeSkillConfig(data: any): Skill {
  return {
    ...data,
    primaryDimension: data.primaryDimension || 'style',
    dimensionTags: data.dimensionTags?.length ? data.dimensionTags : ['style'],
    compositionProfile: data.compositionProfile || {
      styleWeight: 0.8,
      characterWeight: 0.4,
      worldWeight: 0.4,
      powerWeight: 0.3,
      plotWeight: 0.5,
      pacingWeight: 0.6,
      conflictTags: [],
      blendHints: [],
    },
  };
}

function normalizeSkillConfigs(data: any): Skill[] {
  const rawSkills = Array.isArray(data?.skills) ? data.skills : Array.isArray(data) ? data : data ? [data] : [];
  return rawSkills.map(normalizeSkillConfig);
}

const EVIDENCE_COVERAGE_LABELS: Record<SkillEvidenceCoverage, string> = {
  'full-book-stable': '全书稳定',
  'opening-heavy': '开篇偏强',
  'mid-book-heavy': '中段偏强',
  'climax-heavy': '高潮偏强',
  'weak-evidence': '局部信号',
};

const EVIDENCE_STAGE_LABELS: Record<BookEvidenceStage, string> = {
  opening: '开篇',
  'early-mid': '前中段',
  mid: '中段',
  'late-mid': '后中段',
  climax: '高潮/收束',
};

export function BookFactoryView() {
  const [fileContent, setFileContent] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [skillCards, setSkillCards] = useState<Skill[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [deckMeta, setDeckMeta] = useState<{ mainCardId?: string; supportCount?: number } | null>(null);
  const [deck, setDeck] = useState<AggregatedSkillDeck | null>(null);
  const [segmentLabels, setSegmentLabels] = useState<Array<{ id: string; stage: BookEvidenceStage; label: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableJson, setEditableJson] = useState("");
  // Fallback-first extraction state (Skill A pattern)
  const [extractionSource, setExtractionSource] = useState<'fallback' | 'model' | null>(null);
  const [extractionJobId, setExtractionJobId] = useState<string | null>(null);
  const [isModelPending, setIsModelPending] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractionStatusNote, setExtractionStatusNote] = useState<string | null>(null);

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
    setExtractionSource(null);
    setExtractionJobId(null);
    setIsModelPending(false);
    setExtractionWarnings([]);
    setExtractionStatusNote(null);

    try {
      const data = await extractSkill(fileContent);
      const normalized = normalizeSkillConfigs(data);
      setSkillCards(normalized);
      setSelectedSkillIndex(0);
      setDeck(data.deck);
      setLastSavedSkillId('');
      setSavedDeckIds([]);
      setShowEquipPanel(false);
      setDeckMeta({
        mainCardId: data.deck?.mainCard?.id,
        supportCount: Array.isArray(data.deck?.supportCards) ? data.deck.supportCards.length : Math.max(0, normalized.length - 1),
      });
      setSegmentLabels(Array.isArray(data.segments) ? data.segments : []);
      setIsEditing(false);
      setEditableJson(JSON.stringify(normalized[0] || {}, null, 2));

      // Set source tracking for fallback-first pattern
      setExtractionSource(data.source || 'fallback');
      setExtractionWarnings(data.warnings || []);
      setExtractionStatusNote(data.statusNote || null);

      // If fallback-only, kick off background polling for model upgrade
      if (data.source === 'fallback' && data.jobId) {
        setExtractionJobId(data.jobId);
        setIsModelPending(true);
      }
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
  const [showEquipPanel, setShowEquipPanel] = useState(false);
  const [equipNovelId, setEquipNovelId] = useState('');
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [lastSavedSkillId, setLastSavedSkillId] = useState('');
  const [savedDeckIds, setSavedDeckIds] = useState<string[]>([]);

  useEffect(() => {
    if (showEquipPanel) {
      listNovels().then(setUserNovels);
    }
  }, [showEquipPanel]);

  // Poll for model extraction upgrade (Skill A pattern: replace fallback when model arrives)
  useEffect(() => {
    if (!extractionJobId || !isModelPending) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 60; // ~2 minutes at 2s intervals

    const poll = async () => {
      if (cancelled) return;
      try {
        attempts++;
        const job = await checkSkillExtractionJob(extractionJobId);

        if (job.status === 'completed' && job.skills) {
          if (!cancelled) {
            const normalized = normalizeSkillConfigs({ skills: job.skills });
            setSkillCards(normalized);
            if (job.deck) setDeck(job.deck);
            if (job.segments) setSegmentLabels(job.segments);
            setExtractionSource('model');
            setExtractionWarnings(job.warnings || []);
            setIsModelPending(false);
            if (normalized[0]) {
              setEditableJson(JSON.stringify(normalized[0], null, 2));
            }
          }
          return;
        }

        if (job.status === 'failed') {
          if (!cancelled) {
            setExtractionWarnings((prev) => [
              ...prev,
              `AI 深度分析未完成：${job.error || '模型响应失败'}。当前显示的是本地保底萃取结果。`,
            ]);
            setIsModelPending(false);
          }
          return;
        }

        // Still pending — keep polling
        if (!cancelled && attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(poll, 2000);
        } else if (!cancelled) {
          setExtractionWarnings((prev) => [
            ...prev,
            'AI 深度分析超时，当前显示的是本地保底萃取结果。',
          ]);
          setIsModelPending(false);
        }
      } catch (e) {
        if (!cancelled) {
          setExtractionWarnings((prev) => [
            ...prev,
            `AI 深度分析轮询出错：${String(e)}。当前显示的是本地保底萃取结果。`,
          ]);
          setIsModelPending(false);
        }
      }
    };

    // Start polling after a short initial delay
    const timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [extractionJobId, isModelPending]);
  const selectedSkill = skillCards[selectedSkillIndex] || null;
  const updateSelectedSkill = (updater: (skill: Skill) => Skill) => {
    setSkillCards((current) =>
      current.map((skill, index) => (index === selectedSkillIndex ? updater(skill) : skill)),
    );
  };

  const handleTestDrive = async () => {
    if (!selectedSkill || !testInput) return;
    setIsTesting(true);
    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftingSurface: 'workspace-draft',
          reviewSurface: 'chapter-review',
          contextStr: "这是一个风格模拟测试场景。",
          sceneBeats: testInput,
          skills: [selectedSkill],
          maxIterations: 1,
          draftContent: "",
          includeCritic: false
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

  const handleSaveSkill = async (targetSkill: Skill, forcedId?: string) => {
    setIsSaving(true);
    const now = forcedId ? Number(forcedId) || Date.now() : Date.now();
    const id = forcedId || now.toString();
    await createSkill({
      ...targetSkill,
      id,
      lineageRootId: targetSkill.lineageRootId || id,
      createdAt: now,
      updatedAt: now,
    });
    setIsSaving(false);
    return id;
  };

  const handleEquipSkill = async () => {
    if (!equipNovelId || !lastSavedSkillId || isSaving) return;
    const novel = userNovels.find((n) => n.id === equipNovelId);
    if (!novel) return;
    const currentIds = novel.mountedSkillIds || [];
    if (currentIds.includes(lastSavedSkillId)) {
      setShowEquipPanel(false);
      return;
    }
    if (currentIds.length >= 3) {
      alert('每个作品最多装备 3 个技能。请先在技能仓库中移除一个。');
      return;
    }
    const newIds = [...currentIds, lastSavedSkillId];
    await updateNovel(equipNovelId, {
      mountedSkillIds: newIds,
      mountedSkillLoadout: coerceMountedSkillLoadout(newIds),
    });
    setShowEquipPanel(false);
  };

  const handleSaveSelectedSkill = async () => {
    if (!selectedSkill || isSaving) return;
    if (lastSavedSkillId) {
      setShowEquipPanel(true);
      setEquipNovelId('');
      return;
    }
    const id = Date.now().toString();
    const deckGroupId = deck ? `single-${id}` : undefined;
    await handleSaveSkill({ ...selectedSkill, deckGroupId } as Skill, id);
    setLastSavedSkillId(id);
    setShowEquipPanel(true);
    setEquipNovelId('');
  };

  const handleSaveDeck = async (): Promise<string[]> => {
    if (!deck) return [];
    if (savedDeckIds.length > 0) return savedDeckIds;
    setIsSaving(true);
    try {
      const deckGroupId = Date.now().toString();
      const allCards = [deck.mainCard, ...deck.supportCards];
      const savedIds: string[] = [];
      for (const card of allCards) {
        const now = Date.now() + Math.floor(Math.random() * 1000);
        const id = now.toString();
        await createSkill({
          ...normalizeSkillConfig(card),
          id,
          lineageRootId: card.lineageRootId || id,
          deckGroupId,
          createdAt: now,
          updatedAt: now,
        });
        savedIds.push(id);
      }
      setSavedDeckIds(savedIds);
      setLastSavedSkillId(savedIds[0] || '');
      alert(`Deck 已保存：主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡 (ID: ${deckGroupId})`);
      return savedIds;
    } finally {
      setIsSaving(false);
    }
  };

  const handleEquipDeck = async () => {
    if (!equipNovelId || !deck || isSaving) return;
    const novel = userNovels.find((n) => n.id === equipNovelId);
    if (!novel) return;
    const allCards = [deck.mainCard, ...deck.supportCards];
    const mountedIds = (savedDeckIds.length > 0 ? savedDeckIds : await handleSaveDeck())
      .slice(0, Math.min(allCards.length, 3));
    if (mountedIds.length === 0) return;
    const loadout = mountedIds.map((skillId, index) => ({
      slot: index + 1,
      skillId,
      weight: index === 0 ? 1 : 0.7,
      lockedDimensions: [allCards[index]?.primaryDimension || 'style'],
    }));
    await updateNovel(equipNovelId, {
      mountedSkillIds: mountedIds,
      mountedSkillLoadout: loadout as any,
    });
    setShowEquipPanel(false);
    alert(`Deck「${deck.mainCard.name}」已装备到作品，共 ${mountedIds.length} 张卡。`);
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
                <h3 className="font-bold text-theme-text">萃取结果 (Skill Deck)</h3>
                {extractionSource === 'fallback' && !isModelPending && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-[10px] font-bold text-amber-700">
                    保底萃取
                  </span>
                )}
                {extractionSource === 'fallback' && isModelPending && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-[10px] font-bold text-blue-700 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    保底萃取
                  </span>
                )}
                {extractionSource === 'model' && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-[10px] font-bold text-emerald-700">
                    AI 深度萃取
                  </span>
                )}
              </div>
              {selectedSkill && (
                <button
                  onClick={() => {
                    if (isEditing) {
                      try {
                        const parsed = JSON.parse(editableJson);
                        updateSelectedSkill(() => normalizeSkillConfig(parsed));
                        setIsEditing(false);
                      } catch (e) {
                        alert("JSON 格式错误，请检查后再保存编辑。");
                      }
                    } else {
                      setEditableJson(JSON.stringify(selectedSkill, null, 2));
                      setIsEditing(true);
                    }
                  }}
                  className="text-[10px] bg-white border border-theme-border px-3 py-1 rounded-lg font-bold hover:bg-theme-sidebar transition-all flex items-center gap-1.5"
                >
                  {isEditing ? <><CheckCircle2 size={12} className="text-emerald-500" /> 完成编辑</> : <><Wand2 size={12} /> 手动修正 JSON</>}
                </button>
              )}
            </div>
            {/* Status banner for model-pending and warnings */}
            {(isModelPending || extractionWarnings.length > 0) && (
              <div className="px-4 pb-1">
                {isModelPending && (
                  <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-2.5 mb-2 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-blue-600" />
                    <div className="text-[11px] text-blue-700 font-medium">
                      AI 正在后台深度分析文本风格...结果就绪后自动替换当前卡片。
                    </div>
                  </div>
                )}
                {extractionWarnings.map((warning, idx) => (
                  <div key={idx} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2 mb-1.5 text-[11px] text-amber-700 leading-relaxed">
                    {warning}
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 p-6 overflow-y-auto bg-white/50 backdrop-blur-sm">
              {!selectedSkill ? (
                <div className="h-full flex flex-col items-center justify-center text-theme-muted/50">
                  <Wand2 size={48} className="mb-4 opacity-50" />
                  <p>{isAnalyzing ? '正在拆书...' : '等待拆书结果...'}</p>
                  {extractionStatusNote && (
                    <p className="text-[11px] text-theme-muted/60 mt-2 max-w-xs text-center">{extractionStatusNote}</p>
                  )}
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
                  <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">卡组拆解结果</div>
                        <div className="text-xs text-theme-muted mt-1">
                          本次拆书会把整书分段取证，再汇总成可直接进入工作台的卡组。当前共生成 {skillCards.length} 张技能卡。
                        </div>
                      </div>
                      {savedDeckIds.length > 0 && (
                        <div className="px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-[11px] font-bold text-emerald-700">
                          Deck 已保存
                        </div>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-theme-border bg-white px-3 py-3">
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">主笔卡</div>
                        <div className="mt-2 text-sm font-bold text-theme-text">
                          {deck?.mainCard?.name || '待生成'}
                        </div>
                        {deck?.mainCard?.stabilityScore != null && (
                          <div className="text-[10px] text-theme-accent mt-0.5">稳定性 {deck.mainCard.stabilityScore}%</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-theme-border bg-white px-3 py-3">
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">副卡</div>
                        <div className="mt-2 text-sm font-bold text-theme-text">{deck?.supportCards?.length ?? deckMeta?.supportCount ?? 0} 张</div>
                        {deck?.supportCards?.length ? (
                          <div className="text-[10px] text-theme-muted mt-0.5 truncate">
                            {deck.supportCards.map((c) => c.name).join('、')}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-theme-border bg-white px-3 py-3">
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">取证阶段</div>
                        <div className="mt-2 text-sm font-bold text-theme-text">{segmentLabels.length || 0} 段</div>
                      </div>
                    </div>
                    {deck && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        <button
                          onClick={() => void handleSaveDeck()}
                          disabled={isSaving || savedDeckIds.length > 0}
                          className="px-4 py-2 rounded-xl bg-theme-accent text-white text-[11px] font-bold hover:bg-theme-accent/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <Save size={12} /> {savedDeckIds.length > 0 ? '整组 Deck 已保存' : '保存整组 Deck'}
                        </button>
                        <button
                          onClick={() => { setShowEquipPanel(true); setEquipNovelId(''); }}
                          className="px-4 py-2 rounded-xl border border-theme-accent text-theme-accent text-[11px] font-bold hover:bg-theme-accent/5 transition-colors"
                        >
                          装备整组 Deck
                        </button>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {skillCards.map((skill, index) => (
                        (() => {
                          const recommendation = getSkillRecommendation(skill);
                          return (
                        <button
                          key={`${skill.name}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedSkillIndex(index);
                            setIsEditing(false);
                            setEditableJson(JSON.stringify(skill, null, 2));
                            setTestOutput('');
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                            selectedSkillIndex === index
                              ? 'border-theme-accent bg-theme-accent/5'
                              : 'border-theme-border bg-white hover:bg-theme-sidebar/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-bold text-theme-text">{skill.name}</div>
                              <div className="text-[10px] text-theme-muted mt-1">
                                {index === 0 && deck ? '主笔卡' : index > 0 && deck ? `副卡 · ${recommendation.cardType}` : recommendation.cardType}
                              </div>
                            </div>
                            <div className="text-[10px] font-bold text-theme-accent">{skill.stabilityScore}%</div>
                          </div>
                          <div className="mt-2 rounded-xl bg-theme-sidebar/40 border border-theme-border px-3 py-2">
                            <div className="text-[10px] font-bold text-theme-text">{recommendation.slotLabel}</div>
                            <div className="text-[10px] text-theme-muted mt-1 leading-relaxed">{recommendation.reason}</div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(skill.dimensionTags || []).slice(0, 3).map((tag) => (
                              <span key={tag} className="px-2 py-0.5 rounded-full bg-theme-sidebar text-[10px] text-theme-muted border border-theme-border">
                                {getDimensionLabel(tag)}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 text-[10px] text-theme-accent font-bold">
                            {getDimensionBand(skill.stabilityScore || 0)}
                          </div>
                          {!!skill.evidenceCoverage && (
                            <div className="mt-2 text-[10px] text-theme-muted">
                              {EVIDENCE_COVERAGE_LABELS[skill.evidenceCoverage]}
                            </div>
                          )}
                        </button>
                          );
                        })()
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-theme-text">{selectedSkill.name}</h2>
                      <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">
                        Card {selectedSkillIndex + 1} / {skillCards.length} · Version {selectedSkill.version || 1}
                      </p>
                    </div>
                    <div className="px-4 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-2xl text-center">
                       <div className="text-xl font-bold text-theme-accent">{selectedSkill.stabilityScore}</div>
                       <div className="text-[8px] text-theme-muted uppercase font-bold">稳定性评分</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-4 py-3">
                      <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">卡片类型</div>
                      <div className="text-sm font-bold text-theme-text mt-2">
                        {selectedSkillIndex === 0 && deck ? '主笔卡（主导叙事基调）' : selectedSkillIndex > 0 && deck ? `副卡 · ${getSkillRecommendation(selectedSkill).cardType}` : getSkillRecommendation(selectedSkill).cardType}
                      </div>
                      <div className="text-xs text-theme-muted mt-1">
                        写作职责：{getSkillRecommendation(selectedSkill).reason}
                      </div>
                    </div>
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar/25 px-4 py-3">
                      <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">建议装配位</div>
                      <div className="text-sm font-bold text-theme-text mt-2">
                        {getSkillRecommendation(selectedSkill).slotLabel}
                      </div>
                      <div className="text-xs text-theme-muted mt-1 leading-relaxed">
                        {getSkillRecommendation(selectedSkill).reason}
                      </div>
                    </div>
                  </div>

                  <div className="bg-theme-sidebar/20 p-4 rounded-xl border border-theme-border/50 space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">证据覆盖</div>
                      <div className="text-xs text-theme-muted mt-1">
                        这些标签只说明这张卡在整书哪些阶段证据更强，不代表对整本书所有能力的完整判决。
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedSkill.evidenceCoverage ? (
                        <span className="px-3 py-1.5 rounded-full border border-theme-accent bg-theme-accent/10 text-[11px] font-bold text-theme-accent">
                          {EVIDENCE_COVERAGE_LABELS[selectedSkill.evidenceCoverage]}
                        </span>
                      ) : null}
                      {(selectedSkill.evidenceMoments || []).map((moment) => (
                        <span
                          key={moment}
                          className="px-3 py-1.5 rounded-full border border-theme-border bg-white text-[11px] text-theme-muted"
                        >
                          {EVIDENCE_STAGE_LABELS[moment]}
                        </span>
                      ))}
                    </div>
                    {segmentLabels.length > 0 ? (
                      <div className="text-[10px] text-theme-muted leading-relaxed">
                        本次整书拆书已覆盖：
                        {segmentLabels.map((segment) => segment.label).join(' / ')}
                      </div>
                    ) : null}
                  </div>

                  <p className="text-sm text-theme-muted italic bg-theme-sidebar/30 p-3 rounded-xl border-l-4 border-theme-accent quote font-serif">
                    “{selectedSkill.description}”
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {selectedSkill.style && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">描写风格 (Style)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.style}</p>
                      </div>
                    )}
                    {selectedSkill.pacing && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">叙事节奏 (Pacing)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.pacing}</p>
                      </div>
                    )}
                    {selectedSkill.characterTraits && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">人物特征 (Character)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.characterTraits}</p>
                      </div>
                    )}
                    {selectedSkill.worldBuilding && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">世界观与力量 (World)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.worldBuilding}</p>
                      </div>
                    )}
                    {selectedSkill.plotPattern && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">剧情爽点套路 (Plot Patterns)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.plotPattern}</p>
                      </div>
                    )}
                    {selectedSkill.foreshadowing && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm col-span-2">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-2">伏笔与悬念 (Foreshadowing)</h4>
                        <p className="text-xs text-theme-text leading-relaxed">{selectedSkill.foreshadowing}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {(selectedSkill.vocabulary?.length > 0 || selectedSkill.corePatterns?.length > 0) && (
                      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                        <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">核心要素提取</h4>
                        {selectedSkill.vocabulary?.length > 0 && (
                          <div className="mb-3">
                            <span className="text-[10px] font-bold text-theme-muted mr-2">特色词汇:</span>
                            <div className="flex flex-wrap gap-2 inline-flex">
                              {selectedSkill.vocabulary.map((v: string) => (
                                <span key={v} className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedSkill.corePatterns?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold text-theme-muted mr-2">剧情模式:</span>
                            <div className="flex flex-wrap gap-2 inline-flex">
                              {selectedSkill.corePatterns.map((v: string) => (
                                <span key={v} className="px-2 py-0.5 bg-theme-accent/10 border border-theme-accent/20 text-theme-accent rounded text-[10px] font-bold">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="mt-3 text-xs text-theme-muted border-t border-theme-border/50 pt-2 italic">
                          <strong>句式习惯:</strong> {selectedSkill.sentenceStructure || '未指定'}
                        </p>
                      </div>
                    )}

                    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                      <h4 className="text-[10px] font-bold text-red-500 uppercase mb-3">绝对禁止红线 (OOC / 毒点)</h4>
                      <div className="flex flex-wrap gap-2">
                        {(selectedSkill.bannedElements || selectedSkill.bannedWords || []).map((w: string) => (
                          <span key={w} className="px-2 py-0.5 bg-red-50 border border-red-100 text-red-600 rounded text-[10px] line-through">
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                      <h4 className="text-[10px] font-bold text-theme-accent uppercase mb-3">经典句式提取</h4>
                      <div className="space-y-2">
                        {(selectedSkill.fewShots || []).map((s: string, idx: number) => (
                          <div key={idx} className="text-xs text-theme-muted italic p-2 bg-theme-sidebar/10 rounded-lg border-l-2 border-theme-accent/30 font-serif">
                            "{s}"
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                       <h4 className="text-[10px] font-bold text-emerald-700 uppercase mb-1">功能性评估 (Functional Audit)</h4>
                       <p className="text-[11px] text-emerald-600 leading-relaxed font-medium">
                         {selectedSkill.evaluationFeedback}
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
                    onClick={handleSaveSelectedSkill}
                    disabled={isSaving || Boolean(deck && savedDeckIds.length > 0)}
                    className="w-full py-4 mt-4 bg-theme-text text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:translate-y-[-2px] flex justify-center items-center gap-2 transition-all disabled:opacity-50 active:translate-y-0"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {deck ? '单独保存当前卡（通常不需要）' : lastSavedSkillId ? '当前技能卡已保存' : '保存当前技能卡到技能库'}
                  </button>

                  {/* Equip panel */}
                  {showEquipPanel && (
                    <div className="mt-4 rounded-2xl border border-theme-accent/30 bg-theme-accent/5 p-5">
                      <div className="text-sm font-bold text-theme-text mb-1">
                        {deck ? '装备整组 Deck' : lastSavedSkillId ? '技能已保存' : '装备技能'}
                      </div>
                      <div className="text-xs text-theme-muted mb-4">
                        {deck
                          ? savedDeckIds.length > 0
                            ? `将已保存的主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡装备到作品。`
                            : `主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡将先保存一次，再装备到作品。`
                          : '装备到作品后，AI 生成时会参考这个技能的文风和节奏设定。'}
                      </div>
                      <div className="mb-3">
                        <label className="text-[10px] font-bold text-theme-muted uppercase">装备到</label>
                        <select
                          value={equipNovelId}
                          onChange={(e) => setEquipNovelId(e.target.value)}
                          className="w-full rounded-xl border border-theme-border px-3 py-2 text-sm mt-1 bg-white"
                        >
                          <option value="">不装备，仅保存到仓库</option>
                          {userNovels.map((n) => (
                            <option key={n.id} value={n.id}>{n.title}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={deck ? handleEquipDeck : handleEquipSkill}
                          disabled={!equipNovelId || isSaving}
                          className="rounded-xl bg-theme-accent text-white px-4 py-2 text-sm font-bold disabled:opacity-40 transition-opacity"
                        >
                          {isSaving ? '处理中...' : deck ? (savedDeckIds.length > 0 ? '装备已保存 Deck' : '保存并装备整组') : '装备已保存技能'}
                        </button>
                        <button
                          onClick={() => setShowEquipPanel(false)}
                          className="rounded-xl border border-theme-border px-4 py-2 text-sm text-theme-muted hover:text-theme-text transition-colors"
                        >
                          仅保存
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
