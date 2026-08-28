import React, { useState, useMemo, useCallback } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import type { SyncExtractionResult } from '../../../shared/lib/sync-extract-prompt';
import type { Character, Location, Item, Faction } from '../../../shared/types';
import { recommendRelationshipRepairs } from '../../lib/continuation-client';
import type { RelationshipRecommendation, RelationshipRepairInput, RelationshipEntityType } from '../../../shared/lib/relationship-repair';

interface SyncPreviewPanelProps {
  extraction: SyncExtractionResult;
  packId?: string;
  novelId?: string;
  databaseGeneration?: number;
  existingCharacters: Character[];
  existingLocations: Location[];
  existingItems: Item[];
  existingFactions: Faction[];
  onConfirm: (selections: {
    characters: SyncExtractionResult['characters'];
    locations: SyncExtractionResult['locations'];
    items: SyncExtractionResult['items'];
    factions: SyncExtractionResult['factions'];
    powerLevels: SyncExtractionResult['powerLevels'];
    timelineEvents: SyncExtractionResult['timelineEvents'];
    relationships: SyncExtractionResult['relationships'];
    globalOutline?: string;
    worldRules?: string;
  }, options?: { keepOpen?: boolean }) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
  isSyncing: boolean;
}

const normalizeName = (name: string) => name.trim().normalize('NFC').toLowerCase();

type TabKey = 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'timelineEvents' | 'relationships';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'characters', label: '人物' },
  { key: 'locations', label: '地点' },
  { key: 'items', label: '道具' },
  { key: 'factions', label: '势力' },
  { key: 'powerLevels', label: '力量体系' },
  { key: 'timelineEvents', label: '时间线' },
  { key: 'relationships', label: '关系' },
];

function EmptyHint({ text }: { text: string }) {
  return <div className="text-xs text-theme-muted text-center py-6">{text}</div>;
}

function CharacterRow({
  entity, checked, onToggle, isDuplicate,
}: {
  entity: SyncExtractionResult['characters'][number];
  checked: boolean;
  onToggle: (c: boolean) => void;
  isDuplicate: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${checked ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-theme-text text-sm">{entity.name}</span>
          {isDuplicate ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">跳过</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
          )}
        </div>
        <div className="text-xs text-theme-muted mt-1 line-clamp-2">
          <span className="text-theme-accent font-medium">{entity.role}</span> · {entity.summary}
        </div>
      </div>
    </label>
  );
}

function LocationRow({
  entity, checked, onToggle, isDuplicate,
}: {
  entity: SyncExtractionResult['locations'][number];
  checked: boolean;
  onToggle: (c: boolean) => void;
  isDuplicate: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${checked ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-theme-text text-sm">{entity.name}</span>
          {isDuplicate ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">跳过</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
          )}
        </div>
        <div className="text-xs text-theme-muted mt-1 line-clamp-2">
          <span className="text-theme-accent font-medium">{entity.region}</span> · {entity.description}
        </div>
      </div>
    </label>
  );
}

function ItemRow({
  entity, checked, onToggle, isDuplicate,
}: {
  entity: SyncExtractionResult['items'][number];
  checked: boolean;
  onToggle: (c: boolean) => void;
  isDuplicate: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${checked ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-theme-text text-sm">{entity.name}</span>
          {isDuplicate ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">跳过</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
          )}
        </div>
        <div className="text-xs text-theme-muted mt-1 line-clamp-2">
          <span className="text-theme-accent font-medium">{entity.type}</span> · {entity.description}
        </div>
      </div>
    </label>
  );
}

function FactionRow({
  entity, checked, onToggle, isDuplicate,
}: {
  entity: SyncExtractionResult['factions'][number];
  checked: boolean;
  onToggle: (c: boolean) => void;
  isDuplicate: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${checked ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-theme-text text-sm">{entity.name}</span>
          {isDuplicate ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">跳过</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
          )}
        </div>
        <div className="text-xs text-theme-muted mt-1 line-clamp-2">
          首领 <span className="text-theme-accent font-medium">{entity.leader}</span> · {entity.description}
        </div>
      </div>
    </label>
  );
}

