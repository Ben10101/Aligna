import { prisma } from '../src/lib/prisma.js';
import {
  createAgentRunStart,
  finishAgentRun,
  restoreTaskAfterAgentFailure,
} from '../src/services/projectDataService.js';

const original = {
  projectFindUnique: prisma.project.findUnique,
  taskFindUnique: prisma.task.findUnique,
  userFindUnique: prisma.user.findUnique,
  agentRunFindMany: prisma.agentRun.findMany,
  agentRunFindFirst: prisma.agentRun.findFirst,
  agentRunFindUnique: prisma.agentRun.findUnique,
  agentRunUpdate: prisma.agentRun.update,
  agentRunCreate: prisma.agentRun.create,
  taskUpdate: prisma.task.update,
  taskStatusHistoryCreate: prisma.taskStatusHistory.create,
  transaction: prisma.$transaction,
};

const state = {
  project: { id: 78, uuid: 'project-qa-1' },
  user: { id: 6, uuid: 'user-qa-1' },
  task: {
    id: 601,
    uuid: 'task-qa-1',
    title: 'Como coordenador, eu quero validar o plano do evento, para garantir uma execucao segura.',
    taskType: 'story',
    status: 'qa',
    assigneeType: 'agent',
    assigneeUserId: null,
    assigneeAgentName: 'qa_engineer',
    startedAt: new Date(Date.now() - 60_000),
    completedAt: null,
    currentArtifactSummary: null,
    createdAt: new Date(Date.now() - 120_000),
    updatedAt: new Date(),
    artifacts: [{ artifactType: 'requirements', artifactScope: 'refinement', isCurrent: true }],
    comments: [],
    checklistItems: [],
    agentRuns: [],
    creator: { uuid: 'creator-qa-1', name: 'Creator QA', email: 'creator-qa@example.com' },
    assigneeUser: null,
    reporterUser: null,
    _count: { artifacts: 1, comments: 0, checklistItems: 0 },
  },
  runs: [
    {
      id: 901,
      uuid: 'stale-qa-run',
      projectId: 78,
      taskId: 601,
      agentName: 'qa_engineer',
      status: 'running',
      inputPayload: '{"task":"old-qa"}',
      outputText: null,
      startedAt: new Date(Date.now() - 12 * 60 * 1000),
      finishedAt: null,
      createdAt: new Date(Date.now() - 12 * 60 * 1000),
      errorMessage: null,
    },
  ],
  statusHistory: [],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cloneTask(include = {}) {
  return {
    ...state.task,
    artifacts: include.artifacts ? state.task.artifacts : undefined,
    comments: include.comments ? state.task.comments : undefined,
    checklistItems: include.checklistItems ? state.task.checklistItems : undefined,
    agentRuns: include.agentRuns ? state.runs.slice().sort((a, b) => b.createdAt - a.createdAt) : undefined,
    creator: include.creator ? state.task.creator : undefined,
    assigneeUser: include.assigneeUser ? state.task.assigneeUser : undefined,
    reporterUser: include.reporterUser ? state.task.reporterUser : undefined,
    _count: include._count ? state.task._count : undefined,
  };
}

function installMocks() {
  prisma.project.findUnique = async ({ where }) => {
    if (where?.uuid === state.project.uuid) {
      return { id: state.project.id };
    }
    return null;
  };

  prisma.task.findUnique = async ({ where, select, include }) => {
    if (where?.uuid === state.task.uuid || where?.id === state.task.id) {
      if (select?.id && !include) {
        return { id: state.task.id, status: state.task.status, inputPayload: undefined };
      }

      if (select?.id && select?.status) {
        return { id: state.task.id, status: state.task.status };
      }

      return cloneTask(include || {});
    }
    return null;
  };

  prisma.user.findUnique = async ({ where, select }) => {
    if (where?.uuid === state.user.uuid) {
      return select?.id ? { id: state.user.id } : state.user;
    }
    return null;
  };

  prisma.agentRun.findMany = async ({ where }) =>
    state.runs.filter((run) => {
      const matchesProject = where?.projectId === undefined || run.projectId === where.projectId;
      const matchesAgent = where?.agentName === undefined || run.agentName === where.agentName;
      const matchesTask = where?.taskId === undefined || run.taskId === where.taskId;
      const matchesStatus = where?.status === undefined || run.status === where.status;
      const matchesStartedAt = !where?.startedAt?.lt || run.startedAt < where.startedAt.lt;
      return matchesProject && matchesAgent && matchesTask && matchesStatus && matchesStartedAt;
    });

  prisma.agentRun.findFirst = async ({ where }) =>
    state.runs.find(
      (run) =>
        run.projectId === where.projectId &&
        run.agentName === where.agentName &&
        run.taskId === where.taskId &&
        run.status === where.status
    ) || null;

  prisma.agentRun.findUnique = async ({ where, select }) => {
    const run = state.runs.find((item) => item.id === where.id);
    if (!run) return null;
    if (select) {
      const selected = {};
      for (const key of Object.keys(select)) {
        selected[key] = run[key];
      }
      return selected;
    }
    return run;
  };

  prisma.agentRun.update = async ({ where, data }) => {
    const run = state.runs.find((item) => item.id === where.id);
    if (!run) throw new Error('Run nao encontrada.');
    Object.assign(run, data);
    return run;
  };

  prisma.agentRun.create = async ({ data }) => {
    const created = {
      id: 902,
      createdAt: new Date(),
      inputPayload: data.inputPayload,
      outputText: null,
      errorMessage: null,
      finishedAt: null,
      ...data,
    };
    state.runs.push(created);
    return created;
  };

  prisma.task.update = async ({ where, data }) => {
    if (where?.id !== state.task.id) throw new Error('Task nao encontrada.');
    Object.assign(state.task, data);
    state.task.updatedAt = new Date();
    return cloneTask({});
  };

  prisma.taskStatusHistory.create = async ({ data }) => {
    state.statusHistory.push(data);
    return data;
  };

  prisma.$transaction = async (callback) => callback(prisma);
}

function restoreMocks() {
  prisma.project.findUnique = original.projectFindUnique;
  prisma.task.findUnique = original.taskFindUnique;
  prisma.user.findUnique = original.userFindUnique;
  prisma.agentRun.findMany = original.agentRunFindMany;
  prisma.agentRun.findFirst = original.agentRunFindFirst;
  prisma.agentRun.findUnique = original.agentRunFindUnique;
  prisma.agentRun.update = original.agentRunUpdate;
  prisma.agentRun.create = original.agentRunCreate;
  prisma.task.update = original.taskUpdate;
  prisma.taskStatusHistory.create = original.taskStatusHistoryCreate;
  prisma.$transaction = original.transaction;
}

try {
  installMocks();

  const previousTaskState = {
    status: 'in_review',
    assigneeType: 'agent',
    assigneeUserId: null,
    assigneeAgentName: 'requirements_analyst',
    startedAt: null,
    completedAt: null,
    currentArtifactSummary: null,
  };

  const createdRun = await createAgentRunStart(state.project.uuid, 'qa_engineer', {
    task_uuid: state.task.uuid,
  });

  const recoveredRun = state.runs.find((run) => run.uuid === 'stale-qa-run');
  assert(recoveredRun?.status === 'stale', 'A run antiga de QA deveria ser marcada como stale antes da nova tentativa.');
  assert(createdRun.status === 'running', 'A nova run de QA deveria iniciar em running.');

  await finishAgentRun(createdRun.id, {
    status: 'failed',
    errorMessage: 'Falha simulada do qa_engineer.',
  });

  await restoreTaskAfterAgentFailure(state.task.uuid, previousTaskState, {
    changedByUserUuid: state.user.uuid,
    failedAgentName: 'qa_engineer',
    errorMessage: 'Falha simulada do qa_engineer.',
  });

  const finalRun = state.runs.find((run) => run.id === createdRun.id);
  assert(finalRun?.status === 'failed', 'A nova run de QA deveria terminar em failed.');
  assert(state.task.status === 'in_review', 'A task deveria voltar para in_review apos falha do QA.');
  assert(state.task.startedAt === null, 'A task nao deveria manter startedAt apos recovery do QA.');
  assert(
    state.statusHistory.some((item) => String(item.note || '').includes('Falha ao executar qa_engineer')),
    'O historico deveria registrar a devolucao da task apos falha do QA.'
  );

  console.log('qa-recovery-smoke: ok');
} finally {
  restoreMocks();
}
