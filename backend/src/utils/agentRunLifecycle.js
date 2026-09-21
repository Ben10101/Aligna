const DEFAULT_ABORT_MESSAGE = 'Requisicao encerrada pelo cliente antes da conclusao da geracao.';

function detachListener(target, eventName, handler) {
  if (!target || typeof target.off !== 'function') return;
  target.off(eventName, handler);
}

function shouldIgnoreAbortEvent(req, res) {
  if (!req) return true;

  if (req.aborted || req.destroyed) {
    return false;
  }

  if (res?.writableEnded || res?.writableFinished) {
    return true;
  }

  return false;
}

export function createAgentRunLifecycle(req, res, agentRun, finishAgentRun, options = {}) {
  if (!req || !res || !agentRun?.id || typeof finishAgentRun !== 'function') {
    return {
      finalizeSuccess: async () => false,
      finalizeFailure: async () => false,
      isFinalized: () => true,
      wasAborted: () => false,
      dispose: () => {},
    };
  }

  const abortMessage = options.abortMessage || DEFAULT_ABORT_MESSAGE;
  let finalized = false;
  let aborted = false;
  let disposed = false;

  const detach = () => {
    if (disposed) return;
    disposed = true;
    detachListener(req, 'aborted', handleRequestAbort);
    detachListener(req, 'close', handleRequestClose);
    detachListener(res, 'close', handleResponseClose);
  };

  const finalizeRun = async ({ status, result, errorMessage, diagnostic = null, usageMeta = null }) => {
    if (finalized) return false;
    finalized = true;
    detach();
    await finishAgentRun(agentRun.id, {
      status,
      result,
      errorMessage,
      diagnostic,
      usageMeta,
    });
    return true;
  };

  const handleAbort = async () => {
    if (finalized || shouldIgnoreAbortEvent(req, res)) return false;
    aborted = true;
    return finalizeRun({ status: 'aborted', errorMessage: abortMessage });
  };

  function handleRequestAbort() {
    void handleAbort().catch(() => null);
  }

  function handleRequestClose() {
    void handleAbort().catch(() => null);
  }

  function handleResponseClose() {
    void handleAbort().catch(() => null);
  }

  req.on('aborted', handleRequestAbort);
  req.on('close', handleRequestClose);
  res.on('close', handleResponseClose);

  return {
    finalizeSuccess: async ({ result, usageMeta = null }) =>
      finalizeRun({ status: 'completed', result, usageMeta }),
    finalizeFailure: async ({ errorMessage, result = null, diagnostic = null }) => finalizeRun({ status: 'failed', errorMessage, result, diagnostic }),
    isFinalized: () => finalized,
    wasAborted: () => aborted,
    dispose: detach,
  };
}
