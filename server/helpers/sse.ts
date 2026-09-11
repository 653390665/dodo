import type { Request, Response } from 'express';
import { bindClientDisconnect } from './stream-disconnect';

export const SSE_CONTENT_TYPE = 'text/event-stream';

export type OpenSseStreamOptions = {
  /** Heartbeat interval in ms; pass 0 to disable. Defaults to 30_000. */
  heartbeatMs?: number;
  /**
   * Flush the headers (and write the initial `retry:` hint) immediately.
   * Routes that must still answer pre-stream failures with a JSON error
   * status pass false so `res.headersSent` stays false until the first
   * event is written. Defaults to true.
   */
  flush?: boolean;
  /** Called once when a client disconnect is observed, before cleanup. */
  onAbort?: () => void;
  /** Called once when the transport shell tears down for any reason. */
  onCleanup?: () => void;
};

export interface SseStreamHandle {
  /**
   * Write one `data:` event (JSON-encoded) to the stream.
   * Returns false — and tears the shell down — once the response is no
   * longer writable, so callers can stop producing work.
   */
  (event: unknown): boolean;
  /** Idempotent teardown of heartbeat, disconnect binding and observers. */
  cleanup(): void;
}

function isSseWritable(res: Response): boolean {
  return res.writable !== false && !res.writableEnded && !res.destroyed && !res.closed;
}

/**
 * Open a server-sent-events response with the shared transport shell:
 * standard SSE headers (including `X-Accel-Buffering: no`), an initial
 * `retry:` hint, a keep-alive heartbeat and client-disconnect teardown.
 * Routes keep ownership of their event payloads and abort semantics and
 * only hand the byte-transport concerns to this helper.
 */
export function openSseStream(
  req: Request,
  res: Response,
  options: OpenSseStreamOptions = {}
): SseStreamHandle {
  const { heartbeatMs = 30_000, flush = true, onAbort, onCleanup } = options;

  let cleanedUp = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let disposeDisconnect = () => {};
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    disposeDisconnect();
    onCleanup?.();
  };

  res.setHeader('Content-Type', SSE_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (flush) res.flushHeaders();

  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (!isSseWritable(res)) {
        cleanup();
        return;
      }
      try {
        res.write(':ping\n\n');
      } catch {
        cleanup();
      }
    }, heartbeatMs);
  }

  const handle = ((event: unknown): boolean => {
    if (!isSseWritable(res)) {
      cleanup();
      return false;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  }) as SseStreamHandle;
  handle.cleanup = cleanup;

  if (!isSseWritable(res)) {
    cleanup();
    return handle;
  }
  req.socket.setTimeout(0);
  if (flush) res.write('retry: 3000\n\n');

  disposeDisconnect = bindClientDisconnect(req, res, () => {
    onAbort?.();
    cleanup();
  });

  return handle;
}
