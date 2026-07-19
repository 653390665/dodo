/// <reference lib="webworker" />

import { expandContinuationArchive } from '../../shared/lib/continuation-zip';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const files = await expandContinuationArchive(event.data);

    self.postMessage({ ok: true, files }, { transfer: files.map((file) => file.buffer) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
