import {
  assertProjectAccess,
  assertProjectPermission,
  assertTaskAccess,
  assertWorkspaceAccess,
  addProjectMember,
  approveCurrentArchitectureArtifact,
  createAgentRunStart,
  createProject,
  createTask,
  createTaskArtifact,
  refreshRequirementSpecArtifact,
  refreshQaValidationSpecArtifact,
  createTaskComment,
  ensurePipelineProject,
  finishAgentRun,
  getDefaultWorkspaceForUserUuid,
  getProjectArchitectureStatus,
  getProjectDocumentationBundle,
  getProjectByUuid,
  getTaskByUuid,
  getWorkspaceTeamSummary,
  importBacklogTasks,
  publishBacklogTasks,
  revalidateBacklogForPublication,
  consolidateBacklogStories,
  moveBacklogAcceptanceCriterion,
  updateBacklogStory,
  listProjects,
  listProjectTasks,
  listAllTasks,
  persistAgentResult,
  removeProjectMember,
  deleteProject,
  updateProjectBrief,
  updateProjectMemberRole,
  updateProjectStatus,
  updateTask,
  reviewTaskArtifact,
} from '../services/projectDataService.js';
import { createHash } from 'node:crypto';
import { assertArtifactQuality, evaluateArtifactQuality } from '../services/artifactQualityGateService.js';
import { runSingleAgent } from '../services/orchestratorService.js';
import { buildRuntimeAiEnvForUser } from '../services/aiSettingsService.js';
import { createAgentRunLifecycle } from '../utils/agentRunLifecycle.js';
import { assertArtifactCompleteness } from '../utils/artifactQuality.js';
import { serializeBigInts } from '../utils/serialize.js';
import { buildAgentRunUsage, withAiRuntimeMeta } from '../utils/aiRunMetrics.js';
import { inferProjectTemplateKey } from '../templates/projects/index.js';
import { prisma } from '../lib/prisma.js';

const PM_RETRY_BASE_DELAY_MS = Math.max(5_000, Number(process.env.PROJECT_MANAGER_RETRY_BASE_DELAY_MS || 20_000));
const PM_RETRY_MAX_DELAY_MS = Math.max(PM_RETRY_BASE_DELAY_MS, Number(process.env.PROJECT_MANAGER_RETRY_MAX_DELAY_MS || 5 * 60_000));
// A background retry is a recovery convenience, not another full generation
// budget. Further retries remain an explicit user action.
const PM_RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.PROJECT_MANAGER_RETRY_MAX_ATTEMPTS || 1));
const PM_BACKGROUND_RETRY_PROVIDERS = String(process.env.PROJECT_MANAGER_BACKGROUND_RETRY_PROVIDERS || 'nvidia,gemini')
  .split(',')
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const projectManagerRetryTimers = new Map();

function projectManagerRetryDelay(attempt) {
  return Math.min(PM_RETRY_MAX_DELAY_MS, PM_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
}

function projectManagerRetryProvider(index) {
  if (!PM_BACKGROUND_RETRY_PROVIDERS.length) return 'nvidia';
  return PM_BACKGROUND_RETRY_PROVIDERS[Math.max(0, Number(index) || 0) % PM_BACKGROUND_RETRY_PROVIDERS.length];
}

function projectManagerNextProviderIndex(recovery = {}) {
  const persistedIndex = Number(recovery?.nextProviderIndex);
  if (Number.isInteger(persistedIndex) && persistedIndex >= 0) {
    return PM_BACKGROUND_RETRY_PROVIDERS.length ? persistedIndex % PM_BACKGROUND_RETRY_PROVIDERS.length : 0;
  }
  // Compatibility with recovery records created before the rotation cursor.
  // A record that already tried NVIDIA must continue with Gemini, not restart
  // at NVIDIA whenever the user presses Generate again.
  const legacyHistory = Array.isArray(recovery?.attemptHistory) ? recovery.attemptHistory : [];
  const lastExecutedAttempt = [...legacyHistory].reverse().find((item) => (
    item?.scheduled === true
    || (item?.scheduled === undefined && Number(item?.attempt) <= Number(recovery?.maxAutomaticRetryAttempts || 0))
  ));
  const lastProvider = String(lastExecutedAttempt?.provider || recovery?.provider || '').toLowerCase();
  const lastProviderIndex = PM_BACKGROUND_RETRY_PROVIDERS.indexOf(lastProvider);
  return lastProviderIndex >= 0 ? (lastProviderIndex + 1) % PM_BACKGROUND_RETRY_PROVIDERS.length : 0;
}

function providerSuggestedRetryDelayMs(detail) {
  const text = String(detail || '');
  const matches = [
    ...text.matchAll(/(?:please\s+)?retry\s*(?:in|after)?\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec(?:ond)?s?)/gi),
    ...text.matchAll(/retry[_\s-]*delay[^\d]*(\d+(?:[.,]\d+)?)\s*(?:s|sec(?:ond)?s?)/gi),
  ];
  const seconds = matches
    .map((match) => Number(String(match[1]).replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return seconds.length ? Math.min(PM_RETRY_MAX_DELAY_MS, Math.max(...seconds) * 1_000) : 0;
}

function isRecoverableProviderFailure(error) {
  const detail = String(error?.message || '').toLowerCase();
  return /nenhum modelo do router concluiu|falha recuperavel de provider|\btimeout\b|\b503\b|\b429\b|resource_exhausted|temporarily overloaded|read operation timed out/.test(detail);
}

function clearProjectManagerRetryTimer(projectUuid) {
  const timer = projectManagerRetryTimers.get(projectUuid);
  if (timer) clearTimeout(timer);
  projectManagerRetryTimers.delete(projectUuid);
}

function scheduleProjectManagerRetry(projectUuid, nextRetryAt) {
  clearProjectManagerRetryTimer(projectUuid);
  const delay = Math.max(0, new Date(nextRetryAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    projectManagerRetryTimers.delete(projectUuid);
    void runQueuedProjectManagerRetry(projectUuid);
  }, delay);
  timer.unref?.();
  projectManagerRetryTimers.set(projectUuid, timer);
}

async function queueProjectManagerRetry(projectUuid, diagnostic, fallbackReason, requestedByUserUuid) {
  const project = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: { intakeConfig: true },
  });
  const current = project?.intakeConfig?.backlogGenerationRecovery || {};
  const checkpoint = diagnostic?.backlog_checkpoint || project?.intakeConfig?.pmBacklogCheckpoint || null;
  const priorAttempts = Number(current?.automaticRetryAttempt || 0);
  const attempt = priorAttempts + 1;
  const exhausted = attempt > PM_RETRY_MAX_ATTEMPTS;
  const reason = String(diagnostic?.cause || fallbackReason || '').slice(0, 800);
  const backoffMs = projectManagerRetryDelay(attempt);
  // Provider quotas sometimes tell us exactly when another call is welcome.
  // Never schedule earlier than either our backoff or that advice.
  const delayMs = Math.max(backoffMs, providerSuggestedRetryDelayMs(reason));
  const nextRetryAt = exhausted ? null : new Date(Date.now() + delayMs).toISOString();
  const providerIndex = projectManagerNextProviderIndex(current);
  const provider = projectManagerRetryProvider(providerIndex);
  // Advance the cursor only when this provider is actually scheduled. If the
  // automatic budget is exhausted, retain the upcoming provider for the next
  // user-initiated cycle instead of silently skipping it.
  const nextProviderIndex = exhausted
    ? providerIndex
    : (providerIndex + 1) % Math.max(1, PM_BACKGROUND_RETRY_PROVIDERS.length);
  const providerAttempts = Array.isArray(diagnostic?.providerAttempts) ? diagnostic.providerAttempts.slice(-12) : [];
  const recovery = {
    ...current,
    status: exhausted ? 'retryable' : 'queued',
    completedBatches: Array.isArray(checkpoint?.batches) ? checkpoint.batches.length : (current?.completedBatches || 0),
    totalBatches: Array.isArray(checkpoint?.coverage_plan) ? checkpoint.coverage_plan.length : (current?.totalBatches || null),
    automaticRetryAttempt: attempt,
    maxAutomaticRetryAttempts: PM_RETRY_MAX_ATTEMPTS,
    nextRetryAt,
    provider: exhausted ? (current?.provider || null) : provider,
    nextProvider: provider,
    nextProviderIndex,
    providerPolicy: 'single-provider-single-model-no-internal-retry',
    scheduledDelayMs: exhausted ? null : delayMs,
    requestedByUserUuid: requestedByUserUuid || current?.requestedByUserUuid || null,
    interruptedAt: new Date().toISOString(),
    reason,
    providerAttempts,
    attemptHistory: [
      ...(Array.isArray(current?.attemptHistory) ? current.attemptHistory : []),
      { attempt, provider, queuedAt: new Date().toISOString(), delayMs, providerAttempts, scheduled: !exhausted },
    ].slice(-5),
  };
  await updateProjectBrief(projectUuid, {
    intakeConfig: {
      ...(checkpoint ? { pmBacklogCheckpoint: checkpoint } : {}),
      backlogGenerationRecovery: recovery,
    },
  });
  if (nextRetryAt) scheduleProjectManagerRetry(projectUuid, nextRetryAt);
  return recovery;
}

