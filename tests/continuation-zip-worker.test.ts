import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';

import { expandContinuationArchive } from '../shared/lib/continuation-zip';

test('continuation ZIP expansion enforces real archive metadata before extraction', async () => {
  const zip = new JSZip();
  zip.file('chapters/one.txt', '第一章内容');
  zip.file('chapters/two.md', '第二章内容');
  const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' });

  const files = await expandContinuationArchive(archive, {
    maxEntries: 10,
    maxSingleUncompressedBytes: 32,
    maxTotalUncompressedBytes: 32,
    maxCompressionRatio: 10,
  });
  assert.deepEqual(files.map((file) => file.name), ['chapters/one.txt', 'chapters/two.md']);

  await assert.rejects(
    expandContinuationArchive(archive, {
      maxEntries: 10,
      maxSingleUncompressedBytes: 32,
      maxTotalUncompressedBytes: 12,
      maxCompressionRatio: 10,
    }),
    /总大小/,
  );
});

test('continuation ZIP expansion rejects nested archives', async () => {
  const zip = new JSZip();
  zip.file('nested.zip', 'not really a zip');
  const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  await assert.rejects(expandContinuationArchive(archive), /嵌套 ZIP/);
});

test('continuation ZIP expansion rejects a real high-ratio compressed entry', async () => {
  const zip = new JSZip();
  zip.file('bomb.txt', 'A'.repeat(100_000));
  const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  await assert.rejects(expandContinuationArchive(archive), /压缩比/);
});
