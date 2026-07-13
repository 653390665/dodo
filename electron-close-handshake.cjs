function createCloseHandshake({
  sendPrepare,
  allowClose,
  logTimeout,
  timeoutMs = 5000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let pending = false;
  let complete = false;
  let timer = null;

  return {
    requestClose(event) {
      if (complete) return true;
      event?.preventDefault();
      if (pending) return false;
      pending = true;
      sendPrepare();
      timer = setTimer(() => {
        timer = null;
        pending = false;
        complete = true;
        logTimeout();
        allowClose();
      }, timeoutMs);
      return false;
    },
    rendererReady() {
      if (!pending) return false;
      pending = false;
      complete = true;
      if (timer) clearTimer(timer);
      timer = null;
      allowClose();
      return true;
    },
    isComplete() {
      return complete;
    },
  };
}

module.exports = { createCloseHandshake };
