import React, { useState, useMemo, useCallback } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { SyncExtractionResult } from '../../../shared/lib/sync-extract-prompt';
import type { Character, Location, Item, Faction } from '../../../shared/types';

interface SyncPreviewPanelProps {
  extraction: SyncExtractionResult;
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
  }) => void;
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

  const unresolvedCount = useMemo(() => {
    let count = 0;
    extraction.relationships.forEach((r, i) => {
      if (skippedRelationships.has(i)) return;
      const srcResolved = resolvedNames[`${i}:source`] || r.sourceName;
      const tgtResolved = resolvedNames[`${i}:target`] || r.targetName;
      const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
      const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
      if (!srcKnown || !tgtKnown) count++;
    });
    return count;
  }, [extraction.relationships, resolvedNames, allEntityNames, skippedRelationships]);

  const counts = useMemo(() => {
    let newCount = 0;
    let skipCount = 0;

    extraction.characters.forEach((c, i) => {
      if (selectedChars.has(i)) {
        if (isDuplicateChar(c.name)) skipCount++;
        else newCount++;
      }
    });
    extraction.locations.forEach((l, i) => {
      if (selectedLocs.has(i)) {
        if (isDuplicateLoc(l.name)) skipCount++;
        else newCount++;
      }
    });
    extraction.items.forEach((item, i) => {
      if (selectedItems.has(i)) {
        if (isDuplicateItem(item.name)) skipCount++;
        else newCount++;
      }
    });
    extraction.factions.forEach((f, i) => {
      if (selectedFactions.has(i)) {
        if (isDuplicateFaction(f.name)) skipCount++;
        else newCount++;
      }
    });

    return { newCount, skipCount };
  }, [selectedChars, selectedLocs, selectedItems, selectedFactions, extraction, isDuplicateChar, isDuplicateLoc, isDuplicateItem, isDuplicateFaction]);

  const handleConfirm = () => {
    onConfirm({
      characters: extraction.characters.filter((_, i) => selectedChars.has(i)),
      locations: extraction.locations.filter((_, i) => selectedLocs.has(i)),
      items: extraction.items.filter((_, i) => selectedItems.has(i)),
      factions: extraction.factions.filter((_, i) => selectedFactions.has(i)),
      powerLevels: extraction.powerLevels.filter((_, i) => selectedPowerLevels.has(i)),
      timelineEvents: extraction.timelineEvents.filter((_, i) => selectedTimeline.has(i)),
      relationships: extraction.relationships
        .filter((_, i) => selectedRelationships.has(i) && !skippedRelationships.has(i))
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
    });
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
            {extraction.characters.map((c, i) => (
              <CharacterRow key={i} entity={c} checked={selectedChars.has(i)} onToggle={(ch) => toggleSet(setSelectedChars, i, ch)} isDuplicate={isDuplicateChar(c.name)} />
            ))}
            {extraction.characters.length === 0 && <EmptyHint text="未提取到人物" />}
          </div>
        );
      case 'locations':
        return (
          <div className="space-y-2">
            {extraction.locations.map((l, i) => (
              <LocationRow key={i} entity={l} checked={selectedLocs.has(i)} onToggle={(ch) => toggleSet(setSelectedLocs, i, ch)} isDuplicate={isDuplicateLoc(l.name)} />
            ))}
            {extraction.locations.length === 0 && <EmptyHint text="未提取到地点" />}
          </div>
        );
      case 'items':
        return (
          <div className="space-y-2">
            {extraction.items.map((item, i) => (
              <ItemRow key={i} entity={item} checked={selectedItems.has(i)} onToggle={(ch) => toggleSet(setSelectedItems, i, ch)} isDuplicate={isDuplicateItem(item.name)} />
            ))}
            {extraction.items.length === 0 && <EmptyHint text="未提取到道具" />}
          </div>
        );
      case 'factions':
        return (
          <div className="space-y-2">
            {extraction.factions.map((f, i) => (
              <FactionRow key={i} entity={f} checked={selectedFactions.has(i)} onToggle={(ch) => toggleSet(setSelectedFactions, i, ch)} isDuplicate={isDuplicateFaction(f.name)} />
            ))}
            {extraction.factions.length === 0 && <EmptyHint text="未提取到势力" />}
          </div>
        );
      case 'powerLevels':
        return (
          <div className="space-y-2">
            {extraction.powerLevels.map((pl, i) => (
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
            {extraction.powerLevels.length === 0 && <EmptyHint text="未提取到力量体系" />}
          </div>
        );
      case 'timelineEvents':
        return (
          <div className="space-y-2">
            {extraction.timelineEvents.map((te, i) => (
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
            {extraction.timelineEvents.length === 0 && <EmptyHint text="未提取到时间线事件" />}
          </div>
        );
      case 'relationships':
        return (
          <div className="space-y-2">
            {extraction.relationships.map((r, i) => {
              const srcResolved = resolvedNames[`${i}:source`] || r.sourceName;
              const tgtResolved = resolvedNames[`${i}:target`] || r.targetName;
              const srcKnown = allEntityNames.has(`${r.sourceType}:${normalizeName(srcResolved)}`);
              const tgtKnown = allEntityNames.has(`${r.targetType}:${normalizeName(tgtResolved)}`);
              const confirmed = srcKnown && tgtKnown;
              const srcOptions = entityOptionsByType[r.sourceType] || [];
              const tgtOptions = entityOptionsByType[r.targetType] || [];
              return (
                <div key={i} className={`p-3 rounded-xl border transition-colors ${selectedRelationships.has(i) ? 'border-theme-accent/30 bg-theme-accent/5' : 'border-theme-border bg-theme-sidebar/30'} ${!confirmed ? 'border-amber-300/50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedRelationships.has(i)}
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
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${skippedRelationships.has(i) ? 'bg-gray-200 text-gray-500' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                          >
                            {skippedRelationships.has(i) ? '已跳过' : '跳过此关系'}
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-theme-muted mt-1 line-clamp-2">{r.description}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {extraction.relationships.length === 0 && <EmptyHint text="未提取到关系" />}
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
            新增实体默认勾选，已存在同名实体默认跳过。关系中引用不存在实体的标记为待确认。
          </div>
        </div>
        <button onClick={onCancel} className="text-theme-muted hover:text-theme-text transition-colors">
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
      <div className="flex items-center justify-between pt-3 border-t border-theme-border">
        <div className="text-xs text-theme-muted space-x-3">
          <span>新增 <strong className="text-emerald-600">{counts.newCount}</strong> 项</span>
          <span>跳过 <strong className="text-gray-500">{counts.skipCount}</strong> 项</span>
          {unresolvedCount > 0 && (
            <span>待处理 <strong className="text-amber-600">{unresolvedCount}</strong> 项关系</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={isSyncing} className="px-4 py-2 rounded-xl border border-theme-border text-theme-text text-xs font-bold hover:bg-theme-sidebar/20 transition-colors">
            取消
          </button>
          <button onClick={handleConfirm} disabled={isSyncing || unresolvedCount > 0} className="px-4 py-2 rounded-xl bg-theme-accent text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2" title={unresolvedCount > 0 ? '请先处理所有待确认关系（解析或跳过）' : ''}>
            {isSyncing && <Loader2 size={12} className="animate-spin" />}
            {isSyncing ? '同步中...' : '确认同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
