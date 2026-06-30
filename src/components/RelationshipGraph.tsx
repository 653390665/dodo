import React, { useEffect, useRef, useState } from 'react';
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

export function RelationshipGraph({ relationships, characters, locations, items, factions, onSelectEntity }: RelationshipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    // Build node set from relationships
    const nodeMap = new Map<string, GraphNode>();
    for (const rel of relationships) {
      const sKey = `${rel.sourceType}:${rel.sourceId}`;
      if (!nodeMap.has(sKey)) {
        nodeMap.set(sKey, {
          id: sKey,
          label: getEntityName(rel.sourceType, rel.sourceId, characters, locations, items, factions),
          type: rel.sourceType,
          x: Math.random() * 400 + 50,
          y: Math.random() * 300 + 50,
          vx: 0, vy: 0,
        });
      }
      const tKey = `${rel.targetType}:${rel.targetId}`;
      if (!nodeMap.has(tKey)) {
        nodeMap.set(tKey, {
          id: tKey,
          label: getEntityName(rel.targetType, rel.targetId, characters, locations, items, factions),
          type: rel.targetType,
          x: Math.random() * 400 + 50,
          y: Math.random() * 300 + 50,
          vx: 0, vy: 0,
        });
      }
    }

    const nodeList = Array.from(nodeMap.values());
    const edgeList: GraphEdge[] = relationships.map((r) => ({
      source: `${r.sourceType}:${r.sourceId}`,
      target: `${r.targetType}:${r.targetId}`,
      type: r.relationshipType,
      description: r.description || '',
    }));

    // Simple force simulation
    const simNodes = nodeList.map((n) => ({ ...n }));
    for (let iter = 0; iter < 100; iter++) {
      // Repulsion between all pairs
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = 500 / (d * d);
          simNodes[i].vx -= (dx / d) * f;
          simNodes[i].vy -= (dy / d) * f;
          simNodes[j].vx += (dx / d) * f;
          simNodes[j].vy += (dy / d) * f;
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
        const f = d * 0.01;
        simNodes[si].vx += (dx / d) * f;
        simNodes[si].vy += (dy / d) * f;
        simNodes[ti].vx -= (dx / d) * f;
        simNodes[ti].vy -= (dy / d) * f;
      }
      // Center gravity + damping
      for (const n of simNodes) {
        n.x += n.vx * 0.3 + (250 - n.x) * 0.01;
        n.y += n.vy * 0.3 + (200 - n.y) * 0.01;
        n.vx *= 0.85;
        n.vy *= 0.85;
      }
    }

    setNodes(simNodes);
    setEdges(edgeList);
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
      {nodes.map((node) => (
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
            stroke={selectedNode === node.id ? '#fff' : 'none'}
            strokeWidth={2}
            opacity={selectedNode === node.id ? 1 : 0.85}
          />
          <text
            textAnchor="middle"
            dy={20}
            className="fill-theme-text"
            style={{ fontSize: '9px', fontFamily: 'sans-serif' }}
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
