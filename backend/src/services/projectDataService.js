import { randomUUID } from 'crypto';
import { access, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { recoverBlockingAgentRunsForStart } from './agentRunRecoveryService.js';
import { estimateTokenCount } from '../utils/aiRunMetrics.js';
import { DEFAULT_AI_SETTINGS, getAiSettingsForUser } from './aiSettingsService.js';
import { inferProjectTemplateKey, resolveProjectTemplate } from '../templates/projects/index.js';
import { logInfo, logWarn } from '../utils/logger.js';
import { recordRuntimeEvent } from './runtimeTelemetryService.js';
import { assertArtifactQuality } from './artifactQualityGateService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GENERATED_PROJECTS_ROOT = path.join(REPO_ROOT, 'generated-projects');
const QA_VALIDATION_ARTIFACT_TYPE = 'qa_validation_cases';
const QA_ARTIFACT_TYPES = [QA_VALIDATION_ARTIFACT_TYPE, 'test_plan']; // test_plan is legacy only

export function resolveArtifactReviewTransition(artifactType, approved) {
  if (approved && artifactType === 'requirements') return { status: 'qa', assigneeAgentName: 'qa_engineer', assigneeType: 'agent', releasedStage: 'qa' };
  // Architecture is no longer an active agent. QA approval releases a story
  // to implementation; it must never be reported as completed at this point.
  if (approved && QA_ARTIFACT_TYPES.includes(artifactType)) return { status: 'todo', assigneeAgentName: 'developer', assigneeType: 'agent', releasedStage: 'implementation' };
  if (approved && artifactType === 'architecture') return { status: 'todo', assigneeAgentName: 'developer', assigneeType: 'agent', releasedStage: 'implementation' };
  if (!approved && artifactType === 'architecture') return { status: 'in_review', assigneeAgentName: 'architect', assigneeType: 'agent', releasedStage: null };
  if (!approved && QA_ARTIFACT_TYPES.includes(artifactType)) return { status: 'qa', assigneeAgentName: 'qa_engineer', assigneeType: 'agent', releasedStage: null };
  if (!approved) return { status: 'backlog', assigneeAgentName: 'requirements_analyst', assigneeType: 'agent', releasedStage: null };
  return null;
}

const taskListInclude = {
  assigneeUser: { select: { uuid: true, name: true, email: true } },
  reporterUser: { select: { uuid: true, name: true, email: true } },
  creator: { select: { uuid: true, name: true, email: true } },
  artifacts: {
    where: { isCurrent: true, artifactScope: 'refinement' },
    orderBy: { createdAt: 'desc' },
  },
  statusHistory: {
    orderBy: { changedAt: 'desc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      changedAt: true,
    },
  },
  _count: { select: { artifacts: true, comments: true, checklistItems: true } },
};

const taskDetailInclude = {
  ...taskListInclude,
  project: {
    select: {
      uuid: true,
      name: true,
      slug: true,
      status: true,
      members: {
        include: {
          user: {
            select: { uuid: true, name: true, email: true },
          },
        },
      },
    },
  },
  comments: {
    orderBy: { createdAt: 'desc' },
    include: {
      authorUser: { select: { uuid: true, name: true, email: true } },
    },
  },
  artifacts: {
    where: { artifactScope: 'refinement' },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    include: { reviews: { orderBy: { reviewedAt: 'desc' }, include: { reviewer: { select: { uuid: true, name: true } } } } },
  },
  statusHistory: {
    orderBy: { changedAt: 'desc' },
    include: {
      changedByUser: { select: { uuid: true, name: true, email: true } },
    },
  },
  checklistItems: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  agentRuns: {
    orderBy: { createdAt: 'desc' },
  },
};

function getDurationSeconds(startAt, endAt = new Date()) {
  if (!startAt) return 0;
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function buildTaskTiming(task) {
  const now = new Date();
  const leadTimeSeconds = getDurationSeconds(task.createdAt, task.completedAt || now);

  const byAgent = (task.agentRuns || []).reduce((acc, run) => {
    const durationSeconds = run.startedAt ? getDurationSeconds(run.startedAt, run.finishedAt || now) : 0;
    const current = acc[run.agentName] || {
      agentName: run.agentName,
      runs: 0,
      totalDurationSeconds: 0,
      lastStatus: run.status,
      lastFinishedAt: run.finishedAt || null,
    };

    current.runs += 1;
    current.totalDurationSeconds += durationSeconds;
    current.lastStatus = run.status;
    current.lastFinishedAt = run.finishedAt || current.lastFinishedAt;
    acc[run.agentName] = current;
    return acc;
  }, {});

  const totalAgentProcessingSeconds = Object.values(byAgent).reduce(
    (total, agent) => total + (agent.totalDurationSeconds || 0),
    0
  );
  const cycleTimeSeconds =
    totalAgentProcessingSeconds > 0
      ? totalAgentProcessingSeconds
      : task.startedAt
        ? getDurationSeconds(task.startedAt, task.completedAt || now)
        : 0;

  return {
    leadTimeSeconds,
    cycleTimeSeconds,
    requirementsTimeSeconds: byAgent.requirements_analyst?.totalDurationSeconds || 0,
    qaTimeSeconds: byAgent.qa_engineer?.totalDurationSeconds || 0,
    byAgent: Object.values(byAgent),
  };
}

function getAgentDisplayName(agentName, agentAliases = DEFAULT_AI_SETTINGS.agentAliases) {
  if (!agentName) return null;
  return agentAliases?.[agentName] || agentName;
}

function enrichTask(task, agentAliases = DEFAULT_AI_SETTINGS.agentAliases) {
  if (!task) return task;
  const latestAgentRun = (task.agentRuns || [])[0] || null;
  const processingError =
    latestAgentRun?.status === 'failed'
      ? {
          agentName: latestAgentRun.agentName,
          agentLabel: getAgentDisplayName(latestAgentRun.agentName, agentAliases),
          message: latestAgentRun.errorMessage || 'Falha ao processar a task.',
          happenedAt: latestAgentRun.finishedAt || latestAgentRun.createdAt || null,
        }
      : null;

  return {
    ...task,
    assigneeAgentLabel: getAgentDisplayName(task.assigneeAgentName, agentAliases),
    timing: {
      ...buildTaskTiming(task),
      byAgent: (buildTaskTiming(task).byAgent || []).map((item) => ({
        ...item,
        agentLabel: getAgentDisplayName(item.agentName, agentAliases),
      })),
    },
    latestAgentRun: latestAgentRun
      ? {
          ...latestAgentRun,
          agentLabel: getAgentDisplayName(latestAgentRun.agentName, agentAliases),
        }
      : null,
    agentRuns: (task.agentRuns || []).map((run) => ({
      ...run,
      agentLabel: getAgentDisplayName(run.agentName, agentAliases),
    })),
    processingError,
  };
}

const workflowOrder = ['backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done'];
const projectRoleOrder = ['viewer', 'editor', 'manager', 'owner'];

function hasCurrentArtifact(task, artifactType) {
  return (task.artifacts || []).some((artifact) => artifact.artifactType === artifactType && artifact.isCurrent);
}

function validateTaskStatusTransition(existingTask, nextStatus) {
  if (!nextStatus || nextStatus === existingTask.status) return;

  if (nextStatus === 'blocked' || nextStatus === 'archived') return;

  // QA is an execution state. Once the QA agent creates its artifact, the
  // normal next state is human review, even though the board order displays
  // `in_review` before `qa`.
  if (existingTask.status === 'qa' && nextStatus === 'in_review') return;

  const currentIndex = workflowOrder.indexOf(existingTask.status);
  const nextIndex = workflowOrder.indexOf(nextStatus);

  if (currentIndex !== -1 && nextIndex !== -1 && nextIndex < currentIndex) {
    throw new Error('NÃ£o Ã© permitido voltar a tarefa para uma etapa anterior.');
  }

  if (nextStatus === 'qa' && !hasCurrentArtifact(existingTask, 'requirements')) {
    throw new Error('A tarefa sÃ³ pode seguir para QA depois que os requisitos estiverem processados.');
  }
}

function buildProjectAccessFilter(userUuid) {
  if (!userUuid) return {};

  return {
    OR: [
      { creator: { is: { uuid: userUuid } } },
      {
        workspace: {
          is: {
            ownerUser: {
              is: {
                uuid: userUuid,
              },
            },
          },
        },
      },
      {
        members: {
          some: {
            user: {
              is: {
                uuid: userUuid,
              },
            },
          },
        },
      },
    ],
  };
}

function getProjectRoleRank(role) {
  const index = projectRoleOrder.indexOf(role || 'viewer');
  return index === -1 ? 0 : index;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeGeneratedProjectRootIfSafe(rootPath, projectUuid) {
  const resolvedRoot = path.resolve(String(rootPath || '').trim());
  const generatedProjectsRoot = path.resolve(GENERATED_PROJECTS_ROOT);

  if (
    !resolvedRoot ||
    resolvedRoot === generatedProjectsRoot ||
    !resolvedRoot.startsWith(`${generatedProjectsRoot}${path.sep}`)
  ) {
    logWarn({ projectUuid, rootPath: resolvedRoot }, 'Skipping project directory cleanup outside generated-projects root.');
    return false;
  }

  if (!(await pathExists(resolvedRoot))) {
    return false;
  }

  await rm(resolvedRoot, { recursive: true, force: true });
  return true;
}

function buildProjectPermissions(currentUserRole = 'viewer') {
  const roleRank = getProjectRoleRank(currentUserRole);
  return {
    canViewProject: roleRank >= getProjectRoleRank('viewer'),
    canEditProject: roleRank >= getProjectRoleRank('manager'),
    canManageMembers: roleRank >= getProjectRoleRank('manager'),
    canCreateTask: roleRank >= getProjectRoleRank('editor'),
    canEditTask: roleRank >= getProjectRoleRank('editor'),
    canRunAgents: roleRank >= getProjectRoleRank('editor'),
    canApproveArchitecture: roleRank >= getProjectRoleRank('manager'),
  };
}

function resolveCurrentUserProjectRole(project, userUuid) {
  if (!userUuid || !project) return 'viewer';
  if (project.creator?.uuid === userUuid) return 'owner';
  if (project.workspace?.ownerUser?.uuid === userUuid) return 'owner';

  const membership = (project.members || []).find((member) => member.user?.uuid === userUuid);
  return membership?.projectRole || 'viewer';
}

function enrichProjectAccess(project, userUuid = null) {
  if (!project) return project;

  const currentUserRole = resolveCurrentUserProjectRole(project, userUuid);
  const resolvedProjectTemplate = resolveProjectTemplate(
    project.templateKey || project.intakeConfig?.projectTemplateKey || null,
    {
      projectName: project.name,
      summary: project.description || project.vision || '',
      label: project.name,
    }
  );
  return {
    ...project,
    projectDna: project.intakeConfig?.projectDna || null,
    currentUserRole,
    permissions: buildProjectPermissions(currentUserRole),
    resolvedProjectTemplate,
  };
}

function normalizeProjectLanguage(...values) {
  const tokens = values
    .flatMap((value) =>
      String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    );

  return Array.from(new Set(tokens));
}

function inferDomainLanguage({ projectName, description, vision, templateKey }) {
  const vocabulary = normalizeProjectLanguage(projectName, description, vision, templateKey);
  const stopwords = new Set([
    'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
    'e', 'ou', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'que',
    'como', 'se', 'ao', 'aos', 'mais', 'menos', 'uma', 'permitir', 'permite', 'garantir',
    'sistema', 'plataforma', 'processo', 'forma', 'deve', 'devem', 'cliente', 'clientes',
  ]);
  const meaningfulVocabulary = vocabulary.filter((term) => term.length >= 4 && !stopwords.has(term));
  return meaningfulVocabulary.slice(0, 12);
}

function inferProductMode({ templateKey, description, vision }) {
  const source = normalizeProjectLanguage(templateKey, description, vision);
  if (source.includes('evento') || source.includes('eventos')) return 'operational-workspace';
  if (source.includes('visita') || source.includes('visitante')) return 'access-operations';
  if (source.includes('suporte') || source.includes('ticket') || source.includes('chamado')) return 'service-operations';
  if (source.includes('dashboard') || source.includes('analitico')) return 'executive-cockpit';
  return 'product-workspace';
}

function inferExperienceStyle({ templateKey, description, vision }) {
  const source = normalizeProjectLanguage(templateKey, description, vision);
  if (source.includes('evento') || source.includes('operacao') || source.includes('operacional')) return 'operational-premium';
  if (source.includes('configuracao') || source.includes('preferencia') || source.includes('ajuste')) return 'controlled-console';
  return 'professional-balanced';
}

function inferPrimaryActor({ description, vision, intakeConfig }) {
  const actorCandidates = [
    'coordenador de eventos',
    'recepcionista',
    'analista de suporte',
    'gestor operacional',
    'administrador',
  ];
  const source = `${description || ''}\n${vision || ''}\n${intakeConfig?.idea || ''}\n${intakeConfig?.objective || ''}`.toLowerCase();
  return actorCandidates.find((candidate) => source.includes(candidate)) || 'operador principal';
}

function buildProjectDna({ name, description, vision, templateKey, intakeConfig }) {
  const domainLanguage = inferDomainLanguage({
    projectName: name,
    description,
    vision,
    templateKey,
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      name: String(name || '').trim(),
      slugHint:
        String(name || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || null,
      templateKey: templateKey || null,
      productMode: inferProductMode({ templateKey, description, vision }),
      experienceStyle: inferExperienceStyle({ templateKey, description, vision }),
      primaryActor: inferPrimaryActor({ description, vision, intakeConfig }),
      domainLanguage,
    },
    positioning: {
      summary: String(description || vision || intakeConfig?.idea || '').trim() || null,
      promise: String(vision || intakeConfig?.objective || '').trim() || null,
    },
    designSystem: {
      allowedScreenFamilies: ['workspace', 'executive-cockpit', 'settings-console'],
      defaultScreenFamily: 'workspace',
      navigationStyle: 'sidebar-operational',
      visualTone: 'professional',
    },
    coherenceRules: {
      mustPreserve: ['domainLanguage', 'productMode', 'experienceStyle'],
      forbiddenDrift: ['generic-crud-without-domain', 'cross-domain-language-bleed'],
    },
  };
}

function renderProjectDnaArtifact(project, projectDna) {
  const domainLanguage = (projectDna?.project?.domainLanguage || []).map((item) => `- ${item}`).join('\n') || '- sem termos-chave';
  const screenFamilies =
    (projectDna?.designSystem?.allowedScreenFamilies || []).map((item) => `- ${item}`).join('\n') || '- workspace';

  return `# Project DNA\n\n## Projeto\n- Nome: ${project.name}\n- Template: ${project.templateKey || 'nao definido'}\n- Product mode: ${projectDna?.project?.productMode || 'product-workspace'}\n- Experience style: ${projectDna?.project?.experienceStyle || 'professional-balanced'}\n- Ator principal: ${projectDna?.project?.primaryActor || 'operador principal'}\n\n## Posicionamento\n- Resumo: ${projectDna?.positioning?.summary || 'nao informado'}\n- Promessa: ${projectDna?.positioning?.promise || 'nao informada'}\n\n## Linguagem do Dominio\n${domainLanguage}\n\n## Direcao de UX\n${screenFamilies}\n\n## Regras de Coerencia\n- Preservar: ${(projectDna?.coherenceRules?.mustPreserve || []).join(', ') || 'domainLanguage, productMode, experienceStyle'}\n- Evitar: ${(projectDna?.coherenceRules?.forbiddenDrift || []).join(', ') || 'generic-crud-without-domain'}\n\n## Contract\n\`\`\`json\n${JSON.stringify(projectDna, null, 2)}\n\`\`\`\n`;
}

async function persistProjectDnaArtifact(projectUuid, projectRecord, projectDna) {
  const stageTask = await ensureStageTask(projectUuid, 'project_manager');
  if (!stageTask) return null;

  return createSystemTaskArtifact(stageTask.uuid, {
    artifactType: 'custom',
    title: '[SYSTEM] Project DNA',
    content: renderProjectDnaArtifact(projectRecord, projectDna),
    contentFormat: 'markdown',
    createdByAgentName: 'system',
  });
}

export async function assertProjectPermission(projectUuid, userUuid, minimumRole = 'viewer') {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(userUuid),
    },
    select: {
      id: true,
      uuid: true,
      createdBy: true,
      creator: {
        select: { uuid: true },
      },
      workspace: {
        select: {
          uuid: true,
          ownerUser: {
            select: { uuid: true },
          },
        },
      },
      members: {
        include: {
          user: {
            select: { uuid: true },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado ou sem permissÃ£o de acesso.');
  }

  const currentUserRole = resolveCurrentUserProjectRole(project, userUuid);
  if (getProjectRoleRank(currentUserRole) < getProjectRoleRank(minimumRole)) {
    throw new Error('VocÃª nÃ£o tem permissÃ£o para executar esta aÃ§Ã£o neste projeto.');
  }

  const enrichedProject = enrichProjectAccess(project, userUuid);
  if (!enrichedProject) return enrichedProject;
  const stories = enrichedProject.intakeConfig?.backlogContract?.stories;
  return {
    ...enrichedProject,
    backlogReconciliation: {
      findings: validateBacklogFinalReconciliation(stories),
    },
  };
}

export async function getDefaultWorkspaceForUserUuid(userUuid) {
  if (!userUuid) return null;

  const user = await prisma.user.findUnique({
    where: { uuid: userUuid },
    select: { id: true },
  });

  if (!user) return null;

  const ownedWorkspace = await prisma.workspace.findFirst({
    where: { ownerUserId: user.id },
    select: { id: true, uuid: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  if (ownedWorkspace) return ownedWorkspace;

  const membership = await prisma.projectMember.findFirst({
    where: { userId: user.id },
    include: {
      project: {
        include: {
          workspace: {
            select: { id: true, uuid: true, name: true, slug: true },
          },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return membership?.project?.workspace || null;
}

export async function assertWorkspaceAccess(workspaceUuid, userUuid) {
  const workspace = await prisma.workspace.findFirst({
    where: {
      uuid: workspaceUuid,
      OR: [
        {
          ownerUser: {
            is: {
              uuid: userUuid,
            },
          },
        },
        {
          projects: {
            some: {
              members: {
                some: {
                  user: {
                    is: {
                      uuid: userUuid,
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: { id: true, uuid: true, name: true, slug: true },
  });

  if (!workspace) {
    throw new Error('Workspace nÃ£o encontrado ou sem permissÃ£o de acesso.');
  }

  return workspace;
}

export async function getWorkspaceTeamSummary(userUuid, workspaceUuid = null) {
  const workspace =
    workspaceUuid
      ? await assertWorkspaceAccess(workspaceUuid, userUuid)
      : await getDefaultWorkspaceForUserUuid(userUuid);

  if (!workspace?.uuid) {
    throw new Error('Workspace não encontrado ou sem permissão de acesso.');
  }

  const workspaceRecord = await prisma.workspace.findUnique({
    where: { uuid: workspace.uuid },
    select: {
      uuid: true,
      name: true,
      slug: true,
      description: true,
      ownerUser: {
        select: { uuid: true, name: true, email: true },
      },
      projects: {
        orderBy: { createdAt: 'asc' },
        select: {
          uuid: true,
          name: true,
          slug: true,
          status: true,
          creator: {
            select: { uuid: true, name: true, email: true },
          },
          workspace: {
            select: {
              ownerUser: {
                select: { uuid: true },
              },
            },
          },
          members: {
            include: {
              user: {
                select: { uuid: true, name: true, email: true },
              },
            },
          },
        },
      },
    },
  });

  if (!workspaceRecord) {
    throw new Error('Workspace não encontrado.');
  }

  const peopleMap = new Map();

  for (const project of workspaceRecord.projects) {
    const currentUserRole = resolveCurrentUserProjectRole(project, userUuid);
    const permissions = buildProjectPermissions(currentUserRole);

    for (const member of project.members || []) {
      const memberUser = member.user;
      if (!memberUser?.uuid) continue;

      const current = peopleMap.get(memberUser.uuid) || {
        user: memberUser,
        workspaceOwner: workspaceRecord.ownerUser?.uuid === memberUser.uuid,
        memberships: [],
      };

      current.memberships.push({
        projectUuid: project.uuid,
        projectName: project.name,
        projectStatus: project.status,
        projectRole: member.projectRole,
        joinedAt: member.joinedAt,
        currentUserRole,
        permissions,
      });

      peopleMap.set(memberUser.uuid, current);
    }
  }

  if (workspaceRecord.ownerUser?.uuid) {
    const existingOwner = peopleMap.get(workspaceRecord.ownerUser.uuid);
    if (existingOwner) {
      existingOwner.workspaceOwner = true;
      peopleMap.set(workspaceRecord.ownerUser.uuid, existingOwner);
    } else {
      peopleMap.set(workspaceRecord.ownerUser.uuid, {
        user: workspaceRecord.ownerUser,
        workspaceOwner: true,
        memberships: [],
      });
    }
  }

  const members = Array.from(peopleMap.values())
    .map((member) => ({
      ...member,
      memberships: [...member.memberships].sort((left, right) =>
        String(left.projectName || '').localeCompare(String(right.projectName || ''), 'pt-BR')
      ),
    }))
    .sort((left, right) => {
      if (left.workspaceOwner !== right.workspaceOwner) {
        return left.workspaceOwner ? -1 : 1;
      }
      return String(left.user?.name || left.user?.email || '').localeCompare(
        String(right.user?.name || right.user?.email || ''),
        'pt-BR'
      );
    });

  return {
    workspace: {
      uuid: workspaceRecord.uuid,
      name: workspaceRecord.name,
      slug: workspaceRecord.slug,
      description: workspaceRecord.description,
      ownerUser: workspaceRecord.ownerUser,
    },
    canManageWorkspace: workspaceRecord.ownerUser?.uuid === userUuid,
    projects: workspaceRecord.projects.map((project) => {
      const currentUserRole = resolveCurrentUserProjectRole(project, userUuid);
      return {
        uuid: project.uuid,
        name: project.name,
        slug: project.slug,
        status: project.status,
        currentUserRole,
        permissions: buildProjectPermissions(currentUserRole),
        memberCount: project.members.length,
      };
    }),
    members,
    summary: {
      totalProjects: workspaceRecord.projects.length,
      totalPeople: members.length,
      managers: members.filter((member) =>
        member.memberships.some((membership) => ['owner', 'manager'].includes(membership.projectRole))
      ).length,
      contributors: members.filter((member) =>
        member.memberships.some((membership) => membership.projectRole === 'editor')
      ).length,
      viewers: members.filter((member) =>
        member.memberships.every((membership) => membership.projectRole === 'viewer')
      ).length,
    },
  };
}

export async function assertProjectAccess(projectUuid, userUuid) {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(userUuid),
    },
    select: { id: true, uuid: true, workspaceId: true, createdBy: true },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado ou sem permissÃ£o de acesso.');
  }

  return project;
}

export async function assertTaskAccess(taskUuid, userUuid) {
  const task = await prisma.task.findFirst({
    where: {
      uuid: taskUuid,
      project: {
        is: buildProjectAccessFilter(userUuid),
      },
    },
    select: { id: true, uuid: true, projectId: true },
  });

  if (!task) {
    throw new Error('Tarefa nÃ£o encontrada ou sem permissÃ£o de acesso.');
  }

  return task;
}

export async function listProjects(userUuid = null) {
  const projects = await prisma.project.findMany({
    where: buildProjectAccessFilter(userUuid),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      uuid: true,
      name: true,
      slug: true,
      description: true,
      vision: true,
      createdAt: true,
      updatedAt: true,
      startMode: true,
      templateKey: true,
      intakeConfig: true,
      workspace: {
        select: {
          uuid: true,
          name: true,
          slug: true,
          ownerUser: {
            select: { uuid: true },
          },
        },
      },
      creator: {
        select: { uuid: true, name: true, email: true },
      },
      ...(userUuid
        ? {
            members: {
              where: {
                user: {
                  is: {
                    uuid: userUuid,
                  },
                },
              },
              include: {
                user: {
                  select: { uuid: true },
                },
              },
            },
          }
        : {}),
      _count: {
        select: { tasks: true, agentRuns: true },
      },
    },
  });

  return projects.map((project) => enrichProjectAccess(project, userUuid));
}

export async function bootstrapWorkspaceAndUser({ userName, email, workspaceName, passwordHash = null, failIfUserExists = false }) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedWorkspaceName = workspaceName?.trim() || 'Meu Workspace';
  const workspaceSlug =
    normalizedWorkspaceName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 150) || `workspace-${randomUUID().slice(0, 8)}`;

  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      user = await tx.user.create({
        data: {
          uuid: randomUUID(),
          name: userName.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'owner',
          status: 'active',
        },
      });
    } else {
      if (failIfUserExists) {
        throw new Error('JÃ¡ existe um usuÃ¡rio com este e-mail.');
      }

      if (!user.passwordHash && passwordHash) {
        user = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
      }
    }

    let workspace = await tx.workspace.findFirst({
      where: {
        ownerUserId: user.id,
        name: normalizedWorkspaceName,
      },
    });

    if (!workspace) {
      let uniqueSlug = workspaceSlug;
      let suffix = 1;

      while (
        await tx.workspace.findFirst({
          where: { slug: uniqueSlug },
          select: { id: true },
        })
      ) {
        suffix += 1;
        uniqueSlug = `${workspaceSlug}-${suffix}`;
      }

      workspace = await tx.workspace.create({
        data: {
          uuid: randomUUID(),
          name: normalizedWorkspaceName,
          slug: uniqueSlug,
          ownerUserId: user.id,
        },
      });
    }

    return { user, workspace };
  });
}

export async function getProjectByUuid(projectUuid, userUuid = null) {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(userUuid),
    },
    select: {
      id: true,
      uuid: true,
      name: true,
      slug: true,
      description: true,
      vision: true,
      startMode: true,
      templateKey: true,
      intakeConfig: true,
      workspace: {
        select: {
          uuid: true,
          name: true,
          slug: true,
          ownerUser: {
            select: { uuid: true },
          },
        },
      },
      creator: {
        select: { uuid: true, name: true, email: true },
      },
      members: {
        include: {
          user: {
            select: { uuid: true, name: true, email: true },
          },
        },
      },
      tasks: {
        where: {
          taskType: {
            not: 'agent_job',
          },
        },
        orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
        include: {
          _count: {
            select: { artifacts: true, comments: true, checklistItems: true },
          },
        },
      },
    },
  });

  return enrichProjectAccess(project, userUuid);
}

export async function updateProjectBrief(projectUuid, input = {}) {
  const existingProject = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { id: true, name: true, description: true, vision: true, templateKey: true, intakeConfig: true },
  });

  if (!existingProject) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const mergedIntakeConfig =
    input.intakeConfig !== undefined
      ? {
          ...(existingProject.intakeConfig || {}),
          ...input.intakeConfig,
        }
      : existingProject.intakeConfig || {};

  const resolvedTemplateKey =
    input.templateKey !== undefined
      ? input.templateKey?.trim() || null
      : existingProject.templateKey ||
        mergedIntakeConfig.projectTemplateKey ||
        inferProjectTemplateKey({
          projectName: existingProject.name,
          description: input.description !== undefined ? input.description : existingProject.description,
          vision: input.vision !== undefined ? input.vision : existingProject.vision,
          idea: mergedIntakeConfig.idea,
          summary: mergedIntakeConfig.objective,
        });

  const resolvedProjectDna = buildProjectDna({
    name: existingProject.name,
    description: input.description !== undefined ? input.description : existingProject.description,
    vision: input.vision !== undefined ? input.vision : existingProject.vision,
    templateKey: resolvedTemplateKey,
    intakeConfig: mergedIntakeConfig,
  });

  const project = await prisma.project.update({
    where: { uuid: projectUuid },
    data: {
      description: input.description !== undefined ? input.description?.trim() || null : undefined,
      vision: input.vision !== undefined ? input.vision?.trim() || null : undefined,
      templateKey: resolvedTemplateKey,
      intakeConfig:
        input.intakeConfig !== undefined
          ? {
              ...mergedIntakeConfig,
              projectDna: resolvedProjectDna,
              projectTemplateKey: resolvedTemplateKey || mergedIntakeConfig.projectTemplateKey || null,
            }
          : {
              ...(existingProject.intakeConfig || {}),
              projectDna: resolvedProjectDna,
            },
    },
  });

  await persistProjectDnaArtifact(projectUuid, project, resolvedProjectDna);

  return project;
}

const allowedProjectStatuses = new Set(['draft', 'active', 'on_hold', 'completed', 'archived']);

export async function updateProjectStatus(projectUuid, nextStatus, actorUserUuid) {
  const resolvedStatus = String(nextStatus || '').trim();
  if (!allowedProjectStatuses.has(resolvedStatus)) {
    throw new Error('Status de projeto invalido.');
  }

  await assertProjectPermission(projectUuid, actorUserUuid, 'manager');
  const currentProject = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { uuid: true, status: true, name: true },
  });

  if (!currentProject) {
    throw new Error('Projeto nao encontrado.');
  }

  if (currentProject.status === resolvedStatus) {
    return getProjectByUuid(projectUuid, actorUserUuid);
  }

  await prisma.project.update({
    where: { uuid: projectUuid },
    data: {
      status: resolvedStatus,
    },
  });

  return getProjectByUuid(projectUuid, actorUserUuid);
}

export async function deleteProject(projectUuid, actorUserUuid) {
  await assertProjectPermission(projectUuid, actorUserUuid, 'owner');

  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: {
      id: true,
      uuid: true,
      generatedApps: {
        select: {
          rootPath: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error('Projeto nao encontrado.');
  }

  await prisma.project.delete({
    where: { id: project.id },
  });

  const cleanupResults = await Promise.allSettled(
    (project.generatedApps || [])
      .filter((generatedApp) => generatedApp?.rootPath)
      .map((generatedApp) => removeGeneratedProjectRootIfSafe(generatedApp.rootPath, project.uuid))
  );

  cleanupResults
    .filter((result) => result.status === 'rejected')
    .forEach((result) => {
      logWarn(
        { projectUuid: project.uuid, error: result.reason?.message || String(result.reason || '') },
        'Project generated directory cleanup failed after delete.'
      );
    });

  return { deleted: true, projectUuid: project.uuid };
}

export async function addProjectMember(projectUuid, { email, projectRole = 'editor' }, actorUserUuid) {
  const access = await assertProjectPermission(projectUuid, actorUserUuid, 'manager');
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('Informe o e-mail do membro que deve entrar no projeto.');
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, uuid: true, name: true, email: true },
  });

  if (!user) {
    throw new Error('Nenhum usuÃ¡rio encontrado com este e-mail.');
  }

  const existingMember = await prisma.projectMember.findFirst({
    where: {
      projectId: access.id,
      userId: user.id,
    },
    select: { id: true },
  });

  if (existingMember) {
    throw new Error('Este usuÃ¡rio jÃ¡ faz parte do projeto.');
  }

  await prisma.projectMember.create({
    data: {
      projectId: access.id,
      userId: user.id,
      projectRole,
    },
  });

  return getProjectByUuid(projectUuid, actorUserUuid);
}

export async function updateProjectMemberRole(projectUuid, memberUuid, { projectRole }, actorUserUuid) {
  const access = await assertProjectPermission(projectUuid, actorUserUuid, 'manager');

  const member = await prisma.projectMember.findFirst({
    where: {
      project: {
        is: {
          id: access.id,
        },
      },
      user: {
        is: {
          uuid: memberUuid,
        },
      },
    },
    include: {
      user: {
        select: { uuid: true },
      },
    },
  });

  if (!member) {
    throw new Error('Membro nÃ£o encontrado neste projeto.');
  }

  const actorRole = access.currentUserRole;
  if (member.projectRole === 'owner' && actorRole !== 'owner') {
    throw new Error('Somente o owner do projeto pode alterar outro owner.');
  }

  await prisma.projectMember.update({
    where: { id: member.id },
    data: { projectRole },
  });

  return getProjectByUuid(projectUuid, actorUserUuid);
}

export async function removeProjectMember(projectUuid, memberUuid, actorUserUuid) {
  const access = await assertProjectPermission(projectUuid, actorUserUuid, 'manager');

  const member = await prisma.projectMember.findFirst({
    where: {
      project: {
        is: {
          id: access.id,
        },
      },
      user: {
        is: {
          uuid: memberUuid,
        },
      },
    },
    include: {
      user: {
        select: { uuid: true },
      },
    },
  });

  if (!member) {
    throw new Error('Membro nÃ£o encontrado neste projeto.');
  }

  const ownerCount = await prisma.projectMember.count({
    where: {
      projectId: access.id,
      projectRole: 'owner',
    },
  });

  if (member.projectRole === 'owner' && ownerCount <= 1) {
    throw new Error('O projeto precisa manter pelo menos um owner.');
  }

  if (member.projectRole === 'owner' && access.currentUserRole !== 'owner') {
    throw new Error('Somente o owner do projeto pode remover outro owner.');
  }

  await prisma.projectMember.delete({
    where: { id: member.id },
  });

  return getProjectByUuid(projectUuid, actorUserUuid);
}

export async function createProject({
  workspaceUuid,
  createdByUuid,
  name,
  description,
  vision,
  startMode,
  templateKey,
  intakeConfig,
  boardConfig,
  agentsConfig,
  automationConfig,
  status,
  forcedUuid,
}) {
  const [workspace, user] = await Promise.all([
    prisma.workspace.findUnique({ where: { uuid: workspaceUuid } }),
    prisma.user.findUnique({ where: { uuid: createdByUuid } }),
  ]);

  if (!workspace) {
    throw new Error('Workspace nÃ£o encontrado.');
  }

  if (!user) {
    throw new Error('UsuÃ¡rio criador nÃ£o encontrado.');
  }

  const slugBase =
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 150) || `projeto-${randomUUID().slice(0, 8)}`;

  let slug = slugBase;
  let suffix = 1;

  while (
    await prisma.project.findFirst({
      where: { workspaceId: workspace.id, slug },
      select: { id: true },
    })
  ) {
    suffix += 1;
    slug = `${slugBase}-${suffix}`;
  }

  const resolvedTemplateKey =
    templateKey?.trim() ||
    inferProjectTemplateKey({
      projectName: name,
      description,
      vision,
      idea: intakeConfig?.idea,
      summary: intakeConfig?.objective,
    });

  const normalizedIntakeConfig =
    intakeConfig !== undefined
      ? {
          ...(intakeConfig || {}),
          projectTemplateKey: resolvedTemplateKey || intakeConfig?.projectTemplateKey || null,
        }
      : {};

  const projectDna = buildProjectDna({
    name,
    description,
    vision,
    templateKey: resolvedTemplateKey,
    intakeConfig: normalizedIntakeConfig,
  });

  const project = await prisma.project.create({
    data: {
      uuid: forcedUuid || randomUUID(),
      workspaceId: workspace.id,
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      vision: vision?.trim() || null,
      startMode: startMode?.trim() || null,
      templateKey: resolvedTemplateKey || null,
      intakeConfig: {
        ...normalizedIntakeConfig,
        projectDna,
      },
      boardConfig: boardConfig ?? undefined,
      agentsConfig: agentsConfig ?? undefined,
      automationConfig: automationConfig ?? undefined,
      status: status || 'draft',
      createdBy: user.id,
      members: {
        create: {
          userId: user.id,
          projectRole: 'owner',
        },
      },
    },
    include: {
      workspace: {
        select: { uuid: true, name: true, slug: true },
      },
      creator: {
        select: { uuid: true, name: true, email: true },
      },
    },
  });

  await persistProjectDnaArtifact(project.uuid, project, projectDna);

  return project;
}

export async function listProjectTasks(projectUuid, { status, parentTaskUuid } = {}, userUuid = null) {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(userUuid),
    },
    select: { id: true },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  // Reconcile legacy QA approvals so the board immediately places them in A Fazer.
  const legacyArchitectureTasks = await prisma.task.findMany({
    where: {
      projectId: project.id,
      status: 'in_review',
      assigneeAgentName: 'architect',
      artifacts: { some: { isCurrent: true, artifactScope: 'refinement', artifactType: { in: QA_ARTIFACT_TYPES }, isApproved: true } },
    },
    select: { id: true },
  });
  if (legacyArchitectureTasks.length) {
    await prisma.task.updateMany({ where: { id: { in: legacyArchitectureTasks.map((item) => item.id) } }, data: { status: 'done' } });
  }
  const legacyQaTasks = await prisma.task.findMany({
    where: {
      projectId: project.id,
      status: { in: ['backlog', 'in_review'] },
      AND: [
        { artifacts: { some: { isCurrent: true, artifactScope: 'refinement', artifactType: 'requirements', isApproved: true } } },
        { artifacts: { none: { isCurrent: true, artifactScope: 'refinement', artifactType: { in: QA_ARTIFACT_TYPES } } } },
      ],
    },
    select: { id: true },
  });
  if (legacyQaTasks.length) {
    await prisma.task.updateMany({ where: { id: { in: legacyQaTasks.map((item) => item.id) } }, data: { status: 'qa', assigneeAgentName: 'qa_engineer', assigneeType: 'agent' } });
  }

  let parentTaskId;
  if (parentTaskUuid) {
    const parentTask = await prisma.task.findUnique({
      where: { uuid: parentTaskUuid },
      select: { id: true, projectId: true },
    });

    if (!parentTask || parentTask.projectId !== project.id) {
      throw new Error('Tarefa pai nÃ£o encontrada neste projeto.');
    }
    parentTaskId = parentTask.id;
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId: project.id,
      taskType: {
        not: 'agent_job',
      },
      ...(status ? { status } : {}),
      ...(parentTaskUuid ? { parentTaskId } : {}),
    },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    include: {
      ...taskListInclude,
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  const agentAliases = userUuid ? (await getAiSettingsForUser(userUuid)).agentAliases : DEFAULT_AI_SETTINGS.agentAliases;
  return tasks.map((task) => enrichTask(task, agentAliases));
}

export async function listAllTasks({ status } = {}, userUuid = null) {
  const tasks = await prisma.task.findMany({
    where: {
      taskType: {
        not: 'agent_job',
      },
      ...(status ? { status } : {}),
      project: {
        is: buildProjectAccessFilter(userUuid),
      },
    },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    include: {
      ...taskListInclude,
      project: {
        select: { uuid: true, name: true, slug: true },
      },
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  const agentAliases = userUuid ? (await getAiSettingsForUser(userUuid)).agentAliases : DEFAULT_AI_SETTINGS.agentAliases;
  return tasks.map((task) => enrichTask(task, agentAliases));
}

export async function getTaskByUuid(taskUuid, userUuid = null) {
  const task = await prisma.task.findFirst({
    where: {
      uuid: taskUuid,
      ...(userUuid
        ? {
            project: {
              is: buildProjectAccessFilter(userUuid),
            },
          }
        : {}),
    },
    include: taskDetailInclude,
  });

  // One-time reconciliation for tasks approved before QA->architecture used
  // the `todo` state. This keeps legacy records consistent on the next read.
  if (task?.status === 'in_review' && task.assigneeAgentName === 'architect') {
    const approvedQa = (task.artifacts || []).some(
      (artifact) => artifact.isCurrent && QA_ARTIFACT_TYPES.includes(artifact.artifactType) && artifact.isApproved
    );
    if (approvedQa) {
      await prisma.task.update({ where: { id: task.id }, data: { status: 'done' } });
      task.status = 'done';
    }
  }

  const agentAliases = userUuid ? (await getAiSettingsForUser(userUuid)).agentAliases : DEFAULT_AI_SETTINGS.agentAliases;
  const enrichedTask = enrichTask(task, agentAliases);

  if (enrichedTask?.project) {
    enrichedTask.project = enrichProjectAccess(enrichedTask.project, userUuid);
  }

  return enrichedTask;
}

export async function createTask(projectUuid, input) {
  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { id: true },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const [creator, reporter, assigneeUser, parentTask] = await Promise.all([
    prisma.user.findUnique({
      where: { uuid: input.createdByUuid },
      select: { id: true },
    }),
    input.reporterUserUuid
      ? prisma.user.findUnique({ where: { uuid: input.reporterUserUuid }, select: { id: true } })
      : Promise.resolve(null),
    input.assigneeUserUuid
      ? prisma.user.findUnique({ where: { uuid: input.assigneeUserUuid }, select: { id: true } })
      : Promise.resolve(null),
    input.parentTaskUuid
      ? prisma.task.findUnique({
          where: { uuid: input.parentTaskUuid },
          select: { id: true, projectId: true },
        })
      : Promise.resolve(null),
  ]);

  if (!creator) {
    throw new Error('UsuÃ¡rio criador da tarefa nÃ£o encontrado.');
  }

  if (input.reporterUserUuid && !reporter) {
    throw new Error('UsuÃ¡rio reporter nÃ£o encontrado.');
  }

  if (input.assigneeUserUuid && !assigneeUser) {
    throw new Error('UsuÃ¡rio responsÃ¡vel nÃ£o encontrado.');
  }

  if (input.parentTaskUuid && (!parentTask || parentTask.projectId !== project.id)) {
    throw new Error('Tarefa pai nÃ£o encontrada neste projeto.');
  }

  const task = await prisma.task.create({
    data: {
      uuid: randomUUID(),
      projectId: project.id,
      parentTaskId: parentTask?.id || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      taskType: input.taskType || 'task',
      status: input.status || 'backlog',
      priority: input.priority || 'medium',
      assigneeType:
        input.assigneeType ||
        (input.assigneeAgentName ? 'agent' : input.assigneeUserUuid ? 'human' : 'unassigned'),
      assigneeUserId: assigneeUser?.id || null,
      assigneeAgentName: input.assigneeAgentName || null,
      reporterUserId: reporter?.id || null,
      position: input.position ?? 0,
      storyPoints: input.storyPoints ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdBy: creator.id,
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: input.status || 'backlog',
          changedByUserId: creator.id,
          note: 'Tarefa criada',
        },
      },
    },
    include: {
      ...taskListInclude,
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return enrichTask(task);
}

export async function updateTask(taskUuid, input) {
  const existingTask = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: {
      id: true,
      status: true,
      projectId: true,
      artifacts: {
        where: { isCurrent: true },
        select: {
          artifactType: true,
          isCurrent: true,
        },
      },
    },
  });

  if (!existingTask) {
    throw new Error('Tarefa nÃ£o encontrada.');
  }

  const [assigneeUser, reporterUser, changedByUser, parentTask] = await Promise.all([
    input.assigneeUserUuid
      ? prisma.user.findUnique({ where: { uuid: input.assigneeUserUuid }, select: { id: true } })
      : Promise.resolve(undefined),
    input.reporterUserUuid
      ? prisma.user.findUnique({ where: { uuid: input.reporterUserUuid }, select: { id: true } })
      : Promise.resolve(undefined),
    input.changedByUserUuid
      ? prisma.user.findUnique({ where: { uuid: input.changedByUserUuid }, select: { id: true } })
      : Promise.resolve(null),
    input.parentTaskUuid
      ? prisma.task.findUnique({
          where: { uuid: input.parentTaskUuid },
          select: { id: true, projectId: true },
        })
      : Promise.resolve(undefined),
  ]);

  if (input.assigneeUserUuid && !assigneeUser) {
    throw new Error('UsuÃ¡rio responsÃ¡vel nÃ£o encontrado.');
  }

  if (input.reporterUserUuid && !reporterUser) {
    throw new Error('UsuÃ¡rio reporter nÃ£o encontrado.');
  }

  if (input.parentTaskUuid && (!parentTask || parentTask.projectId !== existingTask.projectId)) {
    throw new Error('Tarefa pai nÃ£o encontrada neste projeto.');
  }

  const data = {};

  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.taskType !== undefined) data.taskType = input.taskType;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.position !== undefined) data.position = input.position;
  if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.parentTaskUuid !== undefined) data.parentTaskId = parentTask?.id || null;
  if (input.reporterUserUuid !== undefined) data.reporterUserId = reporterUser?.id || null;
  if (input.assigneeUserUuid !== undefined) data.assigneeUserId = assigneeUser?.id || null;
  if (input.assigneeAgentName !== undefined) data.assigneeAgentName = input.assigneeAgentName || null;
  if (input.assigneeType !== undefined) data.assigneeType = input.assigneeType;

  const nextStatus = input.status;
  const statusChanged = nextStatus && nextStatus !== existingTask.status;

  if (statusChanged) {
    validateTaskStatusTransition(existingTask, nextStatus);
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.task.update({
        where: { id: existingTask.id },
        data: {
          ...data,
          ...(statusChanged
            ? {
                status: nextStatus,
                startedAt:
                  nextStatus === 'in_progress' && !['in_progress', 'done'].includes(existingTask.status)
                    ? new Date()
                    : undefined,
                completedAt: nextStatus === 'done' ? new Date() : nextStatus !== 'done' ? null : undefined,
              }
            : {}),
        },
      });

      if (statusChanged) {
        await tx.taskStatusHistory.create({
          data: {
            taskId: existingTask.id,
            fromStatus: existingTask.status,
            toStatus: nextStatus,
            changedByUserId: changedByUser?.id || null,
            note: input.statusNote || 'Status atualizado via API',
          },
        });
      }
    },
    {
      timeout: 15000,
    }
  );

  const updatedTask = await prisma.task.findUnique({
    where: { id: existingTask.id },
    include: {
      ...taskListInclude,
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return enrichTask(updatedTask);
}

export async function createTaskComment(taskUuid, input) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: { id: true },
  });

  if (!task) {
    throw new Error('Tarefa nÃ£o encontrada.');
  }

  let authorUser = null;
  if (input.authorUserUuid) {
    authorUser = await prisma.user.findUnique({
      where: { uuid: input.authorUserUuid },
      select: { id: true },
    });

    if (!authorUser) {
      throw new Error('UsuÃ¡rio autor nÃ£o encontrado.');
    }
  }

  return prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorUserId: authorUser?.id || null,
      authorAgentName: input.authorAgentName || null,
      body: input.body.trim(),
    },
    include: {
      authorUser: { select: { uuid: true, name: true, email: true } },
    },
  });
}

async function ensureSystemWorkspaceAndUser() {
  const email = 'system@factory.local';
  const workspaceName = 'Pipeline Workspace';

  const result = await bootstrapWorkspaceAndUser({
    userName: 'Aligna System',
    email,
    workspaceName,
  });

  return result;
}

function derivePipelineProjectName(idea) {
  const text = String(idea || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Projeto de Pipeline';

  const instructionPatterns = [
    /^atue como\b/i,
    /^refine\b/i,
    /^gere\b/i,
    /^crie\b/i,
    /^analise\b/i,
    /^baseado na historia\b/i,
    /^baseado na história\b/i,
    /^historia de usuario\b/i,
    /^história de usuário\b/i,
  ];

  if (instructionPatterns.some((pattern) => pattern.test(text))) {
    return 'Projeto de Pipeline';
  }

  return text.slice(0, 120);
}

export async function ensurePipelineProject(projectUuid, idea = 'Pipeline Project', userUuid = null) {
  const existingProject = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { id: true, uuid: true },
  });

  if (existingProject) {
    if (userUuid) {
      await assertProjectAccess(projectUuid, userUuid);
    }
    return existingProject;
  }

  let user = null;
  let workspace = null;

  if (userUuid) {
    const authUser = await prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { uuid: true },
    });

    if (!authUser) {
      throw new Error('UsuÃ¡rio autenticado nÃ£o encontrado.');
    }

    workspace = await getDefaultWorkspaceForUserUuid(userUuid);
    if (!workspace?.uuid) {
      throw new Error('Nenhum workspace disponivel para criar o projeto de pipeline.');
    }

    user = authUser;
  } else {
    const systemContext = await ensureSystemWorkspaceAndUser();
    user = systemContext.user;
    workspace = systemContext.workspace;
  }

  return createProject({
    workspaceUuid: workspace.uuid,
    createdByUuid: user.uuid,
    name: derivePipelineProjectName(idea),
    description: 'Projeto criado automaticamente pelo pipeline.',
    vision: String(idea || 'Pipeline Project').slice(0, 500),
    status: 'active',
    forcedUuid: projectUuid,
  });
}

