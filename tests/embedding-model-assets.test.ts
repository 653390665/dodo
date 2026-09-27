/**
 * 随包附嵌入权重（Plan 263 E2 / 对应 R6·M6）—— 清单单源、打包接线与落点解析守卫。
 *
 * ① 清单单源：scripts/lib/embedding-weights.mjs 与 server/embedding.ts 的文件清单、模型 id 一致；
 * ② 打包接线：package.json 的 extraResources 带权重组、package 链先取权重、冒烟脚本断言权重存在；
 * ③ Electron 注入：打包态注入 INKFLOW_EMBEDDING_MODEL_DIR / INKFLOW_MODEL_CACHE_DIR（缓存落 userData）；
 * ④ 纯函数：resolveEmbeddingAssetPaths（齐备 → 本地优先 + 关远程；不全 → 只设缓存目录、保留远程）；
 * ⑤ 取权重脚本可跳过执行（SKIP_EMBEDDING_MODEL_FETCH=true，退出码 0）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { LOCAL_EMBEDDING_MODEL_FILES, resolveEmbeddingAssetPaths } from '../server/embedding';

const require = createRequire(import.meta.url);
const {
  EMBEDDING_MODEL_FILES,
  EMBEDDING_MODEL_ID,
  MIN_QUANTIZED_MODEL_BYTES,
  PACKAGED_EMBEDDING_MODEL_REL,
  embeddingWeightsVerdict,
  isCompleteModelDir,
} = require('../scripts/lib/embedding-weights.mjs') as {
  EMBEDDING_MODEL_FILES: string[];
  EMBEDDING_MODEL_ID: string;
  MIN_QUANTIZED_MODEL_BYTES: number;
  PACKAGED_EMBEDDING_MODEL_REL: string;
  embeddingWeightsVerdict: (
    files: string[],
    options?: { skip?: boolean; sizeOf?: (file: string) => number }
  ) => { ok: boolean; message: string };
  isCompleteModelDir: (dir: string, deps?: { exists?: (target: string) => boolean }) => boolean;
};

test('权重清单与模型 id 在取权重脚本与运行时是同一份', () => {
  assert.deepEqual([...LOCAL_EMBEDDING_MODEL_FILES], [...EMBEDDING_MODEL_FILES]);
  assert.equal(EMBEDDING_MODEL_ID, 'Xenova/bge-small-zh-v1.5');

  const runtimeSource = fs.readFileSync('server/embedding.ts', 'utf8');
  assert.match(runtimeSource, /const MODEL_ID = 'Xenova\/bge-small-zh-v1\.5';/);
  // 打包件内的量化权重路径必须与 asarUnpack / extraResources 的落点一致
  assert.equal(
    PACKAGED_EMBEDDING_MODEL_REL,
    path.join('embedding-model', 'Xenova', 'bge-small-zh-v1.5', 'onnx', 'model_quantized.onnx')
  );
});

test('resolveEmbeddingAssetPaths：权重齐备 → 本地优先且关远程', () => {
  const bundledDir = '/tmp/inkflow-embedding-model';
  const modelDir = path.join(bundledDir, 'Xenova', 'bge-small-zh-v1.5');
  const present = new Set(LOCAL_EMBEDDING_MODEL_FILES.map((file) => path.join(modelDir, file)));

  const complete = resolveEmbeddingAssetPaths(
    { bundledModelDir: bundledDir, modelCacheDir: '/tmp/inkflow-models-cache' },
    { exists: (target) => present.has(target) }
  );
  assert.equal(complete.localModelPath, bundledDir);
  assert.equal(complete.cacheDir, '/tmp/inkflow-models-cache');
  assert.equal(complete.disableRemoteModels, true);
});

test('resolveEmbeddingAssetPaths：权重不全 → 只设缓存目录、保留远程', () => {
  const bundledDir = '/tmp/inkflow-embedding-model';
  const partial = resolveEmbeddingAssetPaths(
    { bundledModelDir: bundledDir, modelCacheDir: '/tmp/inkflow-models-cache' },
    { exists: (target) => !target.endsWith('onnx/model_quantized.onnx') }
  );
  assert.equal(partial.localModelPath, undefined);
  assert.equal(partial.disableRemoteModels, false);
  assert.equal(partial.cacheDir, '/tmp/inkflow-models-cache');
});

test('resolveEmbeddingAssetPaths：未注入环境变量时不改动 transformers 默认值', () => {
  assert.deepEqual(resolveEmbeddingAssetPaths(), { disableRemoteModels: false });
  assert.deepEqual(resolveEmbeddingAssetPaths({ bundledModelDir: '  ', modelCacheDir: '' }), {
    disableRemoteModels: false,
  });
});

test('打包接线：extraResources 带权重组、package 链先取权重、冒烟脚本断言权重存在', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const extraResources = pkg.build.extraResources as Array<{ from: string; to: string }>;
  assert.ok(
    extraResources.some((entry) => entry.from === 'build/embedding-model' && entry.to === 'embedding-model')
  );
  assert.match(pkg.scripts.package, /scripts\/fetch-embedding-model\.mjs/);
  assert.equal(pkg.scripts['model:fetch'], 'node scripts/fetch-embedding-model.mjs');

  const smoke = fs.readFileSync('scripts/check-package-artifacts.mjs', 'utf8');
  assert.match(smoke, /embeddingWeightsVerdict\(releaseFiles/);
  assert.match(smoke, /SKIP_EMBEDDING_MODEL_FETCH/);
});

test('Electron 打包态注入权重目录与可写缓存目录', () => {
  const mainProcessSource = fs.readFileSync('electron.cjs', 'utf8');
  assert.match(mainProcessSource, /path\.join\(process\.resourcesPath, 'embedding-model'\)/);
  assert.match(
    mainProcessSource,
    /fs\.existsSync\(path\.join\(embeddingModelDir, 'Xenova', 'bge-small-zh-v1\.5'\)\)/
  );
  assert.match(mainProcessSource, /INKFLOW_EMBEDDING_MODEL_DIR: embeddingModelDir/);
  assert.match(
    mainProcessSource,
    /INKFLOW_MODEL_CACHE_DIR: path\.join\(app\.getPath\('userData'\), 'models-cache'\)/
  );
});

test('冒烟判定：缺权重/权重过小/跳过三种口径', () => {
  const rel = PACKAGED_EMBEDDING_MODEL_REL;
  const sizeOf = () => 23_000_000;

  const missing = embeddingWeightsVerdict([], { sizeOf });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /missing/);

  const okVerdict = embeddingWeightsVerdict(['/release/mac/InkFlow.app/Contents/Resources/' + rel], { sizeOf });
  assert.equal(okVerdict.ok, true);
  assert.match(okVerdict.message, /weights packaged/);

  const tooSmall = embeddingWeightsVerdict(['/release/' + rel], { sizeOf: () => 1024 });
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.message, /too small/);

  assert.equal(embeddingWeightsVerdict([], { skip: true }).ok, true);
});

test('取权重脚本可跳过执行（SKIP_EMBEDDING_MODEL_FETCH=true）', () => {
  const result = spawnSync(process.execPath, ['scripts/fetch-embedding-model.mjs'], {
    env: { ...process.env, SKIP_EMBEDDING_MODEL_FETCH: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip embedding-model/);
});

test('取权重产物（本地已取时）为完整 4 文件且量化权重达标', (t) => {
  const outDir = path.join('build', 'embedding-model', ...EMBEDDING_MODEL_ID.split('/'));
  if (!fs.existsSync(outDir)) {
    t.skip('build/embedding-model 尚未生成（打包前由 npm run model:fetch 产出）');
    return;
  }
  assert.equal(isCompleteModelDir(outDir), true);
  const size = fs.statSync(path.join(outDir, 'onnx', 'model_quantized.onnx')).size;
  assert.ok(size >= MIN_QUANTIZED_MODEL_BYTES, `量化权重过小：${size} bytes`);
});
