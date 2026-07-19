import type { Request, Response } from 'express';

export type ClientDisconnectHandler = () => void;

/** Detect client disconnect from request abortion or an unfinished response close. */
export function isStreamDisconnected(req: Request, res: Response): boolean {
  const resWithClosed = res as Response & { closed?: boolean };
  return Boolean(req.aborted) || Boolean(resWithClosed.closed && !res.writableEnded);
}

/**
 * Bind one idempotent client-disconnect callback without treating the normal
 * request-stream close lifecycle as a disconnect. Call the returned disposer
 * on every normal completion path so completed responses retain no listeners.
 */
export function bindClientDisconnect(
  req: Request,
  res: Response,
  onDisconnect: ClientDisconnectHandler,
): () => void {
  let disposed = false;
  let handled = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    req.off('aborted', handleRequestAborted);
    res.off('close', handleResponseClose);
  };

  const triggerOnce = () => {
    if (disposed || handled) return;
    handled = true;
    dispose();
    onDisconnect();
  };

  const handleRequestAborted = () => {
    if (req.aborted) triggerOnce();
  };

  const handleResponseClose = () => {
    if (!res.writableEnded) triggerOnce();
  };

  req.on('aborted', handleRequestAborted);
  res.on('close', handleResponseClose);

  if (isStreamDisconnected(req, res)) {
    triggerOnce();
  }

  return dispose;
}