function normalizeBacklogLine(line) {
  return String(line || '')
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStoryTitle(line) {
  const normalized = normalizeBacklogLine(line);
  const withPrefix = normalized.match(/^(?:US-\d+|H\d+|Story-\d+|\d+)\s*\|\s*(Como\b.+)$/i);
  if (withPrefix) {
    return withPrefix[1].trim();
  }

  if (/^Como\b/i.test(normalized) && normalized.includes('eu quero')) {
    return normalized;
  }

  return null;
}

function normalizeStoryDetailLine(line) {
  return String(line || '')
    .replace(/^(?:descricao|contexto|detalhe)\s*[:\-]\s*/i, '')
    // Rendering metadata is useful in the source Markdown but is not story
    // content. Keeping it here leaked internal tags to the review cards.
    .replace(/\s*\[capacidades:\s*[^\]]*\]\s*$/i, '')
    .replace(/^revisao\s*:\s*\[[^\]]*\]\s*$/i, '')
    .trim();
}

function extractStoriesFromBacklog(backlogMarkdown) {
  if (!backlogMarkdown) return [];

  return backlogMarkdown
    .split('\n')
    .map((line) => parseStoryTitle(line))
    .filter(Boolean);
}

function extractStorySectionContent(backlogMarkdown) {
  const sectionTitles = [
    'Historias de Usuario',
    'Histórias de Usuário',
    'User Stories',
    'User Story',
    'Stories',
  ];

  for (const title of sectionTitles) {
    const section = extractMarkdownSection(backlogMarkdown, title);
    if (section) return section;
  }

  return String(backlogMarkdown || '');
}

