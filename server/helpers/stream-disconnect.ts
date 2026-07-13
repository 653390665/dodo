import type { Request, Response } from 'express';

/** Detect client disconnect without relying on req.on('close'). */
export function isStreamDisconnected(req: Request, res: Response): boolean {
  const resWithClosed = res as Response & { closed?: boolean };
  return Boolean(req.aborted) || Boolean(resWithClosed.closed && !res.writableEnded);
}
