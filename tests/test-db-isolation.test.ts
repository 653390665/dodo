import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };

test('default node test command preloads a pid-isolated temporary database', () => {
  const command = packageJson.scripts?.test ?? '';
  assert.match(command, /--import\s+tsx/);
  assert.match(command, /--import\s+\.?\/?tests\/helpers\/test-db-preload\.ts/);

  const helperPath = path.resolve('tests/helpers/test-db-preload.ts');
  assert.equal(fs.existsSync(helperPath), true, 'test db preload helper must exist');
  const helper = fs.readFileSync(helperPath, 'utf8');
  assert.match(helper, /process\.pid/);
  assert.match(helper, /os\.tmpdir\(\)/);
  assert.match(helper, /INKFLOW_DB_PATH/);
  assert.match(helper, /process\.(?:on|once)\(['"]exit['"]/);
});

test('separate workers receive separate database paths while explicit paths win', () => {
  const helper = path.resolve('tests/helpers/test-db-preload.ts');
  const runWorker = (databasePath?: string) => {
    const env = { ...process.env };
    if (databasePath === undefined) delete env.INKFLOW_DB_PATH;
    else {
      env.INKFLOW_DB_PATH = databasePath;
      delete env.INKFLOW_TEST_DB_OWNER_PID;
    }
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', '--import', helper,
      '--eval', "process.stdout.write(`${process.pid}|${process.env.INKFLOW_DB_PATH}`)",
    ], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('|');
  };

  const first = runWorker();
  const second = runWorker();
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[1], second[1]);
  assert.match(first[1] ?? '', new RegExp(`inkflow-test-${first[0]}-`));
  assert.equal(runWorker('/tmp/inkflow-explicit-test.db')[1], '/tmp/inkflow-explicit-test.db');
});

test('a worker regenerates a path inherited from the parent preload', () => {
  const helper = path.resolve('tests/helpers/test-db-preload.ts');
  const inheritedPath = '/tmp/inkflow-parent/data.db';
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', '--import', helper,
    '--eval', "process.stdout.write(`${process.pid}|${process.env.INKFLOW_DB_PATH}`)",
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INKFLOW_DB_PATH: inheritedPath,
      INKFLOW_TEST_DB_OWNER_PID: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const [pid, databasePath] = result.stdout.trim().split('|');
  assert.notEqual(databasePath, inheritedPath);
  assert.match(databasePath ?? '', new RegExp(`inkflow-test-${pid}-`));
});
