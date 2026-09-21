import { prisma } from '../src/lib/prisma.js';
import {
  getOperationalHealth,
  getRuntimeOperationsStatus,
} from '../src/services/observabilityService.js';
import {
  recordRuntimeEvent,
  resetRuntimeTelemetryForTests,
} from '../src/services/runtimeTelemetryService.js';

const original = {
  queryRawUnsafe: prisma.$queryRawUnsafe,
  agentRunFindMany: prisma.agentRun.findMany,
  agentRunCount: prisma.agentRun.count,
  taskCount: prisma.task.count,
};

const state = {
  runningRuns: [
    {
      uuid: 'run-live-1',
      agentName: 'requirements_analyst',
      startedAt: new Date(Date.now() - 12 * 60 * 1000),
      project: { uuid: 'project-1', name: 'Projeto Operacional' },
      task: { uuid: 'task-1', title: 'Refinar historia de evento' },
    },
  ],
  recentAgentHealth: [
    {
      agentName: 'requirements_analyst',
      status: 'failed',
      errorMessage: 'Execucao travada recuperada automaticamente antes de iniciar uma nova tentativa.',
      startedAt: new Date(Date.now() - 40 * 60 * 1000),
      finishedAt: new Date(Date.now() - 39 * 60 * 1000),
    },
    {
      agentName: 'requirements_analyst',
      status: 'completed',
      errorMessage: null,
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      finishedAt: new Date(Date.now() - 29 * 60 * 1000),
    },
    {
      agentName: 'architect',
      status: 'failed',
      errorMessage: 'Falha simulada.',
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      finishedAt: new Date(Date.now() - 18 * 60 * 1000),
    },
  ],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installMocks() {
  prisma.$queryRawUnsafe = async () => [{ ok: 1 }];

  prisma.agentRun.findMany = async ({ where, take, select }) => {
    if (where?.status === 'running') {
      return state.runningRuns.slice(0, take || state.runningRuns.length);
    }

    if (where?.createdAt?.gte) {
      return state.recentAgentHealth.map((run) => {
        if (select) {
          const selected = {};
          for (const key of Object.keys(select)) {
            selected[key] = run[key];
          }
          return selected;
        }
        return run;
      });
    }

    return [];
  };

  prisma.agentRun.count = async ({ where }) => {
    if (where?.status === 'running' && where?.startedAt?.lt) {
      return 1;
    }
    if (where?.status === 'failed' && where?.errorMessage?.contains === 'recuper') {
      return 1;
    }
    if (where?.status === 'failed') {
      return 2;
    }
    if (where?.createdAt?.gte) {
      return 5;
    }
    return 0;
  };

  prisma.task.count = async ({ where }) => {
    if (where?.status === 'backlog') return 7;
    if (where?.status === 'in_progress') return 2;
    if (where?.status === 'in_review') return 3;
    if (where?.status === 'qa') return 1;
    return 0;
  };
}

function restoreMocks() {
  prisma.$queryRawUnsafe = original.queryRawUnsafe;
  prisma.agentRun.findMany = original.agentRunFindMany;
  prisma.agentRun.count = original.agentRunCount;
  prisma.task.count = original.taskCount;
}

try {
  resetRuntimeTelemetryForTests();
  installMocks();

  recordRuntimeEvent('agent_run_started', { agentName: 'requirements_analyst', runUuid: 'run-a' });
  recordRuntimeEvent('agent_run_recovered', { agentName: 'requirements_analyst', runUuid: 'run-a', recoveryMode: 'preflight' });
  recordRuntimeEvent('agent_run_retry_opened', { agentName: 'requirements_analyst', runUuid: 'run-b' });
  recordRuntimeEvent('agent_run_failed', { agentName: 'architect', runUuid: 'run-c' });

  const runtime = await getRuntimeOperationsStatus();
  const health = await getOperationalHealth();

  assert(runtime.summary.runningRuns === 1, 'O snapshot deveria expor a run em andamento.');
  assert(runtime.summary.staleRunningRuns === 1, 'O snapshot deveria detectar run stale.');
  assert(runtime.summary.recoveredRunsLast24h === 1, 'O snapshot deveria contar recoveries recentes.');
  assert(runtime.inMemory.summary.runsRecovered === 1, 'A telemetria em memoria deveria registrar recovery.');
  assert(
    runtime.byAgent.some((agent) => agent.agentName === 'requirements_analyst'),
    'O snapshot deveria agrupar metricas por agente.'
  );
  assert(health.database === 'ok', 'O health deveria reportar banco operacional.');
  assert(health.runtime.staleRunningRuns === 1, 'O health deveria carregar resumo do runtime operacional.');

  console.log('runtime-observability-smoke: ok');
} finally {
  restoreMocks();
  resetRuntimeTelemetryForTests();
}
