/**
 * Plan 263 E3 · Node 版本声明单源守卫。
 *
 * 背景：版本下限此前只写在 `package.json`（`>=22.0.0`，过松），而 `.nvmrc` / `.node-version` /
 * CI 三处各自硬编码 `22`，四处漂移无人拦。本测试把「单源」变成可执行合同：
 * ① `.nvmrc` 与 `.node-version` 必须一致且为 22.x 精确补丁版本；
 * ② `engines.node` 必须由该版本派生（floor = 同版本，上限 `<23` = 只支持 22 支线）；
 * ③ CI 不得硬编码 `node-version:`；每个用到 setup-node 的 workflow 都必须走 `node-version-file: .nvmrc`。
 *
 * 依据（2026-09-28，nodejs.org dist index 实测）：22.22.0/.1/.2/.3 与 22.23.x 均已发布；
 * npm 12 要求 `^22.22.2 || ^24.15.0 || >=26.0.0`，故下限取 22.22.x 支线最新补丁 22.22.3。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').trim();

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => Number(n));
}

function atLeast(cur: number[], floor: number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if ((cur[i] ?? 0) > (floor[i] ?? 0)) return true;
    if ((cur[i] ?? 0) < (floor[i] ?? 0)) return false;
  }
  return true;
}

test('Node 版本声明单源：.nvmrc / .node-version / engines / CI（Plan 263 E3）', () => {
  const pin = read('.nvmrc');
  assert.match(pin, /^22\.\d+\.\d+$/, '.nvmrc 必须是 22.x 精确补丁版本');
  assert.equal(read('.node-version'), pin, '.node-version 必须与 .nvmrc 保持同步');

  const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
  assert.equal(pkg.engines?.node, `>=${pin} <23`, 'engines.node 必须由 .nvmrc 派生（floor = 同版本，上限 <23）');

  const files = readdirSync(join(repoRoot, '.github/workflows')).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(files.length > 0, '至少一个 CI workflow');
  for (const file of files) {
    const workflow = read('.github/workflows/' + file);
    const setupNode = (workflow.match(/actions\/setup-node@/g) ?? []).length;
    const viaFile = (workflow.match(/node-version-file:\s*['"]?\.nvmrc['"]?/g) ?? []).length;
    assert.equal(viaFile, setupNode, file + '：每个 setup-node 都必须走 node-version-file: .nvmrc');
    assert.ok(
      !/^\s*node-version:\s/m.test(workflow),
      file + '：不得再出现硬编码 node-version 行（会与 .nvmrc 漂移）',
    );
  }
});

test('Node 版本下限满足 npm 12 的运行时要求（>=22.22.2）', () => {
  const cur = parseVersion(read('.nvmrc'));
  assert.equal(cur[0], 22, '受支持主线为 22（对齐 Electron 内置 Node 与 better-sqlite3 原生构建）');
  assert.ok(atLeast(cur, [22, 22, 2]), '.nvmrc 不得低于 22.22.2（npm 12 支持的 Node 版本下限）');
});
