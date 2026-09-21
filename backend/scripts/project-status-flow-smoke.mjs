import { prisma } from '../src/lib/prisma.js';
import { updateProjectStatus } from '../src/services/projectDataService.js';

const ACTOR_UUID = 'user-manager-1';

const state = {
  project: {
    id: 10,
    uuid: 'project-status-1',
    name: 'Projeto de status',
    slug: 'projeto-de-status',
    status: 'active',
    description: 'Projeto usado no smoke de status.',
    vision: 'Validar troca de status.',
    startMode: null,
    templateKey: null,
    intakeConfig: {},
    creator: { uuid: ACTOR_UUID },
    workspace: {
      uuid: 'workspace-1',
      ownerUser: { uuid: ACTOR_UUID },
    },
    members: [],
    tasks: [],
  },
};

const original = {
  findFirst: prisma.project.findFirst,
  findUnique: prisma.project.findUnique,
  update: prisma.project.update,
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installMocks() {
  prisma.project.findFirst = async () => state.project;
  prisma.project.findUnique = async ({ where }) => {
    if (where?.uuid === state.project.uuid) {
      return state.project;
    }
    return null;
  };
  prisma.project.update = async ({ data }) => {
    state.project = {
      ...state.project,
      ...data,
    };
    return state.project;
  };
}

function restoreMocks() {
  prisma.project.findFirst = original.findFirst;
  prisma.project.findUnique = original.findUnique;
  prisma.project.update = original.update;
}

try {
  installMocks();

  await assertThrowsInvalidStatus();
  await assertStatusTransition();

  console.log('project-status-flow-smoke: ok');
} finally {
  restoreMocks();
}

async function assertThrowsInvalidStatus() {
  let error = null;
  try {
    await updateProjectStatus(state.project.uuid, 'invalid-status', ACTOR_UUID);
  } catch (caughtError) {
    error = caughtError;
  }

  assert(error, 'O smoke deveria rejeitar status de projeto inválido.');
  assert(String(error.message || '').includes('Status de projeto invalido'), 'A validação de status inválido não retornou a mensagem esperada.');
}

async function assertStatusTransition() {
  const updatedProject = await updateProjectStatus(state.project.uuid, 'on_hold', ACTOR_UUID);

  assert(updatedProject.status === 'on_hold', 'O projeto deveria ser atualizado para on_hold.');
  assert(updatedProject.uuid === state.project.uuid, 'O projeto retornado deveria manter o mesmo uuid.');
  assert(state.project.status === 'on_hold', 'O mock interno deveria refletir a alteração de status.');
}
