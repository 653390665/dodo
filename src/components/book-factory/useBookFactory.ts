import { useState, useEffect, useRef } from 'react';
import { listNovels, updateNovel } from '../../lib/novel-client';
import { createSkill } from '../../lib/skill-client';
import { extractSkill, checkSkillExtractionJob } from '../../lib/prompt-client';
import { coerceMountedSkillLoadout } from '../../lib/skill-model';
import type { Skill, AggregatedSkillDeck, Novel, BookEvidenceStage } from '../../../shared/types';

// 编码自动打分辅助函数
function scoreDecodedText(text: string): number {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const punctuationCount = (text.match(/[，。！？；：、“”‘’]/g) || []).length;
  return chineseCount * 2 + punctuationCount - replacementCount * 20;
}

// 自动判定编码并解码 Buffer
function decodeTextArrayBuffer(buffer: ArrayBuffer): string {
  const attempts: string[] = ['utf-8', 'gb18030', 'gbk'];
  const decodedCandidates: string[] = [];
  for (const encoding of attempts) {
    try {
      const useFatal = encoding === 'utf-8';
      const text = new TextDecoder(encoding, useFatal ? { fatal: true } : undefined).decode(buffer);
      decodedCandidates.push(text);
    } catch {}
  }
  if (decodedCandidates.length === 0) {
    return new TextDecoder('utf-8').decode(buffer);
  }
  return decodedCandidates.sort((a, b) => scoreDecodedText(b) - scoreDecodedText(a))[0];
}

// 标准化技能配置
export function normalizeSkillConfig(data: any): Skill {
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

export function normalizeSkillConfigs(data: any): Skill[] {
  const rawSkills = Array.isArray(data?.skills) ? data.skills : Array.isArray(data) ? data : data ? [data] : [];
  return rawSkills.map(normalizeSkillConfig);
}

export function useBookFactory() {
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

  // 轮询状态
  const [extractionSource, setExtractionSource] = useState<'fallback' | 'model' | null>(null);
  const [extractionJobId, setExtractionJobId] = useState<string | null>(null);
  const [isModelPending, setIsModelPending] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractionStatusNote, setExtractionStatusNote] = useState<string | null>(null);

  // 风格测试状态
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  // 装备状态
  const [showEquipPanel, setShowEquipPanel] = useState(false);
  const [equipNovelId, setEquipNovelId] = useState('');
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [lastSavedSkillId, setLastSavedSkillId] = useState('');
  const [savedDeckIds, setSavedDeckIds] = useState<string[]>([]);

  const lastSeenInputRef = useRef(fileContent);

  useEffect(() => {
    if (showEquipPanel) {
      listNovels().then(setUserNovels);
    }
  }, [showEquipPanel]);

  useEffect(() => {
    if (fileContent === lastSeenInputRef.current) return;
    lastSeenInputRef.current = fileContent;
    if (isAnalyzing) return;
    setExtractionWarnings([]);
    if (skillCards.length === 0) {
      setExtractionStatusNote(null);
    }
  }, [fileContent, isAnalyzing, skillCards.length]);

  // 后台轮询升级
  useEffect(() => {
    if (!extractionJobId || !isModelPending) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 60;

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
              `AI 深度分析未完成：${job.error || '模型响应失败'}。当前显示的是本地保底提炼结果。`,
            ]);
            setIsModelPending(false);
          }
          return;
        }
        if (!cancelled && attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(poll, 2000);
        } else if (!cancelled) {
          setExtractionWarnings((prev) => [...prev, 'AI 深度分析超时，当前显示的是本地保底提炼结果。']);
          setIsModelPending(false);
        }
      } catch (e) {
        if (!cancelled) {
          setExtractionWarnings((prev) => [...prev, `AI 深度分析轮询出错：${String(e)}。`]);
          setIsModelPending(false);
        }
      }
    };

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        setFileContent(decodeTextArrayBuffer(buffer));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAnalyze = async () => {
    if (!fileContent) return;
    setIsAnalyzing(true);
    setSkillCards([]);
    setSelectedSkillIndex(0);
    setDeck(null);
    setDeckMeta(null);
    setSegmentLabels([]);
    setIsEditing(false);
    setEditableJson("");
    setExtractionSource(null);
    setExtractionJobId(null);
    setIsModelPending(false);
    setExtractionWarnings([]);
    setExtractionStatusNote('正在拆书与提炼本地保底卡……');

    try {
      const data = await extractSkill(fileContent);
      const normalized = normalizeSkillConfigs(data);
      if (normalized.length === 0) {
        throw new Error('拆书接口返回成功，但没有可展示的技能卡。');
      }
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
      setEditableJson(JSON.stringify(normalized[0] || {}, null, 2));
      setExtractionSource(data.source || 'fallback');
      setExtractionWarnings(data.warnings || []);
      setExtractionStatusNote(data.statusNote || null);

      if (data.source === 'fallback' && data.jobId) {
        setExtractionJobId(data.jobId);
        setIsModelPending(true);
      }
    } catch (e) {
      console.error(e);
      setExtractionStatusNote('拆书未开始：当前文本还不足以进入萃取流程。');
      setExtractionWarnings([e instanceof Error ? e.message : String(e)]);
    } finally {
      setIsAnalyzing(false);
    }
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
          contextStr: "风格模拟测试场景。",
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
            } catch {}
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
      alert(`Deck 已保存：主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡`);
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
    alert(`Deck「${deck.mainCard.name}」已装备到作品。`);
  };

  return {
    fileContent, setFileContent,
    isAnalyzing,
    skillCards,
    selectedSkillIndex, setSelectedSkillIndex,
    deckMeta,
    deck,
    segmentLabels,
    isSaving,
    isEditing, setIsEditing,
    editableJson, setEditableJson,
    extractionSource,
    isModelPending,
    extractionWarnings,
    extractionStatusNote,
    selectedSkill,
    testInput, setTestInput,
    testOutput, setTestOutput,
    isTesting,
    showEquipPanel, setShowEquipPanel,
    equipNovelId, setEquipNovelId,
    userNovels,
    lastSavedSkillId,
    savedDeckIds,
    handleFileUpload,
    handleAnalyze,
    handleTestDrive,
    handleSaveSelectedSkill,
    handleSaveDeck,
    handleEquipDeck,
    handleEquipSkill,
    updateSelectedSkill,
  };
}