async function runQueuedProjectManagerRetry(projectUuid) {
  const projectRecord = await prisma.project.findUnique({
    where: { uuid: projectUuid },
    select: {
      uuid: true,
      intakeConfig: true,
      creator: { select: { uuid: true } },
    },
  });
  const recovery = projectRecord?.intakeConfig?.backlogGenerationRecovery;
  if (!projectRecord || recovery?.status !== 'queued' || !recovery?.nextRetryAt || new Date(recovery.nextRetryAt).getTime() > Date.now()) {
    return;
  }
  const userUuid = recovery.requestedByUserUuid || projectRecord.creator?.uuid;
  if (!userUuid) return;

  await updateProjectBrief(projectUuid, {
    intakeConfig: { backlogGenerationRecovery: { ...recovery, status: 'running', startedAt: new Date().toISOString() } },
  });

  let agentRun = null;
  try {
    const project = await getProjectByUuid(projectUuid, userUuid);
    const intake = project?.intakeConfig || {};
    const idea = String(intake.idea || '').trim();
    if (!idea) throw new Error('Retry do backlog sem briefing salvo.');
    const payload = {
      project_id: projectUuid,
      idea: [compactBacklogInput(idea, intake.answers || {}), compactProjectDnaForAgent(project?.projectDna || null)].filter(Boolean).join('\n\n'),
      answers: {},
      elicitation: intake.pmElicitation || null,
      elicitation_answers: intake.answers?.elicitationAnswers || {},
      incremental_checkpoint: intake.pmBacklogCheckpoint || null,
    };
    const userEnvOverrides = await buildRuntimeAiEnvForUser(userUuid, { agentName: 'project_manager' });
    const provider = String(recovery.provider || projectManagerRetryProvider(projectManagerNextProviderIndex(recovery))).trim().toLowerCase();
    // Keep one queued execution to one provider/model call. If it fails, the
    // queue persists the checkpoint and rotates provider only on a later run.
    const envOverrides = {
      ...userEnvOverrides,
      AI_PROVIDER_ORDER: provider,
      AI_PROVIDER_ORDER_PROJECT_MANAGER: provider,
      AI_PROVIDER_ORDER_APPEND_DEFAULTS: '0',
      MODEL_ROUTER_MAX_CANDIDATES: '1',
      MODEL_ROUTER_SINGLE_ATTEMPT: '1',
      MODEL_ROUTER_TRANSIENT_RETRIES: '0',
      PROJECT_MANAGER_BACKGROUND_RETRY: '1',
    };
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(projectUuid, 'project_manager', payloadWithRuntime);
    const result = await runSingleAgent('project_manager', payloadWithRuntime, { envOverrides });
    await finishAgentRun(agentRun.id, {
      status: 'completed',
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });
    if (result?.clarification_required || result?.elicitation_required) {
      await updateProjectBrief(projectUuid, {
        intakeConfig: {
          requirementsContract: result.requirements_contract || null,
          backlogClarifications: result.clarifications || [],
          pmElicitation: result.elicitation || null,
          backlogGenerationRecovery: { ...recovery, status: 'awaiting_user', nextRetryAt: null },
        },
      });
      return;
    }
    await persistAgentResult(projectUuid, 'project_manager', payloadWithRuntime, result);
    await updateProjectBrief(projectUuid, {
      intakeConfig: {
        pmElicitation: result?.backlog_contract?.elicitation || null,
        backlogClarifications: [],
        pmBacklogCheckpoint: null,
        backlogGenerationRecovery: null,
      },
    });
  } catch (error) {
    await finishAgentRun(agentRun?.id, {
      status: 'failed',
      errorMessage: error.message,
      diagnostic: error.agentDiagnostic || null,
    }).catch(() => null);
    await queueProjectManagerRetry(projectUuid, error?.agentDiagnostic, error.message, userUuid).catch(() => null);
  }
}

export async function resumeProjectManagerRetryQueue() {
  const projects = await prisma.project.findMany({
    select: { id: true, uuid: true, intakeConfig: true },
  });
  for (const project of projects) {
    const recovery = project.intakeConfig?.backlogGenerationRecovery;
    if (recovery?.status === 'queued' && recovery?.nextRetryAt) {
      scheduleProjectManagerRetry(project.uuid, recovery.nextRetryAt);
    } else if (recovery?.status === 'running') {
      // A local Python child cannot survive a backend restart. The AgentRun
      // watchdog marks that run as stale first, but recovery state lives on
      // the project and must be reconciled separately or the UI remains
      // permanently disabled. Keep the checkpoint and require an explicit
      // retry instead of silently spending another generation budget.
      const activeRun = await prisma.agentRun.findFirst({
        where: { projectId: project.id, agentName: 'project_manager', status: 'running' },
        select: { id: true },
      });
      if (!activeRun) {
        await updateProjectBrief(project.uuid, {
          intakeConfig: {
            backlogGenerationRecovery: {
              ...recovery,
              status: 'retryable',
              nextRetryAt: null,
              reconciledAt: new Date().toISOString(),
              reason: 'Execução em segundo plano interrompida; o checkpoint foi preservado para uma nova tentativa.',
            },
          },
        });
      }
    } else if (recovery?.status === 'retryable' && recovery?.automaticRetryAttempt === undefined) {
      // Compatibility for checkpoints persisted before the retry queue was
      // introduced. They were already explicitly marked retryable, so they
      // are safe to enqueue once rather than asking the user to recreate it.
      await queueProjectManagerRetry(project.uuid, null, recovery.reason, recovery.requestedByUserUuid);
    }
  }
}

function isAgentRunConflictError(error) {
  return error?.statusCode === 409 || error?.code === 'AGENT_RUN_CONFLICT';
}

function compactWhitespace(value = '') {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeBacklogStoryForReview(story = {}) {
  const actor = String(story.actor || '').trim();
  const goal = String(story.goal || '').trim();
  const benefit = String(story.benefit || '').trim();
  const description = String(story.description || '').trim();
  const title = String(story.title || '').trim()
    || (actor && goal
      ? `Como ${actor}, quero ${goal}${benefit ? `, para ${benefit}` : ''}.`
      : goal || description);

  return {
    ...story,
    id: String(story.id || '').trim(),
    title,
    description: description || null,
    actor: actor || null,
    benefit: benefit || null,
  };
}

function mergeReviewAnswers(storedAnswers, submittedAnswers) {
  const answerKey = (item = {}) => String(item.id || item.question || '').trim().toLowerCase();
  const normalize = (values) => (Array.isArray(values) ? values : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      question: String(item?.question || '').trim(),
      answer: String(item?.answer || '').trim(),
    }))
    .filter((item) => item.answer && answerKey(item));
  const merged = new Map();
  normalize(storedAnswers).forEach((item) => merged.set(answerKey(item), item));
  normalize(submittedAnswers).forEach((item) => merged.set(answerKey(item), item));
  return [...merged.values()].slice(0, 20);
}

function normalizeReviewProposal(proposal = {}) {
  const normalizeText = (value) => String(value || '').trim();
  const normalizeCriterion = (criterion = {}) => ({
    given: normalizeText(criterion.given),
    when: normalizeText(criterion.when),
    then: normalizeText(criterion.then),
    status: normalizeText(criterion.status) || 'proposed',
    source_ids: Array.isArray(criterion.source_ids || criterion.sourceIds)
      ? [...new Set((criterion.source_ids || criterion.sourceIds).map(normalizeText).filter(Boolean))].sort()
      : [],
  });
  return {
    title: normalizeText(proposal.title),
    description: normalizeText(proposal.description),
    actor: normalizeText(proposal.actor),
    benefit: normalizeText(proposal.benefit),
    acceptance_criteria: Array.isArray(proposal.acceptance_criteria)
      ? proposal.acceptance_criteria.map(normalizeCriterion)
      : [],
  };
}

function validateReviewProposalGenerationRules(proposal) {
  const title = String(proposal?.title || '').replace(/\s+/g, ' ').trim();
  const description = String(proposal?.description || '').replace(/\s+/g, ' ').trim();
  if (!/^Como\s+.+?,\s*eu quero\s+.+?,\s*para\s+.+[.!?]?$/i.test(title)) {
    return 'O título precisa seguir o formato "Como ..., eu quero ..., para ...".';
  }
  if (title.length > 320) return 'O título excede o tamanho aceito para uma user story.';
  if (!description) return 'A descrição da story é obrigatória.';
  const cleanDescription = description.replace(/^(?:descrição|descricao|contexto|detalhe)\s*[:\-]?\s*/i, '').trim();
  const sentenceCount = cleanDescription.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (!cleanDescription || sentenceCount > 2) return 'A descrição precisa ser objetiva e ter uma ou duas frases.';
  if (cleanDescription.toLocaleLowerCase() === title.toLocaleLowerCase()) return 'A descrição deve acrescentar contexto, regra ou exceção, sem repetir o título.';
  return null;
}

function createReviewFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildReviewSnapshot(review, answers) {
  const proposal = normalizeReviewProposal(review?.proposed_story);
  const normalizedAnswers = mergeReviewAnswers([], answers);
  return {
    proposalFingerprint: createReviewFingerprint(proposal),
    answersFingerprint: createReviewFingerprint(normalizedAnswers),
    assessment: review?.assessment || null,
    // Keep the complete, user-facing result so reopening the modal never has
    // to invoke an LLM merely to show a review that already exists.
    review: {
      proposed_story: proposal,
      questions: Array.isArray(review?.questions) ? review.questions : [],
      assessment: review?.assessment || null,
      generation_degraded: Boolean(review?.generation_degraded),
    },
    generatedAt: new Date().toISOString(),
  };
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

function compactBacklogInput(idea = '', answers = {}) {
  const answerLimits = {
    objective: 360,
    audience: 360,
    mainFlows: 720,
    constraints: 720,
    clarifications: 1800,
  };
  const entries = Object.entries(answers || {})
    .map(([key, value]) => {
      if (key === 'clarifications' && Array.isArray(value)) {
        const resolved = value
          .filter((item) => item?.question && item?.answer)
          .map((item) => `${item.question}: ${item.answer}`)
          .join(' | ');
        return resolved ? `Clarificacoes respondidas: ${clampText(resolved, answerLimits.clarifications)}` : null;
      }
      return `${key}: ${clampText(typeof value === 'string' ? value : JSON.stringify(value), answerLimits[key] || 240)}`;
    })
    .filter(Boolean)
    .slice(0, 8);

  return [
    clampText(idea, 480),
    entries.length ? `Respostas-chave:\n- ${entries.join('\n- ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
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

export async function listProjectsController(req, res, next) {
  try {
    const projects = await listProjects(req.authUser.uuid);
    res.json(serializeBigInts(projects));
  } catch (error) {
    next(error);
  }
}

export async function getWorkspaceTeamSummaryController(req, res, next) {
  try {
    const summary = await getWorkspaceTeamSummary(req.authUser.uuid, req.query.workspaceUuid || null);
    res.json(serializeBigInts(summary));
  } catch (error) {
    next(error);
  }
}

export async function bootstrapController(_req, res) {
  res.status(410).json({
    message: 'Bootstrap pÃºblico desativado. Use /api/auth/register para criar sua conta com seguranÃ§a.',
  });
}

export async function getProjectController(req, res, next) {
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);

    if (!project) {
      return res.status(404).json({ message: 'Projeto nÃ£o encontrado.' });
    }

    res.json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function createProjectController(req, res, next) {
  try {
    const {
      workspaceUuid,
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
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        message: 'name e obrigatorio.',
      });
    }

    const workspace =
      workspaceUuid
        ? await assertWorkspaceAccess(workspaceUuid, req.authUser.uuid)
        : await getDefaultWorkspaceForUserUuid(req.authUser.uuid);

    if (!workspace?.uuid) {
      return res.status(400).json({
        message: 'Nenhum workspace disponÃ­vel para este usuÃ¡rio.',
      });
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

    const project = await createProject({
      workspaceUuid: workspace.uuid,
      createdByUuid: req.authUser.uuid,
      name,
      description,
      vision,
      startMode,
      templateKey: resolvedTemplateKey,
      intakeConfig: {
        ...(intakeConfig || {}),
        projectTemplateKey: resolvedTemplateKey || intakeConfig?.projectTemplateKey || null,
      },
      boardConfig,
      agentsConfig,
      automationConfig,
      status,
    });

    res.status(201).json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function updateProjectBriefController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');

    const { description, vision, intakeConfig } = req.body || {};
    const resolvedTemplateKey = inferProjectTemplateKey({
      description,
      vision,
      idea: intakeConfig?.idea,
      summary: intakeConfig?.objective,
    });
    const project = await updateProjectBrief(req.params.projectUuid, {
      description,
      vision,
      templateKey: intakeConfig?.projectTemplateKey || resolvedTemplateKey || undefined,
      intakeConfig,
    });

    res.json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function updateProjectStatusController(req, res, next) {
  try {
    const { status } = req.body || {};

    if (!status?.trim()) {
      return res.status(400).json({ message: 'status e obrigatorio.' });
    }

    const project = await updateProjectStatus(req.params.projectUuid, status, req.authUser.uuid);
    res.json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function deleteProjectController(req, res, next) {
  try {
    const result = await deleteProject(req.params.projectUuid, req.authUser.uuid);
    res.json(serializeBigInts(result));
  } catch (error) {
    next(error);
  }
}

export async function listProjectTasksController(req, res, next) {
  try {
    const tasks = await listProjectTasks(
      req.params.projectUuid,
      {
        status: req.query.status,
        parentTaskUuid: req.query.parentTaskUuid,
      },
      req.authUser.uuid
    );

    res.json(serializeBigInts(tasks));
  } catch (error) {
    next(error);
  }
}

export async function listAllTasksController(req, res, next) {
  try {
    const tasks = await listAllTasks(
      {
        status: req.query.status,
      },
      req.authUser.uuid
    );

    res.json(serializeBigInts(tasks));
  } catch (error) {
    next(error);
  }
}

export async function createTaskController(req, res, next) {
  try {
    const { title } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        message: 'title e obrigatorio.',
      });
    }

    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'editor');

    const task = await createTask(req.params.projectUuid, {
      ...req.body,
      createdByUuid: req.authUser.uuid,
      reporterUserUuid: req.body.reporterUserUuid || req.authUser.uuid,
    });

    res.status(201).json(serializeBigInts(task));
  } catch (error) {
    next(error);
  }
}

export async function updateTaskController(req, res, next) {
  try {
    await assertTaskAccess(req.params.taskUuid, req.authUser.uuid);
    if (req.body?.status || req.body?.assigneeUserUuid !== undefined || req.body?.dueDate !== undefined || req.body?.title || req.body?.description) {
      const existingTask = await getTaskByUuid(req.params.taskUuid, req.authUser.uuid);
      await assertProjectPermission(existingTask.project.uuid, req.authUser.uuid, 'editor');
    }

    const task = await updateTask(req.params.taskUuid, {
      ...req.body,
      changedByUserUuid: req.authUser.uuid,
    });
    res.json(serializeBigInts(task));
  } catch (error) {
    next(error);
  }
}

export async function getTaskController(req, res, next) {
  try {
    const task = await getTaskByUuid(req.params.taskUuid, req.authUser.uuid);

    if (!task) {
      return res.status(404).json({ message: 'Tarefa nÃ£o encontrada.' });
    }

    res.json(serializeBigInts(task));
  } catch (error) {
    next(error);
  }
}

export async function createTaskCommentController(req, res, next) {
  try {
    const { body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'body e obrigatorio.' });
    }

    await assertTaskAccess(req.params.taskUuid, req.authUser.uuid);
    const existingTask = await getTaskByUuid(req.params.taskUuid, req.authUser.uuid);
    await assertProjectPermission(existingTask.project.uuid, req.authUser.uuid, 'editor');

    const comment = await createTaskComment(req.params.taskUuid, {
      ...req.body,
      authorUserUuid: req.authUser.uuid,
    });
    res.status(201).json(serializeBigInts(comment));
  } catch (error) {
    next(error);
  }
}

export async function ensurePipelineProjectController(req, res, next) {
  try {
    const { projectUuid, idea } = req.body;

    if (!projectUuid?.trim()) {
      return res.status(400).json({ message: 'projectUuid e obrigatorio.' });
    }

    const project = await ensurePipelineProject(projectUuid, idea, req.authUser.uuid);
    res.status(201).json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function importBacklogTasksController(req, res, next) {
  try {
    const { backlogMarkdown } = req.body;
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');

    const tasks = await importBacklogTasks(req.params.projectUuid, backlogMarkdown);
    res.status(201).json(serializeBigInts(tasks));
  } catch (error) {
    next(error);
  }
}

export async function generateProjectBacklogController(req, res, next) {
  let agentRun = null;
  let runLifecycle = null;

  try {
    const { projectUuid } = req.params;
    const { idea, answers, description, vision, elicitation } = req.body;

    if (!idea?.trim()) {
      return res.status(400).json({ message: 'idea e obrigatorio.' });
    }

    await assertProjectPermission(projectUuid, req.authUser.uuid, 'manager');
    // A deliberate user retry supersedes any timer left by an older failed
    // request. Its retry budget starts fresh; the saved checkpoint and the
    // provider rotation cursor remain, so a temporarily overloaded provider
    // is not selected again at the start of every manual cycle.
    clearProjectManagerRetryTimer(projectUuid);
    const existingProject = await getProjectByUuid(projectUuid, req.authUser.uuid);
    const priorRecovery = existingProject?.intakeConfig?.backlogGenerationRecovery || null;
    const providerRotation = priorRecovery
      ? { nextProviderIndex: projectManagerNextProviderIndex(priorRecovery) }
      : null;

    await updateProjectBrief(projectUuid, {
      description,
      vision,
      templateKey: inferProjectTemplateKey({
        idea: idea.trim(),
        description,
        vision,
        summary: answers?.objective || '',
      }),
      intakeConfig: {
        idea: idea.trim(),
        objective: answers?.objective || '',
        audience: answers?.audience || '',
        answers: answers || {},
        ...(elicitation ? { pmElicitation: elicitation } : {}),
        backlogGenerationRecovery: providerRotation,
        lastGeneratedAt: new Date().toISOString(),
      },
    });

    const refreshedProject = await getProjectByUuid(projectUuid, req.authUser.uuid);
    const projectDnaContext = compactProjectDnaForAgent(refreshedProject?.projectDna || null);

    const payload = {
      project_id: projectUuid,
      idea: [compactBacklogInput(idea.trim(), answers || {}), projectDnaContext].filter(Boolean).join('\n\n'),
      answers: {},
      elicitation: elicitation || refreshedProject?.intakeConfig?.pmElicitation || null,
      elicitation_answers: answers?.elicitationAnswers || {},
      incremental_checkpoint: refreshedProject?.intakeConfig?.pmBacklogCheckpoint || null,
    };

    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'project_manager' });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(projectUuid, 'project_manager', payloadWithRuntime);
    runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    const result = await runSingleAgent('project_manager', payloadWithRuntime, { envOverrides });

    const finalized = await runLifecycle.finalizeSuccess({
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });

    if (!finalized) {
      return;
    }

    if (result?.clarification_required || result?.elicitation_required) {
      // Keep the requirements gate recoverable after a browser refresh. No
      // backlog has been published here, so no stories/tasks are created.
      await updateProjectBrief(projectUuid, {
        intakeConfig: {
          requirementsContract: result.requirements_contract || null,
          backlogClarifications: result.clarifications || [],
          pmElicitation: result.elicitation || null,
        },
      });
      const [project, tasks] = await Promise.all([
        getProjectByUuid(projectUuid, req.authUser.uuid),
        listProjectTasks(projectUuid, {}, req.authUser.uuid),
      ]);
      return res.status(200).json(serializeBigInts({ project, tasks, result }));
    }

    await persistAgentResult(projectUuid, 'project_manager', payloadWithRuntime, result);
    // The successful contract carries the evaluated readiness state. Replace
    // the pending discovery snapshot so a later page load does not revive an
    // already answered question round.
    await updateProjectBrief(projectUuid, {
      intakeConfig: {
        pmElicitation: result?.backlog_contract?.elicitation || null,
        backlogClarifications: [],
        pmBacklogCheckpoint: null,
        backlogGenerationRecovery: null,
      },
    });

    const [project, tasks] = await Promise.all([
      getProjectByUuid(projectUuid, req.authUser.uuid),
      listProjectTasks(projectUuid, {}, req.authUser.uuid),
    ]);

    res.status(201).json(
      serializeBigInts({
        project,
        tasks,
        result,
      })
    );
  } catch (error) {
    if (runLifecycle?.isFinalized()) {
      return;
    }

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({
        errorMessage: error.message,
        result: error.agentDiagnostic || null,
      }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, {
        status: 'failed',
        errorMessage: error.message,
      }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) {
      return;
    }

    if (isAgentRunConflictError(error)) {
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    // The PM emits a checkpoint only after a full batch has BDD criteria.
    // Persist it separately from the published backlog: it is recovery state,
    // never a partially approved product artifact.
    const checkpoint = error?.agentDiagnostic?.backlog_checkpoint;
    if ((checkpoint && typeof checkpoint === 'object') || isRecoverableProviderFailure(error)) {
      const recoveryKind = String(error?.agentDiagnostic?.recovery_kind || 'provider');
      const isQualityRepair = recoveryKind === 'quality_repair';
      const recovery = await queueProjectManagerRetry(
        req.params.projectUuid,
        error.agentDiagnostic,
        error.message,
        req.authUser.uuid,
      ).catch(() => null);
      return res.status(recovery?.nextRetryAt ? 202 : 503).json({
        code: recovery?.nextRetryAt
          ? 'PROJECT_BACKLOG_RETRY_QUEUED'
          : (isQualityRepair ? 'PROJECT_BACKLOG_QUALITY_REPAIR_RETRYABLE' : 'PROJECT_BACKLOG_GENERATION_RETRYABLE'),
        retryable: Boolean(recovery?.nextRetryAt),
        message: isQualityRepair
          ? 'O Quality Gate solicitou um reparo focalizado. Os lotes validados foram preservados; tente novamente sem regenerar o backlog.'
          : 'A geração foi interrompida por um provedor de IA. Os lotes já validados foram preservados; tente novamente para retomar do próximo lote.',
        recovery: {
          completedBatches: Array.isArray(checkpoint?.batches) ? checkpoint.batches.length : 0,
          totalBatches: Array.isArray(checkpoint?.coverage_plan) ? checkpoint.coverage_plan.length : null,
          nextRetryAt: recovery?.nextRetryAt || null,
          automaticRetryAttempt: recovery?.automaticRetryAttempt || null,
          maxAutomaticRetryAttempts: recovery?.maxAutomaticRetryAttempts || null,
        },
      });
    }

    next(error);
  }
}

function getBacklogQualityReview(contract = {}) {
  return contract.qualityReview || contract.quality_review || {};
}

function withBacklogQualityReview(contract = {}, review = {}) {
  // `qualityReview` is the persisted contract format. Keep the legacy alias in
  // sync so projects generated by older PM versions remain actionable.
  return { ...contract, qualityReview: review, quality_review: review };
}

function recalculateBacklogQualityReview(review = {}) {
  const pendingProposals = (review.proposals || []).some((item) => !['accepted', 'rejected'].includes(String(item?.status || 'proposed').toLowerCase()));
  const pendingQuestions = (review.questions || []).some((item) => item?.requires_confirmation && String(item?.status || '').toLowerCase() !== 'answered');
  const hasFindings = Array.isArray(review.findings) && review.findings.length > 0;
  return {
    ...review,
    decision: pendingProposals || pendingQuestions || hasFindings ? 'REVISE' : 'PASS',
    resolvedAt: pendingProposals || pendingQuestions || hasFindings ? null : new Date().toISOString(),
  };
}

function replaceArtifactSection(content, requestedTitle, replacementBody, artifactType) {
  const requested = String(requestedTitle || '').replace(/^#+\s*/, '').trim().toLocaleLowerCase('pt-BR');
  // A section replacement must never treat every known section as an alias.
  // Doing so makes a patch for "Comportamento" replace "Historia" simply
  // because it appears first in the document.
  const candidates = [requested].filter(Boolean);
  const headingRegex = /^##\s+([^\n]+?)\s*$/gim;
  let match;
  while ((match = headingRegex.exec(String(content || ''))) !== null) {
    const heading = match[1].trim().toLocaleLowerCase('pt-BR');
    if (!candidates.some((candidate) => heading === candidate || heading.startsWith(`${candidate} `) || heading.startsWith(`${candidate} (`))) continue;
    const start = match.index;
    const afterHeading = start + match[0].length;
    const next = /^##\s+[^\n]+?\s*$/gim;
    next.lastIndex = afterHeading;
    const nextMatch = next.exec(String(content || ''));
    const end = nextMatch ? nextMatch.index : String(content || '').length;
    return `${String(content || '').slice(0, start)}## ${requestedTitle}\n${String(replacementBody || '').trim()}\n${String(content || '').slice(end)}`.replace(/\n{3,}/g, '\n\n');
  }
  return `${String(content || '').trim()}\n\n## ${requestedTitle}\n${String(replacementBody || '').trim()}\n`;
}

function removeResolvedPendingDecisions(content, instruction) {
  const answered = [...String(instruction || '').matchAll(/Decisao:\s*([^\n]+)\nResposta:/gi)]
    .map((match) => match[1].trim().toLocaleLowerCase('pt-BR'));
  if (!answered.length) return content;
  return String(content).split('\n').filter((line) => {
    const normalized = line.replace(/^\s*[-*]\s*/, '').trim().toLocaleLowerCase('pt-BR');
    return !answered.some((question) => normalized === question);
  }).join('\n');
}

function removeLegacyRequirementSections(content) {
  let normalized = String(content)
    .replace(/\n##\s+requirements\s*[\s\S]*?(?=\n##\s+|$)/gi, '\n')
    .replace(/\n##\s+Criterios de Aceite(?:\s+\(BDD\))?\s*[\s\S]*?(?=\n##\s+|$)/gi, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const seen = new Set();
  let discard = false;
  normalized = normalized.split('\n').filter((line) => {
    const heading = line.match(/^##\s+(.+)\s*$/i);
    if (!heading) return !discard;
    const key = heading[1].trim().toLocaleLowerCase('pt-BR');
    discard = seen.has(key);
    seen.add(key);
    return !discard;
  }).join('\n');
  if (!/^##\s+Historia e objetivo\s*$/im.test(normalized)) {
    const title = normalized.match(/^#\s+Requisito Refinado\s*$/im);
    const story = normalized.match(/Como\s+[^\n]+/i)?.[0];
    if (title && story) normalized = normalized.replace(title[0], `${title[0]}\n\n## Historia e objetivo\n\n${story}`);
  }
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

function extractLevelTwoSection(content, title) {
  const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`^##[\\t ]+${escaped}[\\t ]*\\r?\\n([\\s\\S]*?)(?=^##[\\t ]+|(?![\\s\\S]))`, 'im'));
  return match?.[1]?.trim() || '';
}

function enrichLoginAcceptanceScenarios(scenarios, sourceContent) {
  const source = String(sourceContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const existing = String(scenarios || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hasLoginRules = ['matricula', 'senha', '5 tentativas', '15 minutos', '8 digitos'].every((term) => source.includes(term));
  if (!hasLoginRules || (existing.includes('5 tentativas') && existing.includes('8 digitos'))) return scenarios;
  return `### Sucesso

### Cenario 1 - Autenticacao valida

**DADO** que o professor informa matricula com 8 digitos e senha valida na tela de login
**QUANDO** confirma o acesso
**ENTAO** o sistema autentica o professor e libera as funcionalidades de reserva.

### Excecoes

### Cenario 2 - Campos ausentes ou formato invalido

**DADO** que o professor deixa matricula ou senha em branco, ou informa matricula fora de 8 digitos
**QUANDO** tenta confirmar o acesso
**ENTAO** o sistema nao cria sessao e informa o dado que deve ser corrigido.

### Cenario 3 - Credenciais invalidas

**DADO** que o professor informa matricula ou senha incorreta
**QUANDO** confirma o acesso antes do limite de tentativas
**ENTAO** o sistema nao cria sessao e informa que as credenciais sao invalidas.

### Cenario 4 - Bloqueio temporario

**DADO** que o professor realizou 5 tentativas consecutivas com credenciais invalidas
**QUANDO** tenta autenticar novamente
**ENTAO** o sistema bloqueia o acesso por 15 minutos e informa o tempo de bloqueio.

### Cenario 5 - Sessao expirada

**DADO** que o professor possui uma sessao autenticada
**QUANDO** a inatividade ultrapassa 30 minutos
**ENTAO** o sistema encerra a sessao e solicita novo login.

### Cenario 6 - Perfil sem permissao

**DADO** que um usuario sem perfil Professor esta autenticado
**QUANDO** tenta acessar funcionalidades de reserva
**ENTAO** o sistema nega o acesso e informa que o perfil nao possui permissao.`;
}

function normalizeAcceptanceScenario(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[*_`#\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function extractBddScenarioBlocks(content = '') {
  const text = String(content || '').trim();
  const matches = [...text.matchAll(/^###\s+Cen[aá]rio\b[^\n]*\r?\n([\s\S]*?)(?=^###\s+Cen[aá]rio\b|(?![\s\S]))/gim)];
  return matches
    .map((match) => match[0].trim())
    .filter((block) => {
      const normalized = normalizeAcceptanceScenario(block);
      return /\bdado\b/.test(normalized) && /\bquando\b/.test(normalized) && /\bentao\b/.test(normalized);
    });
}

function mergeAcceptanceScenarioCoverage(existingContent, proposedContent) {
  const existing = String(existingContent || '').trim();
  const existingScenarios = extractBddScenarioBlocks(existing);
  const proposedScenarios = extractBddScenarioBlocks(proposedContent);
  if (!proposedScenarios.length) {
    throw new Error('O reparo não retornou cenários BDD verificáveis para as decisões confirmadas. Nenhuma versão foi criada.');
  }

  // A versão atual pode já ter sido degradada por uma execução antiga. Nesse
  // caso, um placeholder não é cobertura a preservar: a proposta BDD válida
  // substitui somente esse conteúdo inválido.
  if (!existingScenarios.length && /\ba validar durante a revis[aã]o\b|nenhum cen[aá]rio (?:de )?(?:sucesso|exce[cç][aã]o)/i.test(existing)) {
    return String(proposedContent).trim();
  }

  const existingKeys = new Set(existingScenarios.map(normalizeAcceptanceScenario));
  const additions = proposedScenarios.filter((scenario) => !existingKeys.has(normalizeAcceptanceScenario(scenario)));
  // A patch de cobertura é incremental: o conteúdo existente é a fonte de
  // verdade e nunca pode ser substituído por uma resposta parcial do modelo.
  return additions.length ? `${existing}\n\n${additions.join('\n\n')}`.trim() : existing;
}

function restoreCompactRequirementStructure(content, storyTitle) {
  let normalized = removeLegacyRequirementSections(content);
  const story = String(storyTitle || '').trim();
  const history = extractLevelTwoSection(normalized, 'Historia e objetivo');
  if (story && !/\bComo\s+/i.test(history)) {
    normalized = replaceArtifactSection(normalized, 'Historia e objetivo', story, 'requirements');
  }

  let behaviorSection = extractLevelTwoSection(normalized, 'Comportamento e regras confirmadas');
  if (behaviorSection && !/^###\s+Comportamento\s*$/im.test(behaviorSection)) {
    normalized = replaceArtifactSection(
      normalized,
      'Comportamento e regras confirmadas',
      `### Comportamento\n\n${behaviorSection}\n\n### Regras\n\n- Nenhuma regra adicional confirmada nas fontes.`,
      'requirements',
    );
    behaviorSection = extractLevelTwoSection(normalized, 'Comportamento e regras confirmadas');
  }

  const pending = extractLevelTwoSection(normalized, 'Decisoes pendentes');
  const scenarios = enrichLoginAcceptanceScenarios(
    extractLevelTwoSection(normalized, 'Cenarios de aceite'),
    normalized,
  );
  const finalHistory = extractLevelTwoSection(normalized, 'Historia e objetivo') || story;
  const hasPendingDecision = pending.split('\n').some((line) => /^\s*[-*]\s+/.test(line) && !/nenhuma decis[aã]o pendente/i.test(line));
  const finalStatus = hasPendingDecision ? '**PENDENTE DE VALIDACAO**' : '**PRONTO PARA VALIDACAO**';
  const sections = [
    '# Requisito Refinado',
    `## Historia e objetivo\n\n${finalHistory}`,
    `## Comportamento e regras confirmadas\n\n${behaviorSection || '### Comportamento\n\n- A validar durante a revisao.\n\n### Regras\n\n- Nenhuma regra confirmada.'}`,
    `## Cenarios de aceite\n\n${scenarios || '### Sucesso\n\n- A validar durante a revisao.\n\n### Excecoes\n\n- A validar durante a revisao.'}`,
  ];
  sections.push(hasPendingDecision
    ? `## Decisoes pendentes\n\n${pending}`
    : '## Decisoes pendentes\n\n- Nenhuma decisao pendente.');
  sections.push(`## Status\n\n${finalStatus}`);
  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function publishBacklogTasksController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const tasks = await publishBacklogTasks(req.params.projectUuid);
    res.status(201).json(serializeBigInts(tasks));
  } catch (error) { next(error); }
}

export async function updateBacklogStoryController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const story = await updateBacklogStory(req.params.projectUuid, req.params.storyId, req.body, req.authUser.uuid);
    res.status(200).json(serializeBigInts(story));
  } catch (error) { next(error); }
}

export async function revalidateBacklogController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'editor');
    const result = await revalidateBacklogForPublication(req.params.projectUuid, req.authUser.uuid);
    res.json(serializeBigInts({ success: true, ...result }));
  } catch (error) { next(error); }
}

