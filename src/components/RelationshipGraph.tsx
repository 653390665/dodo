import React, { useMemo, useRef, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';
import type { EntityRelationship } from '../../shared/types';
import type { Character, Location, Item, Faction } from '../../shared/types';
import type { StoryMemoryProjection } from '../../shared/types/story-memory';

interface GraphNode {
  id: string;
  label: string;
  type: string;
  entityId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  description: string;
}

interface RelationshipGraphProps {
  relationships: EntityRelationship[];
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  onSelectEntity?: (type: string, id: string) => void;
  activeEntityNames?: string[];
  onGoToWorldBible?: (tab?: string) => void;
  onSyncFromContinuationPack?: () => void;
  hasGlobalRelationships?: boolean;
  totalEntities?: number;
  storyMemory?: StoryMemoryProjection;
}

const ENTITY_COLORS: Record<string, string> = {
  character: '#3b82f6',
  location: '#22c55e',
  item: '#eab308',
  faction: '#ef4444',
  chapter: '#8b5cf6',
  'timeline-event': '#06b6d4',
  'narrative-promise': '#f97316',
};

function getEntityName(type: string, id: string, characters: Character[], locations: Location[], items: Item[], factions: Faction[]): string {
  if (type === 'character') return characters.find((c) => c.id === id)?.name || id.slice(0, 8);
  if (type === 'location') return locations.find((l) => l.id === id)?.name || id.slice(0, 8);
  if (type === 'item') return items.find((i) => i.id === id)?.name || id.slice(0, 8);
  if (type === 'faction') return factions.find((f) => f.id === id)?.name || id.slice(0, 8);
  return id.slice(0, 8);
}

export function RelationshipGraph({ relationships, characters, locations, items, factions, onSelectEntity, activeEntityNames = [], onGoToWorldBible, onSyncFromContinuationPack, hasGlobalRelationships, totalEntities, storyMemory }: RelationshipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
    const nodeMap = new Map<string, GraphNode>();
    if (storyMemory?.nodes.length) {
      storyMemory.nodes.forEach((node, index) => {
        nodeMap.set(node.id, {
          id: node.id,
          label: node.label,
          type: node.kind,
          entityId: node.source.id,
          x: 100 + (index * 77) % 300,
          y: 80 + (index * 53) % 240,
          vx: 0,
          vy: 0,
        });
      });
      const simNodes = Array.from(nodeMap.values());
      const edgeList: GraphEdge[] = storyMemory.edges.map((edge) => {
        const relationship = edge.sourceArtifact && relationshipById.get(edge.sourceArtifact.id);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: relationship?.relationshipType || edge.kind,
          description: relationship?.description || edge.kind,
        };
      });
      return layoutGraph(simNodes, edgeList);
    }

    for (const rel of relationships) {
      const sKey = `${rel.sourceType}:${rel.sourceId}`;
      if (!nodeMap.has(sKey)) {
        const index = nodeMap.size;
        nodeMap.set(sKey, {
          id: sKey,
          label: getEntityName(rel.sourceType, rel.sourceId, characters, locations, items, factions),
          type: rel.sourceType,
          x: 100 + (index * 77) % 300,
          y: 80 + (index * 53) % 240,
          vx: 0,
          vy: 0,
        });
      }
      const tKey = `${rel.targetType}:${rel.targetId}`;
      if (!nodeMap.has(tKey)) {
        const index = nodeMap.size;
        nodeMap.set(tKey, {
          id: tKey,
          label: getEntityName(rel.targetType, rel.targetId, characters, locations, items, factions),
          type: rel.targetType,
          x: 100 + (index * 77) % 300,
          y: 80 + (index * 53) % 240,
          vx: 0,
          vy: 0,
        });
      }
    }

    const simNodes = Array.from(nodeMap.values());
    const edgeList: GraphEdge[] = relationships.map((rel) => ({
      id: rel.id,
      source: `${rel.sourceType}:${rel.sourceId}`,
      target: `${rel.targetType}:${rel.targetId}`,
      type: rel.relationshipType,
      description: rel.description || '',
    }));

    return layoutGraph(simNodes, edgeList);
  }, [relationships, characters, locations, items, factions, storyMemory]);

  if (relationships.length === 0 && !storyMemory?.nodes.length) {
    const entityCount = totalEntities ?? 0;
    let message: string;
    let buttonText: string;
    let buttonTab: string | undefined;

    if (entityCount === 0) {
      if (onSyncFromContinuationPack) {
        message = '已有已确认资料包，可同步到设定集。';
        buttonText = '从资料包同步';
      } else {
        message = '尚未创建任何设定实体，请先添加人物或地点。';
        buttonText = '去添加人物';
      }
      buttonTab = 'characters';
    } else if (entityCount === 1) {
      message = '还需要至少一个实体才能建立关系。';
      buttonText = '去添加更多实体';
      buttonTab = 'characters';
    } else {
      message = hasGlobalRelationships
        ? '当前正文未提及已设定的实体关系'
        : '已有实体，暂无关系数据';
      buttonText = hasGlobalRelationships ? '查看全局关系图' : '去世界观补充关系';
      buttonTab = 'graph';
    }

    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-5 border border-dashed border-theme-border/40 rounded-xl space-y-3 bg-theme-sidebar/10">
        <span className="text-[11px] text-theme-muted/80 leading-relaxed max-w-[220px]">
          {message}
        </span>
        {onSyncFromContinuationPack && entityCount === 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-full">
            <button
              type="button"
              onClick={onSyncFromContinuationPack}
              className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-xl bg-theme-accent text-white text-[10px] font-bold shadow-sm hover:opacity-90 transition-opacity"
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span className="truncate">从资料包同步</span>
            </button>
            {onGoToWorldBible && (
              <button
                type="button"
                onClick={() => onGoToWorldBible('characters')}
                className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-xl border border-theme-border/60 text-theme-muted text-[10px] font-bold hover:bg-theme-border/20 transition-colors"
              >
                <UserPlus size={12} aria-hidden="true" />
                <span className="truncate">手动添加人物</span>
              </button>
            )}
          </div>
        ) : onGoToWorldBible ? (
          <button
            type="button"
            onClick={() => onGoToWorldBible(buttonTab)}
            className="inline-flex items-center max-w-full px-3 py-1.5 rounded-xl bg-theme-accent text-white text-[10px] font-bold shadow-sm hover:opacity-90 transition-opacity"
          >
            <span className="truncate">{buttonText}</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <svg ref={svgRef} viewBox="0 0 500 400" role="img" aria-label="故事记忆关系图谱" className="w-full h-80 bg-theme-sidebar/45 rounded-xl border border-theme-border/60 backdrop-blur-md">
      {/* Edges */}
      {edges.map((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        const x1 = sourceNode?.x || 0;
        const y1 = sourceNode?.y || 0;
        const x2 = targetNode?.x || 0;
        const y2 = targetNode?.y || 0;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return (
          <g key={edge.id}>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={edge.type === 'enemy' || edge.type === 'rival' ? '#ef4444' : 'var(--theme-muted)'}
              strokeDasharray={edge.type === 'enemy' ? '4 2' : 'none'}
              strokeWidth={1.5}
              opacity={0.65}
            >
              <title>{edge.description || edge.type}</title>
            </line>
            <text
              x={midX} y={midY}
              textAnchor="middle" dy={-4}
              className="fill-theme-muted"
              style={{ fontSize: '8px', fontFamily: 'sans-serif' }}
            >
              {edge.type}
            </text>
          </g>
        );
      })}
      {/* Nodes */}
      {nodes.map((node) => {
        const isActiveNode = activeEntityNames.includes(node.label);
        return (
          <g
            key={node.id}
            transform={`translate(${node.x},${node.y})`}
            onClick={() => {
              setSelectedNode(node.id);
              if (['character', 'location', 'item', 'faction'].includes(node.type)) onSelectEntity?.(node.type, node.entityId || node.id.split(':').at(-1) || '');
            }}
            className="cursor-pointer"
            aria-label={`${node.type === 'chapter' ? '章节' : node.type === 'narrative-promise' ? '叙事承诺' : node.type}：${node.label}`}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }}
          >
            <circle
              r={selectedNode === node.id ? 14 : 11}
              fill={ENTITY_COLORS[node.type] || 'var(--theme-muted)'}
              stroke={isActiveNode ? '#38bdf8' : (selectedNode === node.id ? '#fff' : 'none')}
              strokeWidth={isActiveNode ? 3 : (selectedNode === node.id ? 2 : 0)}
              opacity={selectedNode === node.id || isActiveNode ? 1 : 0.85}
              className={isActiveNode ? "animate-pulse" : ""}
            />
            <text
              textAnchor="middle"
              dy={22}
              className="fill-theme-text font-bold"
              style={{ fontSize: '10px', fontFamily: 'sans-serif' }}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function layoutGraph(simNodes: GraphNode[], edgeList: GraphEdge[]) {
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const n1 = simNodes[i];
        const n2 = simNodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 100) {
          const force = (100 - dist) * 0.05;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          n1.vx -= fx; n1.vy -= fy;
          n2.vx += fx; n2.vy += fy;
        }
      }
    }
    for (const edge of edgeList) {
      const source = simNodes.find((node) => node.id === edge.source);
      const target = simNodes.find((node) => node.id === edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist > 80) {
        const force = (dist - 80) * 0.02;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx; source.vy += fy;
        target.vx -= fx; target.vy -= fy;
      }
    }
    for (const node of simNodes) {
      node.x += node.vx * 0.3 + (250 - node.x) * 0.01;
      node.y += node.vy * 0.3 + (200 - node.y) * 0.01;
      node.vx *= 0.85; node.vy *= 0.85;
    }
  }
  return { nodes: simNodes, edges: edgeList };
}