function extractStructuredStoriesFromBacklog(sectionContent) {
  if (!sectionContent) return [];

  const stories = [];
  const lines = String(sectionContent).split('\n');
  let currentStory = null;

  function pushCurrentStory() {
    if (!currentStory?.title) return;
    const description = currentStory.details
      .map((item) => normalizeStoryDetailLine(item))
      .filter(Boolean)
      .join('\n')
      .trim();
    stories.push({
      title: currentStory.title.trim(),
      description: description || null,
    });
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentStory) {
        currentStory.details.push('');
      }
      continue;
    }

    if (/^FIM_DO_BACKLOG$/i.test(line)) {
      continue;
    }

    const title = parseStoryTitle(line);
    if (title) {
      pushCurrentStory();
      currentStory = {
        title,
        details: [],
      };
      continue;
    }

    if (currentStory) {
      const cleaned = normalizeStoryDetailLine(line.replace(/^[-*]\s+/, '').trim());
      currentStory.details.push(cleaned);
    }
  }

  pushCurrentStory();
  return stories.filter((story) => story.title);
}

function extractMarkdownSection(content, sectionTitle) {
  const text = String(content || '');
  if (!text.trim()) return '';
  const normalizeHeading = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[ \t]+/g, ' ')
      .trim();

  const targetHeading = normalizeHeading(sectionTitle);
  const lines = text.split('\n');
  let capture = false;
  let captureLevel = null;
  const captured = [];

  for (const rawLine of lines) {
    const line = String(rawLine || '').replace(/\r/g, '');
    const headingMatch = line.match(/^\s*(#{2,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const currentHeading = normalizeHeading(headingMatch[2]);
      if (capture && level <= captureLevel) {
        break;
      }
      if (currentHeading === targetHeading) {
        capture = true;
        captureLevel = level;
      } else if (capture) {
        // Nested headings delimit BDD scenarios and must remain available to
        // the contract parser. Dropping them merged every scenario into CA-01.
        captured.push(line);
      }
      continue;
    }

    if (capture) {
      captured.push(line);
    }
  }

  return captured.join('\n').trim();
}

