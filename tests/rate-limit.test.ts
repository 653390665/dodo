import assert from 'node:assert/strict';
import test from 'node:test';
import { rateLimit } from '../server/middleware/rate-limit';

test('rateLimit allows requests up to bucket size and then limits', () => {
  const endpoint = 'test-endpoint';

  // Bucket size is 5, so first 5 requests should pass
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit(endpoint), true);
  }

  // 6th request should be limited
  assert.equal(rateLimit(endpoint), false);
});
