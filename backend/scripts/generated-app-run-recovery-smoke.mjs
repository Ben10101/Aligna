import { prisma } from '../src/lib/prisma.js';
import {
  recoverBlockingGeneratedAppRunsForStart,
  recoverStaleGeneratedAppRuns,
} from '../src/services/generatedAppRunRecoveryService.js';

const original = {
  generatedAppRunFindMany: prisma.generatedAppRun.findMany,
  generatedAppRunUpdate: prisma.generatedAppRun.update,
  taskImplementationFindUnique: prisma.taskImplementation.findUnique,
  taskImplementationUpdate: prisma.taskImplementation.update,
  generatedAppFindUnique: prisma.generatedApp.findUnique,
  generatedAppUpdate: prisma.generatedApp.update,
  transaction: prisma.$transaction,
};

const now = Date.now();
const state = {
  runs: [
    {
      id: 101,
      uuid: 'stale-implementation-run',
      generatedAppId: 71,
      taskImplementationId: 501,
      runType: 'implementation_apply',
      status: 'running',
      logSummary: null,
      startedAt: new Date(now - 20 * 60 * 1000),
      generatedApp: { projectId: 88 },
      taskImplementation: { taskId: 9001 },
    },
    {
      id: 102,
      uuid: 'stale-bootstrap-run',
      generatedAppId: 72,
      taskImplementationId: null,
      runType: 'bootstrap',
      status: 'running',
      logSummary: 'Bootstrap interrompido.',
      startedAt: new Date(now - 25 * 60 * 1000),
      generatedApp: { projectId: 89 },
      taskImplementation: null,
    },
    {
      id: 103,
      uuid: 'fresh-run',
      generatedAppId: 71,
      taskImplementationId: 502,
      runType: 'implementation_apply',
      status: 'running',
      logSummary: null,
      startedAt: new Date(now - 2 * 60 * 1000),
      generatedApp: { projectId: 88 },
      taskImplementation: { taskId: 9002 },
    },
  ],
  implementations: [
    {
      id: 501,
      status: 'in_progress',
      summary: 'Execucao em andamento.',
      buildStatus: null,
      testStatus: null,
    },
    {
      id: 502,
      status: 'in_progress',
      summary: 'Ainda ativa.',
      buildStatus: null,
      testStatus: null,
    },
  ],
  apps: [
    { id: 71, status: 'ready' },
    { id: 72, status: 'bootstrapping' },
  ],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function matchesWhere(run, where = {}) {
  const matchesGeneratedApp = where.generatedAppId === undefined || run.generatedAppId === where.generatedAppId;
  const matchesStatus = where.status === undefined || run.status === where.status;
  const matchesRunType = where.runType === undefined || run.runType === where.runType;
  const matchesStartedAt = !where.startedAt?.lt || run.startedAt < where.startedAt.lt;
  const matchesTask =
    !where.taskImplementation ||
    (run.taskImplementation && run.taskImplementation.taskId === where.taskImplementation.taskId);

  return matchesGeneratedApp && matchesStatus && matchesRunType && matchesStartedAt && matchesTask;
}

function installMocks() {
  prisma.generatedAppRun.findMany = async ({ where }) => state.runs.filter((run) => matchesWhere(run, where));

  prisma.generatedAppRun.update = async ({ where, data }) => {
    const run = state.runs.find((item) => item.id === where.id);
    if (!run) throw new Error('Run nao encontrada no mock.');
    Object.assign(run, data);
    return run;
  };

  prisma.taskImplementation.findUnique = async ({ where }) =>
    state.implementations.find((item) => item.id === where.id) || null;

  prisma.taskImplementation.update = async ({ where, data }) => {
    const implementation = state.implementations.find((item) => item.id === where.id);
    if (!implementation) throw new Error('Implementation nao encontrada no mock.');
    Object.assign(implementation, data);
    return implementation;
  };

  prisma.generatedApp.findUnique = async ({ where }) => state.apps.find((item) => item.id === where.id) || null;

  prisma.generatedApp.update = async ({ where, data }) => {
    const app = state.apps.find((item) => item.id === where.id);
    if (!app) throw new Error('Generated app nao encontrada no mock.');
    Object.assign(app, data);
    return app;
  };

  prisma.$transaction = async (callback) => callback(prisma);
}

function restoreMocks() {
  prisma.generatedAppRun.findMany = original.generatedAppRunFindMany;
  prisma.generatedAppRun.update = original.generatedAppRunUpdate;
  prisma.taskImplementation.findUnique = original.taskImplementationFindUnique;
  prisma.taskImplementation.update = original.taskImplementationUpdate;
  prisma.generatedApp.findUnique = original.generatedAppFindUnique;
  prisma.generatedApp.update = original.generatedAppUpdate;
  prisma.$transaction = original.transaction;
}

try {
  installMocks();

  const preflightResult = await recoverBlockingGeneratedAppRunsForStart({
    generatedAppId: 71,
    taskId: 9001,
    runType: 'implementation_apply',
    maxAgeSeconds: 600,
  });

  assert(preflightResult.recoveredCount === 1, 'O preflight deveria recuperar exatamente uma run stale da task alvo.');

  const recoveredImplementationRun = state.runs.find((run) => run.id === 101);
  assert(recoveredImplementationRun.status === 'failed', 'A run stale de implementation_apply deveria virar failed.');
  assert(recoveredImplementationRun.finishedAt instanceof Date, 'A run stale deveria registrar finishedAt.');
  assert(
    String(recoveredImplementationRun.logSummary || '').includes('Execucao travada recuperada automaticamente'),
    'A run stale deveria registrar a mensagem de recovery.'
  );

  const implementation = state.implementations.find((item) => item.id === 501);
  assert(implementation.status === 'failed', 'A implementation travada deveria virar failed.');
  assert(
    String(implementation.summary || '').includes('Execucao travada recuperada automaticamente'),
    'A implementation deveria receber nota de recovery no summary.'
  );

  const freshRun = state.runs.find((run) => run.id === 103);
  assert(freshRun.status === 'running', 'Runs recentes nao deveriam ser afetadas pelo preflight.');

  const watchdogResult = await recoverStaleGeneratedAppRuns({
    maxAgeSeconds: 600,
    reason: 'Execucao marcada como falha por watchdog de recuperacao do backend.',
  });

  assert(watchdogResult.recoveredCount === 1, 'O watchdog deveria recuperar a run stale restante.');

  const recoveredBootstrapRun = state.runs.find((run) => run.id === 102);
  assert(recoveredBootstrapRun.status === 'failed', 'A run stale de bootstrap deveria virar failed.');
  assert(
    String(recoveredBootstrapRun.logSummary || '').includes('watchdog de recuperacao do backend'),
    'A run de bootstrap deveria registrar a mensagem do watchdog.'
  );

  const bootstrapApp = state.apps.find((item) => item.id === 72);
  assert(bootstrapApp.status === 'failed', 'O generated app em bootstrapping deveria virar failed apos recovery.');

  console.log('generated-app-run-recovery-smoke: ok');
} finally {
  restoreMocks();
}
