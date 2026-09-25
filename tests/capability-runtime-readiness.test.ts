import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  hasRuntimeReadySanitization,
  isRuntimeReadyAsset,
} from '../shared/lib/capability-runtime-readiness.js';

const READY = {
  isRuntimeReady: true,
  runtimeStatus: 'active',
  sanitizationStatus: 'runtime-ready',
};

test('isRuntimeReadyAsset：三元判据缺一不可', () => {
  assert.equal(isRuntimeReadyAsset(READY), true);
  assert.equal(isRuntimeReadyAsset({ ...READY, isRuntimeReady: false }), false);
  assert.equal(isRuntimeReadyAsset({ ...READY, runtimeStatus: 'candidate' }), false);
  assert.equal(isRuntimeReadyAsset({ ...READY, sanitizationStatus: 'needs-sanitization' }), false);
  assert.equal(isRuntimeReadyAsset(undefined), false);
  assert.equal(isRuntimeReadyAsset(null), false);
  assert.equal(isRuntimeReadyAsset({}), false);
});

test('hasRuntimeReadySanitization：只描述消毒面', () => {
  assert.equal(hasRuntimeReadySanitization({ sanitizationStatus: 'runtime-ready' }), true);
  assert.equal(hasRuntimeReadySanitization({ sanitizationStatus: 'raw' }), false);
  assert.equal(hasRuntimeReadySanitization(undefined), false);
});

test('单源守卫：仓内不得再手抄 runtime-ready 三元判据', () => {
  const needle = ['sanitizationStatus', '===', "'runtime-ready'"].join(' ');
  const allowed = new Set(['shared/lib/capability-runtime-readiness.ts']);
  const offenders: string[] = [];
  for (const root of ['src', 'server', 'shared', 'scripts']) {
    for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const rel = path.posix.join(root, entry.split(path.sep).join('/'));
      if (allowed.has(rel)) continue;
      const text = readFileSync(rel, 'utf8');
      if (text.includes(needle)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `以下文件仍在手抄判据，请改引用 isRuntimeReadyAsset：${offenders.join(', ')}`);
});
