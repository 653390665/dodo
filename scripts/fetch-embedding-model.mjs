/**
 * 随包附嵌入权重（Plan 263 E2 / 对应 R6·M6）—— 取权重到 build/embedding-model/，
 * 由 electron-builder 的 extraResources 复制进打包件 Resources/embedding-model/。
 *
 * 目的：打包首启不再需要联网向 HF Hub 拉 Xenova/bge-small-zh-v1.5（约 23 MB 量化权重），
 * 离线优先语义检索成立；运行期缓存另由 INKFLOW_MODEL_CACHE_DIR 指向 userData。
 *
 * 取权重顺序：INKFLOW_MODEL_SOURCE_DIR → node_modules 缓存 → huggingface.co。
 * 跳过：SKIP_EMBEDDING_MODEL_FETCH=true（打包脚本仍会跑，冒烟检查同步跳过权重断言）。
 *
 * 用法：node scripts/fetch-embedding-model.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  EMBEDDING_MODEL_FILES,
  EMBEDDING_MODEL_ID,
  MIN_QUANTIZED_MODEL_BYTES,
  isCompleteModelDir,
  verifyModelDirHashes,
} from './lib/embedding-weights.mjs';

const OUT_DIR = path.join('build', 'embedding-model', ...EMBEDDING_MODEL_ID.split('/'));
const HUB_BASE = 'https://huggingface.co';
const DEFAULT_CACHE_DIR = path.join(
  'node_modules',
  '@huggingface',
  'transformers',
  '.cache',
  ...EMBEDDING_MODEL_ID.split('/')
);

function fileUsable(target) {
  if (!fs.existsSync(target)) return false;
  const size = fs.statSync(target).size;
  return target.endsWith('.onnx') ? size >= MIN_QUANTIZED_MODEL_BYTES : size > 0;
}

function copyIfUsable(from, to) {
  if (!fs.existsSync(from)) return 0;
  const size = fs.statSync(from).size;
  if (size === 0) return 0;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
}

async function downloadFile(file, to) {
  const url = HUB_BASE + '/' + EMBEDDING_MODEL_ID + '/resolve/main/' + file;
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buffer);
  return buffer.length;
}

async function main() {
  if (process.env.SKIP_EMBEDDING_MODEL_FETCH === 'true') {
    console.log('skip embedding-model: SKIP_EMBEDDING_MODEL_FETCH=true');
    return;
  }

  const sources = [process.env.INKFLOW_MODEL_SOURCE_DIR, DEFAULT_CACHE_DIR].filter(Boolean);
  const rows = [];

  for (const file of EMBEDDING_MODEL_FILES) {
    const target = path.join(OUT_DIR, file);
    if (fileUsable(target)) {
      rows.push([file, 'cached', fs.statSync(target).size]);
      continue;
    }

    let size = 0;
    let origin = 'cached';
    for (const source of sources) {
      size = copyIfUsable(path.join(source, file), target);
      if (size > 0) {
        origin = 'copy ' + source;
        break;
      }
    }
    if (size === 0) {
      size = await downloadFile(file, target);
      origin = 'download ' + HUB_BASE;
    }
    rows.push([file, origin, size]);
  }

  if (!isCompleteModelDir(OUT_DIR)) {
    throw new Error(
      '权重不完整（' + OUT_DIR + '）；离线环境请设 INKFLOW_MODEL_SOURCE_DIR 指向本地权重目录'
    );
  }

  const hashes = verifyModelDirHashes(OUT_DIR);
  if (!hashes.ok) {
    throw new Error(
      '权重 sha256 不匹配：' +
        hashes.mismatches
          .map(
            (row) =>
              row.file + '（期望 ' + row.expected + '，实得 ' + row.actual + '）'
          )
          .join('；') +
        '；若上游更新了权重，请同步 scripts/lib/embedding-weights.mjs 的 EMBEDDING_MODEL_SHA256'
    );
  }

  let total = 0;
  for (const file of EMBEDDING_MODEL_FILES) total += fs.statSync(path.join(OUT_DIR, file)).size;
  for (const [file, origin, size] of rows) {
    console.log('ok embedding-model: ' + file + ' (' + size + ' bytes, ' + origin + ')');
  }
  console.log(
    'ok embedding-model: ' +
      EMBEDDING_MODEL_FILES.length +
      ' files → ' +
      OUT_DIR +
      ' (' +
      (total / 1024 / 1024).toFixed(1) +
      ' MB)'
  );
}

main().catch((error) => {
  console.error('not ok embedding-model: ' + error.message);
  process.exit(1);
});
