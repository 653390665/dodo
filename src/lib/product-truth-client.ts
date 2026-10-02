/**
 * Plan 271 W2 · 产品真值读数客户端（只读取数，不在前端重算口径）。
 */
import type { ProductTruthSnapshot } from '../../shared/types/product-truth';

export class ProductTruthRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ProductTruthRequestError';
  }
}

export async function fetchProductTruthMetrics(
  novelId?: string,
  days = 30,
  signal?: AbortSignal
): Promise<ProductTruthSnapshot> {
  const params = new URLSearchParams({ days: String(days) });
  if (novelId) params.set('novelId', novelId);
  const response = await fetch(`/api/product-truth/metrics?${params.toString()}`, { signal });
  const payload = (await response.json().catch(() => ({}))) as Partial<ProductTruthSnapshot> & {
    error?: string;
  };
  if (!response.ok) {
    throw new ProductTruthRequestError(
      response.status,
      payload.error ?? `服务器返回 ${response.status}`
    );
  }
  return payload as ProductTruthSnapshot;
}
