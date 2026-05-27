import type { Character, ContinuationPack, Item, Location } from '../types';
import { getPreferredContinuationPack } from './continuation-pack-selection';

export type KnowledgeEntrySource = 'entity' | 'continuation-pack';

export interface KnowledgeSearchEntry {
  id: string;
  kind: 'character' | 'location' | 'item' | 'canon-fact' | 'pack-character' | 'continuation-task' | 'reading-question' | 'continuation-gap' | 'source-section';
  source: KnowledgeEntrySource;
  title: string;
  summary: string;
  detail: string;
  tag: string;
  sourceLabel: string;
}

interface BuildKnowledgeSearchEntriesArgs {
  bibleSearch: string;
  characters: Character[];
  locations: Location[];
  items: Item[];
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
}

function normalizeSearch(text: string): string {
  return text.trim().toLowerCase();
}

function matchesSearch(search: string, ...fields: string[]): boolean {
  if (!search) return true;
  const haystack = fields.join(' ').toLowerCase();
  return haystack.includes(search);
}

export function buildKnowledgeSearchEntries({
  bibleSearch,
  characters,
  locations,
  items,
  continuationPacks,
  selectedContinuationPackId,
}: BuildKnowledgeSearchEntriesArgs): KnowledgeSearchEntry[] {
  const normalizedSearch = normalizeSearch(bibleSearch);
  const selectedPack = getPreferredContinuationPack(continuationPacks, selectedContinuationPackId);

  const entityEntries: KnowledgeSearchEntry[] = [
    ...characters.map((character) => ({
      id: character.id,
      kind: 'character' as const,
      source: 'entity' as const,
      title: character.name,
      summary: character.summary,
      detail: character.bio || character.traits.join(' / '),
      tag: `角色 - ${character.role}`,
      sourceLabel: '设定实体',
    })),
    ...locations.map((location) => ({
      id: location.id,
      kind: 'location' as const,
      source: 'entity' as const,
      title: location.name,
      summary: location.region,
      detail: location.description,
      tag: '地点',
      sourceLabel: '设定实体',
    })),
    ...items.map((item) => ({
      id: item.id,
      kind: 'item' as const,
      source: 'entity' as const,
      title: item.name,
      summary: item.type,
      detail: item.description,
      tag: '道具',
      sourceLabel: '设定实体',
    })),
  ];

  const packEntries: KnowledgeSearchEntry[] = selectedPack
    ? [
        {
          id: `${selectedPack.id}-task`,
          kind: 'continuation-task',
          source: 'continuation-pack',
          title: selectedPack.continuationTask || `${selectedPack.title} 续写任务`,
          summary: selectedPack.plotState.latestScene || '资料包续写任务',
          detail: [
            selectedPack.plotState.immediateConflict,
            selectedPack.plotState.nextLikelyMove,
          ].filter(Boolean).join(' / '),
          tag: '续写任务',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        },
        ...selectedPack.canonFacts.map((fact) => ({
          id: fact.id,
          kind: 'canon-fact' as const,
          source: 'continuation-pack' as const,
          title: fact.text,
          summary: `${fact.priority} · ${fact.category}`,
          detail: fact.evidence,
          tag: '硬设定',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        })),
        ...selectedPack.characterStates.map((character, index) => ({
          id: `${selectedPack.id}-character-${index}`,
          kind: 'pack-character' as const,
          source: 'continuation-pack' as const,
          title: character.name,
          summary: `${character.role} · ${character.currentGoal}`,
          detail: [
            character.emotionalState,
            ...(character.relationshipNotes || []),
            ...(character.secrets || []),
            character.evidence,
          ].filter(Boolean).join(' / '),
          tag: '资料人物',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        })),
        ...(selectedPack.readingQuestions || []).map((question) => ({
          id: question.id,
          kind: 'reading-question' as const,
          source: 'continuation-pack' as const,
          title: question.question,
          summary: question.category,
          detail: question.context,
          tag: '审读问题',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        })),
        ...(selectedPack.continuationGaps || []).map((gap) => ({
          id: gap.id,
          kind: 'continuation-gap' as const,
          source: 'continuation-pack' as const,
          title: gap.description,
          summary: `${gap.severity} · ${gap.suggestedDirection}`,
          detail: gap.relatedFacts.join(' / '),
          tag: '续写缺口',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        })),
        ...(selectedPack.sourceMap?.sections || []).map((section, index) => ({
          id: `${selectedPack.id}-section-${index}`,
          kind: 'source-section' as const,
          source: 'continuation-pack' as const,
          title: section.title,
          summary: section.summary,
          detail: section.sourceIds.join(' / '),
          tag: '资料章节',
          sourceLabel: `资料包 · ${selectedPack.title}`,
        })),
      ]
    : [];

  return [...packEntries, ...entityEntries].filter((entry) =>
    matchesSearch(normalizedSearch, entry.title, entry.summary, entry.detail, entry.tag, entry.sourceLabel),
  );
}
