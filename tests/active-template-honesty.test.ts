import test from 'node:test';
import assert from 'node:assert/strict';

import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';

/**
 * Plan 215 审计增补守卫：runtimeStatus === 'active' ⇒ template 不得是骨架占位。
 * 「展示文案正常、主体为占位符」是数据诚实度谎言；任何人删掉 realTemplates 条目
 * 导致静默降级时，本守卫必须变红。
 */
test('active catalog assets never carry skeleton placeholder bodies (plan 215)', () => {
  const SKELETON_PREFIX = '[商业定制专属提示词体]';
  const offenders = PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.runtimeStatus === 'active' &&
      typeof asset.template === 'string' &&
      asset.template.startsWith(SKELETON_PREFIX)
  );
  assert.deepEqual(
    offenders,
    [],
    `active 资产仍带骨架占位正文（修法：在 realTemplates 按 id 补真实正文）：${offenders
      .map((a) => a.id)
      .join(', ')}`
  );
});
