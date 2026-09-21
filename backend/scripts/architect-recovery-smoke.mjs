import { prisma } from '../src/lib/prisma.js';
import {
  createAgentRunStart,
  finishAgentRun,
  persistAgentResult,
} from '../src/services/projectDataService.js';

const original = {
  projectFindUnique: prisma.project.findUnique,
  projectUpdate: prisma.project.update,
  taskFindUnique: prisma.task.findUnique,
  taskFindFirst: prisma.task.findFirst,
  taskCreate: prisma.task.create,
  taskArtifactUpdateMany: prisma.taskArtifact.updateMany,
  taskArtifactFindFirst: prisma.taskArtifact.findFirst,
  taskArtifactCreate: prisma.taskArtifact.create,
  agentRunFindMany: prisma.agentRun.findMany,
  agentRunFindFirst: prisma.agentRun.findFirst,
  agentRunFindUnique: prisma.agentRun.findUnique,
  agentRunUpdate: prisma.agentRun.update,
  agentRunCreate: prisma.agentRun.create,
  transaction: prisma.$transaction,
};

const state = {
  project: {
    id: 201,
    uuid: 'project-arch-1',
    creator: { id: 9901 },
    intakeConfig: {},
  },
  runs: [
    {
      id: 2001,
      uuid: 'stale-arch-run',
      projectId: 201,
      taskId: null,
      agentName: 'architect',
      status: 'running',
      inputPayload: '{"requirements":"old"}',
      outputText: null,
      startedAt: new Date(Date.now() - 12 * 60 * 1000),
      finishedAt: null,
      createdAt: new Date(Date.now() - 12 * 60 * 1000),
      errorMessage: null,
    },
  ],
  systemTasks: [],
  artifacts: [],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildAgentJobTask(task) {
  return {
    ...task,
    artifacts: [],
    statusHistory: [],
    _count: { artifacts: 0, comments: 0, checklistItems: 0 },
    assigneeUser: null,
    reporterUser: null,
    creator: null,
  };
}

function installMocks() {
  prisma.project.findUnique = async ({ where, select, include }) => {
    if (where?.uuid !== state.project.uuid) return null;

    if (select?.id) {
      return { id: state.project.id };
    }

    if (include?.creator) {
      return {
        id: state.project.id,
        uuid: state.project.uuid,
        creator: state.project.creator,
      };
    }

    return state.project;
  };

  prisma.project.update = async ({ where, data }) => {
    if (where?.uuid !== state.project.uuid) {
      throw new Error('Projeto nao encontrado.');
    }
    state.project = {
      ...state.project,
      ...data,
      intakeConfig: {
        ...(state.project.intakeConfig || {}),
        ...(data?.intakeConfig || {}),
      },
    };
    return state.project;
  };

  prisma.task.findUnique = async ({ where, select }) => {
    const systemTask = state.systemTasks.find((task) => task.uuid === where?.uuid || task.id === where?.id);
    if (!systemTask) return null;

    if (select?.id) {
      return { id: systemTask.id };
    }

    return systemTask;
  };

  prisma.task.findFirst = async ({ where, include }) => {
    const systemTask = state.systemTasks.find(
      (task) => task.projectId === where?.projectId && task.title === where?.title
    );

    if (!systemTask) return null;
    return include ? buildAgentJobTask(systemTask) : systemTask;
  };

  prisma.task.create = async ({ data, include }) => {
    const task = {
      id: 2100 + state.systemTasks.length + 1,
      uuid: data.uuid,
      projectId: data.projectId,
      title: data.title,
      description: data.description || null,
      taskType: data.taskType,
      status: data.status,
      priority: data.priority,
      assigneeType: data.assigneeType,
      assigneeAgentName: data.assigneeAgentName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.systemTasks.push(task);
    return include ? buildAgentJobTask(task) : task;
  };

  prisma.taskArtifact.updateMany = async () => ({ count: 0 });

  prisma.taskArtifact.findFirst = async ({ where }) => {
    const matching = state.artifacts
      .filter(
        (artifact) =>
          artifact.taskId === where?.taskId &&
          artifact.artifactType === where?.artifactType &&
          artifact.artifactScope === where?.artifactScope
      )
      .sort((a, b) => b.version - a.version);
    return matching[0] ? { version: matching[0].version } : null;
  };

  prisma.taskArtifact.create = async ({ data }) => {
    const artifact = {
      id: 2200 + state.artifacts.length + 1,
      createdAt: new Date(),
      ...data,
    };
    state.artifacts.push(artifact);
    return artifact;
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
      id: 2300 + state.runs.length + 1,
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

  prisma.$transaction = async (callback) => callback(prisma);
}

function restoreMocks() {
  prisma.project.findUnique = original.projectFindUnique;
  prisma.project.update = original.projectUpdate;
  prisma.task.findUnique = original.taskFindUnique;
  prisma.task.findFirst = original.taskFindFirst;
  prisma.task.create = original.taskCreate;
  prisma.taskArtifact.updateMany = original.taskArtifactUpdateMany;
  prisma.taskArtifact.findFirst = original.taskArtifactFindFirst;
  prisma.taskArtifact.create = original.taskArtifactCreate;
  prisma.agentRun.findMany = original.agentRunFindMany;
  prisma.agentRun.findFirst = original.agentRunFindFirst;
  prisma.agentRun.findUnique = original.agentRunFindUnique;
  prisma.agentRun.update = original.agentRunUpdate;
  prisma.agentRun.create = original.agentRunCreate;
  prisma.$transaction = original.transaction;
}

try {
  installMocks();

  const payload = {
    project_id: state.project.uuid,
    requirements: '## Historia 1\nCriar evento\n\n## Historia 2\nPlanejar cronograma',
  };

  const createdRun = await createAgentRunStart(state.project.uuid, 'architect', payload);
  const recoveredRun = state.runs.find((run) => run.uuid === 'stale-arch-run');

  assert(recoveredRun?.status === 'stale', 'A run antiga do architect deveria ser marcada como stale antes da nova tentativa.');
  assert(createdRun.status === 'running', 'A nova run do architect deveria iniciar em running.');

  const architectureResult = [
    '# Arquitetura',
    '',
    '## Modulos',
    '- eventos',
    '- fornecedores',
    '- credenciamento',
  ].join('\n');

  await finishAgentRun(createdRun.id, {
    status: 'completed',
    result: architectureResult,
  });

  const artifact = await persistAgentResult(state.project.uuid, 'architect', payload, architectureResult);

  assert(artifact?.artifactType === 'architecture', 'O architecture master deveria ser persistido.');
  assert(state.systemTasks.length === 1, 'O stage task do architect deveria ser criado.');
  assert(
    state.artifacts.some((item) => item.title === '[SYSTEM] Architecture Master'),
    'O artefato de arquitetura deveria existir.'
  );

  console.log('architect-recovery-smoke: ok');
} finally {
  restoreMocks();
}
