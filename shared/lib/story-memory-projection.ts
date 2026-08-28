import type { Character, EntityRelationship, Faction, Foreshadowing, Item, Location, TimelineEvent } from '../types/world.js';
import type { ChapterMetadata } from '../types/novel.js';
import { normalizeNarrativePromiseCore } from './narrative-promise.js';
import type {
  StoryMemoryEdge,
  StoryMemoryEdgeKind,
  StoryMemoryNode,
  StoryMemoryNodeKind,
  StoryMemoryProjection,
} from '../types/story-memory.js';

export interface StoryMemoryProjectionInput {
  novelId: string;
  characters?: Character[];
  locations?: Location[];
  items?: Item[];
  factions?: Faction[];
  chapters?: ChapterMetadata[];
  timelineEvents?: TimelineEvent[];
  relationships?: EntityRelationship[];
  narrativePromises?: Foreshadowing[];
  foreshadowings?: Foreshadowing[];
  currentChapterId?: string;
}

export interface StoryMemoryProjectionOptions {
  currentChapterId?: string;
}

const nodeId = (novelId: string, kind: StoryMemoryNodeKind, id: string) => `${novelId}:${kind}:${id}`;
const edgeId = (novelId: string, kind: StoryMemoryEdgeKind, source: string, target: string, suffix?: string) =>
  `${novelId}:edge:${kind}:${source}:${target}${suffix ? `:${suffix}` : ''}`;

function addNode(nodes: Map<string, StoryMemoryNode>, novelId: string, kind: StoryMemoryNodeKind, id: string, label: string, source?: StoryMemoryNode['source']) {
  if (!id || nodes.has(nodeId(novelId, kind, id))) return;
  nodes.set(nodeId(novelId, kind, id), {
    id: nodeId(novelId, kind, id),
    novelId,
    kind,
    source: source || { kind, id },
    label: label || id,
  });
}

export function projectStoryMemory(
  input: StoryMemoryProjectionInput,
  options: StoryMemoryProjectionOptions | string = {},
): StoryMemoryProjection {
  const novelId = input.novelId;
  const nodes = new Map<string, StoryMemoryNode>();
  const edges = new Map<string, StoryMemoryEdge>();
  const addEdge = (kind: StoryMemoryEdgeKind, source: string, target: string, suffix?: string) => {
    if (!source || !target || source === target) return;
    const id = edgeId(novelId, kind, source, target, suffix);
    if (!edges.has(id)) edges.set(id, { id, novelId, kind, source, target });
  };

  const entities: Array<[StoryMemoryNodeKind, Array<{ id: string; name: string }> | undefined]> = [
    ['character', input.characters],
    ['location', input.locations],
    ['item', input.items],
    ['faction', input.factions],
  ];
  for (const [kind, records] of entities) {
    for (const record of records || []) addNode(nodes, novelId, kind, record.id, record.name);
  }
  for (const chapter of input.chapters || []) addNode(nodes, novelId, 'chapter', chapter.id, chapter.title);
  for (const event of input.timelineEvents || []) addNode(nodes, novelId, 'timeline-event', event.id, event.title);

  const promises = input.narrativePromises || input.foreshadowings || [];
  for (const promise of promises) {
    addNode(nodes, novelId, 'narrative-promise', promise.id, promise.title);
    const core = normalizeNarrativePromiseCore(promise.narrativeCore);
    const evidence = core?.evidence || [
      ...(promise.plantedChapterId ? [{ chapterId: promise.plantedChapterId, action: 'plant' as const }] : []),
      ...(promise.payoffChapterId ? [{ chapterId: promise.payoffChapterId, action: 'payoff' as const }] : []),
    ];
    for (const evidenceItem of evidence) {
      const chapterNode = nodeId(novelId, 'chapter', evidenceItem.chapterId);
      const promiseNode = nodeId(novelId, 'narrative-promise', promise.id);
      if (!nodes.has(chapterNode)) continue;
      const kind: StoryMemoryEdgeKind = evidenceItem.action === 'plant' ? 'planted-in' : evidenceItem.action === 'hint' ? 'hinted-in' : 'paid-off-in';
      addEdge(kind, chapterNode, promiseNode);
    }
  }

  for (const relationship of input.relationships || []) {
    const source = nodeId(novelId, relationship.sourceType as StoryMemoryNodeKind, relationship.sourceId);
    const target = nodeId(novelId, relationship.targetType as StoryMemoryNodeKind, relationship.targetId);
    if (!nodes.has(source) || !nodes.has(target)) continue;
    const id = edgeId(novelId, 'relates-to', source, target, relationship.id);
    if (!edges.has(id)) edges.set(id, { id, novelId, kind: 'relates-to', source, target, sourceArtifact: { kind: 'world', id: relationship.id, version: 1 } });
  }

  const currentChapterId = typeof options === 'string' ? options : options.currentChapterId || input.currentChapterId;
  let resultNodes = Array.from(nodes.values());
  let resultEdges = Array.from(edges.values());
  if (currentChapterId) {
    const chapterNode = nodeId(novelId, 'chapter', currentChapterId);
    const visible = new Set([chapterNode]);
    for (const edge of resultEdges) {
      if (edge.source === chapterNode || edge.target === chapterNode) {
        visible.add(edge.source);
        visible.add(edge.target);
      }
    }
    resultNodes = resultNodes.filter((node) => visible.has(node.id));
    resultEdges = resultEdges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  }

  const updatedAt = [
    ...(input.characters || []), ...(input.locations || []), ...(input.items || []), ...(input.factions || []),
    ...(input.chapters || []), ...(input.timelineEvents || []), ...promises,
  ].reduce((latest, record) => Math.max(latest, record.updatedAt || record.createdAt || 0), 0);
  return { novelId, nodes: resultNodes, edges: resultEdges, generatedAt: updatedAt };
}
