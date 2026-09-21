import { runSingleAgent } from '../services/orchestratorService.js';
import { buildRuntimeAiEnvForUser } from '../services/aiSettingsService.js';
import { v4 as uuidv4 } from 'uuid';
import {
  assertTaskAccess,
  createAgentRunStart,
  createQaArtifacts,
  createRequirementsArtifacts,
  ensurePipelineProject,
  finishAgentRun,
  getTaskContextByUuid,
  persistAgentResult,
  restoreTaskAfterAgentFailure,
  updateTask,
} from '../services/projectDataService.js';
import { createAgentRunLifecycle } from '../utils/agentRunLifecycle.js';
import { assertArtifactCompleteness as assertSharedArtifactCompleteness } from '../utils/artifactQuality.js';
import { serializeBigInts } from '../utils/serialize.js';
import { buildAgentRunUsage, withAiRuntimeMeta } from '../utils/aiRunMetrics.js';
import { appendWorkbenchArtifactForUser } from '../services/workbenchArtifactService.js';

function compactText(value = '', maxLength = 220) {
  const text = String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
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
  const backlogContract = task.project?.intakeConfig?.backlogContract || null;
  const stories = Array.isArray(backlogContract?.stories) ? backlogContract.stories : [];
  const currentStory = stories.find((story) => String(story?.title || '').trim() === String(task.title || '').trim()) || null;
  const relatedStories = stories
    .filter((story) => story && story.id !== currentStory?.id)
    .slice(0, 6)
    .map((story) => `${story.id}: ${compactText(story.title, 110)}`);

  return [
    currentStory?.id ? `ID rastreavel da historia: ${currentStory.id}` : null,
    `Historia alvo: ${compactText(task.title, 140)}`,
    task.description ? `Contexto imediato: ${compactText(task.description, 180)}` : null,
    task.project?.description ? `Projeto: ${compactText(task.project.description, 140)}` : null,
    task.project?.vision ? `Visao: ${compactText(task.project.vision, 160)}` : null,
    projectDnaSummary ? `Project DNA: ${compactText(projectDnaSummary, 240)}` : null,
    relatedStories.length ? `Outras historias do backlog: ${relatedStories.join(' | ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function extractCompactRequirementSection(content = '', sectionTitle = '', maxLength = 260) {
  const normalized = String(content || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`##+\\s+(?:\\d+\\.\\s+)?${escaped}\\s*([\\s\\S]*?)(?=\\n##+\\s+|$)`, 'i'));
  return compactText(match ? match[1] : '', maxLength);
}

function isAgentRunConflictError(error) {
  return error?.statusCode === 409 || error?.code === 'AGENT_RUN_CONFLICT';
}

function getRequirementsUserFacingError(error) {
  const detail = String(error?.message || '');
  const normalized = normalizeArtifactText(detail);

  if (normalized.includes('revisao de evidencias indisponivel')) {
    return {
      status: 503,
      code: 'REQUIREMENTS_EVIDENCE_REVIEW_UNAVAILABLE',
      message: 'A revisao independente de evidencias nao foi concluida. Nenhum requisito foi publicado; tente novamente.',
    };
  }

  if (normalized.includes('historia nao esta apta para refinamento') || normalized.includes('acoes independentes que precisam ser separadas')) {
    return {
      status: 422,
      code: 'REQUIREMENTS_SCOPE_SPLIT',
      message: 'Esta história reúne mais de uma jornada independente. Separe as ações em stories menores ou confirme o escopo antes de gerar os requisitos.',
    };
  }

  if (normalized.includes('conflito entre ator') || normalized.includes('review_role')) {
    return {
      status: 422,
      code: 'REQUIREMENTS_ROLE_CONFLICT',
      message: 'A história tem conflito entre o ator e a ação descrita. Revise quem executa a ação antes de gerar os requisitos.',
    };
  }

  if (normalized.includes('reparo do backlog pendente') || normalized.includes('review_blocked')) {
    return {
      status: 422,
      code: 'REQUIREMENTS_BACKLOG_REVIEW_REQUIRED',
      message: 'Esta história possui pendências da revisão do backlog. Resolva-as na tela de revisão antes de gerar os requisitos.',
    };
  }

  if (normalized.includes('nenhum modelo do router concluiu') || normalized.includes('falha de provider')) {
    const quotaExceeded = normalized.includes('resource_exhausted')
      || normalized.includes('quota exceeded')
      || normalized.includes('rate limit');
    return {
      status: 503,
      code: 'REQUIREMENTS_PROVIDER_UNAVAILABLE',
      retryable: true,
      message: quotaExceeded
        ? 'A geração não foi concluída porque os serviços de IA atingiram o limite temporário de uso. A task voltou para o backlog sem perder informações. Aguarde cerca de um minuto e tente novamente.'
        : 'A geração não foi concluída porque os serviços de IA estão temporariamente indisponíveis. A task voltou para o backlog sem perder informações. Tente novamente em alguns minutos.',
    };
  }

  if (normalized.includes('tempo limite excedido') || normalized.includes('deadline') || normalized.includes('timeout')) {
    return {
      status: 504,
      code: 'REQUIREMENTS_GENERATION_TIMEOUT',
      message: 'A geração de requisitos excedeu o tempo limite. Reduza o contexto da história ou tente novamente quando o modelo local estiver disponível.',
    };
  }

  if (
    normalized.includes('contrato valido apos')
    || normalized.includes('resposta completa apos')
    || normalized.includes('descoberta semantica')
    || normalized.includes('classificacao semantica')
    || normalized.includes('evidencia semantica')
  ) {
    return {
      status: 422,
      code: 'REQUIREMENTS_INSUFFICIENT_DETAIL',
      message: 'Não foi possível gerar um requisito confiável com as informações atuais. Detalhe ator, ação, resultado esperado e regras relevantes, depois tente novamente.',
    };
  }

  if (normalized.includes('artefato de requisitos') || normalized.includes('criterios de aceite bdd')) {
    return {
      status: 422,
      code: 'REQUIREMENTS_ARTIFACT_INCOMPLETE',
      message: 'O documento gerado ficou incompleto e não foi salvo. Tente novamente; se persistir, complemente a story com fluxo, regras e critérios de aceite.',
    };
  }

  if (normalized.includes('texto aparentemente truncado')) {
    return {
      status: 422,
      code: 'REQUIREMENTS_ARTIFACT_TRUNCATED',
      message: 'O documento gerado terminou de forma incompleta e não foi publicado. Tente novamente; os detalhes técnicos ficaram registrados na execução.',
    };
  }

  return {
    status: 500,
    code: 'REQUIREMENTS_GENERATION_FAILED',
    message: 'Não foi possível gerar os requisitos desta história. Consulte os detalhes da execução e tente novamente.',
  };
}

function buildAgentRunDiagnostic(error, result, executionDiagnostic = null) {
  const diagnostic = {
    ...(executionDiagnostic || {}),
    ...(error?.agentDiagnostic || {}),
  };

  if (result !== null && result !== undefined) {
    diagnostic.rejectedArtifact = true;
    diagnostic.rejectedArtifactChars = typeof result === 'string'
      ? result.length
      : JSON.stringify(result).length;
  }

  return Object.keys(diagnostic).length ? diagnostic : null;
}

function buildQaRequirementSummary(requirementsContent = '') {
  const userStory = extractCompactRequirementSection(requirementsContent, 'User Story Refinada', 180)
    || extractCompactRequirementSection(requirementsContent, 'User Story', 180)
    || extractCompactRequirementSection(requirementsContent, 'Historia e objetivo', 180);
  const functional = extractCompactRequirementSection(requirementsContent, 'Requisitos Funcionais', 360)
    || extractCompactRequirementSection(requirementsContent, 'Comportamento esperado', 360)
    || extractCompactRequirementSection(requirementsContent, 'Comportamento e regras confirmadas', 360);
  const mainFlow = extractCompactRequirementSection(requirementsContent, 'Fluxo Principal', 220)
    || extractCompactRequirementSection(requirementsContent, 'Comportamento esperado', 220)
    || extractCompactRequirementSection(requirementsContent, 'Comportamento e regras confirmadas', 220);
  const rules = extractCompactRequirementSection(requirementsContent, 'Regras de Negocio', 220)
    || extractCompactRequirementSection(requirementsContent, 'Comportamento e regras confirmadas', 220);
  const acceptance = extractCompactRequirementSection(requirementsContent, 'Criterios de Aceite (BDD)', 260)
    || extractCompactRequirementSection(requirementsContent, 'Cenarios de aceitacao', 260)
    || extractCompactRequirementSection(requirementsContent, 'Cenarios de aceite', 260);

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

function buildCompactProjectDnaSummary(projectDna) {
  if (!projectDna || typeof projectDna !== 'object') return '';

  return [
    projectDna.project?.productMode ? `Product mode: ${projectDna.project.productMode}` : null,
    projectDna.project?.experienceStyle ? `Experience style: ${projectDna.project.experienceStyle}` : null,
    projectDna.project?.primaryActor ? `Ator principal: ${projectDna.project.primaryActor}` : null,
    Array.isArray(projectDna.project?.domainLanguage) && projectDna.project.domainLanguage.length
      ? `Linguagem do dominio: ${projectDna.project.domainLanguage.slice(0, 8).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function compactRequirementStory(story) {
  if (!story || typeof story !== 'object') return null;

  const refinement = story.refinementContext || story.refinement_context || {};
  return {
    id: story.id || null,
    title: compactText(story.title || story.goal || '', 180) || null,
    description: compactText(story.description || '', 260) || null,
    actor: compactText(story.actor || '', 100) || null,
    benefit: compactText(story.benefit || '', 160) || null,
    priority: compactText(story.priority || '', 40) || null,
    status: story.status || null,
    reviewTags: Array.isArray(story.reviewTags || story.review_tags) ? (story.reviewTags || story.review_tags).slice(0, 6) : [],
    openQuestions: Array.isArray(story.openQuestions || story.open_questions) ? (story.openQuestions || story.open_questions).slice(0, 4) : [],
    refinementContext: {
      inputs: Array.isArray(refinement.inputs) ? refinement.inputs.slice(0, 5) : [],
      outputs: Array.isArray(refinement.outputs) ? refinement.outputs.slice(0, 5) : [],
      confirmed_rules: Array.isArray(refinement.confirmed_rules) ? refinement.confirmed_rules.slice(0, 6) : [],
      constraints: Array.isArray(refinement.constraints) ? refinement.constraints.slice(0, 5) : [],
      dependencies: Array.isArray(refinement.dependencies) ? refinement.dependencies.slice(0, 5) : [],
      open_questions: Array.isArray(refinement.open_questions) ? refinement.open_questions.slice(0, 4) : [],
      acceptance_criteria: Array.isArray(refinement.acceptance_criteria) ? refinement.acceptance_criteria.slice(0, 4) : [],
      pm_handoff: refinement.pmHandoff || refinement.pm_handoff || null,
    },
  };
}

function buildCompactRequirementProjectContext(task) {
  const intakeConfig = task.project?.intakeConfig || {};
  const projectDna = intakeConfig.projectDna || {};
  const backlogContract = intakeConfig.backlogContract || {};
  const stories = Array.isArray(backlogContract.stories) ? backlogContract.stories : [];
  const currentStory = stories.find((story) => String(story?.title || '').trim() === String(task.title || '').trim()) || null;
  const relatedStories = stories
    .filter((story) => story && story.id !== currentStory?.id)
    // All stories are compacted below. The analyst needs the backlog map to
    // identify criteria that actually belong to a neighbouring journey.
    .slice(0, 30)
    .map(compactRequirementStory)
    .filter(Boolean);

  return {
    taskPriority: task.priority || null,
    description: compactText(task.project?.description, 180),
    vision: compactText(task.project?.vision, 220),
    projectDna: {
      project: {
        productMode: projectDna.project?.productMode || null,
        experienceStyle: projectDna.project?.experienceStyle || null,
        primaryActor: projectDna.project?.primaryActor || null,
        domainLanguage: Array.isArray(projectDna.project?.domainLanguage) ? projectDna.project.domainLanguage.slice(0, 8) : [],
      },
      positioning: {
        summary: compactText(projectDna.positioning?.summary, 220) || null,
      },
      coherenceRules: {
        mustPreserve: Array.isArray(projectDna.coherenceRules?.mustPreserve) ? projectDna.coherenceRules.mustPreserve.slice(0, 6) : [],
        forbiddenDrift: Array.isArray(projectDna.coherenceRules?.forbiddenDrift) ? projectDna.coherenceRules.forbiddenDrift.slice(0, 6) : [],
      },
    },
    backlogContract: {
      capabilities: Array.isArray(backlogContract.capabilities)
        ? backlogContract.capabilities.slice(0, 6).map((item) => ({ id: item?.id || null, name: compactText(item?.name, 120) || null }))
        : [],
      releaseSlices: Array.isArray(backlogContract.releaseSlices)
        ? backlogContract.releaseSlices.slice(0, 5).map((item) => ({ id: item?.id || null, name: compactText(item?.name, 100) || null, goal: compactText(item?.goal, 160) || null }))
        : [],
      policyRegistry: Array.isArray(backlogContract.policyRegistry)
        ? backlogContract.policyRegistry.slice(0, 12).map((policy) => ({
          id: policy?.id || null,
          area: policy?.area || null,
          statement: compactText(policy?.statement, 220) || null,
          status: policy?.status || null,
          sourceIds: Array.isArray(policy?.source_ids) ? policy.source_ids.slice(0, 4) : [],
        }))
        : [],
      stories: [currentStory, ...relatedStories].filter(Boolean).map((story) => compactRequirementStory(story)).filter(Boolean),
    },
    policies: Array.isArray(backlogContract.policyRegistry)
      ? backlogContract.policyRegistry.map((policy) => compactText(policy?.statement, 220)).filter(Boolean).slice(0, 12)
      : [],
    storyContext: {
      currentStory: compactRequirementStory(currentStory),
      relatedStories,
    },
  };
}

function hasBrokenEnding(content = '') {
  const text = (content || '').trimEnd();
  if (!text) return true;
  const codeFenceCount = (text.match(/```/g) || []).length;
  if (codeFenceCount % 2 !== 0) return true;
  const boldMarkerCount = (text.match(/\*\*/g) || []).length;
  if (boldMarkerCount % 2 !== 0) return true;
  const lastLine = text.split(/\r?\n/).pop().trim();
  return /^(?:[-*+]\s*|\d+[.)]\s*|\\)$/.test(lastLine);
}