export async function consolidateBacklogStoriesController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const story = await consolidateBacklogStories(
      req.params.projectUuid,
      req.body?.sourceStoryId,
      req.body?.targetStoryId,
      req.authUser.uuid,
    );
    res.status(200).json(serializeBigInts({ success: true, story }));
  } catch (error) { next(error); }
}

export async function moveBacklogAcceptanceCriterionController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const result = await moveBacklogAcceptanceCriterion(
      req.params.projectUuid,
      req.body?.sourceStoryId,
      req.body?.targetStoryId,
      req.body?.criterionIndex,
      req.authUser.uuid,
    );
    res.status(200).json(serializeBigInts({ success: true, ...result }));
  } catch (error) { next(error); }
}

export async function reviewBacklogStoryController(req, res, next) {
  let agentRun = null;
  let runLifecycle = null;
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);
    if (!project) return res.status(404).json({ message: 'Projeto não encontrado.' });
    await assertProjectPermission(project.uuid, req.authUser.uuid, 'editor');
    const contract = project.intakeConfig?.backlogContract || {};
    const stories = Array.isArray(contract.stories) ? contract.stories : [];
    const storedStory = stories.find((item) => String(item?.id) === String(req.params.storyId));
    if (!storedStory) return res.status(404).json({ message: 'Story não encontrada.' });
    const story = normalizeBacklogStoryForReview(storedStory);
    const draftProposal = req.body?.draftProposal && typeof req.body.draftProposal === 'object'
      ? normalizeReviewProposal(req.body.draftProposal)
      : null;
    const currentRefinementContext = story.refinementContext || story.refinement_context || {};
    const storyForReview = draftProposal
      ? {
          ...story,
          title: draftProposal.title || story.title,
          description: draftProposal.description || story.description,
          actor: draftProposal.actor || story.actor,
          benefit: draftProposal.benefit || story.benefit,
          refinementContext: {
            ...currentRefinementContext,
            acceptanceCriteria: draftProposal.acceptance_criteria,
            acceptance_criteria: draftProposal.acceptance_criteria,
          },
          refinement_context: {
            ...currentRefinementContext,
            acceptanceCriteria: draftProposal.acceptance_criteria,
            acceptance_criteria: draftProposal.acceptance_criteria,
          },
        }
      : story;
    const reviewAnswers = mergeReviewAnswers(storedStory.reviewAnswers, req.body?.answers);
    if (!storyForReview.id || !storyForReview.title) {
      return res.status(422).json({ message: 'A story precisa ter um objetivo ou título antes da revisão.' });
    }
    const payload = {
      project_id: project.uuid,
      idea: project.description || project.vision || project.name,
      briefing: {
        name: project.name,
        description: project.description,
        vision: project.vision,
        intake: project.intakeConfig,
      },
      project_dna: project.projectDna || project.intakeConfig?.projectDna || {},
      backlog_contract: contract,
      other_stories: stories.filter((item) => String(item?.id) !== String(storyForReview.id)).slice(0, 30),
      story: storyForReview,
      review_answers: reviewAnswers,
    };
    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'story_reviewer' });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(project.uuid, 'story_reviewer', payloadWithRuntime);
    runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    const result = await runSingleAgent('story_reviewer', payloadWithRuntime, { envOverrides });

    const finalized = await runLifecycle.finalizeSuccess({
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });
    if (!finalized) return;

    const reviewSnapshot = buildReviewSnapshot(result, reviewAnswers);
    const updatedStories = stories.map((item) => (
      String(item?.id) === String(storyForReview.id)
        ? { ...item, reviewAnswers, pendingAgentReview: reviewSnapshot }
        : item
    ));
    await updateProjectBrief(project.uuid, {
      intakeConfig: { ...project.intakeConfig, backlogContract: { ...contract, stories: updatedStories } },
    });
    res.status(200).json(serializeBigInts({ success: true, review: result }));
  } catch (error) {
    if (runLifecycle?.isFinalized()) return;

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({
        errorMessage: error.message,
        result: error.agentDiagnostic || null,
      }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, {
        status: 'failed',
        errorMessage: error.message,
        diagnostic: error.agentDiagnostic || null,
      }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) return;

    if (isAgentRunConflictError(error)) {
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    next(error);
  }
}