function extractBulletLines(sectionContent, { onlyStories = false } = {}) {
  if (!sectionContent) return [];

  return String(sectionContent)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]?\s*\d*\.?\s*(?:\*\*)?/.test(line))
    .map((line) => line.replace(/^[-*]?\s*\d*\.?\s*(?:\*\*)?/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .filter((line) => {
      if (!onlyStories) return true;
      return /^(?:US-\d+\s*\|\s*)?Como\b/i.test(line);
    })
    .map((line) => line.replace(/^US-\d+\s*\|\s*/i, '').trim());
}

function extractBacklogItems(backlogMarkdown) {
  if (!backlogMarkdown) {
    return { stories: [] };
  }

  const structuredStories = extractStructuredStoriesFromBacklog(extractStorySectionContent(backlogMarkdown));
  const stories = structuredStories.length
    ? structuredStories
    : extractStoriesFromBacklog(backlogMarkdown).map((title) => ({ title, description: null }));

  return {
    stories,
  };
}

function normalizeBacklogContractList(items = []) {
  return items
    .map((item) => String(item || '').replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .filter((item) => !/^[-–—]{2,}$/.test(item))
    .filter((item) => !/^fim_do_/i.test(item));
}

function cleanMarkdownListLine(line) {
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[a-z]?\.\s+/, '')
    .replace(/^\*\*([^*]+)\*\*:\s*/, '$1: ')
    .replace(/^\*\*([^*]+)\*\*$/, '$1')
    .replace(/\*\*/g, '')
    .trim();
}

function extractSectionLines(sectionContent, options = {}) {
  if (!sectionContent) return [];

  const {
    stripNumbering = false,
    keepScenarioLabels = true,
  } = options;

  return normalizeBacklogContractList(
    String(sectionContent)
      .split('\n')
      .map((line) => {
        let cleaned = cleanMarkdownListLine(line);
        if (!keepScenarioLabels) {
          cleaned = cleaned.replace(/^(cenario\s+\d+:\s*)/i, '');
        }
        if (stripNumbering) {
          cleaned = cleaned.replace(/^\d+[a-z]?\.\s*/, '');
          cleaned = cleaned.replace(/^\d+[a-z]?\)\s*/, '');
        }
        return cleaned.trim();
      })
      .filter(Boolean)
  );
}

function extractRequirementFlowLines(sectionContent) {
  return extractSectionLines(sectionContent, { stripNumbering: true }).filter(
    (line) => !/^fluxo[s]?\s+/i.test(line)
  );
}

function normalizeSectionComparableText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractPlainSectionText(sectionContent) {
  return normalizeBacklogContractList(
    String(sectionContent || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => cleanMarkdownListLine(line).trim())
      .filter(Boolean)
  ).join(' ');
}

function extractAcceptanceCriteria(sectionContent) {
  const normalizedSection = String(sectionContent || '')
    .replace(/\r/g, '')
    .replace(/\b(Cen[aá]rio\s+\d+:)/gi, '\n$1')
    .replace(/\b(DADO|QUANDO|ENTAO|ENTÃO|E)\b/g, '\n$1');

  const lines = extractSectionLines(normalizedSection, { stripNumbering: false });
  const scenarios = [];
  let current = [];

  const flushCurrent = () => {
    if (!current.length) return;
    scenarios.push(current.join(' '));
    current = [];
  };

  for (const line of lines) {
    if (/^cenario\s+\d+/i.test(line)) {
      flushCurrent();
      current = [line];
      continue;
    }
    if (/^(dado|quando|entao|e)\b/i.test(line)) {
      if (!current.length) {
        current = [line];
      } else {
        current.push(line);
      }
      continue;
    }
    if (!current.length) {
      current = [line];
    } else {
      current.push(line);
    }
  }

  flushCurrent();
  return normalizeBacklogContractList(scenarios);
}

