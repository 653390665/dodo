import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  commitQuotaReservation,
  checkQuota,
  quotaFailureHttpStatus,
  refundQuota,
  reserveQuota,
  type QuotaCheckResult,
  type QuotaLimitType,
} from './quota-guard.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';
import { __rateLimitTestHooks, rateLimit } from '../middleware/rate-limit.js';

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class OperationSemaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly limit: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason || new Error('LLM execution aborted'));
    }
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason || new Error('LLM execution aborted'));
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.releaseNext();
    };
  }

  private releaseNext(): void {
    while (this.waiters.length > 0 && this.active < this.limit) {
      const waiter = this.waiters.shift()!;
      waiter.signal?.removeEventListener('abort', waiter.onAbort!);
      if (waiter.signal?.aborted) continue;
      this.active += 1;
      waiter.resolve(this.createRelease());
      return;
    }
  }
}

const operationSemaphores = new Map<string, OperationSemaphore>();
const llmExecutionContext = new AsyncLocalStorage<{ traceId: string; operation: string }>();

export function hasActiveLlmExecution(): boolean {
  return Boolean(llmExecutionContext.getStore());
}

function getSemaphore(operation: string, limit: number): OperationSemaphore {
  const key = `${operation}:${limit}`;
  let semaphore = operationSemaphores.get(key);
  if (!semaphore) {
    semaphore = new OperationSemaphore(limit);
    operationSemaphores.set(key, semaphore);
  }
  return semaphore;
}

export class LlmExecutionRejectedError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 429;
  readonly quota: QuotaCheckResult;

  constructor(result: QuotaCheckResult) {
    super(result.error || 'LLM execution rejected');
    this.name = 'LlmExecutionRejectedError';
    this.status = quotaFailureHttpStatus(result);
    this.quota = result;
  }
}

export interface LlmExecutionSession {
  traceId: string;
  run<T>(work: (context: { signal: AbortSignal; controller: AbortController; traceId: string }) => Promise<T>): Promise<T>;
}

export async function createLlmExecution(options: {
  operation: string;
  novelId: string | undefined;
  quotaType?: QuotaLimitType;
  timeoutMs: number;
  signal?: AbortSignal;
  concurrency?: number;
  databaseGeneration?: number;
  /**
   * Count this session as one externally initiated operation. Provider calls
   * nested inside an already rate-limited HTTP/job workflow set this false so
   * writer/critic iterations cannot exhaust the request bucket themselves.
   */
  enforceRateLimit?: boolean;
}): Promise<LlmExecutionSession> {
  const eligibility = options.quotaType
    ? checkQuota(options.novelId, options.quotaType)
    : { allowed: true } satisfies QuotaCheckResult;
  if (!eligibility.allowed) {
    throw new LlmExecutionRejectedError(eligibility);
  }
  if (options.enforceRateLimit !== false && !rateLimit(`llm-execution:${options.operation}`)) {
    throw new LlmExecutionRejectedError({
      allowed: false,
      error: 'Rate limited',
      code: 'RATE_LIMITED',
    });
  }

  const traceId = `llm_${randomUUID()}`;
  let executed = false;

  return {
    traceId,
    async run<T>(work: (context: { signal: AbortSignal; controller: AbortController; traceId: string }) => Promise<T>): Promise<T> {
      if (executed) throw new Error('LLM execution session can only run once');
      executed = true;

      const controller = new AbortController();
      const onExternalAbort = () => controller.abort(options.signal?.reason || new Error('LLM execution aborted'));
      if (options.signal?.aborted) {
        controller.abort(options.signal.reason || new Error('LLM execution aborted'));
      } else {
        options.signal?.addEventListener('abort', onExternalAbort, { once: true });
      }
      const timeoutError = new Error(`LLM operation ${options.operation} timed out`);
      const timeoutId = setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
      let release: (() => void) | undefined;
      let reservation: QuotaCheckResult = { allowed: true };

      try {
        if (
          options.databaseGeneration !== undefined
          && options.databaseGeneration !== getDatabaseGeneration()
        ) {
          throw new LlmExecutionRejectedError({
            allowed: false,
            error: '数据库已切换，请重试当前操作',
            code: 'DATABASE_CHANGED',
          });
        }
        if (options.quotaType) {
          reservation = await reserveQuota(options.novelId, options.quotaType);
          if (!reservation.allowed) throw new LlmExecutionRejectedError(reservation);
          if (
            options.databaseGeneration !== undefined
            && reservation.databaseGeneration !== options.databaseGeneration
          ) {
            await refundQuota(reservation.reservationId);
            throw new LlmExecutionRejectedError({
              allowed: false,
              error: '数据库已切换，请重试当前操作',
              code: 'DATABASE_CHANGED',
            });
          }
        }
        release = await getSemaphore(options.operation, options.concurrency ?? 2).acquire(controller.signal);
        const result = await llmExecutionContext.run(
          { traceId, operation: options.operation },
          () => work({ signal: controller.signal, controller, traceId }),
        );
        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('LLM execution aborted');
        }
        commitQuotaReservation(reservation.reservationId);
        return result;
      } catch (error) {
        await refundQuota(reservation.reservationId);
        throw error;
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onExternalAbort);
        release?.();
      }
    },
  };
}

export const __llmExecutionGateTestHooks = {
  reset(): void {
    operationSemaphores.clear();
    __rateLimitTestHooks.reset();
  },
};