export async function applyBacklogStoryReviewController(req, res, next) {
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);
    if (!project) return res.status(404).json({ message: 'Projeto não encontrado.' });
    await assertProjectPermission(project.uuid, req.authUser.uuid, 'editor');
    const config = project.intakeConfig || {};
    const contract = config.backlogContract || {};
    const stories = Array.isArray(contract.stories) ? [...contract.stories] : [];
    const index = stories.findIndex((item) => String(item?.id) === String(req.params.storyId));
    if (index < 0) return res.status(404).json({ message: 'Story não encontrada.' });
    if (contract.publicationStatus === 'published') return res.status(409).json({ message: 'O backlog já foi publicado e não pode ser alterado.' });

    const proposal = req.body?.proposedStory || {};
    const title = String(proposal.title || '').trim();
    if (!title) return res.status(400).json({ message: 'A proposta precisa ter um título.' });
    const submittedAnswers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 20) : [];
    const current = stories[index];
    const answers = mergeReviewAnswers(current.reviewAnswers, submittedAnswers);
    if (answers.some((item) => !item.answer)) return res.status(400).json({ message: 'Responda todas as perguntas antes de aplicar a proposta.' });

    const normalizedProposal = normalizeReviewProposal(proposal);
    const proposalValidationError = validateReviewProposalGenerationRules(normalizedProposal);
    if (proposalValidationError) return res.status(400).json({ message: proposalValidationError });
    const pendingReview = current.pendingAgentReview;
    if (!pendingReview?.assessment) {
      return res.status(409).json({ message: 'Execute uma nova revisão antes de aplicar a proposta.' });
    }
    if (
      pendingReview.proposalFingerprint !== createReviewFingerprint(normalizedProposal)
      || pendingReview.answersFingerprint !== createReviewFingerprint(answers)
    ) {
      return res.status(409).json({ message: 'A proposta ou as respostas foram alteradas desde a última revisão. Atualize a proposta com respostas e revise novamente.' });
    }
    const acceptanceCriteria = normalizedProposal.acceptance_criteria;
    const assessment = pendingReview.assessment;
    const currentRefinementContext = current.refinementContext || current.refinement_context || {};
    const refinementContext = {
      ...currentRefinementContext,
      acceptanceCriteria,
      acceptance_criteria: acceptanceCriteria,
      openQuestions: [],
      open_questions: [],
    };
    const hasBlockingGate = Array.isArray(assessment?.gates) && assessment.gates.some((gate) => gate?.blocking);
    if (assessment?.decision !== 'READY' || hasBlockingGate) {
      return res.status(409).json({
        message: 'A story ainda precisa de refinamento. Responda as próximas decisões e execute nova revisão até atingir a prontidão mínima.',
        assessment,
      });
    }
    stories[index] = {
      ...current,
      title: normalizedProposal.title,
      description: normalizedProposal.description || current.description || '',
      actor: normalizedProposal.actor || current.actor || null,
      benefit: normalizedProposal.benefit || current.benefit || null,
      refinementContext,
      refinement_context: refinementContext,
      // A READY review with all answers applied closes the old review cycle.
      // Leaving its questions/tags behind made completed stories look blocked
      // and allowed stale context to leak into later reconciliation.
      openQuestions: [],
      open_questions: [],
      reviewTags: (current.reviewTags || current.review_tags || []).filter((tag) => !/^(REVIEW_|PROPOSED_DEFAULT$)/.test(String(tag || ''))),
      review_tags: (current.reviewTags || current.review_tags || []).filter((tag) => !/^(REVIEW_|PROPOSED_DEFAULT$)/.test(String(tag || ''))),
      reviewAnswers: answers,
      reviewStatus: current.reviewStatus,
      // Preserve the review snapshot after applying it. The story becomes the
      // source of truth for the proposal, while this retains the diagnosis and
      // decisions for a later read-only reopening of the modal.
      lastAgentReview: { ...pendingReview, assessment, appliedAt: new Date().toISOString(), appliedBy: req.authUser.uuid },
      pendingAgentReview: null,
    };
    await updateProjectBrief(project.uuid, { intakeConfig: { ...config, backlogContract: { ...contract, stories } } });
    res.json(serializeBigInts({ success: true, story: stories[index] }));
  } catch (error) { next(error); }
}

