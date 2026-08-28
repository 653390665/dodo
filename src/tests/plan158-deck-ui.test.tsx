import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SkillDeckCard } from '../../shared/types';
import { EquipPanel } from '../components/book-factory/EquipPanel';
import { BookFactoryOutput } from '../components/book-factory/BookFactoryOutput';

function card(id: string): SkillDeckCard {
  return {
    id,
    name: id,
    description: '',
    style: '短句',
    pacing: '紧凑',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    deconstructionCardType: 'style-card',
    evidenceCoverage: 'full-book-stable',
    evidenceMoments: ['opening', 'mid', 'climax'],
  };
}

describe('Plan 158 Deck equipment UI', () => {
  it('shows main/support preview and no role-slot controls', () => {
    render(
      <EquipPanel
        deck={{ mainCard: card('main'), supportCards: [card('support')] }}
        savedDeckIds={[]}
        isSaving={false}
        equipNovelId=""
        onSetEquipNovelId={() => undefined}
        userNovels={[]}
        onEquipDeck={() => undefined}
        onEquipSkill={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getAllByText(/主卡/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/辅卡/).length).toBeGreaterThan(0);
    expect(screen.getByText('提交到作品卡组待选')).toBeDefined();
    expect(screen.getByText('提交后仍是待选；在作品能力中心选择主卡或辅卡并应用配置后，才会参与后续写作。')).toBeDefined();
    expect(screen.queryByText(/Planner|Writer|Critic/)).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('explains that single cards enter deck candidates before affecting writing', () => {
    render(
      <EquipPanel
        deck={null}
        savedDeckIds={[]}
        isSaving={false}
        equipNovelId=""
        onSetEquipNovelId={() => undefined}
        userNovels={[]}
        onEquipDeck={() => undefined}
        onEquipSkill={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText('保存后进入作品卡组待选；选择主卡或辅卡，并点击应用配置后才写入作品卡组。')).toBeDefined();
    expect(screen.getByRole('option', { name: '请选择目标作品' })).toBeDefined();
    expect(screen.queryByRole('option', { name: '只保存能力卡，不加入作品' })).toBeNull();
  });

  it('keeps deck selection controls out of nested button markup', () => {
    render(
      <BookFactoryOutput
        isAnalyzing={false} skillCards={[card('main'), card('support')]} selectedSkillIndex={0}
        onSelectSkillIndex={() => undefined} deck={{ mainCard: card('main'), supportCards: [card('support')] }}
        deckMeta={null} segmentLabels={[]} isSaving={false} isEditing={false} onSetIsEditing={() => undefined}
        editableJson="" onSetEditableJson={() => undefined} extractionSource={null} isModelPending={false}
        extractionWarnings={[]} extractionStatusNote={null} selectedSkill={card('main')} updateSelectedSkill={() => undefined}
        testInput="" onTestInputChange={() => undefined} testOutput="" isTesting={false} showEquipPanel={false}
        onSetShowEquipPanel={() => undefined} equipNovelId="" onSetEquipNovelId={() => undefined} userNovels={[]}
        lastSavedSkillId="" selectedSavedSkillId="" savedDeckIds={[]} onTestDrive={() => undefined} onSaveSelectedSkill={() => undefined}
        onSaveDeck={() => undefined} onEquipDeck={() => undefined} onEquipSkill={() => undefined}
        deckSelection={{ mainCardId: 'main', supportCardIds: ['support'] }} onDeckSelectionChange={() => undefined}
      />,
    );
    expect(document.querySelectorAll('button button')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '保存卡组草稿' })).toBeDefined();
    expect(screen.getByRole('button', { name: '提交到作品卡组待选' })).toBeDefined();
    expect(screen.getByRole('button', { name: '设为主卡' })).toBeDefined();
    expect(screen.getByRole('button', { name: '加入辅卡' })).toBeDefined();
  });

  it('explains that saved sample cards must join a target deck before affecting writing', () => {
    render(
      <BookFactoryOutput
        isAnalyzing={false} skillCards={[]} selectedSkillIndex={0}
        onSelectSkillIndex={() => undefined} deck={null} deckMeta={null} segmentLabels={[]} isSaving={false} isEditing={false} onSetIsEditing={() => undefined}
        editableJson="" onSetEditableJson={() => undefined} extractionSource={null} isModelPending={false}
        extractionWarnings={[]} extractionStatusNote={null} selectedSkill={null} updateSelectedSkill={() => undefined}
        testInput="" onTestInputChange={() => undefined} testOutput="" isTesting={false} showEquipPanel={false}
        onSetShowEquipPanel={() => undefined} equipNovelId="" onSetEquipNovelId={() => undefined} userNovels={[]}
        lastSavedSkillId="" selectedSavedSkillId="" savedDeckIds={[]} onTestDrive={() => undefined} onSaveSelectedSkill={() => undefined}
        onSaveDeck={() => undefined} onEquipDeck={() => undefined} onEquipSkill={() => undefined}
        deckSelection={{}} onDeckSelectionChange={() => undefined}
      />,
    );
    expect(screen.getByText('从样本文本中萃取叙事口吻、节奏密度和冲突触发方式；保存到我的能力只是入库，提交到作品卡组待选后仍需在作品能力中心应用配置。')).toBeDefined();
  });

  it('keeps card selection keyboard reachable with visible focus styling', () => {
    const onSelectSkillIndex = vi.fn();
    render(
      <BookFactoryOutput
        isAnalyzing={false} skillCards={[card('main')]} selectedSkillIndex={0}
        onSelectSkillIndex={onSelectSkillIndex} deck={null} deckMeta={null} segmentLabels={[]} isSaving={false} isEditing={false} onSetIsEditing={() => undefined}
        editableJson="" onSetEditableJson={() => undefined} extractionSource={null} isModelPending={false}
        extractionWarnings={[]} extractionStatusNote={null} selectedSkill={card('main')} updateSelectedSkill={() => undefined}
        testInput="" onTestInputChange={() => undefined} testOutput="" isTesting={false} showEquipPanel={false}
        onSetShowEquipPanel={() => undefined} equipNovelId="" onSetEquipNovelId={() => undefined} userNovels={[]}
        lastSavedSkillId="" selectedSavedSkillId="" savedDeckIds={[]} onTestDrive={() => undefined} onSaveSelectedSkill={() => undefined}
        onSaveDeck={() => undefined} onEquipDeck={() => undefined} onEquipSkill={() => undefined}
        deckSelection={{}} onDeckSelectionChange={() => undefined}
      />, { container: document.body },
    );
    const button = screen.getByRole('button', { name: '选择拆书卡 main' });
    expect(button.className).toMatch(/focus-visible:ring/);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onSelectSkillIndex).toHaveBeenCalledWith(0);
  });
});