function extractAcceptanceCriteriaRobust(sectionContent) {
  const compactSource = String(sectionContent || '').replace(/\r/g, '').replace(/\\\s*$/gm, '');
  const bddBlocks = [...compactSource.matchAll(
    /\*\*DADO\*\*\s*([\s\S]*?)\s*\*\*QUANDO\*\*\s*([\s\S]*?)\s*\*\*ENTAO\*\*\s*([\s\S]*?)(?=\s*\*\*DADO\*\*|\r?\n\s*#{3,6}\s+cenario\s+\d+\b|(?![\s\S]))/gim
  )]
    .map((match) => `DADO ${match[1]} QUANDO ${match[2]} ENTAO ${match[3]}`.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (bddBlocks.length) return normalizeBacklogContractList(bddBlocks);

  const headingScenarios = [];
  let currentHeadingScenario = [];
  const flushHeadingScenario = () => {
    const scenario = currentHeadingScenario
      .map((line) => cleanMarkdownListLine(line).trim())
      .filter((line) => line && !/^nenhum cenario de excecao confirmado/i.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/\bDADO\b/i.test(scenario) && /\bQUANDO\b/i.test(scenario) && /\bENTAO\b/i.test(scenario)) {
      headingScenarios.push(scenario);
    }
    currentHeadingScenario = [];
  };
  for (const line of compactSource.split('\n')) {
    if (/^\s*#{3,6}\s+cenario\s+\d+\b/i.test(line)) {
      flushHeadingScenario();
      continue;
    }
    if (currentHeadingScenario.length || /\b(?:DADO|QUANDO|ENTAO)\b/i.test(line)) {
      currentHeadingScenario.push(line);
    }
  }
  flushHeadingScenario();
  if (headingScenarios.length) return normalizeBacklogContractList(headingScenarios);

  const directScenarios = [...compactSource.matchAll(
    /^\s*#{3,6}\s+cenario\s+\d+(?:\s*[-–—:]\s*[^\n]+)?\s*\n([\s\S]*?)(?=^\s*#{3,6}\s+cenario\s+\d+\b|^##\s+|(?![\s\S]))/gim
  )]
    .map((match) => match[1]
      .split('\n')
      .map((line) => cleanMarkdownListLine(line).trim())
      .filter((line) => line && !/^nenhum cenario de excecao confirmado/i.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((scenario) => /\bDADO\b/i.test(scenario) && /\bQUANDO\b/i.test(scenario) && /\bENTAO\b/i.test(scenario));
  if (directScenarios.length) return normalizeBacklogContractList(directScenarios);

  const modernScenarios = String(sectionContent || '')
    .replace(/\r/g, '')
    .replace(/^\s*#{3,6}\s+(?:sucesso|exce[cç][oõ]es)\s*$/gim, '')
    // Keep compact BDD scenarios separate even when lines use Markdown
    // explicit-break escapes (\\). The older look-ahead required an exact
    // heading line and merged all criteria into one record in that format.
    .replace(/\\\s*$/gm, '')
    .split(/(?=^\s*#{3,6}\s+cenario\s+\d+(?:\s*[-–—:]\s*[^\n]+)?\s*$)/gim)
    .map((chunk) => chunk
      .split('\n')
      .map((line) => cleanMarkdownListLine(line).trim())
      .filter((line) => line && !/^nenhum cenario de excecao confirmado/i.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((scenario) => /\bDADO\b/i.test(scenario) && /\bQUANDO\b/i.test(scenario) && /\bENTAO\b/i.test(scenario));
  if (modernScenarios.length) return modernScenarios;

  const lines = String(sectionContent || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => cleanMarkdownListLine(line).trim())
    .filter(Boolean);
  const scenarios = [];
  let current = [];

  const flushCurrent = () => {
    if (!current.length) return;
    const cleanedScenario = current
      .join(' ')
      .replace(/\s+(?:---+|___+)\s*$/g, '')
      .replace(/\s+FIM_DO_[A-Z_]+\s*$/i, '')
      .trim();
    if (cleanedScenario) {
      scenarios.push(cleanedScenario);
    }
    current = [];
  };

  for (const line of lines) {
    const normalizedLine = normalizeSectionComparableText(line);

    if (/^cenario\s+\d+/.test(normalizedLine)) {
      flushCurrent();
      current = [line];
      continue;
    }

    if (/^(dado|quando|entao|e)\b/.test(normalizedLine)) {
      if (!current.length) {
        current = [line];
      } else {
        current.push(line);
      }
      continue;
    }

    if (!current.length) {
      current = [line];
    } else {
      current.push(line);
    }
  }

  flushCurrent();
  return normalizeBacklogContractList(scenarios);
}

function parseReleaseSlices(sectionContent) {
  if (!sectionContent) return [];

  const lines = String(sectionContent)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const slices = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s+/, '').trim();
    const match = cleaned.match(/^([^:]+):\s*(.+)$/);

    if (match) {
      slices.push({
        name: match[1].trim(),
        goal: match[2].trim(),
      });
      continue;
    }

    slices.push({
      name: cleaned,
      goal: null,
    });
  }

  return slices;
}

function buildBacklogContract(backlogMarkdown, projectDna = null, generatedContract = null) {
  const overview = extractMarkdownSection(backlogMarkdown, 'Visao Geral');
  const capabilities = normalizeBacklogContractList(
    extractBulletLines(extractMarkdownSection(backlogMarkdown, 'Capacidades do Produto'))
  );
  const epics = normalizeBacklogContractList(
    extractBulletLines(extractMarkdownSection(backlogMarkdown, 'Epicos Recomendados'))
  );
  const releaseSlices = parseReleaseSlices(extractMarkdownSection(backlogMarkdown, 'Fatias de Release'));
  const { stories } = extractBacklogItems(backlogMarkdown);
  const generatedCapabilities = Array.isArray(generatedContract?.capabilities)
    ? generatedContract.capabilities
    : [];
  const persistedCapabilities = generatedCapabilities.length
    ? generatedCapabilities.map((capability, index) => ({
      // Keep the PM's IDs (for example, CAP-01) because stories reference
      // them in capabilityIds. Re-numbering them here broke traceability and
      // made the quality gate report capabilities as uncovered.
      id: String(capability?.id || `cap_${index + 1}`),
      name: String(capability?.name || capability?.text || capabilities[index] || `Capacidade ${index + 1}`),
    }))
    : capabilities.map((name, index) => ({
      id: `cap_${index + 1}`,
      name,
    }));

  const baseContract = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'project_manager',
    projectDnaSnapshot: projectDna || null,
    overview: overview || null,
    capabilities: persistedCapabilities,
    epics: epics.map((name, index) => ({
      id: `epic_${index + 1}`,
      name,
    })),
    releaseSlices: releaseSlices.map((slice, index) => ({
      id: `slice_${index + 1}`,
      name: slice.name,
      goal: slice.goal,
    })),
    stories: stories.map((story, index) => ({
      // The PM contract owns the canonical story ID. Persisting a positional
      // `story_N` alias made BDD, dependencies and Quality Gate findings
      // point at a different identifier than the story shown to the user.
      id: String(generatedContract?.stories?.[index]?.id || `US-${String(index + 1).padStart(2, '0')}`).toUpperCase(),
      title: story.title,
      description: story.description || null,
      order: index + 1,
    })),
  };

  if (!generatedContract || typeof generatedContract !== 'object') return baseContract;
  const generatedStories = Array.isArray(generatedContract.stories) ? generatedContract.stories : [];
  const storyMetadataById = new Map(generatedStories.map((story) => [String(story?.id || '').toUpperCase(), story]));
  const persistedIdByGeneratedId = new Map(
    baseContract.stories.map((story) => [String(story.id).toUpperCase(), story.id])
  );
  const persistedStories = baseContract.stories.map((story, index) => {
    const metadata = storyMetadataById.get(String(story.id).toUpperCase()) || generatedStories[index] || {};
    const sourceContext = metadata.refinement_context && typeof metadata.refinement_context === 'object'
      ? metadata.refinement_context
      : { inputs: [], outputs: [], confirmed_rules: [], constraints: [], dependencies: [], open_questions: [], acceptance_hints: [], acceptance_criteria: [] };
    const refinementContext = {
      ...sourceContext,
      dependencies: Array.isArray(sourceContext.dependencies)
        ? sourceContext.dependencies.map((id) => persistedIdByGeneratedId.get(String(id).toUpperCase()) || String(id))
        : [],
    };
    if (sourceContext.traceability && typeof sourceContext.traceability === 'object') {
      refinementContext.traceability = {
        ...sourceContext.traceability,
        dependencies: Array.isArray(sourceContext.traceability.dependencies)
          ? sourceContext.traceability.dependencies.map((item) => ({
            ...item,
            text: persistedIdByGeneratedId.get(String(item?.text || '').toUpperCase()) || item?.text,
          }))
          : [],
      };
    }
    const rawPmHandoff = sourceContext.pm_handoff || sourceContext.pmHandoff;
    if (rawPmHandoff && typeof rawPmHandoff === 'object') {
      const { related_stories: _relatedStoriesSnake, relatedStories: _relatedStoriesCamel, ...pmHandoffBase } = rawPmHandoff;
      refinementContext.pmHandoff = {
        ...pmHandoffBase,
        relatedStories: Array.isArray(_relatedStoriesSnake || _relatedStoriesCamel)
          ? (_relatedStoriesSnake || _relatedStoriesCamel).map((item) => ({
            ...item,
            story_id: persistedIdByGeneratedId.get(String(item?.story_id || item?.storyId || '').toUpperCase())
              || item?.story_id || item?.storyId || null,
          })).filter((item) => item.story_id)
          : [],
      };
    }
    return {
      ...story,
      actor: metadata.actor || null,
      goal: metadata.goal || null,
      benefit: metadata.benefit || null,
      sourceIds: Array.isArray(metadata.source_ids) ? metadata.source_ids : [],
      capabilityIds: Array.isArray(metadata.capability_ids) ? metadata.capability_ids : [],
      status: metadata.status || 'proposed',
      lane: metadata.lane || null,
      priority: ['low', 'medium', 'high', 'urgent'].includes(metadata.priority) ? metadata.priority : 'medium',
      release: metadata.release || null,
      reviewTags: Array.isArray(metadata.review_tags) ? metadata.review_tags : ['REVIEW_EVIDENCE'],
      openQuestions: Array.isArray(metadata.open_questions) ? metadata.open_questions : [],
      refinementContext,
    };
  });
  const coverage = Array.isArray(generatedContract.coverage)
    ? generatedContract.coverage.map((item) => ({
      ...item,
      story_ids: Array.isArray(item?.story_ids)
        ? item.story_ids.map((id) => persistedIdByGeneratedId.get(String(id).toUpperCase())).filter(Boolean)
        : [],
    })).filter((item) => item.story_ids.length)
    : [];
  return {
    ...baseContract,
    version: 2,
    evidence: generatedContract.evidence || { facts: [] },
    requirementsContract: generatedContract.requirements_contract || null,
    qualityReview: generatedContract.quality_review || null,
    handoff: generatedContract.handoff || null,
    policyRegistry: Array.isArray(generatedContract.policy_registry)
      ? generatedContract.policy_registry.map((policy) => ({
        ...policy,
        applies_to_story_ids: Array.isArray(policy?.applies_to_story_ids)
          ? policy.applies_to_story_ids
            .map((id) => persistedIdByGeneratedId.get(String(id).toUpperCase()))
            .filter(Boolean)
          : [],
      }))
      : [],
    coverage,
    stories: persistedStories,
  };
}

async function persistBacklogContractArtifact(projectUuid, projectRecord, backlogMarkdown, generatedContract = null) {
  const stageTask = await ensureStageTask(projectUuid, 'project_manager');
  if (!stageTask) return null;

  const backlogContract = buildBacklogContract(backlogMarkdown, projectRecord?.intakeConfig?.projectDna || null, generatedContract);

  await prisma.project.update({
    where: { uuid: projectUuid },
    data: {
      intakeConfig: {
        ...(projectRecord?.intakeConfig || {}),
        backlogContract,
      },
    },
  });

  return createSystemTaskArtifact(stageTask.uuid, {
    artifactType: 'custom',
    title: '[SYSTEM] Backlog Contract',
    content: JSON.stringify(backlogContract, null, 2),
    contentFormat: 'json',
    createdByAgentName: 'system',
  });
}

export function buildRequirementSpec(requirementsMarkdown, context = {}) {
  const getSection = (title) => extractMarkdownSection(requirementsMarkdown, title);
  const firstNonEmptyList = (...lists) => lists.find((list) => Array.isArray(list) && list.length) || [];
  const modernStory = String(getSection('Historia e objetivo') || '')
    .split(/\n\s*-\s*Objetivo\s*:/i)[0]
    .trim();

  const userStory = extractPlainSectionText(getSection('User Story Refinada')) || extractPlainSectionText(modernStory);
  const functionalRequirements = firstNonEmptyList(extractSectionLines(getSection('Requisitos Funcionais')), extractSectionLines(getSection('Comportamento')));
  const mainFlow = firstNonEmptyList(extractRequirementFlowLines(getSection('Fluxo Principal')), extractRequirementFlowLines(getSection('Comportamento')));
  const alternativeFlows = extractRequirementFlowLines(getSection('Fluxos Alternativos'));
  const exceptionFlows = extractRequirementFlowLines(getSection('Fluxos de Excecao'));
  const businessRules = firstNonEmptyList(extractSectionLines(getSection('Regras de Negocio'), { stripNumbering: true }), extractSectionLines(getSection('Regras'), { stripNumbering: true }));
  const uiStates = extractSectionLines(getSection('Estados da Interface e Feedback'));
  const validationsAndData = extractSectionLines(getSection('Validacoes e Dados'));
  const permissionsAndAudit = extractSectionLines(getSection('Permissoes e Auditoria'));
  const acceptanceCriteriaText = firstNonEmptyList(extractAcceptanceCriteriaRobust(getSection('Criterios de Aceite (BDD)')), extractAcceptanceCriteriaRobust(getSection('Cenarios de aceite')));
  // IDs are persisted in the Requirement Spec and become the stable QA
  // traceability key. The QA agent must not recreate them from markdown order.
  const acceptanceCriteria = acceptanceCriteriaText.map((text, index) => ({
    id: `CA-${String(index + 1).padStart(2, '0')}`,
    text,
  }));
  const assumptions = firstNonEmptyList(extractSectionLines(getSection('Premissas e Pontos a Validar')), extractSectionLines(getSection('Decisoes pendentes')))
    .filter((item) => !/^nenhuma decis[aã]o pendente\.?$/i.test(String(item || '').trim()));

  return {
    // Schema version. The version of the reviewed human artifact is stored
    // in sourceArtifact to avoid conflating the two contracts.
    version: 2,
    generatedAt: new Date().toISOString(),
    source: context.sourceAgentName || 'requirements_analyst',
    sourceArtifact: {
      uuid: context.sourceArtifactUuid || null,
      version: context.sourceArtifactVersion || null,
      title: context.sourceArtifactTitle || null,
      agentName: context.sourceAgentName || 'requirements_analyst',
    },
    task: {
      uuid: context.taskUuid || null,
      title: context.taskTitle || null,
      projectUuid: context.projectUuid || null,
      projectName: context.projectName || null,
    },
    projectDnaSnapshot: context.projectDna || null,
    userStory: userStory || null,
    functionalRequirements,
    flows: {
      main: mainFlow,
      alternatives: alternativeFlows,
      exceptions: exceptionFlows,
    },
    businessRules,
    uiStates,
    validationsAndData,
    permissionsAndAudit,
    acceptanceCriteria,
    acceptanceCriteriaText,
    assumptions,
    traceability: context.requirementContract ? {
      contractVersion: 1,
      domain: context.requirementContract.domain || null,
      intent: context.requirementContract.intent || null,
      evidenceSources: context.requirementContract.evidence_sources || [],
      upstreamReview: context.requirementContract.upstream_review || null,
      elements: {
        refinedStory: context.requirementContract.refined_story || null,
        inputs: context.requirementContract.inputs || [],
        outputs: context.requirementContract.outputs || [],
        confirmedRules: context.requirementContract.confirmed_rules || [],
        dependencies: context.requirementContract.dependencies || [],
        acceptanceCriteria: context.requirementContract.acceptance_criteria || [],
      },
    } : null,
  };
}

export async function createRequirementsArtifacts(taskUuid, metadata = {}) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: {
      uuid: true,
      title: true,
      project: {
        select: {
          uuid: true,
          name: true,
          intakeConfig: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error('Tarefa não encontrada.');
  }

  const requirementsArtifact = await createTaskArtifact(taskUuid, {
    artifactType: 'requirements',
    title: metadata.title || `Requisitos refinados - ${task.title}`,
    content: metadata.content || '',
    contentFormat: metadata.contentFormat || 'markdown',
    createdByAgentName: metadata.createdByAgentName || 'requirements_analyst',
    agentRunId: metadata.agentRunId || null,
  });

  const requirementSpec = buildRequirementSpec(metadata.content || '', {
    taskUuid: task.uuid,
    taskTitle: task.title,
    projectUuid: task.project?.uuid || null,
    projectName: task.project?.name || null,
    projectDna: task.project?.intakeConfig?.projectDna || null,
    requirementContract: metadata.requirementContract || null,
    sourceArtifactUuid: requirementsArtifact.uuid,
    sourceArtifactVersion: requirementsArtifact.version,
    sourceArtifactTitle: requirementsArtifact.title,
    sourceAgentName: requirementsArtifact.createdByAgentName || metadata.createdByAgentName || 'requirements_analyst',
  });

  const requirementSpecArtifact = await createSystemTaskArtifact(taskUuid, {
    artifactType: 'custom',
    title: '[SYSTEM] Requirement Spec',
    content: JSON.stringify(requirementSpec, null, 2),
    contentFormat: 'json',
    createdByAgentName: 'system',
    agentRunId: metadata.agentRunId || null,
  });

  return {
    requirementsArtifact,
    requirementSpecArtifact,
    requirementSpec,
  };
}

function buildTestSpec(testPlanMarkdown, context = {}) {
  const getSection = (title) => extractMarkdownSection(testPlanMarkdown, title);
  const asBulletList = (title) => normalizeBacklogContractList(extractBulletLines(getSection(title)));
  const asLines = (title) =>
    normalizeBacklogContractList(
      String(getSection(title) || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );

  const validationCases = [...String(testPlanMarkdown || '').matchAll(/^###\s*(CT[-\s]*\d+)\s*[—-]?\s*(.*)$([\s\S]*?)(?=^###\s*CT[-\s]*\d+|^##\s+|(?![\s\S]))/gim)]
    .map((match) => {
      const content = match[3].trim();
      const criterionMatch = content.match(/^\s*Crit[eé]rio relacionado\s*:\s*((?:CA|DQ)[-\s]*\d+)\b/im);
      return {
        id: match[1].replace(/\s+/g, '').toUpperCase(),
        title: match[2].trim(),
        content,
        criterionId: criterionMatch?.[1]?.replace(/\s+/g, '').toUpperCase() || null,
      };
    });
  const expectedCriteria = Array.isArray(context.requirementSpec?.acceptanceCriteria)
    ? context.requirementSpec.acceptanceCriteria
      .map((item) => String(item?.id || '').trim().toUpperCase())
      .filter(Boolean)
    : [];
  const reportedCriteria = validationCases.map((item) => item.criterionId).filter(Boolean);
  const legacySingleCriterionMapping = expectedCriteria.length > 1
    && validationCases.length === expectedCriteria.length
    && new Set(reportedCriteria).size === 1
    && reportedCriteria.length === validationCases.length;
  const normalizedCases = legacySingleCriterionMapping
    ? validationCases.map((item, index) => ({ ...item, criterionId: expectedCriteria[index] }))
    : validationCases;
  const acceptanceCoverage = normalizedCases.length && normalizedCases.every((item) => item.criterionId)
    ? expectedCriteria.map((criterionId) => {
      const caseIds = normalizedCases.filter((item) => item.criterionId === criterionId).map((item) => item.id);
      return caseIds.length ? `${criterionId} -> ${caseIds.join(', ')}` : null;
    }).filter(Boolean)
    : asLines('Cobertura dos criterios de aceite');

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: 'qa_engineer',
    task: {
      uuid: context.taskUuid || null,
      title: context.taskTitle || null,
      projectUuid: context.projectUuid || null,
      projectName: context.projectName || null,
    },
    projectDnaSnapshot: context.projectDna || null,
    requirementSpecSnapshot: context.requirementSpec || null,
    artifactKind: 'qa_validation_cases',
    acceptanceCoverage,
    validationCases: normalizedCases,
    coverageRepairedDeterministically: legacySingleCriterionMapping,
    qualityGaps: asBulletList('Lacunas de qualidade'),
    preparationDecision: getSection('Decisao de preparacao') || null,
    // Compatibility fields for existing observability readers.
    acceptanceTraceability: acceptanceCoverage,
    functionalCases: normalizedCases.map((item) => item.content),
    scenarios: [],
  };
}

function buildSolutionBlueprint(architectureMarkdown, context = {}) {
  const getSection = (title) => extractMarkdownSection(architectureMarkdown, title);
  const asBulletList = (title) => normalizeBacklogContractList(extractBulletLines(getSection(title)));
  const asLines = (title) =>
    normalizeBacklogContractList(
      String(getSection(title) || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'architect',
    project: {
      uuid: context.projectUuid || null,
      name: context.projectName || null,
    },
    projectDnaSnapshot: context.projectDna || null,
    backlogContractSnapshot: context.backlogContract || null,
    overview: getSection('Visao Geral') || null,
    stack: asBulletList('Stack Tecnologico'),
    modulesAndResponsibilities: asLines('Modulos e Responsabilidades'),
    architectureDiagram: getSection('Diagrama de Arquitetura') || null,
    suggestedDirectories: asLines('Estrutura de Diretorios Sugerida'),
    dataModelAndEntities: asLines('Modelo de Dados e Entidades Principais'),
    contractsAndIntegrations: asLines('Contratos e Integracoes'),
    designPatterns: asLines('Padroes de Design'),
    observabilityAndOperations: asLines('Observabilidade e Operacao'),
    deployStrategy: asLines('Estrategia de Deploy'),
    security: asLines('Seguranca'),
    technicalRisksAndTradeoffs: asLines('Riscos Tecnicos e Trade-offs'),
    implementationSequence: asLines('Sequencia Recomendada de Implementacao'),
  };
}

async function persistSolutionBlueprintArtifact(projectUuid, projectRecord, architectureMarkdown) {
  const stageTask = await ensureStageTask(projectUuid, 'architect');
  if (!stageTask) return null;

  const solutionBlueprint = buildSolutionBlueprint(architectureMarkdown, {
    projectUuid,
    projectName: projectRecord?.name || null,
    projectDna: projectRecord?.intakeConfig?.projectDna || null,
    backlogContract: projectRecord?.intakeConfig?.backlogContract || null,
  });

  await prisma.project.update({
    where: { uuid: projectUuid },
    data: {
      intakeConfig: {
        ...(projectRecord?.intakeConfig || {}),
        solutionBlueprint,
      },
    },
  });

  return createSystemTaskArtifact(stageTask.uuid, {
    artifactType: 'custom',
    title: '[SYSTEM] Solution Blueprint',
    content: JSON.stringify(solutionBlueprint, null, 2),
    contentFormat: 'json',
    createdByAgentName: 'system',
  });
}

export async function createQaArtifacts(taskUuid, metadata = {}) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: {
      uuid: true,
      title: true,
      project: {
        select: {
          uuid: true,
          name: true,
          intakeConfig: true,
        },
      },
      artifacts: {
        where: {
          isCurrent: true,
          artifactScope: 'refinement',
          title: '[SYSTEM] Requirement Spec',
        },
        select: {
          content: true,
        },
        take: 1,
      },
    },
  });

  if (!task) {
    throw new Error('Tarefa não encontrada.');
  }

  const validationCasesArtifact = await createTaskArtifact(taskUuid, {
    artifactType: QA_VALIDATION_ARTIFACT_TYPE,
    title: metadata.title || `Casos de validação - ${task.title}`,
    content: metadata.content || '',
    contentFormat: metadata.contentFormat || 'markdown',
    createdByAgentName: metadata.createdByAgentName || 'qa_engineer',
    agentRunId: metadata.agentRunId || null,
  });

  let requirementSpec = null;
  try {
    requirementSpec = task.artifacts?.[0]?.content ? JSON.parse(task.artifacts[0].content) : null;
  } catch {
    requirementSpec = null;
  }

  const validationSpec = buildTestSpec(metadata.content || '', {
    taskUuid: task.uuid,
    taskTitle: task.title,
    projectUuid: task.project?.uuid || null,
    projectName: task.project?.name || null,
    projectDna: task.project?.intakeConfig?.projectDna || null,
    requirementSpec,
  });

  const validationSpecArtifact = await createSystemTaskArtifact(taskUuid, {
    artifactType: 'custom',
    title: '[SYSTEM] QA Validation Spec',
    content: JSON.stringify(validationSpec, null, 2),
    contentFormat: 'json',
    createdByAgentName: 'system',
    agentRunId: metadata.agentRunId || null,
  });

  return {
    validationCasesArtifact,
    validationSpecArtifact,
    validationSpec,
  };
}

// Rebuild only the derived QA contract. This is used after a Requirement Spec
// migration and deliberately leaves the reviewed QA Markdown untouched.
export async function refreshQaValidationSpecArtifact(taskUuid) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: {
      uuid: true,
      title: true,
      project: { select: { uuid: true, name: true, intakeConfig: true } },
      artifacts: {
        where: { isCurrent: true, artifactScope: 'refinement' },
        select: { artifactType: true, title: true, content: true },
      },
    },
  });
  if (!task) throw new Error('Tarefa nÃ£o encontrada.');

  const requirementArtifact = task.artifacts.find((artifact) => artifact.title === '[SYSTEM] Requirement Spec');
  const validationArtifact = task.artifacts.find((artifact) => QA_ARTIFACT_TYPES.includes(artifact.artifactType));
  if (!requirementArtifact || !validationArtifact) {
    throw new Error('Requirement Spec e casos de validaÃ§Ã£o atuais sÃ£o obrigatÃ³rios para atualizar o contrato de QA.');
  }

  let requirementSpec = null;
  try { requirementSpec = JSON.parse(requirementArtifact.content); } catch { requirementSpec = null; }
  const validationSpec = buildTestSpec(validationArtifact.content || '', {
    taskUuid: task.uuid,
    taskTitle: task.title,
    projectUuid: task.project?.uuid || null,
    projectName: task.project?.name || null,
    projectDna: task.project?.intakeConfig?.projectDna || null,
    requirementSpec,
  });
  const artifact = await createSystemTaskArtifact(taskUuid, {
    artifactType: 'custom',
    title: '[SYSTEM] QA Validation Spec',
    content: JSON.stringify(validationSpec, null, 2),
    contentFormat: 'json',
    createdByAgentName: 'system',
  });
  return { artifact, validationSpec };
}

export async function importBacklogTasks(projectUuid, backlogMarkdown) {
  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    include: {
      creator: { select: { id: true } },
      tasks: { select: { id: true, title: true, taskType: true } },
    },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const { stories } = extractBacklogItems(backlogMarkdown);
  const existingTitles = new Set(project.tasks.filter((task) => task.taskType === 'story').map((task) => task.title.trim()));
  const backlogStories = Array.isArray(project.intakeConfig?.backlogContract?.stories)
    ? project.intakeConfig.backlogContract.stories
    : [];
  const publicationFindings = validateBacklogPublicationReadiness(backlogStories);
  if (publicationFindings.length) {
    const error = new Error(formatBacklogPublicationReadinessMessage(publicationFindings));
    error.statusCode = 409;
    error.code = 'BACKLOG_REVIEW_REQUIRED';
    error.findings = publicationFindings;
    throw error;
  }

  const itemsToCreate = [
    ...stories.map((story, index) => {
      const metadata = backlogStories[index] || {};
      const priority = ['low', 'medium', 'high', 'urgent'].includes(metadata.priority)
        ? metadata.priority
        : 'medium';
      return {
      title: story.title,
      taskType: 'story',
      assigneeType: 'agent',
      assigneeAgentName: 'requirements_analyst',
      position: index,
      description: story.description,
      priority,
      note: 'Story refinada importada do backlog',
      };
    }),
  ];

  for (const item of itemsToCreate) {
    if (existingTitles.has(item.title.trim())) continue;

    await prisma.task.create({
      data: {
        uuid: randomUUID(),
        projectId: project.id,
        title: item.title,
        description: item.description || null,
        taskType: item.taskType,
        status: 'backlog',
        priority: item.priority,
        assigneeType: item.assigneeType,
        assigneeAgentName: item.assigneeAgentName,
        position: item.position,
        createdBy: project.creator.id,
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: 'backlog',
            changedByUserId: project.creator.id,
            note: item.note,
          },
        },
      },
    });
  }

  return listProjectTasks(projectUuid);
}

// A repaired requirement is a new source of truth. Keep its structured
// companion in lockstep so downstream QA never reads an obsolete contract.
export async function refreshRequirementSpecArtifact(taskUuid, metadata = {}) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: {
      uuid: true,
      title: true,
      project: { select: { uuid: true, name: true, intakeConfig: true } },
      artifacts: {
        where: { isCurrent: true, artifactScope: 'refinement', title: '[SYSTEM] Requirement Spec' },
        select: { content: true },
        take: 1,
      },
    },
  });
  if (!task) throw new Error('Tarefa não encontrada.');

  let previousSpec = null;
  try { previousSpec = task.artifacts?.[0]?.content ? JSON.parse(task.artifacts[0].content) : null; } catch { previousSpec = null; }
  const previousTraceability = previousSpec?.traceability || null;
  const previousElements = previousTraceability?.elements || {};
  const requirementContract = previousTraceability ? {
    domain: previousTraceability.domain || null,
    intent: previousTraceability.intent || null,
    evidence_sources: previousTraceability.evidenceSources || [],
    upstream_review: previousTraceability.upstreamReview || null,
    refined_story: previousElements.refinedStory || null,
    inputs: previousElements.inputs || [],
    outputs: previousElements.outputs || [],
    confirmed_rules: previousElements.confirmedRules || [],
    dependencies: previousElements.dependencies || [],
    acceptance_criteria: previousElements.acceptanceCriteria || [],
  } : null;
  const requirementSpec = buildRequirementSpec(metadata.content || '', {
    taskUuid: task.uuid,
    taskTitle: task.title,
    projectUuid: task.project?.uuid || null,
    projectName: task.project?.name || null,
    projectDna: task.project?.intakeConfig?.projectDna || null,
    requirementContract,
    sourceArtifactUuid: metadata.sourceArtifactUuid || null,
    sourceArtifactVersion: metadata.sourceArtifactVersion || null,
    sourceArtifactTitle: metadata.sourceArtifactTitle || null,
    sourceAgentName: metadata.sourceAgentName || metadata.createdByAgentName || 'requirements_reviewer',
  });

  const artifact = await createSystemTaskArtifact(taskUuid, {
    artifactType: 'custom',
    title: '[SYSTEM] Requirement Spec',
    content: JSON.stringify(requirementSpec, null, 2),
    contentFormat: 'json',
    createdByAgentName: metadata.createdByAgentName || 'system',
    agentRunId: metadata.agentRunId || null,
  });
  return { artifact, requirementSpec };
}

