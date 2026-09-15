import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/public-skill-catalog';
import { PlazaAssetCard } from '../components/skills/PlazaAssetCard';

const noop = () => {};
const baseProps = {
  isImported: false,
  isFavorited: false,
  isCloning: false,
  selectedNovel: null,
  isFreeNovel: false,
  onImport: noop,
  onEquip: noop,
  onUseTechnique: noop,
  onUseProjectTechnique: noop,
  onDirectExec: noop,
};

const card = (id: string) => {
  const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === id);
  if (!asset) throw new Error(`missing curated card: ${id}`);
  return asset;
};

describe('PlazaAssetCard 重构绑定提示（plan 228）', () => {
  test('人设重构卡显示来料加工徽标与既有角色资料绑定提示', () => {
    render(<PlazaAssetCard {...baseProps} asset={card('refine-character-rebuild')} />);
    expect(screen.getByText('来料加工')).toBeTruthy();
    const hint = screen.getByTestId('refine-binding-hint');
    expect(hint.textContent).toContain('现有角色设定');
    expect(hint.textContent).toContain('候选');
  });

  test('大纲重构卡绑定提示指向现有大纲资料', () => {
    render(<PlazaAssetCard {...baseProps} asset={card('refine-outline-rebuild')} />);
    expect(screen.getByTestId('refine-binding-hint').textContent).toContain('现有大纲资料');
  });

  test('普通生成卡不显示绑定提示', () => {
    render(<PlazaAssetCard {...baseProps} asset={card('bible-character-arc')} />);
    expect(screen.queryByTestId('refine-binding-hint')).toBeNull();
    expect(screen.queryByText('来料加工')).toBeNull();
  });
});
