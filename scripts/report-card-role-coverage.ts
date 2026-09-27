/**
 * 卡角色投影覆盖度取证（规格 §4.2 小类「统一角色投影」验证①）。
 * 只读：列出精选 manifest 与治理资产的 kind/category → role 投影，断言零未映射。
 */
import { listCatalogCapabilityManifests } from '../shared/lib/capability-manifest-catalog.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import {
  CARD_ROLES,
  cardRoleForGovernedCategory,
  cardRoleForManifest,
  listKindRoleProjections,
} from '../shared/lib/capability-card-role.js';

const manifests = listCatalogCapabilityManifests();
const cards = manifests.filter((e) => e.kind !== 'flow');
const flows = manifests.filter((e) => e.kind === 'flow');

const unmappedCards = cards.filter((e) => cardRoleForManifest(e) === null);
const unmappedGoverned = PROMPT_GOVERNANCE_CATALOG.filter(
  (e) => cardRoleForGovernedCategory(e.primaryCategory) === null
);
const badRole = [
  ...cards.map((e) => cardRoleForManifest(e)),
  ...PROMPT_GOVERNANCE_CATALOG.map((e) => cardRoleForGovernedCategory(e.primaryCategory)),
].filter((r) => r !== null && !(CARD_ROLES as readonly string[]).includes(r));

function tally<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

console.log('=== kind 全量投影 ===');
console.log(listKindRoleProjections().map((p) => `${p.kind}→${p.role ?? 'null'}`).join('  '));

console.log('\n=== A. 精选 manifest ===');
console.log('总数', manifests.length, '｜非 flow 卡', cards.length, '｜flow', flows.length);
console.log('非 flow 按 kind:', tally(cards, (e) => e.kind));
console.log('非 flow 按 role:', tally(cards, (e) => String(cardRoleForManifest(e))));
console.log('非 flow 按 kind+output:', tally(cards, (e) => `${e.kind}/${e.output}`));
console.log('flow 全部 null:', flows.every((e) => cardRoleForManifest(e) === null));

console.log('\n=== A2. 非 flow 卡逐张投影 ===');
for (const e of cards) {
  console.log(
    [e.id, e.kind, e.output, e.action, e.allowedScopes.join('+'), cardRoleForManifest(e)].join(' | ')
  );
}

console.log('\n=== B. 治理资产 ===');
console.log('总数', PROMPT_GOVERNANCE_CATALOG.length);
console.log('按 primaryCategory:', tally(PROMPT_GOVERNANCE_CATALOG, (e) => e.primaryCategory ?? '(none)'));
console.log('按 role:', tally(PROMPT_GOVERNANCE_CATALOG, (e) => String(cardRoleForGovernedCategory(e.primaryCategory))));

console.log('\n=== 未映射 ===');
console.log('精选卡未映射:', unmappedCards.map((e) => `${e.id}(${e.kind}/${e.output})`));
console.log(
  '治理资产未映射:',
  unmappedGoverned.map((e) => `${e.id}(${e.primaryCategory ?? 'none'})`).slice(0, 20),
  '共',
  unmappedGoverned.length
);
console.log('越界角色:', badRole);

const pass =
  unmappedCards.length === 0 && unmappedGoverned.length === 0 && badRole.length === 0 && flows.length > 0;
console.log('\n' + (pass ? 'PASS 零未映射' : 'FAIL'));
if (!pass) process.exit(1);