const BACKLOG_RECONCILIATION_STOPWORDS = new Set([
  'como', 'quero', 'para', 'com', 'sem', 'uma', 'umas', 'um', 'uns', 'que', 'por', 'dos', 'das',
  'de', 'da', 'do', 'e', 'ou', 'a', 'o', 'os', 'as', 'no', 'na', 'nos', 'nas', 'sistema',
]);
const BACKLOG_ACTION_VERBS = new Set([
  // Read-only verbs do not distinguish a capability's business object.
  // Other verbs (export, cancel, reserve...) are part of its scope.
  'consult', 'visuali', 'listar', 'exibir',
]);

function backlogTerms(value) {
  return new Set(
    String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .match(/[a-z0-9]{4,}/g)?.map((term) => term.replace(/s$/, '').slice(0, 7))
      .filter((term) => !BACKLOG_RECONCILIATION_STOPWORDS.has(term)) || []
  );
}

function sharedBacklogTerms(left, right) {
  return [...left].filter((term) => right.has(term)).length;
}

function storyScopeText(story) {
  return [story?.title, story?.actor, story?.goal, story?.benefit, story?.description].filter(Boolean).join(' ');
}

function storyPrimaryActionText(story) {
  const title = String(story?.title || '').trim();
  const matchedAction = title.match(/\b(?:eu\s+quero|quero)\s+(.+?)(?:,\s*para\b|\s+para\b|$)/i);
  return matchedAction?.[1] || String(story?.goal || title);
}

function storyPrimaryScopeTerms(story) {
  return new Set([...backlogTerms(storyPrimaryActionText(story))].filter((term) => !BACKLOG_ACTION_VERBS.has(term)));
}

function storyAcceptanceCriteria(story) {
  const context = story?.refinementContext || story?.refinement_context || {};
  const criteria = story?.acceptanceCriteria || story?.acceptance_criteria || context.acceptanceCriteria || context.acceptance_criteria;
  return Array.isArray(criteria) ? criteria : [];
}

export function validateBacklogFinalReconciliation(stories = []) {
  const normalizedStories = Array.isArray(stories) ? stories.filter((story) => story && typeof story === 'object') : [];
  const scopes = normalizedStories.map((story) => ({
    story,
    terms: backlogTerms(storyScopeText(story)),
    primaryActionTerms: backlogTerms(storyPrimaryActionText(story)),
    primaryScopeTerms: storyPrimaryScopeTerms(story),
  }));
  const findings = [];

  for (const { story, primaryActionTerms } of scopes) {
    for (const [criterionIndex, criterion] of storyAcceptanceCriteria(story).entries()) {
      if (!criterion || typeof criterion !== 'object') continue;
      const criterionTerms = backlogTerms([criterion.given, criterion.when, criterion.then].filter(Boolean).join(' '));
      if (criterionTerms.size < 3) continue;
      const ownScore = sharedBacklogTerms(criterionTerms, primaryActionTerms);
      const bestMatch = scopes
        .filter((candidate) => candidate.story !== story)
        .map((candidate) => ({ story: candidate.story, score: sharedBacklogTerms(criterionTerms, candidate.primaryActionTerms) }))
        .sort((left, right) => right.score - left.score)[0];
      // Exception criteria naturally share vocabulary with adjacent journeys
      // (for example, reserve and change a reservation). Block only when the
      // criterion has virtually no link to its own primary action and is a
      // strong match for another primary action.
      if (bestMatch && ownScore <= 1 && bestMatch.score >= 3 && bestMatch.score >= ownScore + 2) {
        findings.push({
          code: 'criterion_outside_story_scope',
          storyId: story.id || null,
          relatedStoryId: bestMatch.story.id || null,
          criterionIndex,
          criterion,
          message: `O critério de aceite parece pertencer mais à ${bestMatch.story.id || 'outra story'} do que à ${story.id || 'story atual'}.`,
        });
      }
    }
  }

  for (let index = 0; index < scopes.length; index += 1) {
    for (let comparedIndex = index + 1; comparedIndex < scopes.length; comparedIndex += 1) {
      const left = scopes[index];
      const right = scopes[comparedIndex];
      const shared = sharedBacklogTerms(left.primaryScopeTerms, right.primaryScopeTerms);
      const union = new Set([...left.primaryScopeTerms, ...right.primaryScopeTerms]).size;
      if (shared >= 3 && union && shared / union >= 0.75) {
        findings.push({
          code: 'duplicate_story_scope',
          storyId: left.story.id || null,
          relatedStoryId: right.story.id || null,
          message: `${left.story.id || 'Uma story'} e ${right.story.id || 'outra story'} possuem escopo muito semelhante e precisam ser consolidadas ou delimitadas.`,
        });
      }
    }
  }

  return findings;
}

function formatBacklogReconciliationMessage(findings) {
  const instructions = findings.map((finding) => {
    if (finding.code === 'criterion_outside_story_scope') {
      return `A ${finding.storyId} possui um critério de aceite que descreve melhor o fluxo da ${finding.relatedStoryId}. Mova esse critério para a story correta ou reescreva-o para o objetivo da ${finding.storyId}.`;
    }
    if (finding.code === 'duplicate_story_scope') {
      return `As stories ${finding.storyId} e ${finding.relatedStoryId} têm o mesmo objetivo de negócio. Consolide-as em uma única story ou deixe claro o que cada uma cobre.`;
    }
    return finding.message;
  });
  return `Não foi possível publicar o backlog. Revise antes de tentar novamente: ${instructions.join(' ')}`;
}

export function validateBacklogPublicationReadiness(stories = []) {
  return (Array.isArray(stories) ? stories : [])
    .filter((story) => story && typeof story === 'object')
    .flatMap((story) => {
      const tags = story.reviewTags || story.review_tags || [];
      const blockingTags = (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag || ''))
        .filter((tag) => /^(REVIEW_|PROPOSED_DEFAULT$)/.test(tag));
      return blockingTags.length ? [{
        code: 'story_review_required',
        storyId: story.id || null,
        tags: blockingTags,
        questions: story.openQuestions || story.open_questions || [],
      }] : [];
    });
}

function finalRevalidationFindings(contract = {}, stories = []) {
  const findings = [];
  const normalizedStories = Array.isArray(stories) ? stories : [];
  const qualityReview = contract.qualityReview || contract.quality_review || {};

  if (!normalizedStories.length) {
    findings.push({ code: 'backlog_empty', message: 'O backlog não possui stories para ser revalidado.' });
  }
  findings.push(...validateBacklogPublicationReadiness(normalizedStories).map((finding) => ({
    ...finding,
    message: `A ${finding.storyId || 'story'} ainda possui uma revisão pendente.`,
  })));
  normalizedStories.forEach((story) => {
    if (String(story?.reviewStatus || '').toLowerCase() !== 'approved') {
      findings.push({ code: 'story_not_approved', storyId: story?.id || null, message: `A ${story?.id || 'story'} ainda aguarda aprovação humana.` });
    }
    if (String(story?.lastAgentReview?.assessment?.decision || '') !== 'READY') {
      findings.push({ code: 'story_not_ready', storyId: story?.id || null, message: `A ${story?.id || 'story'} não passou no Story Readiness Assessment.` });
    }
  });
  (qualityReview.proposals || []).forEach((proposal, index) => {
    if (!['accepted', 'rejected'].includes(String(proposal?.status || 'proposed').toLowerCase())) {
      findings.push({
        code: 'quality_proposal_pending',
        proposalId: proposal?.id || `PROP-${String(index + 1).padStart(3, '0')}`,
        message: `A decisão sobre "${proposal?.capability || 'capacidade proposta'}" ainda está pendente.`,
      });
    }
  });
  (qualityReview.questions || []).forEach((question, index) => {
    if (question?.requires_confirmation && String(question?.status || '').toLowerCase() !== 'answered') {
      findings.push({
        code: 'quality_question_pending',
        questionId: question?.id || `CQ-${String(index + 1).padStart(3, '0')}`,
        message: question?.question || 'Existe uma decisão de Quality Gate ainda sem resposta.',
      });
    }
  });
  return [...findings, ...validateBacklogFinalReconciliation(normalizedStories)];
}

export async function revalidateBacklogForPublication(projectUuid, actorUserUuid = null) {
  const project = await prisma.project.findUnique({ where: { uuid: projectUuid }, select: { id: true, intakeConfig: true } });
  const contract = project?.intakeConfig?.backlogContract;
  if (!project || !contract) throw new Error('Nenhum backlog aguardando revalidação.');
  if (contract.publicationStatus === 'published') throw new Error('O backlog já foi publicado.');

  const stories = Array.isArray(contract.stories) ? contract.stories : [];
  const findings = finalRevalidationFindings(contract, stories);
  const previousReview = contract.qualityReview || contract.quality_review || {};
  const revalidatedAt = new Date().toISOString();
  const qualityReview = {
    ...previousReview,
    decision: findings.length ? 'REVISE' : 'PASS',
    findings,
    finalRevalidation: {
      status: findings.length ? 'REVISE' : 'PASS',
      findingsCount: findings.length,
      revalidatedAt,
      revalidatedBy: actorUserUuid,
      source: 'deterministic_final_reconciliation',
    },
    resolvedAt: findings.length ? null : revalidatedAt,
  };
  const nextContract = { ...contract, qualityReview, quality_review: qualityReview };
  await prisma.project.update({
    where: { id: project.id },
    data: { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: nextContract } },
  });
  return { qualityReview, findings };
}

function formatBacklogPublicationReadinessMessage(findings) {
  const ids = findings.map((item) => item.storyId || 'story sem ID').join(', ');
  return `Não é possível publicar o backlog enquanto houver stories com revisão pendente: ${ids}. Resolva as pendências e execute o Story Readiness Assessment.`;
}

export async function publishBacklogTasks(projectUuid) {
  const project = await prisma.project.findUnique({ where: { uuid: projectUuid }, include: { creator: { select: { id: true } }, tasks: { select: { title: true, taskType: true } } } });
  const contract = project?.intakeConfig?.backlogContract;
  if (!project || !contract) throw new Error('Nenhum backlog aguardando aprovacao humana.');
  const qualityReview = contract.qualityReview || contract.quality_review;
  const stories = Array.isArray(contract.stories) ? contract.stories : [];
  const publicationFindings = validateBacklogPublicationReadiness(stories);
  if (publicationFindings.length) {
    const error = new Error(formatBacklogPublicationReadinessMessage(publicationFindings));
    error.statusCode = 409;
    error.code = 'BACKLOG_REVIEW_REQUIRED';
    error.findings = publicationFindings;
    throw error;
  }
  // `confirmed` is generated backlog metadata, not the human approval that
  // authorizes publication. Every story must be explicitly approved after a
  // READY assessment; this matches the action shown in the review screen.
  const hasUnapprovedStory = stories.some((story) => String(story?.reviewStatus || '').toLowerCase() !== 'approved');
  if (hasUnapprovedStory) throw new Error('Aprove todas as stories antes de publicar o backlog.');
  const hasUnreadyStory = stories.some((story) => String(story?.lastAgentReview?.assessment?.decision || '') !== 'READY');
  if (hasUnreadyStory) throw new Error('Todas as stories precisam passar pelo Story Readiness Assessment antes da publicacao.');
  const reconciliationFindings = validateBacklogFinalReconciliation(stories);
  if (reconciliationFindings.length) {
    const error = new Error(formatBacklogReconciliationMessage(reconciliationFindings));
    error.statusCode = 409;
    error.code = 'BACKLOG_FINAL_RECONCILIATION_FAILED';
    error.findings = reconciliationFindings;
    throw error;
  }
  const legacyQualityGateSatisfied = !qualityReview && stories.length > 0;
  if (qualityReview?.decision !== 'PASS' && !legacyQualityGateSatisfied) {
    throw new Error('O backlog precisa passar pela validacao de qualidade antes da publicacao.');
  }
  const existing = new Set(project.tasks.filter((task) => task.taskType === 'story').map((task) => task.title.trim()));
  for (const [index, story] of stories.entries()) {
    if (!story?.title || existing.has(story.title.trim())) continue;
    const reviewSnapshot = {
      storyId: story.id || null,
      assessment: story.lastAgentReview?.assessment || null,
      review: story.lastAgentReview?.review || null,
      answers: Array.isArray(story.reviewAnswers) ? story.reviewAnswers : [],
      reviewedAt: story.lastAgentReview?.generatedAt || story.lastAgentReview?.appliedAt || null,
      appliedAt: story.lastAgentReview?.appliedAt || null,
      approvedAt: Array.isArray(story.reviewHistory)
        ? [...story.reviewHistory].reverse().find((entry) => entry?.status === 'approved')?.at || null
        : null,
    };
    await prisma.task.create({ data: { uuid: randomUUID(), projectId: project.id, title: story.title, description: story.description || null, taskType: 'story', status: 'backlog', priority: ['low', 'medium', 'high', 'urgent'].includes(story.priority) ? story.priority : 'medium', assigneeType: 'agent', assigneeAgentName: 'requirements_analyst', position: index, createdBy: project.creator.id, statusHistory: { create: { fromStatus: null, toStatus: 'backlog', changedByUserId: project.creator.id, note: 'Story publicada apos aprovacao humana' } }, artifacts: { create: { uuid: randomUUID(), artifactType: 'review', artifactScope: 'refinement', title: `Story Readiness Review - ${story.title}`.slice(0, 255), content: JSON.stringify(reviewSnapshot), contentFormat: 'json', version: 1, isCurrent: true, isApproved: true, approvedAt: reviewSnapshot.approvedAt ? new Date(reviewSnapshot.approvedAt) : new Date(), createdByUserId: project.creator.id, createdByAgentName: 'story_reviewer' } } } });
  }
  const publishedAt = new Date().toISOString();
  const synthesizedQualityReview = legacyQualityGateSatisfied
    ? { decision: 'PASS', source: 'story_readiness', completedAt: publishedAt }
    : qualityReview;
  await prisma.project.update({
    where: { id: project.id },
    data: {
      ...(project.status === 'draft' ? { status: 'active' } : {}),
      intakeConfig: {
        ...(project.intakeConfig || {}),
        backlogContract: {
          ...contract,
          ...(legacyQualityGateSatisfied ? { qualityReview: synthesizedQualityReview, quality_review: synthesizedQualityReview } : {}),
          publicationStatus: 'published',
          publishedAt,
        },
      },
    },
  });
  return listProjectTasks(projectUuid);
}

export async function updateBacklogStory(projectUuid, storyId, input = {}, actorUserUuid = null) {
  const project = await prisma.project.findUnique({ where: { uuid: projectUuid }, select: { id: true, intakeConfig: true } });
  const contract = project?.intakeConfig?.backlogContract;
  const stories = Array.isArray(contract?.stories) ? contract.stories : [];
  const story = stories.find((item) => String(item?.id || '').toLowerCase() === String(storyId || '').toLowerCase());
  if (!project || !contract || !story) throw new Error('Story pendente nao encontrada.');
  if (contract.publicationStatus === 'published') {
    const error = new Error('O backlog ja foi publicado e suas user stories estao bloqueadas para edicao.');
    error.statusCode = 409;
    throw error;
  }
  const title = String(input.title || '').trim();
  if (!title) throw new Error('O titulo da story e obrigatorio.');
  story.title = title;
  story.description = String(input.description || '').trim();
  if (input.reviewStatus !== undefined) {
    const reviewStatus = String(input.reviewStatus).toLowerCase();
    if (!['approved', 'rejected', 'needs_review'].includes(reviewStatus)) throw new Error('Status de revisão inválido.');
    const comment = String(input.comment || '').trim();
    if (reviewStatus === 'rejected' && !comment) throw new Error('Comentário é obrigatório ao rejeitar uma story.');
    if (reviewStatus === 'approved') {
      const assessment = story.lastAgentReview?.assessment;
      if (assessment?.decision !== 'READY') {
        throw new Error('A story so pode ser aprovada quando o Story Readiness Assessment estiver READY, sem bloqueios.');
      }
    }
    story.reviewStatus = reviewStatus;
    story.reviewComment = comment || null;
    story.reviewHistory = Array.isArray(story.reviewHistory) ? story.reviewHistory : [];
    story.reviewHistory.push({ status: reviewStatus, comment: comment || null, userUuid: actorUserUuid, at: new Date().toISOString() });
  }
  await prisma.project.update({ where: { id: project.id }, data: { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: { ...contract, stories } } } });
  return story;
}

function uniqueBacklogItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const normalized = typeof item === 'string'
      ? item.trim().toLocaleLowerCase('pt-BR')
      : JSON.stringify(item || {}).toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function consolidationAcceptanceCriteria(story = {}) {
  const context = story.refinementContext || story.refinement_context || {};
  const criteria = context.acceptanceCriteria || context.acceptance_criteria || [];
  return Array.isArray(criteria) ? criteria : [];
}

/**
 * Keeps the target story as the canonical one, incorporates its source's
 * verifiable context, and invalidates readiness because the scope changed.
 */
export async function consolidateBacklogStories(projectUuid, sourceStoryId, targetStoryId, actorUserUuid = null) {
  const project = await prisma.project.findUnique({ where: { uuid: projectUuid }, select: { id: true, intakeConfig: true } });
  const contract = project?.intakeConfig?.backlogContract;
  const stories = Array.isArray(contract?.stories) ? contract.stories : [];
  const sourceId = String(sourceStoryId || '').trim();
  const targetId = String(targetStoryId || '').trim();
  if (!project || !contract) throw new Error('Backlog pendente nao encontrado.');
  if (!sourceId || !targetId || sourceId.toLowerCase() === targetId.toLowerCase()) {
    const error = new Error('Selecione duas stories diferentes para consolidar.');
    error.statusCode = 400;
    throw error;
  }
  if (contract.publicationStatus === 'published') {
    const error = new Error('O backlog ja foi publicado e suas user stories estao bloqueadas para edicao.');
    error.statusCode = 409;
    throw error;
  }

  const source = stories.find((item) => String(item?.id || '').toLowerCase() === sourceId.toLowerCase());
  const target = stories.find((item) => String(item?.id || '').toLowerCase() === targetId.toLowerCase());
  if (!source || !target) {
    const error = new Error('Uma das stories selecionadas nao foi encontrada. Atualize a pagina e tente novamente.');
    error.statusCode = 404;
    throw error;
  }
  const sourceAndTargetIds = new Set([sourceId.toLowerCase(), targetId.toLowerCase()]);
  const isDetectedDuplicatePair = validateBacklogFinalReconciliation(stories).some((finding) => (
    finding.code === 'duplicate_story_scope'
    && sourceAndTargetIds.has(String(finding.storyId || '').toLowerCase())
    && sourceAndTargetIds.has(String(finding.relatedStoryId || '').toLowerCase())
  ));
  if (!isDetectedDuplicatePair) {
    const error = new Error('Estas stories não foram identificadas como duplicadas. A consolidação só pode ser feita no par indicado pela revisão do backlog.');
    error.statusCode = 409;
    error.code = 'BACKLOG_CONSOLIDATION_PAIR_INVALID';
    throw error;
  }

  const targetContext = target.refinementContext || target.refinement_context || {};
  const acceptanceCriteria = uniqueBacklogItems([...consolidationAcceptanceCriteria(target), ...consolidationAcceptanceCriteria(source)]);
  const refinementContext = {
    ...targetContext,
    acceptanceCriteria,
    acceptance_criteria: acceptanceCriteria,
    openQuestions: [],
    open_questions: [],
  };
  const consolidatedFrom = uniqueBacklogItems([...(target.consolidatedFrom || []), {
    id: source.id,
    title: source.title || source.goal || null,
    consolidatedAt: new Date().toISOString(),
    consolidatedBy: actorUserUuid,
  }]);
  const reviewHistory = Array.isArray(target.reviewHistory) ? [...target.reviewHistory] : [];
  reviewHistory.push({
    status: 'needs_review',
    comment: `Consolidada com ${source.id}. Execute uma nova revisao antes de aprovar.`,
    userUuid: actorUserUuid,
    at: new Date().toISOString(),
  });
  const consolidatedTarget = {
    ...target,
    refinementContext,
    refinement_context: refinementContext,
    capabilities: uniqueBacklogItems([...(target.capabilities || []), ...(source.capabilities || [])]),
    dependencies: uniqueBacklogItems([...(target.dependencies || []), ...(source.dependencies || [])]),
    source_ids: uniqueBacklogItems([...(target.source_ids || []), ...(source.source_ids || [])]),
    sourceIds: uniqueBacklogItems([...(target.sourceIds || []), ...(source.sourceIds || [])]),
    consolidatedFrom,
    reviewStatus: 'needs_review',
    reviewComment: `Conteúdo consolidado de ${source.id}; requer nova revisão do agente.`,
    reviewHistory,
    reviewAnswers: [],
    openQuestions: [],
    open_questions: [],
    pendingAgentReview: null,
    lastAgentReview: null,
    reviewTags: [],
    review_tags: [],
  };
  const updatedStories = stories
    .filter((item) => String(item?.id || '').toLowerCase() !== sourceId.toLowerCase())
    .map((item) => String(item?.id || '').toLowerCase() === targetId.toLowerCase() ? consolidatedTarget : item);
  await prisma.project.update({ where: { id: project.id }, data: { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: { ...contract, stories: updatedStories } } } });
  return consolidatedTarget;
}

export async function moveBacklogAcceptanceCriterion(projectUuid, sourceStoryId, targetStoryId, criterionIndex, actorUserUuid = null) {
  const project = await prisma.project.findUnique({ where: { uuid: projectUuid }, select: { id: true, intakeConfig: true } });
  const contract = project?.intakeConfig?.backlogContract;
  const stories = Array.isArray(contract?.stories) ? contract.stories : [];
  const sourceId = String(sourceStoryId || '').trim();
  const targetId = String(targetStoryId || '').trim();
  const index = Number(criterionIndex);
  if (!project || !contract) throw new Error('Backlog pendente nao encontrado.');
  if (!sourceId || !targetId || sourceId.toLowerCase() === targetId.toLowerCase() || !Number.isInteger(index) || index < 0) {
    const error = new Error('A origem, o destino e o critério a mover são obrigatórios.');
    error.statusCode = 400;
    throw error;
  }
  if (contract.publicationStatus === 'published') {
    const error = new Error('O backlog ja foi publicado e suas user stories estao bloqueadas para edicao.');
    error.statusCode = 409;
    throw error;
  }
  const source = stories.find((story) => String(story?.id || '').toLowerCase() === sourceId.toLowerCase());
  const target = stories.find((story) => String(story?.id || '').toLowerCase() === targetId.toLowerCase());
  const finding = validateBacklogFinalReconciliation(stories).find((item) => (
    item.code === 'criterion_outside_story_scope'
    && String(item.storyId || '').toLowerCase() === sourceId.toLowerCase()
    && String(item.relatedStoryId || '').toLowerCase() === targetId.toLowerCase()
    && Number(item.criterionIndex) === index
  ));
  if (!source || !target || !finding) {
    const error = new Error('Este critério não está mais indicado para movimentação. Atualize a página e revise as stories antes de tentar novamente.');
    error.statusCode = 409;
    error.code = 'BACKLOG_CRITERION_MOVE_INVALID';
    throw error;
  }
  const sourceCriteria = consolidationAcceptanceCriteria(source);
  const criterion = sourceCriteria[index];
  if (!criterion || typeof criterion !== 'object') {
    const error = new Error('O critério indicado não foi encontrado na story de origem.');
    error.statusCode = 409;
    throw error;
  }
  const targetCriteria = uniqueBacklogItems([...consolidationAcceptanceCriteria(target), criterion]);
  const updateStoryCriteria = (story, criteria, note) => {
    const context = story.refinementContext || story.refinement_context || {};
    const refinementContext = { ...context, acceptanceCriteria: criteria, acceptance_criteria: criteria, openQuestions: [], open_questions: [] };
    return {
      ...story,
      refinementContext,
      refinement_context: refinementContext,
      reviewStatus: 'needs_review',
      reviewComment: note,
      reviewAnswers: [],
      openQuestions: [],
      open_questions: [],
      pendingAgentReview: null,
      lastAgentReview: null,
      reviewTags: [],
      review_tags: [],
      reviewHistory: [...(Array.isArray(story.reviewHistory) ? story.reviewHistory : []), { status: 'needs_review', comment: note, userUuid: actorUserUuid, at: new Date().toISOString() }],
    };
  };
  const updatedStories = stories.map((story) => {
    if (story === source) return updateStoryCriteria(source, sourceCriteria.filter((_, currentIndex) => currentIndex !== index), `Critério movido para ${target.id}; requer nova revisão.`);
    if (story === target) return updateStoryCriteria(target, targetCriteria, `Critério recebido de ${source.id}; requer nova revisão.`);
    return story;
  });
  await prisma.project.update({ where: { id: project.id }, data: { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: { ...contract, stories: updatedStories } } } });
  return { sourceStoryId: source.id, targetStoryId: target.id, criterion };
}

export async function createTaskArtifact(taskUuid, input) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: { id: true },
  });

  if (!task) {
    throw new Error('Tarefa nÃ£o encontrada.');
  }

  await prisma.taskArtifact.updateMany({
    where: {
      taskId: task.id,
      artifactType: input.artifactType,
      artifactScope: input.artifactScope || 'refinement',
      isCurrent: true,
    },
    data: {
      isCurrent: false,
    },
  });

  const latestArtifact = await prisma.taskArtifact.findFirst({
    where: {
      taskId: task.id,
      artifactType: input.artifactType,
      artifactScope: input.artifactScope || 'refinement',
    },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  return prisma.taskArtifact.create({
    data: {
      uuid: randomUUID(),
      taskId: task.id,
      taskImplementationId: input.taskImplementationId || null,
      agentRunId: input.agentRunId || null,
      artifactType: input.artifactType,
      artifactScope: input.artifactScope || 'refinement',
      title: input.title,
      content: input.content,
      contentFormat: input.contentFormat || 'markdown',
      version: (latestArtifact?.version || 0) + 1,
      isCurrent: true,
      isApproved: input.isApproved || false,
      createdByUserId: input.createdByUserId || null,
      createdByAgentName: input.createdByAgentName || null,
    },
  });
}

export async function createSystemTaskArtifact(taskUuid, input) {
  const task = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: { id: true },
  });

  if (!task) {
    throw new Error('Tarefa nÃ£o encontrada.');
  }

  const artifactScope = input.artifactScope || 'refinement';

  await prisma.taskArtifact.updateMany({
    where: {
      taskId: task.id,
      artifactType: input.artifactType || 'custom',
      artifactScope,
      title: input.title,
      isCurrent: true,
    },
    data: {
      isCurrent: false,
    },
  });

  const latestArtifact = await prisma.taskArtifact.findFirst({
    where: {
      taskId: task.id,
      artifactType: input.artifactType || 'custom',
      artifactScope,
      title: input.title,
    },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  return prisma.taskArtifact.create({
    data: {
      uuid: randomUUID(),
      taskId: task.id,
      taskImplementationId: input.taskImplementationId || null,
      agentRunId: input.agentRunId || null,
      artifactType: input.artifactType || 'custom',
      artifactScope,
      title: input.title,
      content: input.content,
      contentFormat: input.contentFormat || 'json',
      version: (latestArtifact?.version || 0) + 1,
      isCurrent: true,
      isApproved: input.isApproved || false,
      createdByUserId: input.createdByUserId || null,
      createdByAgentName: input.createdByAgentName || 'system',
    },
  });
}

export async function reviewTaskArtifact(taskUuid, artifactUuid, { approved, comment = '', userUuid }) {
  const task = await getTaskContextByUuid(taskUuid, userUuid);
  const artifact = task?.artifacts?.find((item) => item.uuid === artifactUuid && item.isCurrent);
  if (!artifact) {
    const error = new Error('Esta versão do artefato não é mais a atual. A tela foi atualizada com a versão mais recente.');
    error.statusCode = 409;
    error.code = 'ARTIFACT_VERSION_STALE';
    throw error;
  }
  if (QA_ARTIFACT_TYPES.includes(artifact.artifactType)) {
    const approvedRequirements = task.artifacts.some(
      (item) => item.isCurrent && item.artifactType === 'requirements' && item.isApproved
    );
    if (!approvedRequirements) {
      const error = new Error('A revisão de QA exige requisitos aprovados na versão atual.');
      error.statusCode = 409;
      error.code = 'QA_REQUIRES_APPROVED_REQUIREMENTS';
      throw error;
    }
  }
  if (!approved && !String(comment).trim()) throw new Error('Informe um comentário ao rejeitar o artefato.');
  let qualityReport = null;
  if (approved && ['requirements', ...QA_ARTIFACT_TYPES].includes(artifact.artifactType)) {
    const relatedRequirement = QA_ARTIFACT_TYPES.includes(artifact.artifactType)
      ? task.artifacts.find((item) => item.artifactType === 'requirements' && item.isCurrent)?.content || `${task.title}\n${task.description || ''}`
      : `${task.title}\n${task.description || ''}`;
    qualityReport = assertArtifactQuality({ artifactType: artifact.artifactType, content: artifact.content, relatedRequirement });
    logInfo('artifact_quality_gate_passed', { taskUuid, artifactUuid: artifact.uuid, artifactType: artifact.artifactType, score: qualityReport.score, threshold: qualityReport.threshold });
  }
  const reviewer = await prisma.user.findUnique({ where: { uuid: userUuid }, select: { id: true } });
  const decision = approved ? 'APPROVED' : 'REJECTED';
  const transition = resolveArtifactReviewTransition(artifact.artifactType, Boolean(approved));
  const releasedStage = transition?.releasedStage || null;
  const trimmedComment = String(comment).trim();
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.artifactReview.findFirst({ where: { artifactId: artifact.id, version: artifact.version, decision }, orderBy: { reviewedAt: 'desc' } });
      if (existing) {
        // Reconcile approvals created before automatic transitions were enabled.
        const taskData = transition && { status: transition.status, assigneeAgentName: transition.assigneeAgentName, assigneeType: transition.assigneeType };
        if (taskData) await tx.task.update({ where: { id: task.id }, data: taskData });
        return tx.taskArtifact.findUnique({ where: { id: artifact.id } });
      }
      const next = await tx.taskArtifact.update({ where: { id: artifact.id }, data: { isApproved: Boolean(approved), approvedBy: approved ? reviewer?.id || null : null, approvedAt: approved ? new Date() : null } });
      await tx.artifactReview.create({ data: { uuid: randomUUID(), artifactId: artifact.id, taskId: task.id, decision, releasedStage, comment: trimmedComment || null, reason: approved ? null : trimmedComment, qualityScore: qualityReport?.score ?? null, qualityReport: qualityReport || undefined, reviewedBy: reviewer?.id || null, version: artifact.version } });
      const taskData = transition && { status: transition.status, assigneeAgentName: transition.assigneeAgentName, assigneeType: transition.assigneeType };
      if (taskData) await tx.task.update({ where: { id: task.id }, data: taskData });
      return next;
    });
  } catch (error) {
    // A concurrent identical decision can win the unique constraint; treat it as idempotent.
    if (error?.code === 'P2002') {
      updated = await prisma.taskArtifact.findUnique({ where: { id: artifact.id } });
    } else {
      throw error;
    }
  }
  await createTaskComment(taskUuid, { authorUserUuid: userUuid, body: `${approved ? 'Artefato aprovado' : 'Artefato rejeitado'} (v${artifact.version}).${String(comment).trim() ? ` ${String(comment).trim()}` : ''}` });
  return updated;
}

