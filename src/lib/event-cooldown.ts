/**
 * Event Matrix with Cooldown — prevents repetitive AI-generated chapter patterns.
 * 5 event types, each with a cooldown period (channels since last use).
 * Every 5-chapter window must include at least one bond/world event.
 */

export enum EventType {
  ConflictThrill = 'conflict_thrill',
  BondDeepening = 'bond_deepening',
  FactionBuilding = 'faction_building',
  WorldPainting = 'world_painting',
  TensionEscalation = 'tension_escalation',
}

export interface EventCooldownState {
  lastUsed: Partial<Record<EventType, number>>; // chapter order of last use
  recentTypes: EventType[]; // last 5 chapter event types
}

const COOLDOWNS: Record<EventType, number> = {
  [EventType.ConflictThrill]: 2,
  [EventType.BondDeepening]: 1,
  [EventType.FactionBuilding]: 2,
  [EventType.WorldPainting]: 1,
  [EventType.TensionEscalation]: 3,
};

const EVENT_LABELS: Record<EventType, string> = {
  [EventType.ConflictThrill]: '冲突/惊险',
  [EventType.BondDeepening]: '羁绊深化',
  [EventType.FactionBuilding]: '势力建设',
  [EventType.WorldPainting]: '世界观描绘',
  [EventType.TensionEscalation]: '张力升级',
};

export function buildEventConstraints(
  state: EventCooldownState,
  currentChapterOrder: number,
): string {
  const lines: string[] = ['[事件节奏约束]'];

  // Check which types are available (cooldown expired)
  const available: EventType[] = [];
  const blocked: string[] = [];
  for (const type of Object.values(EventType)) {
    const last = state.lastUsed[type];
    const cooldown = COOLDOWNS[type];
    if (last !== undefined && currentChapterOrder - last <= cooldown) {
      blocked.push(`${EVENT_LABELS[type]}（冷却剩余 ${cooldown - (currentChapterOrder - last) + 1} 章）`);
    } else {
      available.push(type);
    }
  }

  if (available.length > 0) {
    lines.push(`当前可用的主要事件类型：${available.map(t => EVENT_LABELS[t]).join('、')}`);
  }
  if (blocked.length > 0) {
    lines.push(`禁止作为本章主事件：${blocked.join('，')}`);
  }

  // Diversity check: last 5 chapters must have at least 1 bond or world event
  const recent = state.recentTypes.slice(-5);
  const hasDiversity = recent.some(t => t === EventType.BondDeepening || t === EventType.WorldPainting);
  if (!hasDiversity && recent.length >= 5) {
    lines.push('⚠️ 近 5 章缺少羁绊深化或世界观描绘事件，本章必须优先安排这两种类型之一');
  }

  // Same-type check: no consecutive same type
  if (recent.length > 0 && recent[recent.length - 1] === available[0]) {
    const nextAvailable = available.find(a => a !== recent[recent.length - 1]);
    if (nextAvailable) {
      lines.push(`注意：上一章已用过「${EVENT_LABELS[recent[recent.length - 1]]}」，建议优先选择「${EVENT_LABELS[nextAvailable]}」`);
    }
  }

  return lines.join('\n');
}

export function updateEventState(
  state: EventCooldownState,
  eventType: EventType,
  chapterOrder: number,
): EventCooldownState {
  return {
    lastUsed: { ...state.lastUsed, [eventType]: chapterOrder },
    recentTypes: [...state.recentTypes.slice(-4), eventType],
  };
}

export function defaultEventState(): EventCooldownState {
  return { lastUsed: {}, recentTypes: [] };
}
