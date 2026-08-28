import JSZip from 'jszip';

import {
  CONTINUATION_ZIP_LIMITS,
  isSupportedContinuationDocument,
  sanitizeArchivePath,
  validateArchiveManifest,
  type ArchiveResourceLimits,
} from './archive-limits';

type ZipEntryMetadata = {
  compressedSize?: number;
  uncompressedSize?: number;
};

export interface ExpandedContinuationFile {
  name: string;
  buffer: ArrayBuffer;
}

export async function expandContinuationArchive(
  archive: ArrayBuffer,
  limits: ArchiveResourceLimits = CONTINUATION_ZIP_LIMITS,
): Promise<ExpandedContinuationFile[]> {
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files);
  validateArchiveManifest(entries.map((entry) => {
    const metadata = (entry as unknown as { _data?: ZipEntryMetadata })._data;
    return {
      name: entry.name,
      directory: entry.dir,
      compressedSize: metadata?.compressedSize,
      uncompressedSize: metadata?.uncompressedSize,
    };
  }), limits);

  const files: ExpandedContinuationFile[] = [];
  let actualTotal = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    if (entry.name.toLowerCase().endsWith('.zip')) {
      throw new Error('不允许嵌套 ZIP 压缩包');
    }
    if (!isSupportedContinuationDocument(entry.name)) continue;
    const name = sanitizeArchivePath(entry.name);
    if (!name) continue;
    const buffer = await entry.async('arraybuffer');
    if (buffer.byteLength > limits.maxSingleUncompressedBytes) {
      throw new Error(`压缩条目解压后过大：${name}`);
    }
    actualTotal += buffer.byteLength;
    if (actualTotal > limits.maxTotalUncompressedBytes) {
      throw new Error('压缩包解压后总大小超出安全上限');
    }
    files.push({ name, buffer });
  }
  return files;
}
