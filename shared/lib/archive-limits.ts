export interface ArchiveEntrySize {
  name: string;
  directory: boolean;
  compressedSize?: number;
  uncompressedSize?: number;
}

export interface ArchiveResourceLimits {
  maxEntries: number;
  maxSingleUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
}

export const CONTINUATION_ZIP_LIMITS: ArchiveResourceLimits = {
  maxEntries: 100,
  maxSingleUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 100,
};

// Reject oversized compressed input before renderer code materializes it as an
// ArrayBuffer. Keep a little headroom over the expanded-content budget for ZIP
// metadata and stored (uncompressed) entries.
export const CONTINUATION_ZIP_MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const DOCX_ARCHIVE_LIMITS: ArchiveResourceLimits = {
  maxEntries: 2_000,
  maxSingleUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 96 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export const CONTINUATION_DOCUMENTS_MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

export function validateArchiveManifest(
  entries: ArchiveEntrySize[],
  limits: ArchiveResourceLimits,
): number {
  if (entries.length > limits.maxEntries) {
    throw new Error(`压缩包条目数量超过 ${limits.maxEntries} 个上限`);
  }

  const files = entries.filter((entry) => !entry.directory);
  let total = 0;
  for (const entry of files) {
    const compressed = entry.compressedSize;
    const uncompressed = entry.uncompressedSize;
    if (
      !Number.isSafeInteger(compressed)
      || compressed === undefined
      || compressed < 0
      || !Number.isSafeInteger(uncompressed)
      || uncompressed === undefined
      || uncompressed < 0
    ) {
      throw new Error(`无法验证压缩条目大小：${entry.name}`);
    }
    if (uncompressed > limits.maxSingleUncompressedBytes) {
      throw new Error(`压缩条目解压后过大：${entry.name}`);
    }
    const ratio = uncompressed === 0 ? 0 : compressed === 0 ? Number.POSITIVE_INFINITY : uncompressed / compressed;
    if (ratio > limits.maxCompressionRatio) {
      throw new Error(`压缩比异常：${entry.name}`);
    }
    total += uncompressed;
    if (!Number.isSafeInteger(total) || total > limits.maxTotalUncompressedBytes) {
      throw new Error('压缩包解压后总大小超出安全上限');
    }
  }
  return total;
}

export function isSupportedContinuationDocument(filename: string): boolean {
  const name = filename.toLowerCase().replace(/\\/g, '/');
  if (name.includes('__macosx') || name.startsWith('.') || name.includes('/.')) return false;
  return name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json') || name.endsWith('.docx');
}

export function sanitizeArchivePath(input: string): string {
  let clean = input.replace(/\\/g, '/').replace(/^[a-zA-Z]:\//, '');
  clean = clean
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  return clean;
}
