import { CONTINUATION_ZIP_MAX_INPUT_BYTES } from '../../shared/lib/archive-limits';

interface WorkerArchiveFile {
  name: string;
  buffer: ArrayBuffer;
}

interface WorkerArchiveResponse {
  ok: boolean;
  files?: WorkerArchiveFile[];
  error?: string;
}

const ZIP_WORKER_TIMEOUT_MS = 30_000;

export async function expandContinuationZip(file: File): Promise<File[]> {
  if (file.size > CONTINUATION_ZIP_MAX_INPUT_BYTES) {
    throw new Error('ZIP 文件大小超出安全上限');
  }
  const archiveBuffer = await file.arrayBuffer();
  const worker = new Worker(new URL('../workers/continuation-zip.worker.ts', import.meta.url), { type: 'module' });

  return new Promise<File[]>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('ZIP 解压超时，已安全终止')));
    }, ZIP_WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerArchiveResponse>) => {
      const payload = event.data;
      if (!payload.ok || !payload.files) {
        finish(() => reject(new Error(payload.error || 'ZIP 解压失败')));
        return;
      }
      finish(() => resolve(payload.files!.map((entry) => new File(
        [entry.buffer],
        entry.name,
        { type: 'application/octet-stream' },
      ))));
    };
    worker.onerror = () => finish(() => reject(new Error('ZIP 解压 Worker 异常')));
    worker.postMessage(archiveBuffer, [archiveBuffer]);
  });
}
