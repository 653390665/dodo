/* global module, setTimeout, clearTimeout */

function createSingleFlight(operation) {
  let inFlight = null;
  return function runSingleFlight() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(operation)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

function probeHttp(get, url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let request = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };

    try {
      request = get(url, (response) => {
        response.resume?.();
        finish(resolve, response.statusCode || 0);
      });
      request.once('error', (error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }

    if (settled) return;
    timer = setTimeout(() => {
      const error = new Error(`HTTP probe timed out after ${timeoutMs}ms`);
      try {
        request?.destroy(error);
      } catch {
        // A concurrent socket close is equivalent to a completed abort.
      }
      finish(reject, error);
    }, timeoutMs);
  });
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function terminateChild(child, {
  waitForExit = waitForChildExit,
  gracefulTimeoutMs = 5000,
  forceTimeoutMs = 2000,
} = {}) {
  if (!child || child.exitCode !== null) return true;
  try {
    child.kill();
  } catch {
    // The process may have exited between the exitCode check and kill.
  }
  if (await waitForExit(child, gracefulTimeoutMs)) return true;
  try {
    child.kill('SIGKILL');
  } catch {
    // A concurrent exit is equivalent to a successful termination here.
  }
  return await waitForExit(child, forceTimeoutMs);
}

module.exports = { createSingleFlight, probeHttp, terminateChild, waitForChildExit };
