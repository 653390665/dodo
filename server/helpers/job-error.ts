/** Convert internal/provider failures into stable, author-facing job errors. */
export function safeJobError(error: unknown, fallback = '任务执行失败，请稍后重试。'): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/abort|cancel|取消|中断/i.test(message)) return '任务已取消，可重新发起。';
  if (/timeout|timed out|超时/i.test(message)) return '模型响应超时，请稍后重试。';
  if (/rate|429|限流|频繁/i.test(message)) return '请求过于频繁，请稍后重试。';
  if (/database.*(generation|切换)|数据库已/i.test(message)) return '数据库已变化，请刷新后重试。';
  if (/empty response|空结果|invalid json|JSON/i.test(message)) return '模型返回结果不可用，请重试。';
  return fallback;
}
