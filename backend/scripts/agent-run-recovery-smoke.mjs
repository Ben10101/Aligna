import { prisma } from '../src/lib/prisma.js';
import { createAgentRunStart } from '../src/services/projectDataService.js';

const original = {
  projectFindUnique: prisma.project.findUnique,
  taskFindUnique: prisma.task.findUnique,
  agentRunFindMany: prisma.agentRun.findMany,
  agentRunUpdate: prisma.agentRun.update,
  agentRunFindFirst: prisma.agentRun.findFirst,
  agentRunCreate: prisma.agentRun.create,
  taskUpdate: prisma.task.update,
  taskStatusHistoryCreate: prisma.taskStatusHistory.create,
  transaction: prisma.$transaction,
};

const state = {
  project: { id: 91, uuid: 'project-uuid-1' },
  task: {
    id: 44,
    uuid: 'task-uuid-1',
    taskType: 'story',
    status: 'in_progress',
    assigneeType: 'agent',
    assigneeAgentName: 'requirements_analyst',
    artifacts: [],
  },
  runs: [
    {
      id: 301,
      uuid: 'stale-run-uuid',
      projectId: 91,
      taskId: 44,
      agentName: 'requirements_analyst',
      status: 'running',
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      finishedAt: null,
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

function installMocks() {
  prisma.project.findUnique = async ({ where }) => {
    if (where?.uuid === state.project.uuid) {
      return { id: state.project.id };
    }
    return null;
  };

  prisma.task.findUnique = async ({ where, select, include }) => {
    if (where?.uuid === state.task.uuid) {
      if (select?.id) {
        return { id: state.task.id };
      }
      return {
        id: state.task.id,
        taskType: state.task.taskType,
        status: state.task.status,
        assigneeType: state.task.assigneeType,
        assigneeAgentName: state.task.assigneeAgentName,
        artifacts: include?.artifacts ? state.task.artifacts : undefined,
      };
    }

    if (where?.id === state.task.id) {
      return {
        id: state.task.id,
        taskType: state.task.taskType,
        status: state.task.status,
        assigneeType: state.task.assigneeType,
        assigneeAgentName: state.task.assigneeAgentName,
        artifacts: include?.artifacts ? state.task.artifacts : undefined,
      };
    }

    return null;
  };

  prisma.agentRun.findMany = async ({ where }) =>
    state.runs.filter((run) => {
      const matchesProject = where?.projectId === undefined || run.projectId === where.projectId;
      const matchesAgent = where?.agentName === undefined || run.agentName === where.agentName;
      const matchesTask = where?.taskId === undefined || run.taskId === where.taskId;
      const matchesStatus = where?.status === undefined || run.status === where.status;
      const matchesStartedAt =
        !where?.startedAt?.lt || (run.startedAt && run.startedAt < where.startedAt.lt);

      return matchesProject && matchesAgent && matchesTask && matchesStatus && matchesStartedAt;
    });

  prisma.agentRun.update = async ({ where, data }) => {
    const run = state.runs.find((item) => item.id === where.id);
    if (!run) throw new Error('Run nao encontrada no mock.');
    Object.assign(run, data);
    return run;
  };

  prisma.agentRun.findFirst = async ({ where }) =>
    state.runs.find(
      (run) =>
        run.projectId === where.projectId &&
        run.agentName === where.agentName &&
        run.taskId === where.taskId &&
        run.status === where.status
    ) || null;

  prisma.agentRun.create = async ({ data }) => {
    const created = {
      id: 999,
      ...data,
      createdAt: new Date(),
    };
    state.runs.push(created);
    return created;
  };

  prisma.task.update = async ({ where, data }) => {
    if (where?.id !== state.task.id) throw new Error('Task nao encontrada no mock.');
    Object.assign(state.task, data);
    return state.task;
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
  prisma.agentRun.findMany = original.agentRunFindMany;
  prisma.agentRun.update = original.agentRunUpdate;
  prisma.agentRun.findFirst = original.agentRunFindFirst;
  prisma.agentRun.create = original.agentRunCreate;
  prisma.task.update = original.taskUpdate;
  prisma.taskStatusHistory.create = original.taskStatusHistoryCreate;
  prisma.$transaction = original.transaction;
}

try {
  installMocks();

  const createdRun = await createAgentRunStart(state.project.uuid, 'requirements_analyst', {
    task_uuid: state.task.uuid,
  });

  const staleRun = state.runs.find((run) => run.uuid === 'stale-run-uuid');
  assert(staleRun, 'A run antiga deveria existir no estado.');
  assert(staleRun.status === 'stale', 'A run travada deveria ser marcada como stale.');
  assert(
    staleRun.errorMessage?.includes('Execucao travada recuperada automaticamente'),
    'A run travada deveria receber mensagem de recuperacao automatica.'
  );
  assert(state.task.status === 'backlog', 'A task deveria voltar para backlog apos recovery.');
  assert(
    state.statusHistory.some((item) => String(item.note || '').includes('Execucao travada liberada automaticamente')),
    'Deveria registrar historico da recuperacao automatica.'
  );
  assert(createdRun.status === 'running', 'Uma nova run deveria ser criada em running.');
  assert(createdRun.taskId === state.task.id, 'A nova run deveria apontar para a mesma task.');

  console.log('agent-run-recovery-smoke: ok');
} finally {
  restoreMocks();
}
