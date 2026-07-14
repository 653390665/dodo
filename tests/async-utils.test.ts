import assert from 'node:assert/strict';
import test from 'node:test';

import { withTimeout } from '../server/helpers/async-utils';

test('withTimeout aborts the supplied controller when the timeout wins', async () => {
  const controller = new AbortController();
  const pending = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });

  await assert.rejects(
    withTimeout(pending, 5, 'operation timed out', { controller }),
    /operation timed out/,
  );
  assert.equal(controller.signal.aborted, true);
});
