import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';

import { preflightUploadedDocumentArchives } from '../server/routes/continuation';

async function createArchiveBase64(name: string, content: string): Promise<string> {
  const zip = new JSZip();
  zip.file(name, content);
  return zip.generateAsync({ type: 'base64', compression: 'STORE' });
}

test('continuation DOCX preflight rejects a request whose individually valid archives exceed the aggregate budget', async () => {
  const documents = [
    { filename: 'one.docx', filedata: await createArchiveBase64('one.xml', '12345678') },
    { filename: 'two.docx', filedata: await createArchiveBase64('two.xml', 'abcdefgh') },
  ];

  await assert.rejects(
    preflightUploadedDocumentArchives(documents, 12),
    /文档解压后总大小超出安全上限/,
  );
});
