/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { Character, Location, Item, Faction, EntityRelationship } from '../../../shared/types';
import {
  createEntityRelationshipClient,
  updateEntityRelationshipClient,
  deleteEntityRelationshipClient,
} from '../../lib/world-client';

interface RelationshipFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit' | 'delete';
  novelId: string;
  databaseGeneration: number | null;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  existingRelationship?: EntityRelationship | null;
  onClose: () => void;
  onSaved: (rel: EntityRelationship) => void;
  onDeleted: (id: string) => void;
}

const ENTITY_TYPES = [
  { value: 'character', label: '角色' },
  { value: 'location', label: '地点' },
  { value: 'item', label: '物品' },
  { value: 'faction', label: '势力' },
] as const;

const RELATIONSHIP_PRESETS = [
  '盟友', '敌对', '师徒', '恋人', '亲属', '同门', '上司', '下属', '对手',
] as const;

type EntityType = 'character' | 'location' | 'item' | 'faction';

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  character: '角色',
  location: '地点',
  item: '物品',
  faction: '势力',
};

function getEntitiesByType(
  type: EntityType,
  characters: Character[],
  locations: Location[],
  items: Item[],
  factions: Faction[],
) {
  switch (type) {
    case 'character': return characters;
    case 'location': return locations;
    case 'item': return items;
    case 'faction': return factions;
    default: return [];
  }
}

function getEntityName(
  type: EntityType,
  id: string,
  characters: Character[],
  locations: Location[],
  items: Item[],
  factions: Faction[],
): string {
  const list = getEntitiesByType(type, characters, locations, items, factions);
  return list.find((e) => e.id === id)?.name || id.slice(0, 8);
}

function isDatabaseGenerationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { status?: unknown; code?: unknown };
  return details.status === 409 || [
    'DB_GENERATION_CONFLICT',
    'DATABASE_GENERATION_STALE',
    'DATABASE_GENERATION_MISMATCH',
  ].includes(details.code as string);
}