function normalizeArtifactText(content = '') {
  return String(content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractNormalizedArtifactSection(content = '', sectionTitle = '', nextSectionTitles = []) {
  const normalized = normalizeArtifactText(content);
  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextPattern = nextSectionTitles.length
    ? `(?=\\n##+\\s+(?:${nextSectionTitles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})|$)`
    : '$';
  const match = normalized.match(new RegExp(`##+\\s+${escapedTitle}\\s*([\\s\\S]*?)${nextPattern}`, 'i'));
  return (match?.[1] || '').trim();
}

function countNumberedQaCases(section = '') {
  return (section.match(/(?:^|\n)\s*(?:[-*]\s+)?(?:ct\s*0*\d+|\d+[\.\)])/gi) || []).length;
}

function assertArtifactCompleteness(agentName, content) {
  const normalized = normalizeArtifactText(content);

  if (!content?.trim()) {
    throw new Error(`O agente ${agentName} retornou um artefato vazio.`);
  }

  if (agentName === 'requirements_analyst') {
    const legacyRequiredSections = [
      'user story refinada',
      'requisitos funcionais',
      'fluxo principal',
      'fluxos alternativos',
      'fluxos de excecao',
      'regras de negocio',
      'criterios de aceite',
    ];
    const publicRequiredSections = [
      'historia e objetivo',
      'comportamento e regras confirmadas',
      'cenarios de aceite',
      'decisoes pendentes',
      'status',
    ];
    const requiredSections = normalized.includes('requisito refinado')
      ? publicRequiredSections
      : legacyRequiredSections;

    for (const section of requiredSections) {
      if (!normalized.includes(section)) {
        throw new Error(`O artefato de requisitos foi retornado de forma incompleta: secao ausente (${section}).`);
      }
    }

    if (!normalized.includes('dado') || !normalized.includes('quando') || !normalized.includes('entao')) {
      throw new Error('O artefato de requisitos foi retornado sem critérios de aceite BDD completos.');
    }
  }

  if (agentName === 'qa_engineer') {
    const requiredSections = ['casos de validacao', 'cobertura dos criterios de aceite', 'lacunas de qualidade', 'decisao de preparacao'];

    for (const section of requiredSections) {
      if (!normalized.includes(section)) {
        throw new Error(`Os casos de validacao foram retornados de forma incompleta: secao ausente (${section}).`);
      }
    }

    const functionalCasesSection = extractNormalizedArtifactSection(content, 'casos de validacao', [
      'lacunas de qualidade',
      'decisao de preparacao',
      'fim_dos_casos_de_validacao',
    ]);
    const hasCt01 = /ct\s*0*1/i.test(functionalCasesSection);
    const numberedCases = countNumberedQaCases(functionalCasesSection);
    const actionCount = (functionalCasesSection.match(/\bacao\b/g) || []).length;
    const expectedResultCount = (functionalCasesSection.match(/resultado esperado/g) || []).length;
    const hasStructuredFunctionalCases = numberedCases >= 1 && actionCount >= 1 && expectedResultCount >= 1;

    if (!hasCt01 && !hasStructuredFunctionalCases) {
      throw new Error('Os casos de validacao foram retornados sem casos completos.');
    }
  }

  if (hasBrokenEnding(content)) {
    throw new Error(`O agente ${agentName} retornou um texto aparentemente truncado no final.`);
  }
}

export async function runAgentController(req, res) {
  let agentRun = null;
  let runLifecycle = null;
  let agentResult = null;
  let executionDiagnostic = null;
  try {
    const { agent, payload } = req.body;
    const isFreeformWorkbench = payload?.request_mode === 'freeform_workbench';
    const hasProjectBinding = Boolean(String(payload?.project_id || '').trim());

    if (!agent || !payload || !payload.idea) {
      return res.status(400).json({ message: 'Nome do agente e payload com a ideia sao obrigatorios.' });
    }

    if (!isFreeformWorkbench && !payload.project_id) {
      payload.project_id = uuidv4();
    }

    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: agent });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);

    if (payload.project_id) {
      await ensurePipelineProject(payload.project_id, payload.idea, req.authUser.uuid);
      agentRun = await createAgentRunStart(payload.project_id, agent, payloadWithRuntime);
      runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    }

    agentResult = await runSingleAgent(agent, payloadWithRuntime, {
      envOverrides,
      diagnosticSink: (diagnostic) => { executionDiagnostic = diagnostic; },
    });
    assertSharedArtifactCompleteness(agent, typeof agentResult === 'string' ? agentResult : JSON.stringify(agentResult, null, 2));

    if (runLifecycle) {
      const finalized = await runLifecycle.finalizeSuccess({
        result: agentResult,
        usageMeta: buildAgentRunUsage(payloadWithRuntime, agentResult, envOverrides),
      });

      if (!finalized) {
        return;
      }
    }

    if (payload.project_id) {
      await persistAgentResult(payload.project_id, agent, payloadWithRuntime, agentResult);
    } else if (isFreeformWorkbench) {
      await appendWorkbenchArtifactForUser(req.authUser.uuid, {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        agent,
        story: String(payload.idea || '').trim(),
        storyPreview: String(payload.idea || '').trim().slice(0, 120),
        context: String(payload.context || '').trim(),
        projectId: '',
        timestamp: new Date().toISOString(),
        output: agentResult,
      });
    }

    res.status(200).json({
      success: true,
      project_id: hasProjectBinding ? payload.project_id : null,
      data: agentResult,
    });
  } catch (error) {
    if (runLifecycle?.isFinalized()) {
      return;
    }

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({ errorMessage: error.message, result: agentResult, diagnostic: buildAgentRunDiagnostic(error, agentResult, executionDiagnostic) }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, { status: 'failed', errorMessage: error.message, result: agentResult, diagnostic: buildAgentRunDiagnostic(error, agentResult, executionDiagnostic) }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) {
      return;
    }

    if (isAgentRunConflictError(error)) {
      console.warn(`[AgentController] Conflito ao iniciar agente: ${error.message}`);
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    console.error(`[AgentController] Error: ${error.message}`);
    res.status(500).json({ message: 'Erro ao executar o agente de IA', error: error.message });
  }
}