export async function getTaskContextByUuid(taskUuid, userUuid = null) {
  return prisma.task.findFirst({
    where: {
      uuid: taskUuid,
      ...(userUuid
        ? {
            project: {
              is: buildProjectAccessFilter(userUuid),
            },
          }
        : {}),
    },
    include: {
      project: {
        select: {
          uuid: true,
          name: true,
          description: true,
          vision: true,
          intakeConfig: true,
        },
      },
      creator: {
        select: { id: true, uuid: true, name: true, email: true },
      },
      artifacts: {
        where: { isCurrent: true, artifactScope: 'refinement' },
        orderBy: { createdAt: 'desc' },
      },
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

async function getProjectRecordByUuid(projectUuid) {
  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    include: {
      creator: { select: { id: true } },
    },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  return project;
}

const stageTaskConfig = {
  project_manager: {
    title: '[SYSTEM] Backlog Master',
    artifactType: 'backlog',
    note: 'Artefato consolidado pelo Project Manager',
  },
  architect: {
    title: '[SYSTEM] Architecture Master',
    artifactType: 'architecture',
    note: 'Artefato consolidado pelo Architect',
  },
  developer: {
    title: '[SYSTEM] Development Master',
    artifactType: 'code',
    note: 'Artefato consolidado pelo Developer',
  },
  requirement_challenger: {
    title: '[SYSTEM] Requirement Challenge',
    artifactType: 'custom',
    contentFormat: 'json',
    note: 'Diagnóstico de riscos e lacunas pelo Requirement Challenger',
  },
};

function buildArchitectureBlockers({
  totalStories,
  pendingStories,
}) {
  const blockers = [];

  if (!totalStories) {
    blockers.push('Crie e refine pelo menos uma historia antes de gerar a arquitetura.');
  }

  if (pendingStories > 0) {
    blockers.push(`Ainda faltam ${pendingStories} historias com requisitos refinados.`);
  }

  return blockers;
}

export async function getProjectArchitectureStatus(projectUuid, userUuid = null) {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(userUuid),
    },
    select: {
      id: true,
      uuid: true,
      name: true,
      description: true,
      vision: true,
      intakeConfig: true,
      tasks: {
        where: {
          taskType: 'story',
        },
        select: {
          id: true,
          uuid: true,
          title: true,
          status: true,
          taskType: true,
          artifacts: {
            where: {
              isCurrent: true,
              artifactScope: 'refinement',
              artifactType: {
                in: ['requirements', ...QA_ARTIFACT_TYPES],
              },
            },
            select: {
              id: true,
              uuid: true,
              artifactType: true,
              title: true,
              content: true,
              version: true,
              createdAt: true,
              isCurrent: true,
              isApproved: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const architectureTask = await prisma.task.findFirst({
    where: {
      projectId: project.id,
      title: stageTaskConfig.architect.title,
    },
    select: {
      uuid: true,
      artifacts: {
        where: {
          artifactType: 'architecture',
          artifactScope: 'refinement',
          isCurrent: true,
        },
        select: {
          uuid: true,
          title: true,
          content: true,
          version: true,
          createdAt: true,
          isCurrent: true,
          isApproved: true,
          approvedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const totalStories = project.tasks.length;
  const refinedTasks = project.tasks.filter((task) =>
    task.artifacts.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)
  );
  const refinedStories = refinedTasks.length;
  const qaApprovedStories = project.tasks.filter((task) =>
    task.artifacts.some((artifact) => QA_ARTIFACT_TYPES.includes(artifact.artifactType) && artifact.isCurrent && artifact.isApproved)
  ).length;
  const pendingTasks = project.tasks.filter(
    (task) => !task.artifacts.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)
  );
  const pendingStories = pendingTasks.length;
  const allStoriesRefined = totalStories > 0 && pendingStories === 0;

  const architectureArtifact = architectureTask?.artifacts?.[0] || null;
  const hasArchitecture = Boolean(architectureArtifact);
  const architectureApproved = Boolean(architectureArtifact?.isApproved);
  const architectureNeedsRefresh = false;
  const allStoriesQaApproved = totalStories > 0 && qaApprovedStories === totalStories;
  const canGenerateArchitecture = false;
  const canGenerateCode = allStoriesRefined && allStoriesQaApproved;
  const blockers = buildArchitectureBlockers({
    totalStories,
    pendingStories,
    hasArchitecture,
    architectureNeedsRefresh,
    architectureApproved,
  });
  if (allStoriesRefined && !allStoriesQaApproved) blockers.push(`${totalStories - qaApprovedStories} task(s) ainda aguardam aprovação do QA.`);

  return {
    projectUuid: project.uuid,
    projectName: project.name,
    totalStories,
    refinedStories,
    pendingStories,
    allStoriesRefined,
    qaApprovedStories,
    allStoriesQaApproved,
    canGenerateArchitecture,
    hasArchitecture,
    architectureApproved,
    architectureNeedsRefresh,
    canGenerateCode,
    blockers,
    pendingTasks: pendingTasks.map((task) => ({
      uuid: task.uuid,
      title: task.title,
      status: task.status,
    })),
    architectureArtifact: architectureArtifact
      ? {
          ...architectureArtifact,
          taskUuid: architectureTask?.uuid || null,
          preview: String(architectureArtifact.content || '').slice(0, 600),
        }
      : null,
  };
}

export async function approveCurrentArchitectureArtifact(projectUuid, approvedByUserUuid) {
  const project = await prisma.project.findFirst({
    where: {
      uuid: projectUuid,
      ...buildProjectAccessFilter(approvedByUserUuid),
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const approvedByUser = await prisma.user.findUnique({
    where: { uuid: approvedByUserUuid },
    select: { id: true },
  });

  if (!approvedByUser?.id) {
    throw new Error('UsuÃ¡rio aprovador nÃ£o encontrado.');
  }

  const architectureTask = await prisma.task.findFirst({
    where: {
      projectId: project.id,
      title: stageTaskConfig.architect.title,
    },
    select: {
      id: true,
      status: true,
      artifacts: {
        where: {
          artifactType: 'architecture',
          artifactScope: 'refinement',
          isCurrent: true,
        },
        select: {
          id: true,
          version: true,
          isApproved: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const currentArtifact = architectureTask?.artifacts?.[0];
  if (!architectureTask || !currentArtifact) {
    throw new Error('Nenhum artefato de arquitetura atual encontrado para aprovaÃ§Ã£o.');
  }

  const approvedArtifact = await prisma.taskArtifact.update({
    where: { id: currentArtifact.id },
    data: {
      isApproved: true,
      approvedBy: approvedByUser.id,
      approvedAt: new Date(),
    },
    select: {
      uuid: true,
      version: true,
      isApproved: true,
      approvedAt: true,
    },
  });

  await prisma.taskStatusHistory.create({
    data: {
      taskId: architectureTask.id,
      fromStatus: architectureTask.status,
      toStatus: architectureTask.status,
      changedByUserId: approvedByUser.id,
      note: `Arquitetura aprovada manualmente (artefato v${approvedArtifact.version}).`,
    },
  });

  return approvedArtifact;
}

export async function getProjectDocumentationBundle(projectUuid, userUuid = null) {
  const [project, tasks, architectureStatus] = await Promise.all([
    getProjectByUuid(projectUuid, userUuid),
    listProjectTasks(projectUuid, {}, userUuid),
    getProjectArchitectureStatus(projectUuid, userUuid),
  ]);

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  const backlogTask = await prisma.task.findFirst({
    where: {
      projectId: project.id,
      title: stageTaskConfig.project_manager.title,
    },
    select: {
      uuid: true,
      artifacts: {
        where: {
          artifactType: 'backlog',
          artifactScope: 'refinement',
          isCurrent: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const backlogArtifact = backlogTask?.artifacts?.[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    project: {
      uuid: project.uuid,
      name: project.name,
      description: project.description,
      vision: project.vision,
      status: project.status,
      workspace: project.workspace,
      creator: project.creator,
      intakeConfig: project.intakeConfig || null,
    },
    summary: {
      totalTasks: tasks.length,
      totalEpics: tasks.filter((task) => task.taskType === 'epic').length,
      totalStories: tasks.filter((task) => task.taskType === 'story').length,
      totalTechnicalTasks: tasks.filter((task) => task.taskType === 'task').length,
      refinedStories: architectureStatus.refinedStories || 0,
      storiesWithTestPlan: tasks.filter((task) =>
        (task.artifacts || []).some((artifact) => QA_ARTIFACT_TYPES.includes(artifact.artifactType) && artifact.isCurrent)
      ).length,
      hasBacklog: Boolean(backlogArtifact),
      hasArchitecture: Boolean(architectureStatus.architectureArtifact),
    },
    backlogArtifact,
    architectureArtifact: architectureStatus.architectureArtifact || null,
    architectureStatus,
    tasks: tasks.map((task) => ({
      uuid: task.uuid,
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      status: task.status,
      priority: task.priority,
      assigneeAgentName: task.assigneeAgentName,
      artifacts: (task.artifacts || []).map((artifact) => ({
        uuid: artifact.uuid,
        artifactType: artifact.artifactType,
        title: artifact.title,
        content: artifact.content,
        version: artifact.version,
        createdAt: artifact.createdAt,
        isCurrent: artifact.isCurrent,
      })),
    })),
  };
}

export async function ensureStageTask(projectUuid, agentName) {
  const config = stageTaskConfig[agentName];
  if (!config) return null;

  const project = await getProjectRecordByUuid(projectUuid);

  const existingTask = await prisma.task.findFirst({
    where: {
      projectId: project.id,
      title: config.title,
    },
    include: taskListInclude,
  });

  if (existingTask) {
    return existingTask;
  }

  return prisma.task.create({
    data: {
      uuid: randomUUID(),
      projectId: project.id,
      title: config.title,
      description: config.note,
      taskType: 'agent_job',
      status: 'done',
      priority: 'medium',
      assigneeType: 'agent',
      assigneeAgentName: agentName,
      createdBy: project.creator.id,
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: 'done',
          changedByUserId: project.creator.id,
          note: config.note,
        },
      },
    },
    include: taskListInclude,
  });
}

export async function createAgentRunStart(projectUuid, agentName, payload = {}) {
  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { id: true },
  });

  if (!project) {
    throw new Error('Projeto nÃ£o encontrado.');
  }

  let taskId = null;
  if (payload.task_uuid) {
    const task = await prisma.task.findUnique({
      where: { uuid: payload.task_uuid },
      select: { id: true },
    });
    taskId = task?.id || null;
  }

  const blockingRunRecoveryWindowSeconds = Number(
    process.env.AGENT_RUN_BLOCKING_RECOVERY_WINDOW_SECONDS || 180
  );
  const recoveryResult = await recoverBlockingAgentRunsForStart({
    projectId: project.id,
    agentName,
    taskId,
    maxAgeSeconds: blockingRunRecoveryWindowSeconds,
  });

  if (recoveryResult.recoveredCount > 0) {
    recordRuntimeEvent('agent_run_retry_opened', {
      agentName,
      projectId: project.id,
      taskId,
      recoveredCount: recoveryResult.recoveredCount,
    });
    logWarn('agent_run_retry_opened', {
      agentName,
      projectId: project.id,
      taskId,
      recoveredCount: recoveryResult.recoveredCount,
    });
  }

  const existingRunningRun = await prisma.agentRun.findFirst({
    where: {
      projectId: project.id,
      agentName,
      taskId,
      status: 'running',
    },
    select: {
      uuid: true,
      createdAt: true,
    },
  });

  if (existingRunningRun) {
    const conflictError = new Error(
      `Ja existe uma execucao em andamento para ${agentName}${payload.task_uuid ? ' nesta task' : ' neste projeto'} (run ${existingRunningRun.uuid}).`
    );
    conflictError.statusCode = 409;
    conflictError.code = 'AGENT_RUN_CONFLICT';
    conflictError.existingRunUuid = existingRunningRun.uuid;
    conflictError.agentName = agentName;
    conflictError.projectUuid = projectUuid;
    conflictError.taskUuid = payload.task_uuid || null;
    throw conflictError;
  }

  const createdRun = await prisma.agentRun.create({
    data: {
      uuid: randomUUID(),
      projectId: project.id,
      taskId,
      agentName,
      triggerType: 'manual',
      inputPayload: JSON.stringify(payload),
      outputFormat: 'markdown',
      status: 'running',
      startedAt: new Date(),
    },
  });

  recordRuntimeEvent('agent_run_started', {
    agentName,
    runUuid: createdRun.uuid,
    projectId: project.id,
    taskId,
    triggerType: 'manual',
  });
  logInfo('agent_run_started', {
    agentName,
    runUuid: createdRun.uuid,
    projectId: project.id,
    taskId,
    triggerType: 'manual',
  });

  return createdRun;
}

export async function finishAgentRun(agentRunId, { status, result, errorMessage, diagnostic = null, usageMeta = null }) {
  const existingRun = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      uuid: true,
      inputPayload: true,
      projectId: true,
      taskId: true,
      agentName: true,
      startedAt: true,
    },
  });

  const outputText = result
    ? typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2)
    : null;
  const diagnosticText = diagnostic
    ? (typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic))
    : null;

  const updatedRun = await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      status,
      outputText,
      errorMessage: errorMessage || null,
      tokensInput: usageMeta?.tokensInput ?? estimateTokenCount(existingRun?.inputPayload || ''),
      tokensOutput: usageMeta?.tokensOutput ?? estimateTokenCount(outputText || ''),
      costUsd: usageMeta?.costUsd ?? null,
      finishedAt: new Date(),
    },
  });

  // Keep this raw update until every running backend has reloaded the Prisma
  // client generated from the schema containing AgentRun.diagnostic. It also
  // makes the operational record independent from a stale in-memory client
  // during a rolling restart.
  if (diagnosticText) {
    await prisma.$executeRaw`
      UPDATE agent_runs
      SET diagnostic = ${diagnosticText}
      WHERE id = ${agentRunId}
    `;
  }

  const durationSeconds = existingRun?.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(existingRun.startedAt).getTime()) / 1000))
    : null;
  const totalTokens =
    usageMeta?.tokensInput !== undefined || usageMeta?.tokensOutput !== undefined
      ? Number(usageMeta?.tokensInput || 0) + Number(usageMeta?.tokensOutput || 0)
      : estimateTokenCount(outputText || '');

  if (status === 'completed') {
    recordRuntimeEvent('agent_run_completed', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      totalTokens,
    });
    logInfo('agent_run_completed', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      totalTokens,
      costUsd: usageMeta?.costUsd ?? null,
    });
  } else if (status === 'failed') {
    recordRuntimeEvent('agent_run_failed', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
    logWarn('agent_run_failed', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
  } else if (status === 'aborted') {
    recordRuntimeEvent('agent_run_aborted', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
    logWarn('agent_run_aborted', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
  } else if (status === 'stale') {
    recordRuntimeEvent('agent_run_stale', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
    logWarn('agent_run_stale', {
      agentName: existingRun?.agentName || 'unknown',
      runUuid: existingRun?.uuid || null,
      projectId: existingRun?.projectId || null,
      taskId: existingRun?.taskId || null,
      durationSeconds,
      errorMessage: errorMessage || null,
    });
  }

  return updatedRun;
}

export async function restoreTaskAfterAgentFailure(taskUuid, previousState, { changedByUserUuid, failedAgentName, errorMessage }) {
  const existingTask = await prisma.task.findUnique({
    where: { uuid: taskUuid },
    select: { id: true, status: true },
  });

  if (!existingTask) {
    throw new Error('Tarefa nÃ£o encontrada.');
  }

  const changedByUser = changedByUserUuid
    ? await prisma.user.findUnique({
        where: { uuid: changedByUserUuid },
        select: { id: true },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: existingTask.id },
      data: {
        status: previousState.status,
        assigneeType: previousState.assigneeType || 'unassigned',
        assigneeUserId: previousState.assigneeUserId || null,
        assigneeAgentName: previousState.assigneeAgentName || null,
        startedAt: previousState.startedAt || null,
        completedAt: previousState.completedAt || null,
        currentArtifactSummary: previousState.currentArtifactSummary || null,
      },
    });

    await tx.taskStatusHistory.create({
      data: {
        taskId: existingTask.id,
        fromStatus: existingTask.status,
        toStatus: previousState.status,
        changedByUserId: changedByUser?.id || null,
        note: `Falha ao executar ${failedAgentName}. Task retornada para ${previousState.status}. Erro: ${String(errorMessage || 'Sem detalhes').slice(0, 420)}`,
      },
    });
  });

  const updatedTask = await prisma.task.findUnique({
    where: { id: existingTask.id },
    include: {
      ...taskListInclude,
      agentRuns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  recordRuntimeEvent('task_restore_after_failure', {
    agentName: failedAgentName,
    taskUuid,
    restoredStatus: previousState.status,
  });
  logWarn('task_restore_after_failure', {
    agentName: failedAgentName,
    taskUuid,
    restoredStatus: previousState.status,
    errorMessage: errorMessage || null,
  });

  return enrichTask(updatedTask);
}

export async function persistAgentResult(projectUuid, agentName, payload, result) {
  if (!projectUuid || !stageTaskConfig[agentName]) return null;

  if (payload?.task_uuid) {
    return null;
  }

  const config = stageTaskConfig[agentName];
  const stageTask = await ensureStageTask(projectUuid, agentName);
  const content =
    agentName === 'project_manager' && result?.markdown
      ? result.markdown
      :
    typeof result === 'string'
      ? result
      : agentName === 'developer' && result?.code
        ? result.code
        : JSON.stringify(result, null, 2);

  const artifact = await createTaskArtifact(stageTask.uuid, {
    artifactType: config.artifactType,
    title: config.title,
    content,
    contentFormat: config.contentFormat || 'markdown',
    createdByAgentName: agentName,
  });

  if (agentName === 'project_manager') {
    const projectRecord = await prisma.project.findUnique({
      where: { uuid: projectUuid },
      select: { intakeConfig: true },
    });
    await persistBacklogContractArtifact(projectUuid, projectRecord, content, result?.backlog_contract || null);
  }

  if (agentName === 'architect') {
    const projectRecord = await prisma.project.findUnique({
      where: { uuid: projectUuid },
      select: { name: true, intakeConfig: true },
    });
    await persistSolutionBlueprintArtifact(projectUuid, projectRecord, content);
  }

  recordRuntimeEvent('stage_artifact_persisted', {
    agentName,
    projectId: stageTask.projectId || null,
    taskUuid: stageTask.uuid,
    artifactType: config.artifactType,
  });
  logInfo('stage_artifact_persisted', {
    agentName,
    projectId: stageTask.projectId || null,
    taskUuid: stageTask.uuid,
    artifactType: config.artifactType,
    artifactTitle: config.title,
  });

  return artifact;
}
