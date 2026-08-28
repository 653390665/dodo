import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTINUATION_ZIP_LIMITS,
  sanitizeArchivePath,
  validateArchiveManifest,
} from '../shared/lib/archive-limits';

test('archive manifest accepts bounded document entries', () => {
  assert.doesNotThrow(() => validateArchiveManifest([
    { name: 'docs/chapter.txt', directory: false, compressedSize: 500, uncompressedSize: 2_000 },
    { name: 'docs/world.docx', directory: false, compressedSize: 2_000, uncompressedSize: 8_000 },
  ], CONTINUATION_ZIP_LIMITS));
});

test('archive manifest rejects entry count, expanded bytes, and suspicious compression ratios', () => {
  assert.throws(() => validateArchiveManifest(
    Array.from({ length: 101 }, (_, index) => ({
      name: `${index}.txt`, directory: false, compressedSize: 10, uncompressedSize: 10,
    })),
    CONTINUATION_ZIP_LIMITS,
  ), /数量/);
  assert.throws(() => validateArchiveManifest(
    Array.from({ length: 101 }, (_, index) => ({
      name: `directory-${index}/`, directory: true,
    })),
    CONTINUATION_ZIP_LIMITS,
  ), /条目数量/);
  assert.throws(() => validateArchiveManifest([
    {
      name: 'huge.txt', directory: false, compressedSize: 100,
      uncompressedSize: CONTINUATION_ZIP_LIMITS.maxSingleUncompressedBytes + 1,
    },
  ], CONTINUATION_ZIP_LIMITS), /过大/);
  assert.throws(() => validateArchiveManifest([
    { name: 'bomb.txt', directory: false, compressedSize: 1, uncompressedSize: 101 },
  ], CONTINUATION_ZIP_LIMITS), /压缩比/);
});

test('archive paths are normalized without traversal segments', () => {
  assert.equal(sanitizeArchivePath('../../C:/novel/../chapter.txt'), 'C:/novel/chapter.txt');
});