export function SyncPreviewPanel({
  extraction,
  packId,
  novelId,
  databaseGeneration,
  existingCharacters,
  existingLocations,
  existingItems,
  existingFactions,
  onConfirm,
  onCancel,
  isSyncing,
}: SyncPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('characters');

  const isDuplicateChar = useMemo(() => {
    const s = new Set(existingCharacters.map(c => normalizeName(c.name)));
    return (name: string) => s.has(normalizeName(name));
  }, [existingCharacters]);

  const isDuplicateLoc = useMemo(() => {
    const s = new Set(existingLocations.map(l => normalizeName(l.name)));
    return (name: string) => s.has(normalizeName(name));
  }, [existingLocations]);

  const isDuplicateItem = useMemo(() => {
    const s = new Set(existingItems.map(i => normalizeName(i.name)));
    return (name: string) => s.has(normalizeName(name));
  }, [existingItems]);

  const isDuplicateFaction = useMemo(() => {
    const s = new Set(existingFactions.map(f => normalizeName(f.name)));
    return (name: string) => s.has(normalizeName(name));
  }, [existingFactions]);

  const [selectedChars, setSelectedChars] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.characters.forEach((c, i) => { if (!isDuplicateChar(c.name)) s.add(i); });
    return s;
  });
  const [selectedLocs, setSelectedLocs] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.locations.forEach((l, i) => { if (!isDuplicateLoc(l.name)) s.add(i); });
    return s;
  });
  const [selectedItems, setSelectedItems] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.items.forEach((item, i) => { if (!isDuplicateItem(item.name)) s.add(i); });
    return s;
  });
  const [selectedFactions, setSelectedFactions] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.factions.forEach((f, i) => { if (!isDuplicateFaction(f.name)) s.add(i); });
    return s;
  });
  const [selectedPowerLevels, setSelectedPowerLevels] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.powerLevels.forEach((_, i) => s.add(i));
    return s;
  });
  const [selectedTimeline, setSelectedTimeline] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.timelineEvents.forEach((_, i) => s.add(i));
    return s;
  });
  const [completedChars, setCompletedChars] = useState<Set<number>>(new Set());
  const [completedLocs, setCompletedLocs] = useState<Set<number>>(new Set());
  const [completedItems, setCompletedItems] = useState<Set<number>>(new Set());
  const [completedFactions, setCompletedFactions] = useState<Set<number>>(new Set());
  const [completedPowerLevels, setCompletedPowerLevels] = useState<Set<number>>(new Set());
  const [completedTimeline, setCompletedTimeline] = useState<Set<number>>(new Set());
  const [includeGlobalOutline, setIncludeGlobalOutline] = useState(!!extraction.globalOutline);
  const [includeWorldRules, setIncludeWorldRules] = useState(!!extraction.worldRules);

  const allEntityNames = useMemo(() => {
    const names = new Set<string>();
    extraction.characters.forEach((c, i) => { if (selectedChars.has(i)) names.add(`character:${normalizeName(c.name)}`); });
    extraction.locations.forEach((l, i) => { if (selectedLocs.has(i)) names.add(`location:${normalizeName(l.name)}`); });
    extraction.items.forEach((item, i) => { if (selectedItems.has(i)) names.add(`item:${normalizeName(item.name)}`); });
    extraction.factions.forEach((f, i) => { if (selectedFactions.has(i)) names.add(`faction:${normalizeName(f.name)}`); });
    existingCharacters.forEach(c => names.add(`character:${normalizeName(c.name)}`));
    existingLocations.forEach(l => names.add(`location:${normalizeName(l.name)}`));
    existingItems.forEach(i => names.add(`item:${normalizeName(i.name)}`));
    existingFactions.forEach(f => names.add(`faction:${normalizeName(f.name)}`));
    return names;
  }, [extraction, selectedChars, selectedLocs, selectedItems, selectedFactions, existingCharacters, existingLocations, existingItems, existingFactions]);

  const entityOptionsByType = useMemo(() => {
    const opts: Record<string, string[]> = { character: [], location: [], item: [], faction: [] };
    for (const c of existingCharacters) opts.character.push(c.name);
    for (const l of existingLocations) opts.location.push(l.name);
    for (const i of existingItems) opts.item.push(i.name);
    for (const f of existingFactions) opts.faction.push(f.name);
    extraction.characters.forEach((c, i) => { if (selectedChars.has(i) && !opts.character.some(n => normalizeName(n) === normalizeName(c.name))) opts.character.push(c.name); });
    extraction.locations.forEach((l, i) => { if (selectedLocs.has(i) && !opts.location.some(n => normalizeName(n) === normalizeName(l.name))) opts.location.push(l.name); });
    extraction.items.forEach((item, i) => { if (selectedItems.has(i) && !opts.item.some(n => normalizeName(n) === normalizeName(item.name))) opts.item.push(item.name); });
    extraction.factions.forEach((f, i) => { if (selectedFactions.has(i) && !opts.faction.some(n => normalizeName(n) === normalizeName(f.name))) opts.faction.push(f.name); });
    return opts;
  }, [existingCharacters, existingLocations, existingItems, existingFactions, extraction, selectedChars, selectedLocs, selectedItems, selectedFactions]);

  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  const isRelationshipConfirmed = useCallback((r: SyncExtractionResult['relationships'][number], idx: number) => {
    const srcResolved = resolvedNames[`${idx}:source`] || r.sourceName;
    const tgtResolved = resolvedNames[`${idx}:target`] || r.targetName;
    const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
    const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
    return srcKnown && tgtKnown;
  }, [allEntityNames, resolvedNames]);

  const [selectedRelationships, setSelectedRelationships] = useState<Set<number>>(() => {
    const s = new Set<number>();
    extraction.relationships.forEach((r, i) => {
      if (isRelationshipConfirmed(r, i)) s.add(i);
    });
    return s;
  });

  const [skippedRelationships, setSkippedRelationships] = useState<Set<number>>(new Set());
  const [repairRelationshipIndexes, setRepairRelationshipIndexes] = useState<Set<number> | null>(null);
  const [recommendations, setRecommendations] = useState<Record<number, RelationshipRecommendation>>({});
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [recommendStatus, setRecommendStatus] = useState<string | null>(null);

  // Derive effective skipped set: clear skip for relationships whose entities are now all known
  const effectiveSkippedRelationships = useMemo(() => {
    if (skippedRelationships.size === 0) return skippedRelationships;
    let changed = false;
    const next = new Set(skippedRelationships);
    extraction.relationships.forEach((r, i) => {
      if (!next.has(i)) return;
      const srcResolved = resolvedNames[`${i}:source`] || r.sourceName;
      const tgtResolved = resolvedNames[`${i}:target`] || r.targetName;
      const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
      const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
      if (srcKnown && tgtKnown) { next.delete(i); changed = true; }
    });
    return changed ? next : skippedRelationships;
  }, [allEntityNames, extraction.relationships, resolvedNames, skippedRelationships]);

  const unresolvedRelationshipIndexes = useMemo(() => {
    const indexes: number[] = [];
    extraction.relationships.forEach((r, i) => {
      if (effectiveSkippedRelationships.has(i)) return;
      const srcResolved = resolvedNames[`${i}:source`] || r.sourceName;
      const tgtResolved = resolvedNames[`${i}:target`] || r.targetName;
      const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
      const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
      if (!srcKnown || !tgtKnown) indexes.push(i);
    });
    return indexes;
  }, [extraction.relationships, resolvedNames, allEntityNames, effectiveSkippedRelationships]);
  const unresolvedCount = unresolvedRelationshipIndexes.length;

  const handleRecommendRepairs = useCallback(async () => {
    if (!packId || !novelId || databaseGeneration === undefined) return;
    setIsRecommending(true);
    setRecommendError(null);
    setRecommendStatus(null);
    try {
      const relationships: RelationshipRepairInput[] = unresolvedRelationshipIndexes.map(index => ({ index, ...extraction.relationships[index] })) as RelationshipRepairInput[];
      const candidates = entityOptionsByType as Record<RelationshipEntityType, string[]>;
      const result = await recommendRelationshipRepairs({ packId, novelId, databaseGeneration, relationships, candidates });
      const next: Record<number, RelationshipRecommendation> = {};
      result.recommendations.forEach((recommendation) => {
        if (unresolvedRelationshipIndexes.includes(recommendation.index)) next[recommendation.index] = recommendation;
      });
      setRecommendations(next);
      let appliedCount = 0;
      const mappedNames: Record<string, string> = {};
      const skipped = new Set(skippedRelationships);
      const selected = new Set(selectedRelationships);
      result.recommendations.forEach((recommendation) => {
        if (!unresolvedRelationshipIndexes.includes(recommendation.index)) return;
        const index = recommendation.index;
        if (recommendation.action === 'skip') {
          skipped.add(index);
          selected.delete(index);
          appliedCount++;
          return;
        }
        if (recommendation.sourceName && recommendation.targetName) {
          mappedNames[`${index}:source`] = recommendation.sourceName;
          mappedNames[`${index}:target`] = recommendation.targetName;
          skipped.delete(index);
          selected.add(index);
          appliedCount++;
        }
      });
      if (Object.keys(mappedNames).length > 0) setResolvedNames(prev => ({ ...prev, ...mappedNames }));
      setSkippedRelationships(skipped);
      setSelectedRelationships(selected);
      setRecommendStatus(`Agent 已自动处理 ${appliedCount} 条建议`);
      setActiveTab('relationships');
    } catch (error) {
      setRecommendError(error instanceof Error ? error.message : '推荐失败，请重试。');
    } finally {
      setIsRecommending(false);
    }
  }, [databaseGeneration, entityOptionsByType, extraction.relationships, novelId, packId, selectedRelationships, skippedRelationships, unresolvedRelationshipIndexes]);

  const isRelationshipSelected = useCallback((relationship: SyncExtractionResult['relationships'][number], index: number) => (
    selectedRelationships.has(index)
    || (!!repairRelationshipIndexes?.has(index)
      && !effectiveSkippedRelationships.has(index)
      && isRelationshipConfirmed(relationship, index))
  ), [effectiveSkippedRelationships, isRelationshipConfirmed, repairRelationshipIndexes, selectedRelationships]);

  const handleSkipAllUnresolved = () => {
    setSkippedRelationships(prev => {
      const next = new Set(prev);
      unresolvedRelationshipIndexes.forEach(i => next.add(i));
      return next;
    });
  };

  const counts = useMemo(() => {
    let newCount = 0;

    extraction.characters.forEach((c, i) => {
      if (selectedChars.has(i) && !completedChars.has(i) && !isDuplicateChar(c.name)) newCount++;
    });
    extraction.locations.forEach((l, i) => {
      if (selectedLocs.has(i) && !completedLocs.has(i) && !isDuplicateLoc(l.name)) newCount++;
    });
    extraction.items.forEach((item, i) => {
      if (selectedItems.has(i) && !completedItems.has(i) && !isDuplicateItem(item.name)) newCount++;
    });
    extraction.factions.forEach((f, i) => {
      if (selectedFactions.has(i) && !completedFactions.has(i) && !isDuplicateFaction(f.name)) newCount++;
    });
    extraction.powerLevels.forEach((_, i) => {
      if (selectedPowerLevels.has(i) && !completedPowerLevels.has(i)) newCount++;
    });
    extraction.timelineEvents.forEach((_, i) => {
      if (selectedTimeline.has(i) && !completedTimeline.has(i)) newCount++;
    });

    return { newCount, skipCount: 0 };
  }, [selectedChars, selectedLocs, selectedItems, selectedFactions, selectedPowerLevels, selectedTimeline, completedChars, completedLocs, completedItems, completedFactions, completedPowerLevels, completedTimeline, extraction, isDuplicateChar, isDuplicateLoc, isDuplicateItem, isDuplicateFaction]);

  const handleConfirm = async () => {
    const submittedChars = extraction.characters.map((_, i) => i).filter(i => selectedChars.has(i) && !completedChars.has(i) && !isDuplicateChar(extraction.characters[i].name));
    const submittedLocs = extraction.locations.map((_, i) => i).filter(i => selectedLocs.has(i) && !completedLocs.has(i) && !isDuplicateLoc(extraction.locations[i].name));
    const submittedItems = extraction.items.map((_, i) => i).filter(i => selectedItems.has(i) && !completedItems.has(i) && !isDuplicateItem(extraction.items[i].name));
    const submittedFactions = extraction.factions.map((_, i) => i).filter(i => selectedFactions.has(i) && !completedFactions.has(i) && !isDuplicateFaction(extraction.factions[i].name));
    const submittedPowerLevels = extraction.powerLevels.map((_, i) => i).filter(i => selectedPowerLevels.has(i) && !completedPowerLevels.has(i));
    const submittedTimeline = extraction.timelineEvents.map((_, i) => i).filter(i => selectedTimeline.has(i) && !completedTimeline.has(i));
    const confirmed = await onConfirm({
      characters: submittedChars.map(i => extraction.characters[i]),
      locations: submittedLocs.map(i => extraction.locations[i]),
      items: submittedItems.map(i => extraction.items[i]),
      factions: submittedFactions.map(i => extraction.factions[i]),
      powerLevels: submittedPowerLevels.map(i => extraction.powerLevels[i]),
      timelineEvents: submittedTimeline.map(i => extraction.timelineEvents[i]),
      relationships: extraction.relationships
        .filter((r, i) => (!repairRelationshipIndexes || repairRelationshipIndexes.has(i)) && isRelationshipSelected(r, i) && isRelationshipConfirmed(r, i) && !effectiveSkippedRelationships.has(i))
        .map((r) => {
          const origIdx = extraction.relationships.indexOf(r);
          return {
            ...r,
            sourceName: resolvedNames[`${origIdx}:source`] || r.sourceName,
            targetName: resolvedNames[`${origIdx}:target`] || r.targetName,
          };
        }),
      globalOutline: includeGlobalOutline ? extraction.globalOutline : undefined,
      worldRules: includeWorldRules ? extraction.worldRules : undefined,
    }, { keepOpen: unresolvedCount > 0 });
    if (confirmed !== false && unresolvedCount > 0) {
      setCompletedChars(prev => new Set([...prev, ...submittedChars]));
      setCompletedLocs(prev => new Set([...prev, ...submittedLocs]));
      setCompletedItems(prev => new Set([...prev, ...submittedItems]));
      setCompletedFactions(prev => new Set([...prev, ...submittedFactions]));
      setCompletedPowerLevels(prev => new Set([...prev, ...submittedPowerLevels]));
      setCompletedTimeline(prev => new Set([...prev, ...submittedTimeline]));
      setIncludeGlobalOutline(false);
      setIncludeWorldRules(false);
      setRepairRelationshipIndexes(new Set(unresolvedRelationshipIndexes));
      setActiveTab('relationships');
    }
  };

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, idx: number, checked: boolean) => {
    setter(prev => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'characters':
        return (
          <div className="space-y-2">
            {extraction.characters.map((c, i) => !completedChars.has(i) && !isDuplicateChar(c.name) && (
              <CharacterRow key={i} entity={c} checked={selectedChars.has(i)} onToggle={(ch) => toggleSet(setSelectedChars, i, ch)} isDuplicate={false} />
            ))}
            {extraction.characters.every((c, i) => completedChars.has(i) || isDuplicateChar(c.name)) && <EmptyHint text="未提取到人物" />}
          </div>
        );
      case 'locations':
        return (
          <div className="space-y-2">
            {extraction.locations.map((l, i) => !completedLocs.has(i) && !isDuplicateLoc(l.name) && (
              <LocationRow key={i} entity={l} checked={selectedLocs.has(i)} onToggle={(ch) => toggleSet(setSelectedLocs, i, ch)} isDuplicate={false} />
            ))}
            {extraction.locations.every((l, i) => completedLocs.has(i) || isDuplicateLoc(l.name)) && <EmptyHint text="未提取到地点" />}
          </div>
        );
      case 'items':
        return (
          <div className="space-y-2">
            {extraction.items.map((item, i) => !completedItems.has(i) && !isDuplicateItem(item.name) && (
              <ItemRow key={i} entity={item} checked={selectedItems.has(i)} onToggle={(ch) => toggleSet(setSelectedItems, i, ch)} isDuplicate={false} />
            ))}
            {extraction.items.every((item, i) => completedItems.has(i) || isDuplicateItem(item.name)) && <EmptyHint text="未提取到道具" />}
          </div>
        );
      case 'factions':
        return (
          <div className="space-y-2">
            {extraction.factions.map((f, i) => !completedFactions.has(i) && !isDuplicateFaction(f.name) && (
              <FactionRow key={i} entity={f} checked={selectedFactions.has(i)} onToggle={(ch) => toggleSet(setSelectedFactions, i, ch)} isDuplicate={false} />
            ))}
            {extraction.factions.every((f, i) => completedFactions.has(i) || isDuplicateFaction(f.name)) && <EmptyHint text="未提取到势力" />}
          </div>
        );
      case 'powerLevels':
        return (
          <div className="space-y-2">
            {extraction.powerLevels.map((pl, i) => !completedPowerLevels.has(i) && (
              <label key={i} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${selectedPowerLevels.has(i) ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
                <input type="checkbox" checked={selectedPowerLevels.has(i)} onChange={(e) => toggleSet(setSelectedPowerLevels, i, e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-theme-text text-sm">{pl.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600">Tier {pl.tier}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
                  </div>
                  <div className="text-xs text-theme-muted mt-1 line-clamp-2">
                    <span className="text-theme-accent font-medium">{pl.characteristics}</span> · {pl.description}
                  </div>
                </div>
              </label>
            ))}
            {extraction.powerLevels.every((_, i) => completedPowerLevels.has(i)) && <EmptyHint text="未提取到力量体系" />}
          </div>
        );
      case 'timelineEvents':
        return (
          <div className="space-y-2">
            {extraction.timelineEvents.map((te, i) => !completedTimeline.has(i) && (
              <label key={i} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${selectedTimeline.has(i) ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'}`}>
                <input type="checkbox" checked={selectedTimeline.has(i)} onChange={(e) => toggleSet(setSelectedTimeline, i, e.target.checked)} className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-theme-text text-sm">{te.title}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600">新增</span>
                  </div>
                  <div className="text-xs text-theme-muted mt-1 line-clamp-2">
                    <span className="text-theme-accent font-medium">{te.timestamp}</span> · {te.description}
                  </div>
                </div>
              </label>
            ))}
            {extraction.timelineEvents.every((_, i) => completedTimeline.has(i)) && <EmptyHint text="未提取到时间线事件" />}
          </div>
        );
      case 'relationships':
        return (
          <div className="space-y-2">
            {extraction.relationships.map((r, i) => {
              if (repairRelationshipIndexes && !repairRelationshipIndexes.has(i)) return null;
              const srcResolved = resolvedNames[`${i}:source`] || r.sourceName;
              const tgtResolved = resolvedNames[`${i}:target`] || r.targetName;
              const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
              const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
              const confirmed = srcKnown && tgtKnown;
              const srcOptions = entityOptionsByType[r.sourceType] || [];
              const tgtOptions = entityOptionsByType[r.targetType] || [];
              const recommendation = recommendations[i];
              return (
                <div key={i} data-relationship-repair={repairRelationshipIndexes?.has(i) || !confirmed ? 'true' : undefined} className={`p-3 rounded-xl border transition-colors ${isRelationshipSelected(r, i) ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'} ${!confirmed ? 'border-amber-300/50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isRelationshipSelected(r, i)}
                      disabled={!confirmed}
                      onChange={(e) => toggleSet(setSelectedRelationships, i, e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20 disabled:opacity-40"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        {!srcKnown && srcOptions.length > 0 ? (
                          <select
                            value={srcResolved}
                            onChange={(e) => {
                              setResolvedNames(prev => ({ ...prev, [`${i}:source`]: e.target.value }));
                              setSkippedRelationships(prev => { const next = new Set(prev); next.delete(i); return next; });
                              if (!tgtKnown) return;
                              setSelectedRelationships(prev => { const next = new Set(prev); next.add(i); return next; });
                            }}
                            className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-xs text-amber-700 font-bold max-w-[140px]"
                          >
                            <option value={r.sourceName}>{r.sourceName} (未匹配)</option>
                            {srcOptions.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        ) : (
                          <span className={`font-bold ${srcKnown ? 'text-theme-text' : 'text-amber-600'}`}>{srcResolved}</span>
                        )}
                        <span className="text-theme-muted">→</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-theme-accent/10 text-theme-accent">{r.relationshipType}</span>
                        <span className="text-theme-muted">→</span>
                        {!tgtKnown && tgtOptions.length > 0 ? (
                          <select
                            value={tgtResolved}
                            onChange={(e) => {
                              setResolvedNames(prev => ({ ...prev, [`${i}:target`]: e.target.value }));
                              setSkippedRelationships(prev => { const next = new Set(prev); next.delete(i); return next; });
                              if (!srcKnown) return;
                              setSelectedRelationships(prev => { const next = new Set(prev); next.add(i); return next; });
                            }}
                            className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-xs text-amber-700 font-bold max-w-[140px]"
                          >
                            <option value={r.targetName}>{r.targetName} (未匹配)</option>
                            {tgtOptions.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        ) : (
                          <span className={`font-bold ${tgtKnown ? 'text-theme-text' : 'text-amber-600'}`}>{tgtResolved}</span>
                        )}
                        {!confirmed && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-600">
                            <AlertTriangle size={10} /> 待确认
                          </span>
                        )}
                        {!confirmed && (
                          <button
                            onClick={() => {
                              setSkippedRelationships(prev => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i); else next.add(i);
                                return next;
                              });
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${effectiveSkippedRelationships.has(i) ? 'bg-gray-200 text-gray-500' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                          >
                            {effectiveSkippedRelationships.has(i) ? '已跳过' : '跳过此关系'}
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-theme-muted mt-1 line-clamp-2">{r.description}</div>
                      {recommendation && (
                        <div className="mt-2 border-l-2 border-theme-accent/30 pl-2 text-xs text-theme-muted space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-theme-accent">{recommendation.action === 'map' ? '推荐映射' : '建议跳过'}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${recommendation.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : recommendation.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{recommendation.confidence === 'high' ? '高置信度' : recommendation.confidence === 'medium' ? '中置信度' : '低置信度'}</span>
                            <button type="button" disabled={effectiveSkippedRelationships.has(i) || confirmed} className="font-bold text-theme-accent hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60" onClick={() => {
                              if (recommendation.action === 'skip') {
                                setSkippedRelationships(prev => new Set(prev).add(i));
                                return;
                              }
                              setResolvedNames(prev => ({ ...prev, ...(recommendation.sourceName ? { [`${i}:source`]: recommendation.sourceName } : {}), ...(recommendation.targetName ? { [`${i}:target`]: recommendation.targetName } : {}) }));
                              setSkippedRelationships(prev => { const next = new Set(prev); next.delete(i); return next; });
                              if (recommendation.sourceName && recommendation.targetName) setSelectedRelationships(prev => new Set(prev).add(i));
                            }}>{effectiveSkippedRelationships.has(i) ? '已采用跳过' : confirmed ? '已采用' : recommendation.action === 'map' ? '采用建议' : '采用并跳过'}</button>
                          </div>
                          <div>{recommendation.reason}</div>
                          {recommendation.evidence.map((evidence, evidenceIndex) => <div key={evidenceIndex} className="line-clamp-2 break-words" title={evidence.quote}>来源：{evidence.filename} · “{evidence.quote}”</div>)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {(repairRelationshipIndexes ? repairRelationshipIndexes.size === 0 : extraction.relationships.length === 0) && <EmptyHint text="没有待处理关系" />}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-theme-text text-sm">同步预览 — 选择要导入的实体</div>
          <div className="text-xs text-theme-muted mt-0.5">
            新增实体默认勾选，已存在同名实体自动隐藏。关系中引用不存在实体的标记为待确认。
          </div>
        </div>
        <button onClick={onCancel} disabled={isSyncing} className="text-theme-muted hover:text-theme-text transition-colors disabled:opacity-50" aria-label="关闭同步预览">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-theme-border overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors border-b-2 -mb-px ${activeTab === tab.key ? 'border-theme-accent text-theme-accent' : 'border-transparent text-theme-muted hover:text-theme-text'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-96 overflow-y-auto space-y-2">
        {renderTabContent()}
      </div>

      {/* Global outline & world rules toggles */}
      <div className="space-y-2 pt-2 border-t border-theme-border">
        {extraction.globalOutline && (
          <label className="flex items-center gap-2 text-xs text-theme-text">
            <input type="checkbox" checked={includeGlobalOutline} onChange={(e) => setIncludeGlobalOutline(e.target.checked)} className="h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
            同步世界大纲
          </label>
        )}
        {extraction.worldRules && (
          <label className="flex items-center gap-2 text-xs text-theme-text">
            <input type="checkbox" checked={includeWorldRules} onChange={(e) => setIncludeWorldRules(e.target.checked)} className="h-4 w-4 rounded border-theme-border text-theme-accent focus:ring-theme-accent/20" />
            同步世界规则
          </label>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex flex-col gap-3 pt-3 border-t border-theme-border xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-theme-muted">
          <span>新增 <strong className="text-emerald-600">{counts.newCount}</strong> 项</span>
          {counts.skipCount > 0 && <span>跳过 <strong className="text-gray-500">{counts.skipCount}</strong> 项</span>}
          {unresolvedCount > 0 && (
            <>
              <span>待处理 <strong className="text-amber-600">{unresolvedCount}</strong> 项关系</span>
              <button
                type="button"
                onClick={() => {
                  setRepairRelationshipIndexes(new Set(unresolvedRelationshipIndexes));
                  setActiveTab('relationships');
                }}
                className="font-bold text-amber-700 hover:text-amber-800"
              >
                逐条处理
              </button>
              <button
                type="button"
                onClick={handleSkipAllUnresolved}
                className="rounded-lg border border-amber-300 px-2 py-1 font-bold text-amber-700 hover:bg-amber-50"
              >
                跳过全部待确认关系
              </button>
              {packId && novelId && databaseGeneration !== undefined && (
                <button type="button" onClick={handleRecommendRepairs} disabled={isRecommending} className="flex items-center gap-1 rounded-lg border border-theme-accent/30 px-2 py-1 font-bold text-theme-accent hover:bg-theme-accent/5 disabled:opacity-50">
                  {isRecommending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {isRecommending ? '推荐中...' : 'Agent 推荐修复'}
                </button>
              )}
              {recommendError && (
                <span className="flex flex-wrap items-center gap-2 text-red-500"><span className="break-words">{recommendError}</span><button type="button" onClick={handleRecommendRepairs} className="font-bold underline">重试</button><button type="button" onClick={() => window.dispatchEvent(new Event('open-settings'))} className="font-bold underline">打开设置</button></span>
              )}
            </>
          )}
          {recommendStatus && <span role="status" className="text-emerald-600">{recommendStatus}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end xl:self-auto">
          <button onClick={onCancel} disabled={isSyncing} className="shrink-0 whitespace-nowrap px-4 py-2 rounded-xl border border-theme-border text-theme-text text-xs font-bold hover:bg-theme-sidebar/20 transition-colors">
            取消
          </button>
          <button onClick={handleConfirm} disabled={isSyncing} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-theme-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50" title={unresolvedCount > 0 ? `先导入可确认项，再逐条处理 ${unresolvedCount} 条关系` : ''}>
            {isSyncing && <Loader2 size={12} className="animate-spin" />}
            {isSyncing ? '同步中...' : unresolvedCount > 0 ? `导入可确认项并处理 ${unresolvedCount} 条关系` : '确认同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