export function RelationshipFormDialog({
  open,
  mode,
  novelId,
  databaseGeneration,
  characters,
  locations,
  items,
  factions,
  existingRelationship,
  onClose,
  onSaved,
  onDeleted,
}: RelationshipFormDialogProps) {
  if (databaseGeneration !== null && typeof databaseGeneration !== 'number') {
    throw new Error('databaseGeneration must be a number or null');
  }

  const [sourceType, setSourceType] = useState<EntityType>('character');
  const [sourceId, setSourceId] = useState('');
  const [targetType, setTargetType] = useState<EntityType>('character');
  const [targetId, setTargetId] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [customRelType, setCustomRelType] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens or mode/entity changes
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && existingRelationship) {
      const r = existingRelationship;
      setSourceType(r.sourceType as EntityType);
      setSourceId(r.sourceId);
      setTargetType(r.targetType as EntityType);
      setTargetId(r.targetId);
      setDescription(r.description || '');
      const preset = RELATIONSHIP_PRESETS.includes(r.relationshipType as typeof RELATIONSHIP_PRESETS[number]);
      setIsCustom(!preset);
      setRelationshipType(preset ? r.relationshipType : '');
      setCustomRelType(preset ? '' : r.relationshipType);
    } else if (mode === 'create') {
      setSourceType('character');
      setSourceId('');
      setTargetType('character');
      setTargetId('');
      setRelationshipType('');
      setCustomRelType('');
      setIsCustom(false);
      setDescription('');
    }
  }, [open, mode, existingRelationship]);

  // Reset source/target ids when entity type changes (only in create mode)
  useEffect(() => {
    if (mode === 'create' && open) {
      setSourceId('');
      setTargetId('');
    }
  }, [sourceType, targetType, mode, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const sourceEntities = getEntitiesByType(sourceType, characters, locations, items, factions);
  const targetEntities = getEntitiesByType(targetType, characters, locations, items, factions);

  const resolvedRelType = isCustom ? customRelType.trim() : relationshipType;
  const canSubmit = sourceId && targetId && resolvedRelType.length > 0;

  const handleSubmit = async () => {
    if (mode !== 'delete' && !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (databaseGeneration === null) throw new Error('设定尚未完成一致性读取，请刷新后重试。');
      if (mode === 'create') {
        const rel: EntityRelationship = {
          id: crypto.randomUUID(),
          novelId,
          sourceType,
          sourceId,
          targetType,
          targetId,
          relationshipType: resolvedRelType,
          description: description.trim() || undefined,
          createdAt: Date.now(),
        };
        const ok = await createEntityRelationshipClient(rel, databaseGeneration ?? undefined);
        if (!ok) throw new Error('关系已存在');
        onSaved(rel);
      } else if (mode === 'edit' && existingRelationship) {
        const data: Partial<EntityRelationship> = {
          sourceType,
          sourceId,
          targetType,
          targetId,
          relationshipType: resolvedRelType,
          description: description.trim() || undefined,
        };
        const ok = await updateEntityRelationshipClient(existingRelationship.id, data, databaseGeneration ?? undefined);
        if (!ok) throw new Error('更新失败');
        onSaved({ ...existingRelationship, ...data });
      } else if (mode === 'delete' && existingRelationship) {
        const ok = await deleteEntityRelationshipClient(existingRelationship.id, databaseGeneration ?? undefined);
        if (!ok) throw new Error('删除失败');
        onDeleted(existingRelationship.id);
      }
      onClose();
    } catch (e: unknown) {
      setError(isDatabaseGenerationConflict(e)
        ? '数据库已变化，已保留本地输入。请刷新后重试。'
        : e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const deleteRel = existingRelationship;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relationship-dialog-title"
        className="bg-theme-sidebar border border-theme-border rounded-2xl p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 id="relationship-dialog-title" className="text-lg font-bold text-theme-text font-serif">
            {mode === 'create' && '新建关系'}
            {mode === 'edit' && '编辑关系'}
            {mode === 'delete' && '删除关系'}
          </h3>
          <button onClick={onClose} aria-label="关闭" className="text-theme-muted hover:text-theme-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Delete mode */}
        {mode === 'delete' && deleteRel && (
          <div className="space-y-4">
            <p className="text-sm text-theme-text leading-relaxed">
              确定要删除「{getEntityName(deleteRel.sourceType as EntityType, deleteRel.sourceId, characters, locations, items, factions)} → {deleteRel.relationshipType} → {getEntityName(deleteRel.targetType as EntityType, deleteRel.targetId, characters, locations, items, factions)}」的关系吗？
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-theme-muted hover:text-theme-text rounded-xl border border-theme-border/50 hover:bg-theme-sidebar/50 transition-all">
                取消
              </button>
              <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 shadow-md transition-all disabled:opacity-50">
                <Trash2 size={14} />
                {saving ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        )}

        {/* Create / Edit mode */}
        {(mode === 'create' || mode === 'edit') && (
          <div className="space-y-4">
            {/* Source entity */}
            <div className="space-y-2">
              <label htmlFor="source-type" className="text-xs font-bold text-theme-muted uppercase tracking-wide">起始实体</label>
              <div className="flex gap-2">
                <select
                  id="source-type"
                  autoFocus
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as EntityType)}
                  className="w-1/3 p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent"
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value} title={t.label}>{t.label}</option>
                  ))}
                </select>
                <select
                  id="source-id"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="flex-1 p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent"
                >
                  <option value="">选择{ENTITY_TYPE_LABELS[sourceType] || '实体'}</option>
                  {sourceEntities.map((e) => (
                    <option key={e.id} value={e.id} title={e.name}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Target entity */}
            <div className="space-y-2">
              <label htmlFor="target-type" className="text-xs font-bold text-theme-muted uppercase tracking-wide">目标实体</label>
              <div className="flex gap-2">
                <select
                  id="target-type"
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as EntityType)}
                  className="w-1/3 p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent"
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value} title={t.label}>{t.label}</option>
                  ))}
                </select>
                <select
                  id="target-id"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="flex-1 p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent"
                >
                  <option value="">选择{ENTITY_TYPE_LABELS[targetType] || '实体'}</option>
                  {targetEntities.map((e) => (
                    <option key={e.id} value={e.id} title={e.name}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Relationship type */}
            <div className="space-y-2">
              <label htmlFor="custom-rel-type" className="text-xs font-bold text-theme-muted uppercase tracking-wide">关系类型</label>
              {isCustom ? (
                <div className="flex gap-2">
                  <input
                    id="custom-rel-type"
                    value={customRelType}
                    onChange={(e) => setCustomRelType(e.target.value)}
                    placeholder="输入自定义关系类型"
                    className="flex-1 p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent"
                  />
                  <button
                    onClick={() => { setIsCustom(false); setCustomRelType(''); }}
                    className="px-3 py-2 text-xs text-theme-muted hover:text-theme-text border border-theme-border/50 rounded-lg hover:bg-theme-sidebar/50 transition-all shrink-0"
                  >
                    预设
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {RELATIONSHIP_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setRelationshipType(preset)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        relationshipType === preset
                          ? 'bg-theme-accent text-white border-theme-accent shadow-sm'
                          : 'border-theme-border/50 text-theme-text hover:bg-theme-sidebar/50'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  <button
                    onClick={() => setIsCustom(true)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-dashed border-theme-border/50 text-theme-muted hover:text-theme-text hover:bg-theme-sidebar/50 transition-all"
                  >
                    自定义
                  </button>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label htmlFor="rel-description" className="text-xs font-bold text-theme-muted uppercase tracking-wide">描述（可选）</label>
              <textarea
                id="rel-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="补充关系细节..."
                rows={3}
                className="w-full p-2 text-sm border border-theme-border/50 rounded-lg bg-theme-sidebar/50 text-theme-text outline-none focus:border-theme-accent resize-none"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-theme-muted hover:text-theme-text rounded-xl border border-theme-border/50 hover:bg-theme-sidebar/50 transition-all">
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || saving}
                className="px-5 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all disabled:opacity-50"
              >
                {saving ? '保存中...' : mode === 'create' ? '创建关系' : '保存修改'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