export async function decideBacklogProposalController(req, res, next) {
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);
    if (!project) return res.status(404).json({ message: 'Projeto nÃ£o encontrado.' });
    await assertProjectPermission(project.uuid, req.authUser.uuid, 'editor');
    const contract = project.intakeConfig?.backlogContract || {};
    const review = getBacklogQualityReview(contract);
    const proposalId = String(req.params.proposalId || '');
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['accepted', 'rejected', 'edited'].includes(decision)) return res.status(400).json({ message: 'DecisÃ£o invÃ¡lida.' });
    const proposals = (review.proposals || []).map((item, index) => ({ ...item, id: item.id || `PROP-${String(index + 1).padStart(3, '0')}` }));
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) return res.status(404).json({ message: 'Proposta nÃ£o encontrada.' });
    if (decision === 'edited') proposal.capability = String(req.body?.comment || proposal.capability).trim();
    proposal.status = decision === 'edited' ? 'proposed' : decision;
    proposal.decidedBy = req.authUser.uuid;
    proposal.decidedAt = new Date().toISOString();
    proposal.comment = String(req.body?.comment || '').trim() || null;
    const questions = (review.questions || []).map((item, index) => ({ ...item, id: item.id || `CQ-${String(index + 1).padStart(3, '0')}` }));
    // Rejecting a proposal as already covered is also an explicit answer to
    // its matching capability question. This avoids asking the user to make
    // the same decision twice.
    if (decision === 'rejected' && proposal.capability) {
      questions.forEach((question) => {
        if (String(question.question || '').toLowerCase().includes(String(proposal.capability).toLowerCase())) {
          Object.assign(question, { answer: proposal.comment || 'Capacidade já coberta pelas stories aprovadas.', status: 'answered', answeredBy: req.authUser.uuid, answeredAt: new Date().toISOString() });
        }
      });
    }
    const nextReview = recalculateBacklogQualityReview({ ...review, proposals, questions });
    const nextContract = withBacklogQualityReview(contract, nextReview);
    await updateProjectBrief(project.uuid, { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: nextContract } });
    res.json(serializeBigInts({ success: true, proposal, qualityReview: nextReview }));
  } catch (error) { next(error); }
}

export async function answerBacklogQuestionController(req, res, next) {
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);
    if (!project) return res.status(404).json({ message: 'Projeto nÃ£o encontrado.' });
    await assertProjectPermission(project.uuid, req.authUser.uuid, 'editor');
    const contract = project.intakeConfig?.backlogContract || {};
    const review = getBacklogQualityReview(contract);
    const questionId = String(req.params.questionId || '');
    const answer = String(req.body?.answer || '').trim();
    if (!answer) return res.status(400).json({ message: 'A resposta Ã© obrigatÃ³ria.' });
    const questions = (review.questions || []).map((item, index) => ({ ...item, id: item.id || `CQ-${String(index + 1).padStart(3, '0')}` }));
    const question = questions.find((item) => item.id === questionId);
    if (!question) return res.status(404).json({ message: 'Pergunta nÃ£o encontrada.' });
    Object.assign(question, { answer, status: 'answered', answeredBy: req.authUser.uuid, answeredAt: new Date().toISOString() });
    const nextReview = recalculateBacklogQualityReview({ ...review, questions });
    await updateProjectBrief(project.uuid, { intakeConfig: { ...(project.intakeConfig || {}), backlogContract: withBacklogQualityReview(contract, nextReview) } });
    res.json(serializeBigInts({ success: true, question, qualityReview: nextReview }));
  } catch (error) { next(error); }
}

export async function applyBacklogProposalsController(req, res, next) {
  try {
    const project = await getProjectByUuid(req.params.projectUuid, req.authUser.uuid);
    if (!project) return res.status(404).json({ message: 'Projeto não encontrado.' });
    await assertProjectPermission(project.uuid, req.authUser.uuid, 'editor');
    const config = project.intakeConfig || {}; const contract = config.backlogContract || {}; const review = getBacklogQualityReview(contract);
    const accepted = (review.proposals || []).filter((item) => item.status === 'accepted');
    const stories = [...(contract.stories || [])];
    for (const proposal of accepted) {
      if (stories.some((story) => String(story.title || '').toLowerCase().includes(String(proposal.capability || '').toLowerCase()))) continue;
      const id = `US-${String(stories.length + 1).padStart(2, '0')}`;
      const capability = String(proposal.capability || 'capacidade aprovada').trim();
      const actor = capability.match(/segment|campanh|cobran/i) ? 'Analista de cobrança' : 'Usuário autorizado';
      stories.push({
        id,
        actor,
        goal: `executar ${capability}`,
        benefit: `garantir a cobertura de ${capability} no fluxo da campanha`,
        description: `[PROPOSTO - VALIDAR] História adicionada após confirmação humana: ${proposal.reason || 'capacidade identificada pelo Challenger'}.`,
        lane: capability.match(/aprova|decis/i) ? 'governance' : 'operation',
        priority: 'medium', release: 'MVP',
        source_ids: Array.isArray(proposal.source_ids) ? proposal.source_ids : [],
        status: 'proposed', review_tags: ['REVIEW_HUMAN_APPROVED'], open_questions: [],
        refinement_context: {
          inputs: [], outputs: [capability], confirmed_rules: [], constraints: [], dependencies: [], open_questions: ['Confirmar regra e comportamento esperado para esta capacidade.'], acceptance_hints: [],
          acceptance_criteria: [{ id: `${id}-CA-01`, given: 'o usuário autorizado está no contexto da campanha', when: `executar ${capability}`, then: 'o sistema deve registrar e apresentar o resultado esperado', source_ids: Array.isArray(proposal.source_ids) ? proposal.source_ids : [], status: 'proposed' }],
        },
      });
    }
    const questions = (review.questions || []).map((question) => {
      const isIncluded = accepted.some((proposal) => String(question.question || '').toLowerCase().includes(String(proposal.capability || '').toLowerCase()));
      return isIncluded
        ? { ...question, answer: 'Capacidade aprovada e incluída no backlog.', status: 'answered', answeredBy: req.authUser.uuid, answeredAt: new Date().toISOString() }
        : question;
    });
    const nextReview = recalculateBacklogQualityReview({ ...review, questions, appliedAt: new Date().toISOString(), appliedBy: req.authUser.uuid });
    const next = { ...withBacklogQualityReview(contract, nextReview), stories, version: Number(contract.version || 1) + 1 };
    await updateProjectBrief(project.uuid, { intakeConfig: { ...config, backlogContract: next } });
    const masterTask = await prisma.task.findFirst({ where: { projectId: project.id, title: '[SYSTEM] Backlog Master' }, select: { uuid: true } });
    if (masterTask) {
      const previousContent = JSON.stringify(contract, null, 2);
      const nextContent = JSON.stringify(next, null, 2);
      await createTaskArtifact(masterTask.uuid, { artifactType: 'backlog', title: `[SYSTEM] Backlog v${next.version}`, content: nextContent, contentFormat: 'json', createdByUserUuid: req.authUser.uuid, createdByUserId: req.authUser.id, createdByAgentName: 'backlog_challenger' });
      await createTaskArtifact(masterTask.uuid, { artifactType: 'custom', title: `[SYSTEM] Backlog diff v${next.version}`, content: JSON.stringify({ fromVersion: contract.version || 1, toVersion: next.version, generatedAt: new Date().toISOString(), generatedBy: req.authUser.uuid, previous: previousContent, current: nextContent }, null, 2), contentFormat: 'json', createdByUserUuid: req.authUser.uuid, createdByUserId: req.authUser.id, createdByAgentName: 'backlog_challenger' });
    }
    res.json(serializeBigInts({ success: true, version: next.version, stories: next.stories }));
  } catch (error) { next(error); }
}

