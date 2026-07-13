/**
 * Thin frontend logger — wraps console but provides a single point for
 * future upgrades (structured logging, log levels, remote reporting).
 *
 * Usage:
 *   import { logger } from '../lib/client-logger';
 *   logger.warn('message', err);
 *   logger.error('message', err);
 */

type LogArgs = unknown[];

function formatMsg(msg: string, args: LogArgs): string {
  if (args.length === 0) return msg;
  if (args.length === 1 && args[0] instanceof Error) return `${msg}: ${args[0].message}`;
  return `${msg}: ${JSON.stringify(args)}`;
}

export const logger = {
  warn(msg: string, ...args: LogArgs): void {
    console.warn(`[InkFlow] ${formatMsg(msg, args)}`);
  },
  error(msg: string, ...args: LogArgs): void {
    console.error(`[InkFlow] ${formatMsg(msg, args)}`);
  },
  info(msg: string, ...args: LogArgs): void {
    console.info(`[InkFlow] ${formatMsg(msg, args)}`);
  },
};