function parseJsonArtifact(content = '') {
  try {
    const value = JSON.parse(String(content || ''));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function runRequirementsForTaskController(req, res) {
  let agentRun = null;
  let previousTaskState = null;
  let runLifecycle = null;
  let agentResult = null;
  let executionDiagnostic = null;

  try {
    const { taskUuid } = req.params;
    await assertTaskAccess(taskUuid, req.authUser.uuid);
    const task = await getTaskContextByUuid(taskUuid, req.authUser.uuid);

    if (!task) {
      return res.status(404).json({ message: 'Tarefa não encontrada.' });
    }

    previousTaskState = {
      status: task.status,
      assigneeType: task.assigneeType,
      assigneeUserId: task.assigneeUserId,
      assigneeAgentName: task.assigneeAgentName,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      currentArtifactSummary: task.currentArtifactSummary,
    };

    const latestRequirements = task.artifacts.find(
      (artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent
    );

    if (latestRequirements?.isApproved) {
      return res.status(400).json({
        message: 'A etapa de requisitos desta task já foi concluída e não pode ser executada novamente.',
      });
    }

    await updateTask(taskUuid, {
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeAgentName: 'requirements_analyst',
      changedByUserUuid: req.authUser.uuid,
      statusNote: 'Task enviada para o Analista de Requisitos',
    });

    const payload = {
      project_id: task.project.uuid,
      task_uuid: task.uuid,
      idea: `Refine somente esta história de usuário: ${task.title}${
        task.description ? `\n\nContexto complementar da tarefa: ${task.description}` : ''
      }`,
      backlog: buildCompactRequirementBacklog(task),
      project_name: task.project.name,
      project_context: buildCompactRequirementProjectContext(task),
    };

    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'requirements_analyst' });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(task.project.uuid, 'requirements_analyst', payloadWithRuntime);
    runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    agentResult = await runSingleAgent('requirements_analyst', payloadWithRuntime, {
      envOverrides,
      diagnosticSink: (diagnostic) => { executionDiagnostic = diagnostic; },
    });
    const content = typeof agentResult === 'string'
      ? agentResult
      : (typeof agentResult?.markdown === 'string' ? agentResult.markdown : JSON.stringify(agentResult, null, 2));
    assertSharedArtifactCompleteness('requirements_analyst', content);

    const finalized = await runLifecycle.finalizeSuccess({
      result: agentResult,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, agentResult, envOverrides),
    });

    if (!finalized) {
      return;
    }

    await createRequirementsArtifacts(task.uuid, {
      title: `Requisitos refinados - ${task.title}`,
      content,
      contentFormat: 'markdown',
      createdByAgentName: 'requirements_analyst',
      agentRunId: agentRun.id,
      requirementContract: agentResult?.requirement_contract || agentResult?.requirementContract || parseJsonArtifact(content)?.requirement_contract || parseJsonArtifact(content)?.requirementContract || null,
    });

    const updatedTask = await updateTask(taskUuid, {
      status: 'in_review',
      assigneeType: 'agent',
      assigneeAgentName: 'requirements_analyst',
      changedByUserUuid: req.authUser.uuid,
      statusNote: 'Refinamento de requisitos concluído',
    });

    res.status(200).json(
      serializeBigInts({
        success: true,
        task: updatedTask,
      data: agentResult,
    })
  );
  } catch (error) {
    if (runLifecycle?.isFinalized()) {
      return;
    }

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({ errorMessage: error.message, result: agentResult, diagnostic: buildAgentRunDiagnostic(error, agentResult, executionDiagnostic) }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, { status: 'failed', errorMessage: error.message, result: agentResult, diagnostic: buildAgentRunDiagnostic(error, agentResult, executionDiagnostic) }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) {
      return;
    }

    if (isAgentRunConflictError(error)) {
      console.warn(`[AgentController] Conflito ao executar requisitos: ${error.message}`);
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    if (previousTaskState) {
      await restoreTaskAfterAgentFailure(req.params.taskUuid, previousTaskState, {
        changedByUserUuid: req.authUser.uuid,
        failedAgentName: 'requirements_analyst',
        errorMessage: error.message,
      }).catch(() => null);
    }
    console.error(`[AgentController] Error running requirements for task: ${error.message}`);
    const userFacingError = getRequirementsUserFacingError(error);
    res.status(userFacingError.status).json({
      ...userFacingError,
      scopeReview: error?.agentDiagnostic?.scope_review || null,
      requestId: req.requestId || null,
    });
  }
}

export async function runQaForTaskController(req, res) {
  let agentRun = null;
  let previousTaskState = null;
  let runLifecycle = null;
  let qaResult = null;

  try {
    const { taskUuid } = req.params;
    await assertTaskAccess(taskUuid, req.authUser.uuid);
    const task = await getTaskContextByUuid(taskUuid, req.authUser.uuid);

    if (!task) {
      return res.status(404).json({ message: 'Tarefa não encontrada.' });
    }

    previousTaskState = {
      status: task.status,
      assigneeType: task.assigneeType,
      assigneeUserId: task.assigneeUserId,
      assigneeAgentName: task.assigneeAgentName,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      currentArtifactSummary: task.currentArtifactSummary,
    };

    const latestRequirements = task.artifacts.find(
      (artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent
    );

    if (!latestRequirements) {
      return res.status(400).json({
        message: 'A task precisa ter requisitos refinados antes de seguir para QA.',
      });
    }

    if (!latestRequirements.isApproved) {
      return res.status(409).json({
        message: 'Os requisitos precisam ser aprovados antes de iniciar o QA.',
      });
    }

    const latestTestPlan = task.artifacts.find(
      (artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType) && artifact.isCurrent
    );

    if (latestTestPlan) {
      return res.status(400).json({
        message: 'A etapa de QA desta task já foi concluída e não pode ser executada novamente.',
      });
    }

    await updateTask(taskUuid, {
      status: 'qa',
      assigneeType: 'agent',
      assigneeAgentName: 'qa_engineer',
      changedByUserUuid: req.authUser.uuid,
      statusNote: 'Task enviada para QA',
    });

    const requirementSummary = buildQaRequirementSummary(latestRequirements.content);
    const latestRequirementSpec = task.artifacts.find(
      (artifact) => artifact.title === '[SYSTEM] Requirement Spec' && artifact.isCurrent
    );
    const requirementSpec = parseJsonArtifact(latestRequirementSpec?.content);
    const projectDnaSummary = buildCompactProjectDnaSummary(task.project?.intakeConfig?.projectDna || null);

    const payload = {
      project_id: task.project.uuid,
      task_uuid: task.uuid,
      idea: `Prepare casos de validação apenas para esta tarefa: ${task.title}${
        task.description ? `\n\nContexto especifico da tarefa: ${task.description}` : ''
      }`,
      code_structure: requirementSummary,
      developer_output: {
        code: requirementSummary,
      },
      project_name: task.project.name,
      project_context: {
        description: compactText(task.project.description, 180),
        vision: compactText(task.project.vision, 220),
        project_dna: compactText(projectDnaSummary, 240),
      },
      requirement_summary: requirementSummary,
      requirement_spec: latestRequirementSpec?.content || '',
      requirement_contract: requirementSpec?.requirementContract || requirementSpec?.requirement_contract || null,
    };

    const envOverrides = await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'qa_engineer' });
    const payloadWithRuntime = withAiRuntimeMeta(payload, envOverrides);
    agentRun = await createAgentRunStart(task.project.uuid, 'qa_engineer', payloadWithRuntime);
    runLifecycle = createAgentRunLifecycle(req, res, agentRun, finishAgentRun);
    qaResult = await runSingleAgent('qa_engineer', payloadWithRuntime, { envOverrides });
    const content = typeof qaResult === 'string' ? qaResult : JSON.stringify(qaResult, null, 2);
    assertSharedArtifactCompleteness('qa_engineer', content);

    const finalized = await runLifecycle.finalizeSuccess({
      result: qaResult,
      usageMeta: buildAgentRunUsage(payloadWithRuntime, qaResult, envOverrides),
    });

    if (!finalized) {
      return;
    }

    await createQaArtifacts(task.uuid, {
      title: `Casos de validação - ${task.title}`,
      content,
      contentFormat: 'markdown',
      createdByAgentName: 'qa_engineer',
      agentRunId: agentRun.id,
    });

    const updatedTask = await updateTask(taskUuid, {
      status: 'in_review',
      assigneeType: 'agent',
      assigneeAgentName: 'qa_engineer',
      changedByUserUuid: req.authUser.uuid,
      statusNote: 'Plano de testes gerado; aguardando aprovação humana',
    });

    res.status(200).json(
      serializeBigInts({
        success: true,
        task: updatedTask,
      data: result,
    })
  );
  } catch (error) {
    if (runLifecycle?.isFinalized()) {
      return;
    }

    if (runLifecycle) {
      await runLifecycle.finalizeFailure({ errorMessage: error.message, result: qaResult }).catch(() => null);
    } else if (agentRun?.id) {
      await finishAgentRun(agentRun.id, { status: 'failed', errorMessage: error.message, result: qaResult }).catch(() => null);
    }

    if (runLifecycle?.wasAborted()) {
      return;
    }

    if (isAgentRunConflictError(error)) {
      console.warn(`[AgentController] Conflito ao executar QA: ${error.message}`);
      return res.status(409).json({
        message: error.message,
        existingRunUuid: error.existingRunUuid || null,
      });
    }

    if (previousTaskState) {
      await restoreTaskAfterAgentFailure(req.params.taskUuid, previousTaskState, {
        changedByUserUuid: req.authUser.uuid,
        failedAgentName: 'qa_engineer',
        errorMessage: error.message,
      }).catch(() => null);
    }
    console.error(`[AgentController] Error running QA for task: ${error.message}`);
    res.status(500).json({ message: 'Erro ao executar o QA Engineer', error: error.message });
  }
}
