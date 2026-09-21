import { prisma } from '../src/lib/prisma.js';
import { runSingleAgent } from '../src/services/orchestratorService.js';
import { buildRuntimeAiEnvForUser } from '../src/services/aiSettingsService.js';
import {
  createAgentRunStart,
  createQaArtifacts,
  createRequirementsArtifacts,
  finishAgentRun,
  persistAgentResult,
} from '../src/services/projectDataService.js';
import { assertArtifactCompleteness } from '../src/utils/artifactQuality.js';
import { buildAgentRunUsage, withAiRuntimeMeta } from '../src/utils/aiRunMetrics.js';

function compactText(value = '', maxLength = 220) {
  const text = String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function extractCompactRequirementSection(content = '', sectionTitle = '', maxLength = 260) {
  const normalized = String(content || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`##+\\s+${escaped}\\s*([\\s\\S]*?)(?=\\n##+\\s+|$)`, 'i'));
  return compactText(match ? match[1] : '', maxLength);
}

function buildQaRequirementSummary(requirementsContent = '') {
  const userStory = extractCompactRequirementSection(requirementsContent, 'User Story Refinada', 180);
  const functional = extractCompactRequirementSection(requirementsContent, 'Requisitos Funcionais', 360);
  const mainFlow = extractCompactRequirementSection(requirementsContent, 'Fluxo Principal', 220);
  const rules = extractCompactRequirementSection(requirementsContent, 'Regras de Negocio', 220);
  const acceptance = extractCompactRequirementSection(requirementsContent, 'Criterios de Aceite (BDD)', 260);

  return [
    userStory ? `User Story Refinada:\n${userStory}` : null,
    functional ? `Requisitos Funcionais:\n${functional}` : null,
    mainFlow ? `Fluxo Principal:\n${mainFlow}` : null,
    rules ? `Regras de Negocio:\n${rules}` : null,
    acceptance ? `Criterios de Aceite:\n${acceptance}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildCompactRequirementBacklog(task) {
  const projectDna = task.project?.intakeConfig?.projectDna || null;
  const projectDnaSummary = projectDna
    ? [
        projectDna.project?.productMode ? `Product mode: ${projectDna.project.productMode}` : null,
        projectDna.project?.experienceStyle ? `Experience style: ${projectDna.project.experienceStyle}` : null,
        projectDna.project?.primaryActor ? `Ator principal: ${projectDna.project.primaryActor}` : null,
        Array.isArray(projectDna.project?.domainLanguage) && projectDna.project.domainLanguage.length
          ? `Linguagem do dominio: ${projectDna.project.domainLanguage.slice(0, 8).join(', ')}` 
          : null,
      ]
        .filter(Boolean)
        .join(' | ')
    : null;

  return [
    `Historia alvo: ${compactText(task.title, 140)}`,
    task.description ? `Contexto imediato: ${compactText(task.description, 180)}` : null,
    task.project?.description ? `Projeto: ${compactText(task.project.description, 140)}` : null,
    task.project?.vision ? `Visao: ${compactText(task.project.vision, 160)}` : null,
    projectDnaSummary ? `Project DNA: ${compactText(projectDnaSummary, 240)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function compactWhitespace(value = '') {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMarkdownSection(content, sectionTitle) {
  const normalized = compactWhitespace(content);
  if (!normalized) return '';

  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`##+\\s+${escaped}\\s*([\\s\\S]*?)(?=\\n##+\\s+|$)`, 'i');
  const match = normalized.match(regex);
  return match ? compactWhitespace(match[1]) : '';
}

function clampText(value, maxLength = 420) {
  const text = compactWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function compactRequirementArtifact(content) {
  const userStory = clampText(extractMarkdownSection(content, 'User Story Refinada'), 180);
  const functional = clampText(extractMarkdownSection(content, 'Requisitos Funcionais'), 420);
  const rules = clampText(extractMarkdownSection(content, 'Regras de Negocio'), 260);
  const acceptance = clampText(extractMarkdownSection(content, 'Criterios de Aceite (BDD)'), 320);

  return [
    userStory ? `User Story Refinada:\n${userStory}` : null,
    functional ? `Requisitos Funcionais:\n${functional}` : null,
    rules ? `Regras de Negocio:\n${rules}` : null,
    acceptance ? `Criterios de Aceite:\n${acceptance}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function compactProjectBrief(project) {
  return [
    `Projeto: ${project?.name || 'Projeto'}`,
    project?.description ? `Descricao: ${clampText(project.description, 180)}` : null,
    project?.vision ? `Visao: ${clampText(project.vision, 220)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function compactProjectDnaForAgent(projectDna) {
  if (!projectDna || typeof projectDna !== 'object') return '';

  const project = projectDna.project || {};
  const positioning = projectDna.positioning || {};
  const designSystem = projectDna.designSystem || {};
  const coherenceRules = projectDna.coherenceRules || {};

  const domainLanguage = Array.isArray(project.domainLanguage) ? project.domainLanguage.slice(0, 8).join(', ') : '';
  const allowedScreenFamilies = Array.isArray(designSystem.allowedScreenFamilies)
    ? designSystem.allowedScreenFamilies.slice(0, 6).join(', ')
    : '';

  return [
    'Project DNA:',
    project.productMode ? `- Product mode: ${project.productMode}` : null,
    project.experienceStyle ? `- Experience style: ${project.experienceStyle}` : null,
    project.primaryActor ? `- Ator principal: ${project.primaryActor}` : null,
    domainLanguage ? `- Linguagem do dominio: ${domainLanguage}` : null,
    positioning.summary ? `- Resumo: ${clampText(positioning.summary, 180)}` : null,
    positioning.promise ? `- Promessa: ${clampText(positioning.promise, 180)}` : null,
    allowedScreenFamilies ? `- Familias de tela permitidas: ${allowedScreenFamilies}` : null,
    Array.isArray(coherenceRules.mustPreserve) && coherenceRules.mustPreserve.length
      ? `- Preservar: ${coherenceRules.mustPreserve.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function compactArchitectureBacklogContract(project) {
  const backlogContract = project?.intakeConfig?.backlogContract;
  if (!backlogContract || typeof backlogContract !== 'object') return '';

  const capabilities = Array.isArray(backlogContract.capabilities)
    ? backlogContract.capabilities.slice(0, 6).map((item) => item?.name || '').filter(Boolean).join(', ')
    : '';
  const epics = Array.isArray(backlogContract.epics)
    ? backlogContract.epics.slice(0, 6).map((item) => item?.name || '').filter(Boolean).join(', ')
    : '';
  const releaseSlices = Array.isArray(backlogContract.releaseSlices)
    ? backlogContract.releaseSlices.slice(0, 4).map((item) => item?.name || '').filter(Boolean).join(', ')
    : '';

  return [
    'Backlog Contract:',
    capabilities ? `- Capacidades: ${capabilities}` : null,
    epics ? `- Epicos: ${epics}` : null,
    releaseSlices ? `- Releases: ${releaseSlices}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function regenerateQaForTask(project, task, envOverrides) {
  const latestRequirements = (task.artifacts || []).find((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent);
  if (!latestRequirements?.content) {
    return { taskUuid: task.uuid, title: task.title, status: 'skipped', reason: 'sem requisito corrente' };
  }

  const latestRequirementSpec = (task.artifacts || []).find(
    (artifact) => artifact.title === '[SYSTEM] Requirement Spec' && artifact.isCurrent
  );

  const requirementSummary = buildQaRequirementSummary(latestRequirements.content);
  const projectDnaSummary = compactProjectDnaForAgent(project?.intakeConfig?.projectDna || null);
  const payload = {
    project_id: project.uuid,
    task_uuid: task.uuid,
    idea: `Crie o plano de testes apenas para esta tarefa: ${task.title}${
      task.description ? `\n\nContexto especifico da tarefa: ${task.description}` : ''
    }`,
    code_structure: requirementSummary,
    developer_output: {
      code: requirementSummary,
    },
    project_name: project.name,
    project_context: {
      description: compactText(project.description, 180),
      vision: compactText(project.vision, 220),
      project_dna: compactText(projectDnaSummary, 240),
    },
    requirement_summary: requirementSummary,
    requirement_spec: latestRequirementSpec?.content || '',
  };

  const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
  const agentRun = await createAgentRunStart(project.uuid, 'qa_engineer', payloadWithRuntime);

  try {
    const result = await runSingleAgent('qa_engineer', payloadWithRuntime, { envOverrides });
    const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    assertArtifactCompleteness('qa_engineer', content);
    await finishAgentRun(agentRun.id, {
      status: 'completed',
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });
    await createQaArtifacts(task.uuid, {
      title: `Plano de testes - ${task.title}`,
      content,
      contentFormat: 'markdown',
      createdByAgentName: 'qa_engineer',
      agentRunId: agentRun.id,
    });
    return { taskUuid: task.uuid, title: task.title, status: 'completed' };
  } catch (error) {
    await finishAgentRun(agentRun.id, {
      status: 'failed',
      errorMessage: error.message,
      usageMeta: null,
    }).catch(() => null);
    return { taskUuid: task.uuid, title: task.title, status: 'failed', reason: error.message };
  }
}

async function regenerateRequirementsForTask(project, task, envOverrides) {
  const payload = {
    project_id: project.uuid,
    task_uuid: task.uuid,
    idea: `Refine somente esta história de usuário: ${task.title}${
      task.description ? `\n\nContexto complementar da tarefa: ${task.description}` : ''
    }`,
    backlog: buildCompactRequirementBacklog({
      ...task,
      project,
    }),
    project_name: project.name,
    project_context: {
      description: compactText(project.description, 180),
      vision: compactText(project.vision, 220),
    },
  };

  const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
  const agentRun = await createAgentRunStart(project.uuid, 'requirements_analyst', payloadWithRuntime);

  try {
    const result = await runSingleAgent('requirements_analyst', payloadWithRuntime, { envOverrides });
    const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    assertArtifactCompleteness('requirements_analyst', content);
    await finishAgentRun(agentRun.id, {
      status: 'completed',
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });
    await createRequirementsArtifacts(task.uuid, {
      title: `Requisitos refinados - ${task.title}`,
      content,
      contentFormat: 'markdown',
      createdByAgentName: 'requirements_analyst',
      agentRunId: agentRun.id,
    });
    return { taskUuid: task.uuid, title: task.title, status: 'completed' };
  } catch (error) {
    await finishAgentRun(agentRun.id, {
      status: 'failed',
      errorMessage: error.message,
      usageMeta: null,
    }).catch(() => null);
    return { taskUuid: task.uuid, title: task.title, status: 'failed', reason: error.message };
  }
}

async function regenerateArchitecture(project, envOverrides) {
  const refinedStories = (project.tasks || [])
    .filter((task) => task.taskType !== 'agent_job')
    .map((task) => {
      const requirementsArtifact = (task.artifacts || []).find(
        (artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent
      );

      return {
        taskUuid: task.uuid,
        title: task.title,
        description: clampText(task.description || '', 220),
        requirements: compactRequirementArtifact(requirementsArtifact?.content || ''),
      };
    })
    .filter((story) => story.requirements);

  const requirementsBundle = refinedStories
    .map((story, index) =>
      [
        `## Historia ${index + 1}: ${clampText(story.title, 120)}`,
        `UUID: ${story.taskUuid}`,
        story.description ? `Contexto: ${clampText(story.description, 120)}` : null,
        story.requirements,
      ]
        .filter(Boolean)
        .join('\n\n')
    )
    .join('\n\n---\n\n');

  const payload = {
    project_id: project.uuid,
    idea: compactProjectBrief(project),
    requirements: requirementsBundle,
    project_name: project?.name || 'Projeto',
    project_context: {
      description: project?.description || '',
      vision: project?.vision || '',
      intake: project?.intakeConfig || {},
      project_dna: compactProjectDnaForAgent(project?.intakeConfig?.projectDna || null),
      backlog_contract: compactArchitectureBacklogContract(project),
      stories: refinedStories.map((story) => ({
        taskUuid: story.taskUuid,
        title: story.title,
      })),
    },
  };

  const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
  const agentRun = await createAgentRunStart(project.uuid, 'architect', payloadWithRuntime);

  try {
    const result = await runSingleAgent('architect', payloadWithRuntime, { envOverrides });
    const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    assertArtifactCompleteness('architect', content);
    await finishAgentRun(agentRun.id, {
      status: 'completed',
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });
    await persistAgentResult(project.uuid, 'architect', payloadWithRuntime, result);
    return { status: 'completed' };
  } catch (error) {
    await finishAgentRun(agentRun.id, {
      status: 'failed',
      errorMessage: error.message,
      usageMeta: null,
    }).catch(() => null);
    return { status: 'failed', reason: error.message };
  }
}

const rawArgs = process.argv.slice(2);
const taskFilterArg = rawArgs.find((arg) => arg.startsWith('--tasks='));
const architectureOnly = rawArgs.includes('--architecture-only');
const qaOnly = rawArgs.includes('--qa-only');
const requirementsOnly = rawArgs.includes('--requirements-only');
const requirementsFirst = rawArgs.includes('--requirements-first');
const projectName = rawArgs
  .filter((arg) => !arg.startsWith('--'))
  .join(' ')
  .trim();

if (!projectName) {
  console.error('Uso: node scripts/regenerate-project-artifacts.mjs "Nome do projeto" [--tasks=uuid1,uuid2] [--qa-only] [--requirements-only] [--requirements-first] [--architecture-only]');
  process.exit(1);
}

const taskFilter = new Set(
  String(taskFilterArg || '')
    .replace('--tasks=', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const project = await prisma.project.findFirst({
  where: { name: { contains: projectName } },
  select: {
    id: true,
    uuid: true,
    name: true,
    description: true,
    vision: true,
    intakeConfig: true,
    creator: { select: { uuid: true } },
    tasks: {
      orderBy: [{ createdAt: 'asc' }],
      select: {
        taskType: true,
        uuid: true,
        title: true,
        description: true,
        artifacts: {
          where: { isCurrent: true, artifactScope: 'refinement' },
          select: {
            title: true,
            artifactType: true,
            isCurrent: true,
            content: true,
          },
        },
      },
    },
  },
});

if (!project) {
  console.error(`Projeto nao encontrado: ${projectName}`);
  await prisma.$disconnect();
  process.exit(1);
}

const actorUserUuid = project.creator?.uuid;
if (!actorUserUuid) {
  console.error('Projeto sem creator.uuid para recuperar configuracao de IA.');
  await prisma.$disconnect();
  process.exit(1);
}

const qaEnvOverrides = await buildRuntimeAiEnvForUser(actorUserUuid, { agentName: 'qa_engineer' });
const architectEnvOverrides = await buildRuntimeAiEnvForUser(actorUserUuid, { agentName: 'architect' });
const requirementsEnvOverrides = await buildRuntimeAiEnvForUser(actorUserUuid, { agentName: 'requirements_analyst' });

const qaTargetTasks = project.tasks.filter(
  (task) =>
    task.taskType !== 'agent_job' &&
    task.title !== '[SYSTEM] Backlog Master' &&
    task.title !== '[SYSTEM] Architecture Master' &&
    (!taskFilter.size || taskFilter.has(task.uuid))
);

const requirementResults = [];
if (requirementsOnly || requirementsFirst) {
  for (const task of qaTargetTasks) {
    console.log(`Regenerando requisitos: ${task.title}`);
    const taskResult = await regenerateRequirementsForTask(project, task, requirementsEnvOverrides);
    requirementResults.push(taskResult);
    console.log(` -> ${taskResult.status}${taskResult.reason ? ` | ${taskResult.reason}` : ''}`);
  }
}

const qaResults = [];
if (!architectureOnly && !requirementsOnly) {
  for (const task of qaTargetTasks) {
    console.log(`Regenerando QA: ${task.title}`);
    const taskResult = await regenerateQaForTask(project, task, qaEnvOverrides);
    qaResults.push(taskResult);
    console.log(` -> ${taskResult.status}${taskResult.reason ? ` | ${taskResult.reason}` : ''}`);
  }
}

let architectureResult = { status: 'skipped' };
if (!qaOnly) {
  console.log('Regenerando Architecture Master...');
  architectureResult = await regenerateArchitecture(project, architectEnvOverrides);
  console.log(` -> ${architectureResult.status}${architectureResult.reason ? ` | ${architectureResult.reason}` : ''}`);
}

const summary = {
  project: {
    uuid: project.uuid,
    name: project.name,
  },
  requirements: {
    total: requirementResults.length,
    completed: requirementResults.filter((item) => item.status === 'completed').length,
    failed: requirementResults.filter((item) => item.status === 'failed').length,
    skipped: requirementResults.filter((item) => item.status === 'skipped').length,
    items: requirementResults,
  },
  qa: {
    total: qaResults.length,
    completed: qaResults.filter((item) => item.status === 'completed').length,
    failed: qaResults.filter((item) => item.status === 'failed').length,
    skipped: qaResults.filter((item) => item.status === 'skipped').length,
    items: qaResults,
  },
  architecture: architectureResult,
};

console.log(JSON.stringify(summary, null, 2));
await prisma.$disconnect();
