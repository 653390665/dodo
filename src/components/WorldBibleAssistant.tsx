import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, Trash2, X, ChevronRight } from 'lucide-react';
import type { Character, Faction, Item, Location, Novel, PowerLevel, TimelineEvent } from '../../shared/types';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import { buildSyncExtractionPrompt } from '../../shared/lib/sync-extract-prompt';
import { parseModelJsonPayloadStrict } from '../../shared/lib/model-json';
import {
  listCharacters, listLocations, listItems, listFactions, listPowerLevels, listTimelineEvents,
  createCharacter, createLocation, createItem, createFaction, createPowerLevel, createTimelineEvent,
} from '../lib/world-client';
import { listContinuationPacks, syncPackToWorld } from '../lib/continuation-client';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';
import { getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration } from '../lib/db-transport';
import { SyncPreviewPanel } from './world-bible/SyncPreviewPanel';
import { recordProductEvent } from '../lib/product-events-client';
import { readSseEvents, SseError } from '../lib/sse-client';
import { generateClientId } from '../lib/id';

type EntityType = 'character' | 'location' | 'item' | 'faction' | 'powerLevel' | 'timeline';
type Message = { id: string; sender: 'user' | 'assistant' | 'system'; text: string };
type Draft = { type: EntityType; data: Record<string, unknown>; databaseGeneration?: number };

type ExistingWorldSnapshot = {
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  powerLevels: PowerLevel[];
  timelineEvents: TimelineEvent[];
};

type PreparedSync = {
  packId: string;
  sourceReplyId: string;
  extraction: SyncExtractionResult;
  databaseGeneration: number;
  existing: ExistingWorldSnapshot;
  textConflicts: string[];
};

const welcome: Message = {
  id: 'welcome', sender: 'assistant',
  text: '你好！这里是智能管家的设定模式。你可以描述人物、地点、道具、势力、境界或时间线事件，我会生成可确认写入的设定。',
};

function cleanStreamingText(text: string) {
  return text.replace(/\[JSON_DATA\][\s\S]*?\[\/JSON_DATA\]/, '').replace(/\[JSON_DATA\][\s\S]*$/, '').trim();
}