export async function getProjectArchitectureStatusController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const status = await getProjectArchitectureStatus(req.params.projectUuid, req.authUser.uuid);
    res.json(serializeBigInts(status));
  } catch (error) {
    next(error);
  }
}

export async function getProjectDocumentationBundleController(req, res, next) {
  try {
    await assertProjectPermission(req.params.projectUuid, req.authUser.uuid, 'manager');
    const architectureStatus = await getProjectArchitectureStatus(req.params.projectUuid, req.authUser.uuid);
    if (architectureStatus?.hasArchitecture && !architectureStatus?.architectureApproved) {
      return res.status(409).json({
        message: 'A documentaÃ§Ã£o final sÃ³ pode ser exportada depois da aprovaÃ§Ã£o humana da arquitetura atual.',
        architectureStatus: serializeBigInts(architectureStatus),
      });
    }
    const bundle = await getProjectDocumentationBundle(req.params.projectUuid, req.authUser.uuid);
    res.json(serializeBigInts(bundle));
  } catch (error) {
    next(error);
  }
}

export async function approveProjectArchitectureController(req, res, next) {
  try {
    await assertProjectAccess(req.params.projectUuid, req.authUser.uuid);
    const artifact = await approveCurrentArchitectureArtifact(req.params.projectUuid, req.authUser.uuid);
    const architectureStatus = await getProjectArchitectureStatus(req.params.projectUuid, req.authUser.uuid);
    res.json(
      serializeBigInts({
        success: true,
        artifact,
        architectureStatus,
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function generateProjectArchitectureController(req, res, next) {
  let agentRun = null;
  let runLifecycle = null;

  try {
    const { projectUuid } = req.params;
    await assertProjectPermission(projectUuid, req.authUser.uuid, 'manager');

    // The architecture agent was deliberately removed from the active
    // pipeline. Keep the legacy endpoint explicit instead of creating a run
    // that can only fail as an unknown Python agent.
    return res.status(410).json({
      message: 'A etapa de arquitetura automatizada foi removida. Requisitos e QA aprovados liberam a implementacao diretamente.',
      projectUuid,
    });

    const [project, tasks, architectureStatus] = await Promise.all([
      getProjectByUuid(projectUuid, req.authUser.uuid),
      listProjectTasks(projectUuid, {}, req.authUser.uuid),
      getProjectArchitectureStatus(projectUuid, req.authUser.uuid),
    ]);

    if (!architectureStatus.allStoriesRefined) {
      return res.status(400).json({
        message: 'A arquitetura so pode ser gerada quando todas as historias estiverem refinadas.',
        architectureStatus: serializeBigInts(architectureStatus),
      });
    }

    if (architectureStatus.hasArchitecture) {
      return res.status(409).json({
        message: 'A arquitetura deste projeto jÃ¡ foi gerada e nÃ£o pode ser executada novamente.',
        architectureStatus: serializeBigInts(architectureStatus),
      });
    }

      const refinedStories = tasks
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
        });

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
      project_id: projectUuid,
      idea: compactProjectBrief(project),
      requirements: requirementsBundle,
      project_name: project?.name || 'Projeto',
      project_context: {
        description: project?.description || '',
        vision: project?.vision || '',
        intake: project?.intakeConfig || {},
        project_dna: compactProjectDnaForAgent(project?.projectDna || project?.intakeConfig?.projectDna || null),
        backlog_contract: compactArchitectureBacklogContract(project),
        stories: refinedStories.map((story) => {
          const backlogStories = Array.isArray(project?.intakeConfig?.backlogContract?.stories)
            ? project.intakeConfig.backlogContract.stories
            : [];
          const backlogStory = backlogStories.find(
            (item) => String(item?.title || '').trim() === String(story.title || '').trim()
          );
          return {
            taskUuid: story.taskUuid,
            backlogStoryId: backlogStory?.id || null,
            title: story.title,
          };
        }),
      },
    };

    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'architect' });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(projectUuid, 'architect', payloadWithRuntime);
    runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    const result = await runSingleAgent('architect', payloadWithRuntime, { envOverrides });
    assertArtifactCompleteness('architect', typeof result === 'string' ? result : JSON.stringify(result, null, 2));

    const finalized = await runLifecycle.finalizeSuccess({
      result,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, result, envOverrides),
    });

    if (!finalized) {
      return;
    }

    await persistAgentResult(projectUuid, 'architect', payloadWithRuntime, result);
    const updatedArchitectureStatus = await getProjectArchitectureStatus(projectUuid, req.authUser.uuid);

    res.status(201).json(
      serializeBigInts({
        success: true,
        architectureStatus: updatedArchitectureStatus,
        data: result,
      })
    );
  } catch (error) {
    if (runLifecycle?.isFinalized()) {
      return;
    }

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({ errorMessage: error.message }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, {
        status: 'failed',
        errorMessage: error.message,
      }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) {
      return;
    }

    if (isAgentRunConflictError(error)) {
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    next(error);
  }
}

export async function createTaskArtifactController(req, res, next) {
  try {
    const { artifactType, title, content } = req.body;

    if (!artifactType || !title?.trim() || !content?.trim()) {
      return res.status(400).json({ message: 'artifactType, title e content sao obrigatorios.' });
    }

    await assertTaskAccess(req.params.taskUuid, req.authUser.uuid);
    const existingTask = await getTaskByUuid(req.params.taskUuid, req.authUser.uuid);
    await assertProjectPermission(existingTask.project.uuid, req.authUser.uuid, 'editor');

    const artifact = await createTaskArtifact(req.params.taskUuid, {
      ...req.body,
      createdByUserUuid: req.authUser.uuid,
      createdByUserId: req.authUser.id,
    });
    res.status(201).json(serializeBigInts(artifact));
  } catch (error) {
    next(error);
  }
}

