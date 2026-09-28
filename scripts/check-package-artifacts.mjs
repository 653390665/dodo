import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { embeddingWeightsVerdict } from './lib/embedding-weights.mjs';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDir = path.join(root, 'release');

const minArtifactBytes = 50_000_000;

function fail(message) {
  process.stderr.write(`not ok package-artifacts: ${message}\n`);
  process.exitCode = 1;
}

function ok(message) {
  process.stdout.write(`ok package-artifacts: ${message}\n`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...walk(entryPath));
    else entries.push(entryPath);
  }
  return entries;
}

function requireFile(relativePath) {
  if (exists(relativePath)) ok(`${relativePath} exists`);
  else fail(`${relativePath} missing`);
}

function requireSizedFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    fail(`${label} missing`);
    return;
  }
  const size = fs.statSync(filePath).size;
  if (size < minArtifactBytes) {
    fail(`${label} too small (${size} bytes)`);
    return;
  }
  ok(`${label} exists (${size} bytes)`);
}

for (const file of [
  'dist/index.html',
  'dist-electron/main.cjs',
  'dist-electron/server.cjs',
  'dist-electron/electron-preload.cjs',
  'dist-electron/better-sqlite3-shim.cjs',
]) {
  requireFile(file);
}

if (!fs.existsSync(releaseDir)) {
  fail('release directory missing');
  process.exit(process.exitCode || 1);
}

const releaseFiles = walk(releaseDir);

// 离线语义检索权重（Plan 263 E2 / D6）：随包附权重，打包件里必须能查到量化权重。
// 退出舱只认显式命令行开关；SKIP_EMBEDDING_MODEL_FETCH 只影响「取权重」步骤，不再让冒烟静默放行。
const allowMissingWeights = process.argv.includes('--allow-missing-weights');
if (allowMissingWeights) {
  process.stderr.write(
    'warn package-artifacts: embedding weights check skipped (--allow-missing-weights)\n'
  );
}
const weightsVerdict = embeddingWeightsVerdict(releaseFiles, { skip: allowMissingWeights });
if (weightsVerdict.ok) ok(weightsVerdict.message);
else fail(weightsVerdict.message);

if (process.platform === 'darwin') {
  const dmgName = `InkFlow-${version}-mac-${process.arch}.dmg`;
  const dmgPath = path.join(releaseDir, dmgName);
  const appExecutable = releaseFiles.find((file) =>
    file.endsWith(path.join('InkFlow.app', 'Contents', 'MacOS', 'InkFlow'))
  );
  requireSizedFile(dmgPath, dmgName);
  if (fs.existsSync(`${dmgPath}.blockmap`)) ok(`${dmgName}.blockmap exists`);
  else fail(`${dmgName}.blockmap missing`);
  if (appExecutable) ok(path.relative(root, appExecutable) + ' exists');
  else fail('packaged macOS InkFlow executable missing');
} else if (process.platform === 'win32') {
  const exePath = path.join(releaseDir, `InkFlow-${version}-win-x64.exe`);
  const zipPath = path.join(releaseDir, `InkFlow-${version}-win-x64.zip`);
  const appExecutable = releaseFiles.find(
    (file) => path.basename(file) === 'InkFlow.exe' && file.includes(`win-unpacked${path.sep}`)
  );
  requireSizedFile(exePath, `InkFlow-${version}-win-x64.exe`);
  requireSizedFile(zipPath, `InkFlow-${version}-win-x64.zip`);
  if (appExecutable) ok(path.relative(root, appExecutable) + ' exists');
  else fail('packaged Windows InkFlow.exe missing');
} else if (process.platform === 'linux') {
  const appImageName = `InkFlow-${version}-linux-x64.AppImage`;
  const appImagePath = path.join(releaseDir, appImageName);
  const appExecutable = path.join(releaseDir, 'linux-unpacked', 'inkflow');
  requireSizedFile(appImagePath, appImageName);
  if (fs.existsSync(appExecutable)) ok(path.relative(root, appExecutable) + ' exists');
  else fail('packaged Linux InkFlow executable missing');
} else {
  ok(
    `common Electron build artifacts checked; no strict ${process.platform} release artifact contract is configured`
  );
}

if (process.exitCode) process.exit(process.exitCode);
