const MAX_RECENT_EVENTS = 120;

const state = {
  startedAt: new Date(),
  totals: {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    runsAborted: 0,
    runsStale: 0,
    runsRecovered: 0,
    retriesOpened: 0,
    taskRestores: 0,
    stageArtifactsPersisted: 0,
  },
  byAgent: new Map(),
  recentEvents: [],
};

function ensureAgentBucket(agentName = 'unknown') {
  if (!state.byAgent.has(agentName)) {
    state.byAgent.set(agentName, {
      agentName,
      runsStarted: 0,
      runsCompleted: 0,
      runsFailed: 0,
      runsAborted: 0,
      runsStale: 0,
      runsRecovered: 0,
      retriesOpened: 0,
      taskRestores: 0,
      stageArtifactsPersisted: 0,
      lastEventAt: null,
    });
  }

  return state.byAgent.get(agentName);
}

function pushEvent(eventType, payload) {
  state.recentEvents.unshift({
    timestamp: new Date().toISOString(),
    eventType,
    ...payload,
  });

  if (state.recentEvents.length > MAX_RECENT_EVENTS) {
    state.recentEvents.length = MAX_RECENT_EVENTS;
  }
}

const eventMap = {
  agent_run_started: 'runsStarted',
  agent_run_completed: 'runsCompleted',
  agent_run_failed: 'runsFailed',
  agent_run_aborted: 'runsAborted',
  agent_run_stale: 'runsStale',
  agent_run_recovered: 'runsRecovered',
  agent_run_retry_opened: 'retriesOpened',
  task_restore_after_failure: 'taskRestores',
  stage_artifact_persisted: 'stageArtifactsPersisted',
};

export function recordRuntimeEvent(eventType, payload = {}) {
  const metricKey = eventMap[eventType] || null;
  const agentBucket = payload.agentName ? ensureAgentBucket(payload.agentName) : null;

  if (metricKey) {
    state.totals[metricKey] += 1;
    if (agentBucket) {
      agentBucket[metricKey] += 1;
    }
  }

  if (agentBucket) {
    agentBucket.lastEventAt = new Date().toISOString();
  }

  pushEvent(eventType, payload);
}

export function getRuntimeTelemetrySnapshot() {
  return {
    startedAt: state.startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - state.startedAt.getTime()) / 1000),
    totals: { ...state.totals },
    byAgent: Array.from(state.byAgent.values())
      .map((item) => ({ ...item }))
      .sort((a, b) => {
        if (b.runsStarted !== a.runsStarted) return b.runsStarted - a.runsStarted;
        return a.agentName.localeCompare(b.agentName);
      }),
    recentEvents: [...state.recentEvents],
  };
}

export function resetRuntimeTelemetryForTests() {
  state.startedAt = new Date();
  state.totals = {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    runsAborted: 0,
    runsStale: 0,
    runsRecovered: 0,
    retriesOpened: 0,
    taskRestores: 0,
    stageArtifactsPersisted: 0,
  };
  state.byAgent = new Map();
  state.recentEvents = [];
}