async function describeInspirationError(response: Response): Promise<SseError> {
  const payload = await response.json().catch(() => null) as { error?: unknown; code?: unknown; traceId?: unknown; retriable?: unknown; finishReason?: unknown; reason?: unknown } | null;
  const message = payload && typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : `请求失败（HTTP ${response.status}）`;
  const code = payload && typeof payload.code === 'string' && payload.code.trim()
    ? ` [${payload.code.trim()}]`
    : '';
  return new SseError(`${message}${code}`, {
    code: payload && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`,
    traceId: payload && typeof payload.traceId === 'string' ? payload.traceId : undefined,
    retriable: payload && typeof payload.retriable === 'boolean' ? payload.retriable : response.status >= 500 || response.status === 429,
    finishReason: payload && typeof payload.finishReason === 'string' ? payload.finishReason : undefined,
    reason: payload?.reason === 'no_content' || payload?.reason === 'reasoning_only' || payload?.reason === 'length_exhausted' ? payload.reason : undefined,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asInteger(value: unknown, fallback = 0): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

const MAX_CONTEXT_DETAIL_ROWS = 60;
const MAX_CONTEXT_FIELD_CHARS = 180;

function clipContext(value: unknown, maxChars = MAX_CONTEXT_FIELD_CHARS): string {
  return typeof value === 'string' && value.length > maxChars ? `${value.slice(0, maxChars)}…` : String(value || '');
}

function buildCompactWorldContext(snapshot: ExistingWorldSnapshot): string {
  return JSON.stringify({
    characters: {
      names: snapshot.characters.map(item => item.name),
      details: snapshot.characters.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({
        name: item.name, role: item.role, summary: clipContext(item.summary), traits: item.traits.slice(0, 8),
        bio: clipContext(item.bio), current_state: clipContext(item.current_state),
      })),
    },
    locations: {
      names: snapshot.locations.map(item => item.name),
      details: snapshot.locations.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({ name: item.name, region: item.region, description: clipContext(item.description) })),
    },
    items: {
      names: snapshot.items.map(item => item.name),
      details: snapshot.items.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({ name: item.name, type: item.type, description: clipContext(item.description) })),
    },
    factions: {
      names: snapshot.factions.map(item => item.name),
      details: snapshot.factions.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({ name: item.name, leader: item.leader, territory: item.territory, description: clipContext(item.description) })),
    },
    powerLevels: {
      names: snapshot.powerLevels.map(item => item.name),
      details: snapshot.powerLevels.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({ name: item.name, tier: item.tier, characteristics: clipContext(item.characteristics), description: clipContext(item.description) })),
    },
    timelineEvents: {
      names: snapshot.timelineEvents.map(item => item.title),
      details: snapshot.timelineEvents.slice(0, MAX_CONTEXT_DETAIL_ROWS).map(item => ({ title: item.title, timestamp: item.timestamp, description: clipContext(item.description) })),
    },
  });
}

function normalizeSyncExtraction(value: unknown): SyncExtractionResult {
  const root = asRecord(value);
  const rows = (key: string) => Array.isArray(root[key]) ? (root[key] as unknown[]).map(asRecord) : [];
  const entityTypes = new Set(['character', 'location', 'item', 'faction']);
  return {
    characters: rows('characters').map(row => ({
      name: asText(row.name), role: asText(row.role) || 'supporting', summary: asText(row.summary),
      bio: asText(row.bio), traits: Array.isArray(row.traits) ? row.traits.map(asText).filter(Boolean) : [],
      sourceDocumentIds: Array.isArray(row.sourceDocumentIds) ? row.sourceDocumentIds.map(asText).filter(Boolean) : [],
    })).filter(row => row.name),
    locations: rows('locations').map(row => ({ name: asText(row.name), region: asText(row.region), description: asText(row.description) })).filter(row => row.name),
    items: rows('items').map(row => ({ name: asText(row.name), type: asText(row.type) || 'other', description: asText(row.description) })).filter(row => row.name),
    factions: rows('factions').map(row => ({ name: asText(row.name), leader: asText(row.leader), territory: asText(row.territory), description: asText(row.description) })).filter(row => row.name),
    powerLevels: rows('powerLevels').map(row => ({ name: asText(row.name), tier: asInteger(row.tier), characteristics: asText(row.characteristics), description: asText(row.description) })).filter(row => row.name),
    timelineEvents: rows('timelineEvents').map(row => ({ title: asText(row.title), timestamp: asText(row.timestamp), description: asText(row.description), order: asInteger(row.order) })).filter(row => row.title),
    relationships: rows('relationships').map(row => ({
      sourceName: asText(row.sourceName), sourceType: asText(row.sourceType), targetName: asText(row.targetName),
      targetType: asText(row.targetType), relationshipType: asText(row.relationshipType), description: asText(row.description),
    })).filter(row => row.sourceName && row.targetName && row.relationshipType && entityTypes.has(row.sourceType) && entityTypes.has(row.targetType)) as SyncExtractionResult['relationships'],
    globalOutline: asText(root.globalOutline),
    worldRules: asText(root.worldRules),
  };
}

async function readInspirationStream(response: Response, onToken?: (text: string) => void): Promise<{ text: string; databaseGeneration: number }> {
  if (!response.ok) throw await describeInspirationError(response);
  if (!response.body) throw new SseError('服务器未返回生成流，请稍后重试。', { code: 'SSE_NO_BODY', retriable: true });
  const databaseGeneration = requireResponseDatabaseGeneration(response);
  let accumulated = '';
  let succeeded = false;
  let sawDoneEvent = false;
  const result = await readSseEvents<{ type?: string; token?: string; content?: string; text?: string }>(response, (data) => {
    if (data.type === 'success') {
      succeeded = true;
      if (typeof data.text === 'string') {
        accumulated += data.text;
        onToken?.(accumulated);
      }
    }
    const token = data.token || (data.type === 'token' ? data.content : undefined);
    if (token) {
      succeeded = true;
      accumulated += token;
      onToken?.(accumulated);
    }
    if (data.type === 'done') {
      sawDoneEvent = true;
      return 'done';
    }
  });
  if (!result.done && !sawDoneEvent) throw new SseError('生成连接提前结束，未完成冲突检查。', { code: 'SSE_EOF', retriable: true });
  if (!succeeded) throw new SseError('模型未返回可用内容，请重试。', { code: 'empty_response', reason: 'no_content', retriable: true });
  if (!accumulated.trim()) throw new SseError('模型未返回可用内容，请重试。', { code: 'empty_response', reason: 'no_content', retriable: true });
  return { text: accumulated, databaseGeneration };
}

export function WorldBibleAssistant({ novel, onClose, continuationPackId }: { novel: Novel; onClose: () => void; continuationPackId?: string }) {
  const session = useAssistantSessionStore(state => state.getSession(novel.id, 'bible')) as {
    input?: string; draft?: Draft | null; messages?: Message[]; isLoading?: boolean; loading?: boolean; failure?: { code: string; message: string; prompt: string; failedAt: number; requestId: string; retriable: boolean; reason?: 'no_content' | 'reasoning_only' | 'length_exhausted'; finishReason?: string; traceId?: string } | null;
  };
  const store = useAssistantSessionStore.getState();
  const requestRef = useRef<{ id: string; novelId: string; controller: AbortController } | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const commitLock = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [preparedSync, setPreparedSync] = useState<PreparedSync | null>(null);
  const [isPreparingSync, setIsPreparingSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncErrorCode, setSyncErrorCode] = useState<string | null>(null);
  const [lastReplyFailed, setLastReplyFailed] = useState(false);
  const [inferredContinuationPack, setInferredContinuationPack] = useState<{ novelId: string; packId: string } | null>(null);
  const resolvedContinuationPackId = continuationPackId
    || (inferredContinuationPack?.novelId === novel.id ? inferredContinuationPack.packId : undefined);

  const cancelActiveRequest = () => {
    const active = requestRef.current;
    if (!active) return;
    active.controller.abort();
    store.finishRequest(active.novelId, 'bible', active.id);
    if (requestRef.current === active) requestRef.current = null;
  };

  useEffect(() => {
    if (!session.messages?.length) store.setMessages(novel.id, 'bible', [welcome]);
    // Store actions are stable; novel changes own the initialization boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel.id]);

  useEffect(() => () => {
    cancelActiveRequest();
    prepareAbortRef.current?.abort();
    // Store actions are stable; novel changes own the cancellation boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel.id]);

  useEffect(() => {
    prepareAbortRef.current?.abort();
    prepareAbortRef.current = null;
    // This effect resets transient UI state when the bound novel/pack changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreparedSync(null);
    setSyncError(null);
    setSyncErrorCode(null);
    setLastReplyFailed(false);
    setIsPreparingSync(false);
  }, [novel.id, continuationPackId]);

  const setInput = (value: string) => store.setInput(novel.id, 'bible', value);
  const setDraft = (draft: Draft | null) => store.setDraft(novel.id, 'bible', draft);
  const messages = session.messages?.length ? session.messages : [welcome];
  const isLoading = Boolean(session.isLoading ?? session.loading);
  let latestAssistantText = '';
  let latestAssistantMessage: Message | null = null;
  let latestUserText = '';
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].sender === 'user' && messages[index].text.trim()) {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex >= 0) latestUserText = messages[latestUserIndex].text.trim();
  for (let index = messages.length - 1; index > latestUserIndex; index -= 1) {
    const message = messages[index];
    if (message.sender === 'assistant' && message.id.endsWith('-assistant') && message.text.trim()) {
      latestAssistantText = message.text.trim();
      latestAssistantMessage = message;
      break;
    }
  }

  useEffect(() => {
    if (continuationPackId) return;
    const title = latestUserText.match(/资料包《([^》]+)》/)?.[1]?.trim();
    if (!title) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInferredContinuationPack(null);
      return;
    }
    let cancelled = false;
    void listContinuationPacks(novel.id).then((packs) => {
      if (cancelled) return;
      const matches = packs.filter(pack => pack.status === 'approved' && pack.title.trim() === title);
      setInferredContinuationPack(matches.length === 1 ? { novelId: novel.id, packId: matches[0].id } : null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [continuationPackId, latestUserText, novel.id]);

  const submit = async (isRetry = false) => {
    const input = (session.input || '').trim();
    if (!input || isLoading) return;
    prepareAbortRef.current?.abort();
    prepareAbortRef.current = null;
    setIsPreparingSync(false);
    setPreparedSync(null);
    setSyncError(null);
    setSyncErrorCode(null);
    const requestId = store.startRequest(novel.id, 'bible');
    const failedRequest = store.getSession(novel.id, 'bible').failure;
    store.clearFailure(novel.id, 'bible');
    void recordProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: novel.id, objectId: requestId });
    if (failedRequest) void recordProductEvent({ eventName: 'assistant_retry', stage: 'assistant', result: 'success', novelId: novel.id, objectId: failedRequest.requestId });
    const controller = new AbortController();
    requestRef.current?.controller.abort();
    requestRef.current = { id: requestId, novelId: novel.id, controller };
    const isCurrent = () => requestRef.current?.id === requestId && requestRef.current.novelId === novel.id && !controller.signal.aborted;
    const userId = `${Date.now()}-user`;
    if (!isRetry) {
      store.appendMessage(novel.id, 'bible', { id: userId, sender: 'user', text: input });
      setInput('');
    }
    store.setLoading(novel.id, 'bible', true);
    const assistantId = `${Date.now()}-assistant`;
    try {
      const [characters, locations, items, factions, powerLevels, timelineEvents] = await Promise.all([
        listCharacters(novel.id), listLocations(novel.id), listItems(novel.id), listFactions(novel.id),
        listPowerLevels(novel.id), listTimelineEvents(novel.id),
      ]);
      if (!isCurrent()) { controller.abort(); return; }
      const requestDatabaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      const context = buildCompactWorldContext({ characters, locations, items, factions, powerLevels, timelineEvents });
      const boundedInput = clipContext(input, 60_000);
      const prompt = `你是顶尖的玄幻/科幻/都市小说世界设定设计师，正在协助构建《${clipContext(novel.title, 500)}》。
【全局故事大纲】${clipContext(novel.globalOutline, 12_000) || '无'}
【世界观法则】${clipContext(novel.worldRules, 12_000) || '无'}
【已有设定】${context}
请响应作者：${boundedInput}。给出150字内点评；若作者要求创建实体，必须用 [JSON_DATA] 和 [/JSON_DATA] 包裹 JSON，且标记内只能是 JSON。type 可为 character/location/item/faction/powerLevel/timeline，data 遵循：character(name,role,summary,traits[],bio)，location(name,region,description)，item(name,type,description)，faction(name,leader,territory,description)，powerLevel(name,tier,characteristics,description)，timeline(title,description,timestamp,statusTag,order)。`;
      const response = await fetch('/api/inspiration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId: novel.id, prompt, surface: 'workspace-draft', purpose: 'world-bible', databaseGeneration: requestDatabaseGeneration }), signal: controller.signal,
      });
      if (!isCurrent()) { controller.abort(); return; }
      store.appendMessage(novel.id, 'bible', { id: assistantId, sender: 'assistant', text: '✍️ 正在构思设定中...' });
      const streamed = await readInspirationStream(response, (accumulated) => {
        if (isCurrent()) store.updateMessage(novel.id, 'bible', assistantId, { text: cleanStreamingText(accumulated) || '✍️ 正在设计专属新设定中...' });
      });
      if (!isCurrent()) return;
      const { text: accumulated, databaseGeneration: responseDatabaseGeneration } = streamed;
      const match = accumulated.match(/\[JSON_DATA\]([\s\S]*?)\[\/JSON_DATA\]/);
      let parsed: Draft | null = null;
      if (match?.[1]) {
        try {
          const value = JSON.parse(match[1].trim()) as Draft;
          const allowedTypes: EntityType[] = ['character', 'location', 'item', 'faction', 'powerLevel', 'timeline'];
          if (allowedTypes.includes(value.type) && value.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
            parsed = { ...value, databaseGeneration: responseDatabaseGeneration };
          }
        } catch { /* preserve text fallback */ }
      }
      if (parsed && isCurrent()) setDraft(parsed);
      const cleanedText = cleanStreamingText(accumulated);
      const text = cleanedText
        || (parsed ? `✨ 已设计好「${String(parsed.data.name || parsed.data.title || '新设定')}」，请确认写入。`
          : resolvedContinuationPackId
            ? '批量草稿已生成，但结构化设定解析未完成。请点击“检查冲突并准备写入”重试提取。'
            : '未能生成可确认的设定数据，请调整描述后重试。');
      if (isCurrent() && store.getSession(novel.id, 'bible').activeRequestId === requestId) {
        store.updateMessage(novel.id, 'bible', assistantId, { text });
        void recordProductEvent({ eventName: 'assistant_success', stage: 'assistant', result: 'success', novelId: novel.id, objectId: requestId });
        if (failedRequest) void recordProductEvent({ eventName: 'assistant_recovered', stage: 'assistant', result: 'success', novelId: novel.id, objectId: failedRequest.requestId, durationMs: Math.max(0, Date.now() - failedRequest.failedAt) });
        store.clearFailure(novel.id, 'bible');
        setLastReplyFailed(false);
      }
    } catch (error) {
      if (!controller.signal.aborted && requestRef.current?.id === requestId && requestRef.current.novelId === novel.id) {
        store.removeMessage(novel.id, 'bible', assistantId);
        setLastReplyFailed(true);
        setInput(input);
        const code = typeof (error as { code?: unknown })?.code === 'string'
          ? String((error as { code: string }).code)
          : 'assistant_failure';
        const empty = code === 'empty_response';
        void recordProductEvent({ eventName: empty ? 'assistant_empty_response' : 'assistant_failure', stage: 'assistant', result: 'failure', novelId: novel.id, objectId: requestId, errorCode: code });
        const message = error instanceof Error && error.message.trim() ? error.message : '请求未完成，请检查网络或模型配置后重试。';
        const retriable = typeof (error as { retriable?: unknown })?.retriable === 'boolean'
          ? Boolean((error as { retriable: boolean }).retriable)
          : !['configuration', 'authentication', 'billing'].includes(code);
        const reason = (error as { reason?: unknown })?.reason;
        const finishReason = typeof (error as { finishReason?: unknown })?.finishReason === 'string' ? String((error as { finishReason: string }).finishReason) : undefined;
        const traceId = typeof (error as { traceId?: unknown })?.traceId === 'string' ? String((error as { traceId: string }).traceId) : undefined;
        store.setFailure(novel.id, 'bible', {
          code,
          message,
          prompt: input,
          failedAt: Date.now(),
          requestId,
          retriable,
          reason: reason === 'no_content' || reason === 'reasoning_only' || reason === 'length_exhausted' ? reason : undefined,
          finishReason,
          traceId,
        });
      }
    } finally {
      if (requestRef.current?.id === requestId && requestRef.current.novelId === novel.id) { requestRef.current = null; store.finishRequest(novel.id, 'bible', requestId); store.setLoading(novel.id, 'bible', false); }
    }
  };

  const prepareSyncFromLatestReply = async () => {
    if (!resolvedContinuationPackId || !latestAssistantText || isPreparingSync || isLoading) return;
    const targetPackId = resolvedContinuationPackId;
    const sourceReplyId = latestAssistantMessage?.id;
    if (!sourceReplyId) return;
    prepareAbortRef.current?.abort();
    const controller = new AbortController();
    prepareAbortRef.current = controller;
    setIsPreparingSync(true);
    setPreparedSync(null);
    setSyncError(null);
    try {
      const existingPromise = Promise.all([
        listCharacters(novel.id), listLocations(novel.id), listItems(novel.id), listFactions(novel.id),
        listPowerLevels(novel.id), listTimelineEvents(novel.id),
      ]);
      const [characters, locations, items, factions, powerLevels, timelineEvents] = await existingPromise;
      const requestDatabaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch('/api/inspiration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              novelId: novel.id,
              surface: 'workspace-draft',
              purpose: 'sync-extraction',
              prompt: `${buildSyncExtractionPrompt([latestAssistantText], attempt > 0 ? { repairKind: 'json_syntax', compact: true } : {})}\n\n补充要求：只提取回复中明确列出的设定草稿；不得把“待核对”的资料或模型推测伪装为原资料证据。`,
              databaseGeneration: requestDatabaseGeneration,
            }),
            signal: controller.signal,
          });
          const { text, databaseGeneration: responseDatabaseGeneration } = await readInspirationStream(response);
          const extraction = normalizeSyncExtraction(parseModelJsonPayloadStrict(text, { expectedRoot: 'object' }));
          const extractedCount = extraction.characters.length + extraction.locations.length + extraction.items.length
            + extraction.factions.length + extraction.powerLevels.length + extraction.timelineEvents.length
            + extraction.relationships.length;
          if (extractedCount === 0 && !extraction.globalOutline && !extraction.worldRules) {
            throw new Error('没有提取到可写入的结构化设定。');
          }
          if (controller.signal.aborted) return;
          setPreparedSync({
            packId: targetPackId,
            sourceReplyId,
            extraction: {
              ...extraction,
              globalOutline: novel.globalOutline?.trim() ? '' : extraction.globalOutline,
              worldRules: novel.worldRules?.trim() ? '' : extraction.worldRules,
            },
            databaseGeneration: responseDatabaseGeneration,
            existing: { characters, locations, items, factions, powerLevels, timelineEvents },
            textConflicts: [
              ...(novel.globalOutline?.trim() && extraction.globalOutline ? ['全局大纲已有内容，新草稿不会自动覆盖'] : []),
              ...(novel.worldRules?.trim() && extraction.worldRules ? ['世界规则已有内容，新草稿不会自动覆盖'] : []),
            ],
          });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const code = typeof (error as { code?: unknown })?.code === 'string'
            ? String((error as { code: string }).code)
            : undefined;
          const retryableCode = !code || [
            'empty_response', 'service_unavailable', 'network', 'timeout',
            'INSPIRATION_UNAVAILABLE', 'INSPIRATION_STREAM_FAILED', 'INSPIRATION_STREAM_INTERRUPTED', 'SSE_EOF', 'SSE_INTERRUPTED', 'SSE_NO_BODY',
          ].includes(code);
          const retryableMessage = /JSON|结构化|模型未返回|解析未完成|可用内容/.test(message);
          if (attempt === 0 && !retryableCode && !retryableMessage) break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('无法准备同步草稿，请重试。');
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '无法准备同步草稿，请重试。';
        const code = typeof (error as { code?: unknown })?.code === 'string'
          ? String((error as { code: string }).code)
          : null;
        setSyncErrorCode(code);
        setSyncError(`冲突检查状态未知：${message}`);
      }
    } finally {
      if (prepareAbortRef.current === controller) prepareAbortRef.current = null;
      if (!controller.signal.aborted) setIsPreparingSync(false);
    }
  };

  const handleConfirmPreparedSync = async (
    selections: Parameters<React.ComponentProps<typeof SyncPreviewPanel>['onConfirm']>[0],
  ): Promise<boolean> => {
    if (!preparedSync || !resolvedContinuationPackId || isSyncing) return false;
    if (preparedSync.packId !== resolvedContinuationPackId || preparedSync.sourceReplyId !== latestAssistantMessage?.id) {
      setPreparedSync(null);
      setSyncError('同步预览已过期，请重新检查当前回复的冲突。');
      return false;
    }
    setIsSyncing(true);
    setSyncError(null);
    setSyncErrorCode(null);
    try {
      const result = await syncPackToWorld({
        packId: preparedSync.packId,
        novelId: novel.id,
        databaseGeneration: preparedSync.databaseGeneration,
        ...selections,
      });
      store.appendMessage(novel.id, 'bible', {
        id: `${Date.now()}-sync-complete`,
        sender: 'assistant',
        text: `已更新设定：新增人物 ${result.created.characters}、地点 ${result.created.locations}、道具 ${result.created.items}、势力 ${result.created.factions}、时间线 ${result.created.timelineEvents}、关系 ${result.created.relationships}；重复项已保留原设定。`,
      });
      setPreparedSync(null);
      return true;
    } catch (error) {
      setSyncError(`写入失败，未完成本次同步：${error instanceof Error ? error.message : '请重试。'}`);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const commit = async () => {
    const draft = session.draft;
    if (!draft || commitLock.current) return;
    const rejectCommit = (text: string) => store.appendMessage(novel.id, 'bible', {
      id: `${Date.now()}-save-rejected`, sender: 'system', text,
    });
    if (useNovelStore.getState().selectedNovel?.id !== novel.id) {
      rejectCommit('⚠️ 当前作品已变化，未写入设定。');
      return;
    }
    if (!Number.isInteger(draft.databaseGeneration) || (draft.databaseGeneration as number) < 0) {
      rejectCommit('⚠️ 设定版本无效，未写入设定。');
      return;
    }
    const databaseGeneration = draft.databaseGeneration as number;
    commitLock.current = true;
    const data = draft.data; const now = Date.now(); const id = generateClientId();
    try {
      if (draft.type === 'character') await createCharacter({ id, novelId: novel.id, name: String(data.name || '未命名人物'), role: (data.role || 'supporting') as 'protagonist' | 'supporting' | 'antagonist', summary: String(data.summary || ''), traits: Array.isArray(data.traits) ? data.traits as string[] : [], bio: String(data.bio || ''), createdAt: now, updatedAt: now }, databaseGeneration);
      else if (draft.type === 'location') await createLocation({ id, novelId: novel.id, name: String(data.name || '未命名地点'), region: String(data.region || '未知区域'), description: String(data.description || ''), createdAt: now, updatedAt: now }, databaseGeneration);
      else if (draft.type === 'item') await createItem({ id, novelId: novel.id, name: String(data.name || '未命名道具'), type: String(data.type || '普通道具'), description: String(data.description || ''), createdAt: now, updatedAt: now }, databaseGeneration);
      else if (draft.type === 'faction') await createFaction({ id, novelId: novel.id, name: String(data.name || '未命名势力'), leader: String(data.leader || '未知'), territory: String(data.territory || '未知'), description: String(data.description || ''), createdAt: now, updatedAt: now }, databaseGeneration);
      else if (draft.type === 'powerLevel') { const levels = await listPowerLevels(novel.id); await createPowerLevel({ id, novelId: novel.id, name: String(data.name || '未命名境界'), tier: Number(data.tier) || (levels.length ? Math.max(...levels.map(level => level.tier)) + 1 : 1), characteristics: String(data.characteristics || ''), description: String(data.description || ''), createdAt: now, updatedAt: now }, databaseGeneration); }
      else { const events = await listTimelineEvents(novel.id); await createTimelineEvent({ id, novelId: novel.id, title: String(data.title || '未命名事件'), description: String(data.description || ''), timestamp: String(data.timestamp || '未知时间'), statusTag: String(data.statusTag || '发生中'), order: Number(data.order) || (events.length ? Math.max(...events.map(event => event.order)) + 1 : 1), createdAt: now, updatedAt: now }, databaseGeneration); }
      setDraft(null);
      store.appendMessage(novel.id, 'bible', { id: `${Date.now()}-saved`, sender: 'assistant', text: `🎉 已将「${String(data.name || data.title || '新设定')}」写入《${novel.title}》。` });
    } catch {
      store.appendMessage(novel.id, 'bible', { id: `${Date.now()}-save-error`, sender: 'system', text: '❌ 写入设定失败，请重试。' });
    } finally { commitLock.current = false; }
  };

  const updateDraft = (field: string, value: unknown) => setDraft(session.draft ? { ...session.draft, data: { ...session.draft.data, [field]: value } } : null);
  const fieldSpecs: Record<EntityType, Array<{ key: string; label: string; kind?: 'textarea' | 'select' | 'number'; options?: string[] }>> = {
    character: [{ key: 'name', label: '姓名' }, { key: 'role', label: '角色定位', kind: 'select', options: ['protagonist', 'supporting', 'antagonist'] }, { key: 'summary', label: '一句话简介' }, { key: 'traits', label: '性格特征' }, { key: 'bio', label: '背景小传', kind: 'textarea' }],
    location: [{ key: 'name', label: '地点名称' }, { key: 'region', label: '所属区域' }, { key: 'description', label: '环境与危机描述', kind: 'textarea' }],
    item: [{ key: 'name', label: '道具名称' }, { key: 'type', label: '道具类型' }, { key: 'description', label: '异能与来历描述', kind: 'textarea' }],
    faction: [{ key: 'name', label: '势力名称' }, { key: 'leader', label: '掌门/领袖' }, { key: 'territory', label: '总部地盘' }, { key: 'description', label: '宗门传袭与背景', kind: 'textarea' }],
    powerLevel: [{ key: 'name', label: '境界名称' }, { key: 'tier', label: '等阶级别', kind: 'number' }, { key: 'characteristics', label: '外显异象' }, { key: 'description', label: '修行奥义', kind: 'textarea' }],
    timeline: [{ key: 'title', label: '事件标题' }, { key: 'timestamp', label: '时间纪元' }, { key: 'statusTag', label: '事件状态', kind: 'select', options: ['未发生', '发生中', '已尘封'] }, { key: 'order', label: '排序权重', kind: 'number' }, { key: 'description', label: '影响与过程描述', kind: 'textarea' }],
  };
  const renderDraftFields = (draft: Draft) => fieldSpecs[draft.type].map(spec => {
    const value = draft.data[spec.key];
    const displayValue = Array.isArray(value) ? value.join('，') : String(value ?? '');
    const change = (next: string) => updateDraft(spec.key, spec.key === 'traits' ? next.split(/[，,]+/).map(item => item.trim()).filter(Boolean) : spec.kind === 'number' ? Number(next) : next);
    return <label key={spec.key} className="block text-[10px] text-theme-muted">{spec.label}
      {spec.kind === 'textarea' ? <textarea rows={2} value={displayValue} onChange={event => change(event.target.value)} className="w-full mt-1 bg-theme-sidebar border border-theme-border rounded px-2 py-1 text-xs text-theme-text resize-none" />
        : spec.kind === 'select' ? <select value={displayValue || spec.options?.[0]} onChange={event => change(event.target.value)} className="w-full mt-1 bg-theme-sidebar border border-theme-border rounded px-2 py-1 text-xs text-theme-text">{spec.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : <input type={spec.kind === 'number' ? 'number' : 'text'} value={displayValue} onChange={event => change(event.target.value)} className="w-full mt-1 bg-theme-sidebar border border-theme-border rounded px-2 py-1 text-xs text-theme-text" />}
    </label>;
  });
  const directConflicts = useMemo(() => {
    if (!preparedSync) return [];
    const normalize = (value: string) => value.trim().normalize('NFC').toLowerCase();
    const conflicts = [...preparedSync.textConflicts];
    const collect = (label: string, proposed: string[], existing: string[]) => {
      const existingNames = new Set(existing.map(normalize));
      proposed.forEach((name) => {
        if (existingNames.has(normalize(name))) conflicts.push(`${label}“${name}”已存在，将保留原设定并跳过新增`);
      });
    };
    collect('人物', preparedSync.extraction.characters.map(item => item.name), preparedSync.existing.characters.map(item => item.name));
    collect('地点', preparedSync.extraction.locations.map(item => item.name), preparedSync.existing.locations.map(item => item.name));
    collect('道具', preparedSync.extraction.items.map(item => item.name), preparedSync.existing.items.map(item => item.name));
    collect('势力', preparedSync.extraction.factions.map(item => item.name), preparedSync.existing.factions.map(item => item.name));
    collect('力量体系', preparedSync.extraction.powerLevels.map(item => item.name), preparedSync.existing.powerLevels.map(item => item.name));
    collect('时间线', preparedSync.extraction.timelineEvents.map(item => item.title), preparedSync.existing.timelineEvents.map(item => item.title));
    return [...new Set(conflicts)];
  }, [preparedSync]);
  useEffect(() => { if (typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, isLoading]);

  return <div role="complementary" aria-label="智能管家设定模式" className="bg-theme-sidebar/95 flex flex-col h-full min-h-0">
    <div className="p-4 border-b border-theme-border/50 flex items-center justify-between"><div className="flex items-center gap-2"><Sparkles size={16} className="text-theme-accent" /><h3 className="text-xs font-bold text-theme-text">设定记忆</h3></div><div className="flex gap-1"><button aria-label="清空对话历史" title="清空对话历史" onClick={() => { cancelActiveRequest(); store.clearSession(novel.id, 'bible'); store.setMessages(novel.id, 'bible', [welcome]); }} className="size-7"><Trash2 size={14} /></button><button aria-label="关闭智能管家" title="关闭智能管家" onClick={onClose} className="size-7"><X size={14} /></button></div></div>
    <div role="log" aria-live="polite" className="flex-1 overflow-y-auto p-4 space-y-4">{messages.map(message => <div key={message.id} className={message.sender === 'user' ? 'flex justify-end' : message.sender === 'system' ? 'text-center text-[10px] text-theme-muted' : ''}><div className={message.sender === 'user' ? 'bg-theme-accent text-white px-3 py-2 rounded-2xl text-xs max-w-[85%] whitespace-pre-wrap' : 'bg-theme-bg/60 border border-theme-border/30 text-theme-text px-3 py-2 rounded-2xl text-xs max-w-[85%] whitespace-pre-wrap'}>{message.text}</div></div>)}{isLoading && <div className="text-theme-muted text-[10px]"><Loader2 size={12} className="inline animate-spin" /> 助手正在思考并设计中...</div>}<div ref={endRef} /></div>
    {session.failure && <div role="alert" aria-label="助手请求失败" className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[10px] text-amber-900"><div>{session.failure.reason === 'no_content' ? '模型未返回内容' : session.failure.reason === 'reasoning_only' ? '模型只返回了推理过程' : session.failure.reason === 'length_exhausted' ? '输出因长度限制结束' : session.failure.message}</div>{session.failure.reason && <div>原因：{session.failure.reason}</div>}{session.failure.finishReason && <div>finishReason: {session.failure.finishReason}</div>}{session.failure.traceId && <div>诊断编号：{session.failure.traceId}</div>}<div className="mt-2 flex flex-wrap gap-3">{(session.failure.retriable || session.failure.code === 'empty_response') && <button type="button" className="font-bold underline" onClick={() => void submit(true)}>重试本次请求</button>}{['configuration', 'authentication', 'billing'].includes(session.failure.code) && <button type="button" className="font-bold underline" onClick={() => window.dispatchEvent(new Event('open-settings'))}>打开设置</button>}</div></div>}
    {resolvedContinuationPackId && latestAssistantText && !lastReplyFailed && !isLoading && !preparedSync && !session.draft && (
      <div className="mx-4 mb-3 rounded-xl border border-theme-accent/30 bg-theme-accent/5 p-3 space-y-2">
        <div className="text-[11px] font-bold text-theme-text">批量草稿尚未写入</div>
        <div className="text-[10px] text-theme-muted">先提取为可选设定并检查重复/冲突，再交给现有同步事务写入。</div>
        <button
          type="button"
          aria-label="检查冲突并准备写入"
          onClick={() => void prepareSyncFromLatestReply()}
          disabled={isPreparingSync}
          className="w-full rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {isPreparingSync ? '正在提取并检查冲突...' : '检查冲突并准备写入'}
        </button>
      </div>
    )}
    {syncError && <div className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[10px] text-amber-800">
      <div>{syncError}</div>
      {(syncErrorCode === 'configuration' || syncErrorCode === 'authentication' || syncErrorCode === 'billing') && (
        <button type="button" className="mt-2 font-bold underline" onClick={() => window.dispatchEvent(new Event('open-settings'))}>打开设置检查模型配置</button>
      )}
      <button type="button" className="ml-3 mt-2 font-bold underline" onClick={() => void prepareSyncFromLatestReply()} disabled={isPreparingSync}>重试冲突检查</button>
    </div>}
    {preparedSync && (
      <div className="mx-4 mb-3 min-h-0 max-h-[52vh] overflow-y-auto rounded-xl border border-theme-border bg-theme-sidebar p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-theme-text">冲突检查与同步预览</div>
          <button type="button" aria-label="取消同步预览" onClick={() => setPreparedSync(null)} className="text-[10px] text-theme-muted hover:text-theme-text">取消</button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
          <div className="font-bold">语义冲突状态：待人工确认</div>
          <div className="mt-1">系统只自动识别同名重复、已有全局文本和关系端点；无法证明语义完全一致，重复项默认保留旧设定。</div>
          {directConflicts.length > 0 && <ul className="mt-1 list-disc pl-4 space-y-0.5">{directConflicts.map(item => <li key={item}>{item}</li>)}</ul>}
        </div>
        <SyncPreviewPanel
          extraction={preparedSync.extraction}
          packId={resolvedContinuationPackId}
          novelId={novel.id}
          databaseGeneration={preparedSync.databaseGeneration}
          existingCharacters={preparedSync.existing.characters}
          existingLocations={preparedSync.existing.locations}
          existingItems={preparedSync.existing.items}
          existingFactions={preparedSync.existing.factions}
          onConfirm={handleConfirmPreparedSync}
          onCancel={() => setPreparedSync(null)}
          isSyncing={isSyncing}
        />
      </div>
    )}
    {session.draft && <div className="mx-4 mb-4 p-4 border border-theme-border rounded-2xl space-y-3"><div className="text-xs font-bold">新设定确认单</div><div className="space-y-2 max-h-56 overflow-y-auto">{renderDraftFields(session.draft)}</div><div className="flex gap-2"><button onClick={() => setDraft(null)} className="flex-1 text-xs border rounded py-2">放弃</button><button aria-label="确认写入设定" onClick={commit} className="flex-1 text-xs bg-theme-accent text-white rounded py-2">确认写入设定 <ChevronRight size={12} className="inline" /></button></div></div>}
    <div className="p-4 border-t border-theme-border/50"><textarea aria-label="输入设定灵感" value={session.input || ''} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="在此输入您的灵感..." className="w-full bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text resize-none" /><button aria-label="发送设定灵感" onClick={() => void submit()} disabled={isLoading} className="mt-2 w-full bg-theme-accent text-white rounded-xl py-2 text-xs"><Send size={13} className="inline mr-1" />发送</button></div>
  </div>;
}
