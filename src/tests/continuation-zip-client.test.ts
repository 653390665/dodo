import { afterEach, describe, expect, test, vi } from 'vitest';
import { CONTINUATION_ZIP_MAX_INPUT_BYTES } from '../../shared/lib/archive-limits';
import { expandContinuationZip } from '../lib/continuation-zip-client';

describe('expandContinuationZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects oversized compressed input before reading bytes or starting a worker', async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const workerConstructor = vi.fn();
    vi.stubGlobal('Worker', workerConstructor);
    const file = {
      name: 'oversized.zip',
      size: CONTINUATION_ZIP_MAX_INPUT_BYTES + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(expandContinuationZip(file)).rejects.toThrow('ZIP 文件大小超出安全上限');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(workerConstructor).not.toHaveBeenCalled();
  });
});
