/**
 * Deadline-based polling wait for integration tests.
 *
 * Replaces bare `setTimeout` sleeps: the predicate is polled every 10ms until it
 * holds or the deadline expires, so tests stay fast on warm runs and fail with a
 * clear timeout instead of flaking on slow ones.
 *
 * Uses performance.now() so a test that fakes Date.now (e.g. TTL tests) cannot
 * accidentally disable the deadline.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  description = 'condition',
): Promise<void> {
  const startedAt = performance.now();
  while (!(await predicate())) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor: ${description} not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
