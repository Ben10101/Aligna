import { prisma } from '../src/lib/prisma.js';
import {
  createAgentRunStart,
  finishAgentRun,
  persistAgentResult,
} from '../src/services/projectDataService.js';

const original = {
  projectFindUnique: prisma.project.findUnique,
  projectFindFirst: prisma.project.findFirst,
  projectUpdate: prisma.project.update,
  taskFindUnique: prisma.task.findUnique,
  taskFindFirst: prisma.task.findFirst,
  taskFindMany: prisma.task.findMany,
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
    id: 101,
    uuid: 'project-pm-1',
    creator: { id: 9001 },
    intakeConfig: {},
    tasks: [],
  },
  runs: [
    {
      id: 1001,
      uuid: 'stale-pm-run',
      projectId: 101,
      taskId: null,
      agentName: 'project_manager',
      status: 'running',
      inputPayload: '{"idea":"old"}',
      outputText: null,
      startedAt: new Date(Date.now() - 12 * 60 * 1000),
      finishedAt: null,
      createdAt: new Date(Date.now() - 12 * 60 * 1000),
      errorMessage: null,
    },
  ],
  systemTasks: [],
  artifacts: [],
  importedStories: [],
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

    if (include?.creator || include?.tasks) {
      return {
        id: state.project.id,
        uuid: state.project.uuid,
        creator: state.project.creator,
        tasks: state.importedStories.map((task) => ({
          id: task.id,
          title: task.title,
          taskType: task.taskType,
        })),
      };
    }

    return state.project;
  };

  prisma.project.findFirst = async ({ where, select }) => {
    if (where?.uuid !== state.project.uuid) return null;
    if (select?.id) {
      return { id: state.project.id };
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

  prisma.task.findMany = async ({ where }) =>
    state.importedStories
      .filter((task) => task.projectId === where?.projectId)
      .filter((task) => task.taskType !== 'agent_job');

  prisma.task.create = async ({ data, include }) => {
    const baseTask = {
      id: 1100 + state.systemTasks.length + state.importedStories.length + 1,
      uuid: data.uuid,
      projectId: data.projectId,
      title: data.title,
      description: data.description || null,
      taskType: data.taskType,
      status: data.status,
      priority: data.priority,
      assigneeType: data.assigneeType,
      assigneeAgentName: data.assigneeAgentName,
      position: data.position ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (data.taskType === 'agent_job') {
      state.systemTasks.push(baseTask);
      return include ? buildAgentJobTask(baseTask) : baseTask;
    }

    state.importedStories.push(baseTask);
    return baseTask;
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
      id: 1200 + state.artifacts.length + 1,
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
      id: 1300 + state.runs.length + 1,
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
  prisma.project.findFirst = original.projectFindFirst;
  prisma.project.update = original.projectUpdate;
  prisma.task.findUnique = original.taskFindUnique;
  prisma.task.findFirst = original.taskFindFirst;
  prisma.task.findMany = original.taskFindMany;
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
    idea: 'Plataforma para planejar eventos corporativos.',
  };

  const createdRun = await createAgentRunStart(state.project.uuid, 'project_manager', payload);
  const recoveredRun = state.runs.find((run) => run.uuid === 'stale-pm-run');

  assert(recoveredRun?.status === 'stale', 'A run antiga do project_manager deveria ser marcada como stale antes da nova tentativa.');
  assert(createdRun.status === 'running', 'A nova run do project_manager deveria iniciar em running.');

  const backlogResult = [
    '## Historias de Usuario',
    '- Como coordenador de eventos, eu quero criar um evento com nome, data e local, para iniciar o planejamento.',
    '- Como coordenador de eventos, eu quero cadastrar fornecedores no evento, para organizar a execucao.',
  ].join('\n');

  await finishAgentRun(createdRun.id, {
    status: 'completed',
    result: backlogResult,
  });

  const artifact = await persistAgentResult(state.project.uuid, 'project_manager', payload, backlogResult);

  assert(artifact?.artifactType === 'backlog', 'O backlog master deveria ser persistido como artefato de backlog.');
  assert(state.systemTasks.length === 1, 'O stage task do project_manager deveria ser criado.');
  assert(state.importedStories.length === 2, 'As historias do backlog deveriam ser importadas para o projeto.');
  assert(
    state.importedStories.some((task) => task.title.includes('criar um evento')),
    'A primeira historia importada deveria existir.'
  );

  console.log('project-manager-recovery-smoke: ok');
} finally {
  restoreMocks();
}
