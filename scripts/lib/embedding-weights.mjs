/**
 * 随包附嵌入权重（Plan 263 E2 / 对应 R6·M6）的清单与判定 —— 取权重脚本与打包冒烟检查共用。
 *
 * 模型 id 与 dtype 不得改：vector_chunks 按 modelId 匹配（server/embedding.ts:1-9）。
 * 本文件的文件清单与 server/embedding.ts 的 LOCAL_EMBEDDING_MODEL_FILES 由
 * tests/embedding-model-assets.test.ts 断言一致。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const EMBEDDING_MODEL_ID = 'Xenova/bge-small-zh-v1.5';

export const EMBEDDING_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

/** 量化权重在清单里的相对路径（sha256 pin 的作用对象）。 */
export const QUANTIZED_MODEL_FILE = 'onnx/model_quantized.onnx';

/**
 * 权重文件 sha256 pin（2026-09-28 实测）。
 *
 * 只做完整性校验：模型 id 与 dtype 不得改（vector_chunks 按 modelId 匹配）；
 * 若上游重新导出同名权重，必须同步更新此处并记录理由，否则取权重/打包会直接失败。
 */
export const EMBEDDING_MODEL_SHA256 = {
  'config.json': 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f',
  'tokenizer.json': '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
  'tokenizer_config.json': 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
  'onnx/model_quantized.onnx': '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
};

/** 文件 sha256（小写十六进制）。 */
export function hashFileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 校验权重目录内 4 个文件的 sha256；hashOf / join 可注入以便测试。
 * 返回 { ok, mismatches: [{ file, expected, actual }] }；读不到文件记为 'unreadable: …'。
 */
export function verifyModelDirHashes(dir, deps = {}) {
  const hashOf = deps.hashOf ?? hashFileSha256;
  const join = deps.join ?? ((...parts) => path.join(...parts));
  if (!dir) {
    return {
      ok: false,
      mismatches: EMBEDDING_MODEL_FILES.map((file) => ({
        file,
        expected: EMBEDDING_MODEL_SHA256[file],
        actual: 'missing-dir',
      })),
    };
  }
  const mismatches = [];
  for (const file of EMBEDDING_MODEL_FILES) {
    const expected = EMBEDDING_MODEL_SHA256[file];
    let actual;
    try {
      actual = hashOf(join(dir, file));
    } catch (error) {
      actual = 'unreadable: ' + (error instanceof Error ? error.message : String(error));
    }
    if (actual !== expected) mismatches.push({ file, expected, actual });
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** 量化权重（q8）低于此值视为坏文件：bge-small-zh-v1.5 quantized 约 23 MB。 */
export const MIN_QUANTIZED_MODEL_BYTES = 20 * 1024 * 1024;

/** 打包件内（Contents/Resources 或 resources 下）量化权重的相对路径。 */
export const PACKAGED_EMBEDDING_MODEL_REL = path.join(
  'embedding-model',
  ...EMBEDDING_MODEL_ID.split('/'),
  'onnx',
  'model_quantized.onnx'
);

/** 权重目录是否齐备（4 个文件全在）；exists/join 可注入以便测试。 */
export function isCompleteModelDir(dir, deps = {}) {
  const exists = deps.exists ?? ((target) => fs.existsSync(target));
  const join = deps.join ?? ((...parts) => path.join(...parts));
  if (!dir) return false;
  return EMBEDDING_MODEL_FILES.every((file) => exists(join(dir, file)));
}

/** 打包件里量化权重的判定；sizeOf / hashOf 可注入以便测试（hash 是 pin，见 EMBEDDING_MODEL_SHA256）。 */
export function embeddingWeightsVerdict(releaseFiles, options = {}) {
  if (options.skip) {
    return {
      ok: true,
      message: 'offline embedding weights check skipped (--allow-missing-weights)',
    };
  }
  const sizeOf = options.sizeOf ?? ((file) => fs.statSync(file).size);
  const found = (releaseFiles ?? []).find((file) => file.endsWith(PACKAGED_EMBEDDING_MODEL_REL));
  if (!found) {
    return {
      ok: false,
      message: 'offline embedding weights missing from packaged resources (' + PACKAGED_EMBEDDING_MODEL_REL + ')',
    };
  }
  const size = sizeOf(found);
  if (size < MIN_QUANTIZED_MODEL_BYTES) {
    return {
      ok: false,
      message: 'offline embedding weights too small (' + size + ' bytes < ' + MIN_QUANTIZED_MODEL_BYTES + ')',
    };
  }
  const hashOf = options.hashOf ?? hashFileSha256;
  let actualHash;
  try {
    actualHash = hashOf(found);
  } catch (error) {
    actualHash = 'unreadable: ' + (error instanceof Error ? error.message : String(error));
  }
  const expectedHash = EMBEDDING_MODEL_SHA256[QUANTIZED_MODEL_FILE];
  if (actualHash !== expectedHash) {
    return {
      ok: false,
      message:
        'offline embedding weights hash mismatch (' +
        PACKAGED_EMBEDDING_MODEL_REL +
        ': expected ' +
        expectedHash +
        ', got ' +
        actualHash +
        ')',
    };
  }
  return { ok: true, message: 'offline embedding weights packaged (' + size + ' bytes)' };
}
