import React, { useMemo, useRef, useState } from 'react';
import type { EntityRelationship } from '../../shared/types';
import type { Character, Location, Item, Faction } from '../../shared/types';

interface GraphNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
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
  onGoToWorldBible?: () => void;
}

const ENTITY_COLORS: Record<string, string> = {
  character: '#3b82f6',
  location: '#22c55e',
  item: '#eab308',
  faction: '#ef4444',
};

function getEntityName(type: string, id: string, characters: Character[], locations: Location[], items: Item[], factions: Faction[]): string {
  if (type === 'character') return characters.find((c) => c.id === id)?.name || id.slice(0, 8);
  if (type === 'location') return locations.find((l) => l.id === id)?.name || id.slice(0, 8);
  if (type === 'item') return items.find((i) => i.id === id)?.name || id.slice(0, 8);
  if (type === 'faction') return factions.find((f) => f.id === id)?.name || id.slice(0, 8);
  return id.slice(0, 8);
}

export function RelationshipGraph({ relationships, characters, locations, items, factions, onSelectEntity, activeEntityNames = [], onGoToWorldBible }: RelationshipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    // Build node set from relationships
    const nodeMap = new Map<string, GraphNode>();
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
      source: `${rel.sourceType}:${rel.sourceId}`,
      target: `${rel.targetType}:${rel.targetId}`,
      type: rel.relationshipType,
      description: rel.description || '',
    }));

    // Simple spring layout simulation (10 iterations)
    for (let iter = 0; iter < 10; iter++) {
      // Repulsion between nodes
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
            n1.vx -= fx;
            n1.vy -= fy;
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      // Attraction along edges
      for (const e of edgeList) {
        const sNode = simNodes.find((n) => n.id === e.source);
        const tNode = simNodes.find((n) => n.id === e.target);
        if (sNode && tNode) {
          const dx = tNode.x - sNode.x;
          const dy = tNode.y - sNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist > 80) {
            const force = (dist - 80) * 0.02;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            sNode.vx += fx;
            sNode.vy += fy;
            tNode.vx -= fx;
            tNode.vy -= fy;
          }
        }
      }

      // Center gravity + damping
      for (const n of simNodes) {
        n.x += n.vx * 0.3 + (250 - n.x) * 0.01;
        n.y += n.vy * 0.3 + (200 - n.y) * 0.01;
        n.vx *= 0.85;
        n.vy *= 0.85;
      }
    }

    return { nodes: simNodes, edges: edgeList };
  }, [relationships, characters, locations, items, factions]);

  if (relationships.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-5 border border-dashed border-theme-border/40 rounded-xl space-y-3 bg-theme-sidebar/10">
        <span className="text-[11px] text-theme-muted/80 leading-relaxed max-w-[220px]">
          当前写作上下文匹配的实体暂无关系数据，或正文中未提及实体设定。
        </span>
        {onGoToWorldBible && (
          <button
            onClick={onGoToWorldBible}
            className="px-3 py-1.5 rounded-xl bg-theme-accent text-white text-[10px] font-bold shadow-sm hover:opacity-90 transition-opacity active:scale-[0.98]"
          >
            去世界观补充关系
          </button>
        )}
      </div>
    );
  }

  return (
    <svg ref={svgRef} viewBox="0 0 500 400" className="w-full h-80 bg-theme-sidebar rounded-xl border border-theme-border">
      {/* Edges */}
      {edges.map((edge, i) => (
        <line
          key={i}
          x1={nodes.find((n) => n.id === edge.source)?.x || 0}
          y1={nodes.find((n) => n.id === edge.source)?.y || 0}
          x2={nodes.find((n) => n.id === edge.target)?.x || 0}
          y2={nodes.find((n) => n.id === edge.target)?.y || 0}
          stroke={edge.type === 'enemy' || edge.type === 'rival' ? '#ef4444' : '#94a3b8'}
          strokeDasharray={edge.type === 'enemy' ? '4 2' : 'none'}
          strokeWidth={1.5}
          opacity={0.6}
        >
          <title>{edge.description || edge.type}</title>
        </line>
      ))}
      {/* Nodes */}
      {nodes.map((node) => {
        const isActiveNode = activeEntityNames.includes(node.label);
        return (
          <g
            key={node.id}
            transform={`translate(${node.x},${node.y})`}
            onClick={() => {
              setSelectedNode(node.id);
              const [type, id] = node.id.split(':');
              onSelectEntity?.(type, id);
            }}
            className="cursor-pointer"
          >
            <circle
              r={selectedNode === node.id ? 14 : 11}
              fill={ENTITY_COLORS[node.type] || '#94a3b8'}
              stroke={isActiveNode ? '#38bdf8' : (selectedNode === node.id ? '#fff' : 'none')}
              strokeWidth={isActiveNode ? 3 : (selectedNode === node.id ? 2 : 0)}
              opacity={selectedNode === node.id || isActiveNode ? 1 : 0.8}
              className={isActiveNode ? "animate-pulse" : ""}
            />
            <text
              textAnchor="middle"
              dy={20}
              className="fill-theme-text font-semibold"
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
