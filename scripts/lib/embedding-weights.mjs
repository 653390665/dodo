/**
 * 随包附嵌入权重（Plan 263 E2 / 对应 R6·M6）的清单与判定 —— 取权重脚本与打包冒烟检查共用。
 *
 * 模型 id 与 dtype 不得改：vector_chunks 按 modelId 匹配（server/embedding.ts:1-9）。
 * 本文件的文件清单与 server/embedding.ts 的 LOCAL_EMBEDDING_MODEL_FILES 由
 * tests/embedding-model-assets.test.ts 断言一致。
 */
import fs from 'node:fs';
import path from 'node:path';

export const EMBEDDING_MODEL_ID = 'Xenova/bge-small-zh-v1.5';

export const EMBEDDING_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

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

/** 打包件里量化权重的判定；sizeOf 可注入以便测试。 */
export function embeddingWeightsVerdict(releaseFiles, options = {}) {
  if (options.skip) {
    return {
      ok: true,
      message: 'offline embedding weights check skipped (SKIP_EMBEDDING_MODEL_FETCH=true)',
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
  return { ok: true, message: 'offline embedding weights packaged (' + size + ' bytes)' };
}
