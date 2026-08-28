import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';
import type { Novel } from '../../shared/types';
import { WorldBibleAssistant } from '../components/WorldBibleAssistant';

const worldClient = vi.hoisted(() => ({
  listCharacters: vi.fn().mockResolvedValue([]),
  listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]),
  listFactions: vi.fn().mockResolvedValue([]),
  listPowerLevels: vi.fn().mockResolvedValue([]),
  listTimelineEvents: vi.fn().mockResolvedValue([]),
  listEntityRelationshipsClient: vi.fn().mockResolvedValue([]),
  createCharacter: vi.fn().mockResolvedValue(undefined),
  createLocation: vi.fn().mockResolvedValue(undefined),
  createItem: vi.fn().mockResolvedValue(undefined),
  createFaction: vi.fn().mockResolvedValue(undefined),
  createPowerLevel: vi.fn().mockResolvedValue(undefined),
  createTimelineEvent: vi.fn().mockResolvedValue(undefined),
  importWorldExtraction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/world-client', () => worldClient);

describe('作品助手设定安全边界', () => {
  const novel: Novel = {
    id: 'novel-1', title: '测试作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
  };

  beforeEach(() => {
    useNovelStore.setState({ selectedNovel: novel });
    useAssistantSessionStore.getState().setDraft(novel.id, 'bible', null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    useAssistantSessionStore.getState().setDraft(novel.id, 'bible', null);
    vi.clearAllMocks();
  });

  test('未确认前不写入，重复确认只创建一次且绑定当前作品', async () => {
    useAssistantSessionStore.getState().setDraft(novel.id, 'bible', {
      type: 'character',
      databaseGeneration: 0,
      data: { name: '林', role: 'protagonist' },
    });

    render(<WorldBibleAssistant novel={novel} onClose={vi.fn()} />);
    expect(worldClient.createCharacter).not.toHaveBeenCalled();
    expect(worldClient.importWorldExtraction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认写入设定' }));
    fireEvent.click(screen.getByRole('button', { name: '确认写入设定' }));

    expect(worldClient.createCharacter).toHaveBeenCalledTimes(1);
    expect(worldClient.createCharacter).toHaveBeenCalledWith(expect.objectContaining({ novelId: novel.id }), 0);
    expect(worldClient.importWorldExtraction).not.toHaveBeenCalled();
  });

  test('generation 非法时不写入并提示', () => {
    renderAssistantWithDraft(novel, { databaseGeneration: -1 });
    fireEvent.click(screen.getByRole('button', { name: '确认写入设定' }));
    expect(worldClient.createCharacter).not.toHaveBeenCalled();
    expect(screen.getByText(/版本无效/)).toBeTruthy();
    cleanup();
  });

  test('当前作品变化时不写入并提示', () => {
    renderAssistantWithDraft(novel, { databaseGeneration: 0 });
    useNovelStore.setState({ selectedNovel: { ...novel, id: 'novel-2' } });
    fireEvent.click(screen.getByRole('button', { name: '确认写入设定' }));
    expect(worldClient.createCharacter).not.toHaveBeenCalled();
    expect(screen.getByText(/当前作品已变化/)).toBeTruthy();
  });
});

function renderAssistantWithDraft(novel: Novel, overrides: { databaseGeneration?: number }) {
  useAssistantSessionStore.getState().setDraft(novel.id, 'bible', {
    type: 'character', databaseGeneration: overrides.databaseGeneration,
    data: { name: '林', role: 'protagonist' },
  });
  return render(<WorldBibleAssistant novel={novel} onClose={vi.fn()} />);
}
