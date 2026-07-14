function createCloseHandshake({
  sendPrepare,
  allowClose,
  abandonClose = allowClose,
  onBlocked = () => {},
  timeoutMs = 5000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let state = 'idle';
  let timer = null;
  let latestSnapshot = null;
  let attemptId = 0;

  const clearAttemptTimer = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };

  const beginAttempt = () => {
    attemptId += 1;
    const activeAttemptId = attemptId;
    state = 'awaiting-renderer';
    sendPrepare(activeAttemptId);
    timer = setTimer(() => {
      timer = null;
      if (state !== 'awaiting-renderer' || activeAttemptId !== attemptId) return;
      state = 'blocked';
      onBlocked({ reason: 'timeout', message: `Editor flush timed out after ${timeoutMs}ms`, snapshot: latestSnapshot });
    }, timeoutMs);
  };

  return {
    requestClose(event) {
      if (state === 'complete') return true;
      event?.preventDefault();
      if (state !== 'idle') return false;
      beginAttempt();
      return false;
    },
    rendererSnapshot(rendererAttemptId, snapshot) {
      if (state !== 'awaiting-renderer' || rendererAttemptId !== attemptId) return false;
      latestSnapshot = snapshot;
      return true;
    },
    rendererFailed(rendererAttemptId, message = 'Editor writes failed') {
      if (state !== 'awaiting-renderer' || rendererAttemptId !== attemptId) return false;
      clearAttemptTimer();
      state = 'blocked';
      onBlocked({ reason: 'save-failed', message, snapshot: latestSnapshot });
      return true;
    },
    rendererReady(rendererAttemptId) {
      if (state !== 'awaiting-renderer' || rendererAttemptId !== attemptId) return false;
      clearAttemptTimer();
      state = 'complete';
      allowClose();
      return true;
    },
    retry() {
      if (state !== 'blocked') return false;
      beginAttempt();
      return true;
    },
    abandon() {
      if (state !== 'blocked') return false;
      state = 'complete';
      abandonClose();
      return true;
    },
    cancel() {
      if (state !== 'blocked') return false;
      clearAttemptTimer();
      latestSnapshot = null;
      state = 'idle';
      return true;
    },
    getSnapshot() {
      return latestSnapshot;
    },
    getState() {
      return state;
    },
    getAttemptId() {
      return attemptId;
    },
    isComplete() {
      return state === 'complete';
    },
  };
}

module.exports = { createCloseHandshake };
