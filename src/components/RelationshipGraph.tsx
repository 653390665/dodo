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

export function RelationshipGraph({ relationships, characters, locations, items, factions, onSelectEntity, activeEntityNames = [] }: RelationshipGraphProps) {
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
          x: 50 + (index * 77) % 400,
          y: 50 + (index * 53) % 300,
          vx: 0, vy: 0,
        });
      }
      const tKey = `${rel.targetType}:${rel.targetId}`;
      if (!nodeMap.has(tKey)) {
        const index = nodeMap.size;
        nodeMap.set(tKey, {
          id: tKey,
          label: getEntityName(rel.targetType, rel.targetId, characters, locations, items, factions),
          type: rel.targetType,
          x: 50 + (index * 77) % 400,
          y: 50 + (index * 53) % 300,
          vx: 0, vy: 0,
        });
      }
    }

    const nodeList = Array.from(nodeMap.values());
    const edgeList: GraphEdge[] = relationships.map((rel) => ({
      source: `${rel.sourceType}:${rel.sourceId}`,
      target: `${rel.targetType}:${rel.targetId}`,
      type: rel.relationshipType,
      description: rel.description || '',
    }));

    // Simple Force Directed Simulation (50 iterations)
    const simNodes = nodeList.map((n) => ({ ...n }));
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          if (d < 150) {
            const force = (150 - d) * 0.05;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            simNodes[i].vx -= fx;
            simNodes[i].vy -= fy;
            simNodes[j].vx += fx;
            simNodes[j].vy += fy;
          }
        }
      }
      // Attraction along edges
      for (const edge of edgeList) {
        const si = simNodes.findIndex((n) => n.id === edge.source);
        const ti = simNodes.findIndex((n) => n.id === edge.target);
        if (si === -1 || ti === -1) continue;
        const dx = simNodes[ti].x - simNodes[si].x;
        const dy = simNodes[ti].y - simNodes[si].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = d * 0.01;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        simNodes[si].vx += fx;
        simNodes[si].vy += fy;
        simNodes[ti].vx -= fx;
        simNodes[ti].vy -= fy;
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
      <div className="flex items-center justify-center h-64 text-xs text-theme-muted">
        暂无实体关系数据。点击"添加关系"开始构建知识图谱。
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