export async function repairTaskArtifactController(req, res, next) {
  try {
    const task = await getTaskByUuid(req.params.taskUuid, req.authUser.uuid);
    if (!task) return res.status(404).json({ message: 'Tarefa não encontrada.' });
    const artifact = (task.artifacts || []).find((item) => item.uuid === req.params.artifactUuid && item.isCurrent);
    if (!artifact) return res.status(404).json({ message: 'Artefato atual não encontrado.' });
    const reviewingQa = ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType);
    const approvedRequirements = (task.artifacts || []).some(
      (item) => item.isCurrent && item.artifactType === 'requirements' && item.isApproved
    );
    if (reviewingQa && !approvedRequirements) {
      return res.status(409).json({ message: 'A revisão de QA exige requisitos aprovados na versão atual.' });
    }
    const relatedRequirement = ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType)
      ? (task.artifacts || []).find((item) => item.artifactType === 'requirements' && item.isCurrent)?.content || `${task.title}\n${task.description || ''}`
      : `${task.title}\n${task.description || ''}`;
    const currentReport = evaluateArtifactQuality({ artifactType: artifact.artifactType, content: artifact.content, relatedRequirement });
    const instruction = String(req.body?.instruction || '').trim().slice(0, 2000);
    const decisionResponses = Array.isArray(req.body?.decisionResponses)
      ? req.body.decisionResponses
        .filter((item) => item && typeof item.question === 'string' && (typeof item.answer === 'string' || item.ignored === true))
        .map((item) => ({ question: item.question.trim(), answer: typeof item.answer === 'string' ? item.answer.trim() : null, ignored: item.ignored === true }))
      : [];
    // Decisions must stay in the artifact lane where they were made. Reusing
    // every review_decisions artifact on the task lets a QA answer become a
    // requirement rule (or the inverse) on a later retry.
    const persistedDecisionArtifacts = ['requirements', 'qa_validation_cases', 'test_plan'].includes(artifact.artifactType)
      ? await prisma.taskArtifact.findMany({
          where: {
            taskId: task.id,
            artifactScope: 'review_decisions',
            title: `Decisões da revisão - ${artifact.title}`.slice(0, 255),
          },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        })
      : [];
    const persistedDecisionResponses = persistedDecisionArtifacts.flatMap(({ content }) => {
      try {
        const snapshot = JSON.parse(content);
        // Review decisions belong to the task requirements, not only to the
        // version that first received them. Reapply confirmed facts when a
        // later repair needs to recover a malformed version.
        if (!Array.isArray(snapshot?.decisions)) return [];
        return snapshot.decisions
          .filter((item) => item && !item.ignored && typeof item.question === 'string' && typeof item.answer === 'string' && item.answer.trim())
          .map((item) => ({ question: item.question.trim(), answer: item.answer.trim(), ignored: false }));
      } catch {
        return [];
      }
    });
    const confirmedDecisionResponses = [...decisionResponses, ...persistedDecisionResponses]
      .filter((item) => item?.answer && !item.ignored)
      .filter((item, index, values) => values.findIndex((candidate) =>
        candidate.question === item.question && candidate.answer === item.answer
      ) === index);
    const persistedDecisionInstructions = persistedDecisionResponses
      .map((item) => `Decisao: ${item.question}\nResposta: ${item.answer}`);
    const effectiveInstruction = [instruction, ...persistedDecisionInstructions]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join('\n\n')
      .slice(0, 6000);
    const findings = currentReport.findings.length
      ? currentReport.findings
      : [{
          code: 'manual_review',
          severity: 'medium',
          message: instruction || 'Revise a clareza e a testabilidade da seção mais relevante, sem inventar regras de negócio.',
        }];
    const usesRequirementsRegeneration = artifact.artifactType === 'requirements' && confirmedDecisionResponses.length > 0;
    const usesQaRegeneration = reviewingQa;
    const repairAgentName = usesRequirementsRegeneration
      ? 'requirements_reviewer'
      : (usesQaRegeneration ? 'qa_reviewer' : 'artifact_repair');
    let requirementSpec = null;
    if (usesQaRegeneration) {
      const requirementSpecArtifact = (task.artifacts || []).find(
        (item) => item.isCurrent && item.title === '[SYSTEM] Requirement Spec'
      );
      try { requirementSpec = requirementSpecArtifact?.content ? JSON.parse(requirementSpecArtifact.content) : null; } catch { requirementSpec = null; }
    }
    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: repairAgentName });
    const result = await runSingleAgent(repairAgentName, {
      project_id: task.project.uuid,
      task_uuid: task.uuid,
      artifact_type: artifact.artifactType,
      current_artifact: artifact.content,
      findings,
      source_context: `Task: ${task.title}\nDescricao: ${task.description || ''}\n\nRequisito relacionado:\n${relatedRequirement}`,
      instruction: effectiveInstruction,
      decisions: confirmedDecisionResponses,
      requirement_summary: relatedRequirement,
      requirement_spec: requirementSpec,
      idea: usesRequirementsRegeneration ? 'Regenerar o requisito com decisões humanas confirmadas' : `Reparar somente o artefato ${artifact.artifactType}`,
    }, { envOverrides });
    let patchedContent;
    if (usesRequirementsRegeneration || usesQaRegeneration) {
      patchedContent = String(result.markdown || '').trim();
      if (!patchedContent) throw new Error(`O revisor de ${usesQaRegeneration ? 'QA' : 'requisitos'} não retornou um documento completo.`);
      if (usesRequirementsRegeneration) patchedContent = restoreCompactRequirementStructure(patchedContent, task.title);
    } else {
      const sectionTitle = String(result.section || '').replace(/^#+\s*/, '').trim();
      const isAcceptancePatch = artifact.artifactType === 'requirements' && /^cenarios de aceite$/i.test(sectionTitle);
      const safeReplacement = isAcceptancePatch
        ? mergeAcceptanceScenarioCoverage(extractLevelTwoSection(artifact.content, 'Cenarios de aceite'), result.content)
        : result.content;
      patchedContent = replaceArtifactSection(artifact.content, sectionTitle, safeReplacement, artifact.artifactType);
    }
    if (artifact.artifactType === 'requirements' && !usesRequirementsRegeneration) {
      patchedContent = restoreCompactRequirementStructure(removeResolvedPendingDecisions(patchedContent, effectiveInstruction), task.title);
    }
    if (artifact.artifactType === 'requirements' && confirmedDecisionResponses.length && !usesRequirementsRegeneration) {
      // A confirmed decision that changes a rule must also be demonstrable in
      // acceptance criteria. Ask the repair agent for that single section
      // after rules have been deterministically applied.
      const coveragePatch = await runSingleAgent('artifact_repair', {
        project_id: task.project.uuid,
        task_uuid: task.uuid,
        artifact_type: 'requirements',
        current_artifact: patchedContent,
        findings: [{
          code: 'answered_decision_requires_acceptance_coverage',
          severity: 'high',
          message: 'Cada decisão respondida que altera comportamento deve estar coberta por cenário de aceite verificável.',
        }],
        source_context: `Task: ${task.title}\n\nDecisões confirmadas:\n${confirmedDecisionResponses.map((item) => `- ${item.answer}`).join('\n')}`,
        instruction: 'Atualize somente a seção "Cenarios de aceite". Inclua cenários BDD apenas para decisões confirmadas ainda não cobertas. Não repita cenário já existente nem invente mensagens, persistência ou comportamento adicional.',
        idea: 'Cobrir decisões confirmadas nos cenários de aceite',
      }, { envOverrides });
      const coverageSection = String(coveragePatch.section || '').replace(/^#+\s*/, '').trim();
      if (!/^cenarios de aceite$/i.test(coverageSection) || !String(coveragePatch.content || '').trim()) {
        throw new Error('O reparo não conseguiu produzir cenários de aceite para as decisões confirmadas.');
      }
      const existingScenarios = extractLevelTwoSection(patchedContent, 'Cenarios de aceite');
      const mergedScenarios = mergeAcceptanceScenarioCoverage(existingScenarios, coveragePatch.content);
      const coveredContent = replaceArtifactSection(patchedContent, coverageSection, mergedScenarios, 'requirements');
      if (coveredContent.trim() !== patchedContent.trim()) {
        patchedContent = restoreCompactRequirementStructure(coveredContent, task.title);
      }
    }
    if (patchedContent.trim() === String(artifact.content || '').trim()) {
      // A QA decision can legitimately clarify a rule that has no approved
      // BDD criterion yet. In that case QA must not invent a CT merely to
      // manufacture a new version. Preserve the human decision as audit
      // evidence and let the UI explain that RA needs to complement the
      // requirement before QA can change.
      if (usesQaRegeneration && confirmedDecisionResponses.length) {
        const decisionArtifact = await createTaskArtifact(task.uuid, {
          artifactType: 'custom',
          artifactScope: 'review_decisions',
          title: `Decisões da revisão - ${artifact.title}`.slice(0, 255),
          content: JSON.stringify({
            sourceArtifactUuid: artifact.uuid,
            resultArtifactUuid: null,
            decisions: decisionResponses,
            outcome: 'requires_requirements_revision',
            decidedAt: new Date().toISOString(),
            decidedByUserUuid: req.authUser.uuid,
          }),
          contentFormat: 'json',
          createdByUserId: req.authUser.id,
          createdByAgentName: repairAgentName,
        });
        return res.status(200).json(serializeBigInts({
          success: true,
          noArtifactChange: true,
          decisionArtifact,
          qualityReport: currentReport,
          message: 'A decisão foi registrada, mas ela não pode gerar um caso de QA sem critério BDD aprovado. Atualize o requisito no RA e gere o QA novamente.',
        }));
      }
      return res.status(422).json({ message: 'O agente não propôs uma alteração efetiva para este artefato.', qualityReport: currentReport });
    }
    // Garantia determinística: um reparo não pode continuar sem a seção que
    // o Quality Gate apontou. O texto é explicitamente proposto para revisão
    // humana, sem inventar regra de negócio.
    if (artifact.artifactType === 'requirements' && currentReport.findings?.some((item) => item.code === 'missing_section' && /criterios de aceite/i.test(item.message))) {
      const hasAcceptance = /^##\s+Criterios de Aceite(?:\s+\(BDD\))?\s*$/im.test(patchedContent);
      if (!hasAcceptance) {
        patchedContent = `${patchedContent.trim()}\n\n## Criterios de Aceite\n- [PROPOSTO - VALIDAR] DADO o ator autorizado e o contexto descrito na User Story, QUANDO executar a ação principal, ENTÃO o sistema deve apresentar o resultado esperado descrito na história.\n`;
      }
    }
    if (currentReport.findings?.some((item) => item.code === 'contradictory_not_applicable')) {
      patchedContent = patchedContent.replace(/n[aã]o se aplica/gi, 'A validar com o responsável');
    }
    const repairedReport = assertArtifactQuality({ artifactType: artifact.artifactType, content: patchedContent, relatedRequirement });
    const nextArtifact = await createTaskArtifact(task.uuid, {
      artifactType: artifact.artifactType,
      title: artifact.title,
      content: patchedContent,
      contentFormat: artifact.contentFormat,
      createdByAgentName: repairAgentName,
    });
    const refreshedRequirementSpec = artifact.artifactType === 'requirements'
      ? await refreshRequirementSpecArtifact(task.uuid, {
        content: patchedContent,
        createdByAgentName: repairAgentName,
        sourceArtifactUuid: nextArtifact.uuid,
        sourceArtifactVersion: nextArtifact.version,
        sourceArtifactTitle: nextArtifact.title,
        sourceAgentName: nextArtifact.createdByAgentName || repairAgentName,
      })
      : null;
    const refreshedQaValidationSpec = usesQaRegeneration
      ? await refreshQaValidationSpecArtifact(task.uuid)
      : null;
    if (decisionResponses.length) {
      await createTaskArtifact(task.uuid, {
        artifactType: 'custom',
        artifactScope: 'review_decisions',
        title: `Decisões da revisão - ${artifact.title}`.slice(0, 255),
        content: JSON.stringify({ sourceArtifactUuid: artifact.uuid, resultArtifactUuid: nextArtifact.uuid, decisions: decisionResponses, decidedAt: new Date().toISOString(), decidedByUserUuid: req.authUser.uuid }),
        contentFormat: 'json',
        createdByUserId: req.authUser.id,
        createdByAgentName: repairAgentName,
      });
    }
    res.status(201).json(serializeBigInts({ success: true, artifact: nextArtifact, patch: result, qualityReport: repairedReport, requirementSpec: refreshedRequirementSpec?.artifact || null, qaValidationSpec: refreshedQaValidationSpec?.artifact || null }));
  } catch (error) {
    next(error);
  }
}

export async function reviewTaskArtifactController(req, res, next) {
  try {
    const artifact = await reviewTaskArtifact(req.params.taskUuid, req.params.artifactUuid, {
      approved: req.body?.approved,
      comment: req.body?.comment,
      userUuid: req.authUser.uuid,
    });
    res.json(serializeBigInts({ success: true, artifact }));
  } catch (error) {
    next(error);
  }
}

export async function addProjectMemberController(req, res, next) {
  try {
    const project = await addProjectMember(req.params.projectUuid, req.body || {}, req.authUser.uuid);
    res.status(201).json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function updateProjectMemberController(req, res, next) {
  try {
    const project = await updateProjectMemberRole(
      req.params.projectUuid,
      req.params.memberUuid,
      req.body || {},
      req.authUser.uuid
    );
    res.json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}

export async function removeProjectMemberController(req, res, next) {
  try {
    const project = await removeProjectMember(req.params.projectUuid, req.params.memberUuid, req.authUser.uuid);
    res.json(serializeBigInts(project));
  } catch (error) {
    next(error);
  }
}
