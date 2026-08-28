import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { resolved } = vi.hoisted(() => ({ resolved: () => vi.fn().mockResolvedValue([]) }));

vi.mock('../lib/world-client', () => ({
  listCharacters: resolved(), listLocations: resolved(), listItems: resolved(), listTimelineEvents: resolved(),
  listFactions: resolved(), listPowerLevels: resolved(), listEntityRelationshipsClient: resolved(),
  createCharacter: resolved(), updateCharacter: resolved(), deleteCharacter: resolved(),
  createLocation: resolved(), updateLocation: resolved(), deleteLocation: resolved(),
  createItem: resolved(), updateItem: resolved(), deleteItem: resolved(),
  createFaction: resolved(), updateFaction: resolved(), deleteFaction: resolved(),
  createPowerLevel: resolved(), updatePowerLevel: resolved(), deletePowerLevel: resolved(),
  createTimelineEvent: resolved(), updateTimelineEvent: resolved(), deleteTimelineEvent: resolved(),
  importWorldExtraction: resolved(),
}));
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: resolved() }));
vi.mock('../lib/novel-client', () => ({ getNovel: vi.fn().mockResolvedValue(null), updateNovel: resolved() }));
vi.mock('../lib/db-transport', () => ({
  call: vi.fn(async (method: string) => method === 'listChaptersMetadata' ? [] : undefined),
  requireResponseDatabaseGeneration: vi.fn(),
  subscribeToChanges: vi.fn(() => () => {}),
}));
vi.mock('../lib/prompt-client', () => ({ parseDocAsync: vi.fn() }));
vi.mock('../components/WorldBibleOnboarding', () => ({ WorldBibleOnboarding: () => <div /> }));
vi.mock('../components/ContinuationOverviewPanel', () => ({ ContinuationOverviewPanel: () => <div>overview</div> }));
vi.mock('../components/ContinuationPackView', () => ({ ContinuationPackView: () => <div>packs</div> }));
vi.mock('../components/StoryContractPanel', () => ({ StoryContractPanel: () => <div /> }));
vi.mock('../components/world-bible/CharactersTab', () => ({ CharactersTab: () => <div>characters</div> }));
vi.mock('../components/world-bible/LocationsTab', () => ({ LocationsTab: () => <div /> }));
vi.mock('../components/world-bible/ItemsTab', () => ({ ItemsTab: () => <div /> }));
vi.mock('../components/world-bible/FactionsTab', () => ({ FactionsTab: () => <div /> }));
vi.mock('../components/world-bible/PowerLevelsTab', () => ({ PowerLevelsTab: () => <div /> }));
vi.mock('../components/world-bible/TimelineTab', () => ({ TimelineTab: () => <div /> }));
vi.mock('../components/world-bible/GlobalSetupTab', () => ({ GlobalSetupTab: () => <div /> }));
vi.mock('../components/RelationshipGraph', () => ({ RelationshipGraph: () => <div /> }));
vi.mock('../components/world-bible/RelationshipFormDialog', () => ({ RelationshipFormDialog: () => null }));
vi.mock('../components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

import { WorldBibleView } from '../components/WorldBibleView';

const novel = {
  id: 'novel-1', title: '测试作品', authorId: 'local', summary: '', status: 'ongoing' as const,
  createdAt: 1, updatedAt: 1,
};

describe('WorldBible helper drawer', () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

  test('opens the global assistant with world context and does not render a local drawer', () => {
    const onOpenAssistant = vi.fn();
    render(<WorldBibleView novel={novel} onOpenAssistant={onOpenAssistant} />);
    fireEvent.click(screen.getByRole('button', { name: '打开智能管家' }));

    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
    expect(onOpenAssistant).toHaveBeenCalledWith('bible', {
      surface: 'world', novelId: novel.id, worldBibleTab: 'overview',
    });
    expect(screen.queryByRole('complementary', { name: '智能管家设定模式' })).toBeNull();
  });

  test('empty overview explains import as a confirmable draft', () => {
    render(<WorldBibleView novel={novel} />);

    expect(screen.getByText(/生成大纲与设定拆解草稿，确认后再导入/)).toBeTruthy();
    expect(screen.queryByText(/一键完成大纲与设定/)).toBeNull();
  });

  test('passes the current world bible tab when opening from人物档案', () => {
    const onOpenAssistant = vi.fn();
    render(<WorldBibleView novel={novel} onOpenAssistant={onOpenAssistant} />);
    fireEvent.click(screen.getAllByRole('button', { name: '人物档案' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '打开智能管家' }));

    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
    expect(onOpenAssistant).toHaveBeenCalledWith('bible', {
      surface: 'world', novelId: novel.id, worldBibleTab: 'characters',
    });
  });
});
