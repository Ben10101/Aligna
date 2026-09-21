import { prisma } from '../lib/prisma.js';
import { getAuditLogPath, readRecentAuditEntries } from './auditLogService.js';
import { getRefreshCookieOptions, getRefreshTokenTtlDays } from './authService.js';
import { getRateLimitConfig } from '../middleware/securityMiddleware.js';
import { buildBudgetConfig, estimateTokenCount, extractRuntimeMetaFromPayload } from '../utils/aiRunMetrics.js';
import { getRuntimeTelemetrySnapshot } from './runtimeTelemetryService.js';

function buildProjectScope(userUuid = null, projectUuid = null) {
  const projectWhere = {};

  if (projectUuid) {
    projectWhere.uuid = projectUuid;
  }

  if (userUuid) {
    projectWhere.workspace = {
      ownerUser: {
        uuid: userUuid,
      },
    };
  }

  return Object.keys(projectWhere).length ? { project: projectWhere } : {};
}

function average(values = []) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values = [], p = 95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function asNumber(value) {
  return Number(value || 0);
}

function parseJsonContent(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function averageNullable(values = []) {
  const filtered = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)));
  if (!filtered.length) return null;
  return Math.round(filtered.reduce((sum, value) => sum + Number(value), 0) / filtered.length);
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 1)) * 100);
}

function startsWithTitle(artifacts = [], prefix = '') {
  return artifacts.find((artifact) => String(artifact?.title || '').startsWith(prefix)) || null;
}

function countDriftFlags(frequencies, driftFlags = []) {
  for (const flag of driftFlags) {
    const key = String(flag || '').trim();
    if (!key) continue;
    frequencies[key] = (frequencies[key] || 0) + 1;
  }
}

function buildBudgetPressureSummary(enrichedRuns = []) {
  const budgetedRuns = enrichedRuns.filter((run) => Number(run.configuredBudget || 0) > 0);
  const overBudgetRuns = budgetedRuns.filter((run) => run.overBudget);
  const recentBudgetedRuns = enrichedRuns.slice(0, 20).filter((run) => Number(run.configuredBudget || 0) > 0);
  const recentOverBudgetRuns = recentBudgetedRuns.filter((run) => run.overBudget);

  const pressurePercent = budgetedRuns.length ? Math.round((overBudgetRuns.length / budgetedRuns.length) * 100) : 0;
  const recentPressurePercent = recentBudgetedRuns.length
    ? Math.round((recentOverBudgetRuns.length / recentBudgetedRuns.length) * 100)
    : 0;

  const level =
    recentPressurePercent >= 40 || pressurePercent >= 35
      ? 'high'
      : recentPressurePercent >= 20 || pressurePercent >= 15
        ? 'medium'
        : 'low';

  return {
    level,
    label: level === 'high' ? 'pressao alta' : level === 'medium' ? 'pressao media' : 'pressao baixa',
    pressurePercent,
    recentPressurePercent,
    budgetedRuns: budgetedRuns.length,
    overBudgetRuns: overBudgetRuns.length,
    recentBudgetedRuns: recentBudgetedRuns.length,
    recentOverBudgetRuns: recentOverBudgetRuns.length,
  };
}

function buildReadinessRunbook({ readinessChecks = [], aiOverview = null, production = false }) {
  const checksByCode = new Map(readinessChecks.map((check) => [check.code, check]));
  const actions = [];

  if (checksByCode.get('auth_secret')?.status === 'failed') {
    actions.push({
      code: 'fix_auth_secret',
      title: 'Configurar segredo de autenticação',
      detail: 'Defina AUTH_ACCESS_SECRET ou JWT_SECRET antes de liberar qualquer ambiente de produção.',
      category: 'security',
    });
  }

  if (checksByCode.get('ai_settings_secret')?.status === 'failed') {
    actions.push({
      code: 'fix_ai_settings_secret',
      title: 'Configurar segredo das credenciais de IA',
      detail: 'Defina AI_SETTINGS_SECRET para manter as credenciais de IA criptografadas por ambiente.',
      category: 'security',
    });
  }

  if (checksByCode.get('cors')?.status === 'failed') {
    actions.push({
      code: 'fix_frontend_origin',
      title: 'Fixar a origem do frontend',
      detail: 'Configure FRONTEND_ORIGIN ou VITE_FRONTEND_URL para restringir CORS em produção.',
      category: 'security',
    });
  }

  if (checksByCode.get('provider_api')?.status === 'warning') {
    actions.push({
      code: 'configure_provider_api',
      title: 'Garantir pelo menos um provider remoto',
      detail: 'Adicione uma chave de provider para evitar dependência exclusiva de fallback local.',
      category: 'runtime',
    });
  }

  if ((aiOverview?.summary?.staleRunningRuns || 0) > 0) {
    actions.push({
      code: 'clear_stale_runs',
      title: 'Limpar runs travadas',
      detail: 'Cancele ou recupere execuções acima da janela esperada e revise o watchdog.',
      category: 'runtime',
    });
  }

  if ((aiOverview?.summary?.overBudgetRuns || 0) > 0 || (aiOverview?.summary?.budgetPressureLevel || 'low') === 'high') {
    actions.push({
      code: 'reduce_budget_pressure',
      title: 'Reduzir pressão de budget',
      detail: 'Corte contexto, revise budgets por agente e priorize providers mais previsíveis.',
      category: 'cost',
    });
  }

  if ((aiOverview?.reliability?.topFailingAgents || []).length) {
    const lead = aiOverview.reliability.topFailingAgents[0];
    actions.push({
      code: `stabilize_${lead.agentName}`,
      title: `Estabilizar ${lead.agentName}`,
      detail: `${lead.failed} falhas em ${lead.runs} runs indicam concentração de risco nesta etapa.`,
      category: 'runtime',
    });
  }

  if (!actions.length) {
    actions.push({
      code: 'ready_to_ship',
      title: production ? 'Pronto para operar' : 'Pronto para liberar',
      detail: 'Sem blockers críticos, sem runs travadas e com sinais operacionais estáveis.',
      category: 'readiness',
    });
  }

  return actions.slice(0, 5);
}

function buildReleaseReadinessSummary({ readinessChecks = [], aiOverview = null, production = false }) {
  const failedCount = readinessChecks.filter((check) => check.status === 'failed').length;
  const warningCount = readinessChecks.filter((check) => check.status === 'warning').length;
  const staleRuns = Number(aiOverview?.summary?.staleRunningRuns || 0);
  const overBudgetRuns = Number(aiOverview?.summary?.overBudgetRuns || 0);
  const budgetPressureLevel = String(aiOverview?.summary?.budgetPressureLevel || 'low');

  const releaseState =
    failedCount > 0
      ? 'blocked'
      : warningCount > 0 || staleRuns > 0 || overBudgetRuns > 0 || budgetPressureLevel === 'high'
        ? 'watch'
        : 'ready';

  const rollbackReady = failedCount === 0 && staleRuns === 0;

  return {
    state: releaseState,
    label:
      releaseState === 'blocked'
        ? 'release bloqueada'
        : releaseState === 'watch'
          ? 'release em observacao'
          : 'release pronta',
    canDeploy: releaseState === 'ready',
    rollbackReady,
    nextAction:
      releaseState === 'blocked'
        ? 'Corrigir blockers antes de liberar a próxima release.'
        : releaseState === 'watch'
          ? 'Estabilize budget, runs e warnings antes da próxima release.'
          : production
            ? 'A release pode seguir com monitoramento ativo e rollback pronto.'
            : 'A release pode seguir com monitoramento de pré-produção.',
  };
}

function normalizeRepairTelemetryArtifacts(artifacts = {}) {
  const executionState = artifacts.executionState || null;
  const scopeAssessment = artifacts.repairScopeAssessment || executionState?.repairScopeAssessment || null;
  const enforcement = artifacts.repairEnforcement || null;
  const diagnosis = artifacts.debugDiagnosis?.diagnosis || artifacts.debugDiagnosis || null;

  return {
    writeSetStatus: scopeAssessment?.status || 'unknown',
    adherencePercent:
      scopeAssessment?.adherencePercent !== undefined && scopeAssessment?.adherencePercent !== null
        ? Number(scopeAssessment.adherencePercent)
        : null,
    escalated: Boolean(enforcement?.enforcementDirective),
    rootCause: diagnosis?.rootCause || null,
    nextExecutor: enforcement?.enforcementDirective?.nextExecutor || null,
  };
}

export async function getOperationalHealth() {
  let database = 'degraded';
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    database = 'ok';
  } catch {
    database = 'down';
  }

  let runtimeSnapshot = {
    summary: {
      staleRunningRuns: 0,
      recoveredRunsLast24h: 0,
      failedRunsLast24h: 0,
    },
    inMemory: {
      summary: getRuntimeTelemetrySnapshot().totals,
    },
  };
  if (database === 'ok') {
    try {
      runtimeSnapshot = await getRuntimeOperationsStatus();
    } catch {
      runtimeSnapshot = {
        ...runtimeSnapshot,
        summary: {
          ...runtimeSnapshot.summary,
          staleRunningRuns: 0,
        },
      };
    }
  }

  return {
    status: database === 'ok' && runtimeSnapshot.summary.staleRunningRuns === 0 ? 'ok' : 'degraded',
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database,
    environment: process.env.NODE_ENV || 'development',
    runtime: {
      inMemory: runtimeSnapshot.inMemory.summary,
      staleRunningRuns: runtimeSnapshot.summary.staleRunningRuns,
      recoveredRunsLast24h: runtimeSnapshot.summary.recoveredRunsLast24h,
      failureRunsLast24h: runtimeSnapshot.summary.failedRunsLast24h,
    },
  };
}

export async function getRuntimeOperationsStatus(userUuid = null, { projectUuid = null, lookbackHours = 24 } = {}) {
  const lookbackStart = new Date(Date.now() - Math.max(1, Number(lookbackHours || 24)) * 60 * 60 * 1000);
  const projectScope = buildProjectScope(userUuid, projectUuid);
  const runningThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const inMemory = getRuntimeTelemetrySnapshot();

  const [
    runningRuns,
    staleRunningRunsCount,
    recoveredRunsLast24h,
    failedRunsLast24h,
    startedRunsLast24h,
    backlogTasks,
    inProgressTasks,
    reviewTasks,
    qaTasks,
  ] = await Promise.all([
    prisma.agentRun.findMany({
      where: {
        status: 'running',
        ...projectScope,
      },
      orderBy: { startedAt: 'asc' },
      take: 20,
      select: {
        uuid: true,
        agentName: true,
        startedAt: true,
        project: { select: { uuid: true, name: true } },
        task: { select: { uuid: true, title: true } },
      },
    }),
    prisma.agentRun.count({
      where: {
        status: 'running',
        startedAt: { lt: runningThreshold },
        ...projectScope,
      },
    }),
    prisma.agentRun.count({
      where: {
        status: 'failed',
        finishedAt: { gte: lookbackStart },
        errorMessage: { contains: 'recuper' },
        ...projectScope,
      },
    }),
    prisma.agentRun.count({
      where: {
        status: 'failed',
        finishedAt: { gte: lookbackStart },
        ...projectScope,
      },
    }),
    prisma.agentRun.count({
      where: {
        createdAt: { gte: lookbackStart },
        ...projectScope,
      },
    }),
    prisma.task.count({
      where: {
        status: 'backlog',
        taskType: { not: 'agent_job' },
        ...projectScope,
      },
    }),
    prisma.task.count({
      where: {
        status: 'in_progress',
        taskType: { not: 'agent_job' },
        ...projectScope,
      },
    }),
    prisma.task.count({
      where: {
        status: 'in_review',
        taskType: { not: 'agent_job' },
        ...projectScope,
      },
    }),
    prisma.task.count({
      where: {
        status: 'qa',
        taskType: { not: 'agent_job' },
        ...projectScope,
      },
    }),
  ]);

  const recentAgentHealth = await prisma.agentRun.findMany({
    where: {
      createdAt: { gte: lookbackStart },
      ...projectScope,
    },
    orderBy: { createdAt: 'desc' },
    take: 160,
    select: {
      agentName: true,
      status: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  const byAgent = Object.values(
    recentAgentHealth.reduce((acc, run) => {
      const current = acc[run.agentName] || {
        agentName: run.agentName,
        started: 0,
        failed: 0,
        completed: 0,
        recovered: 0,
        durations: [],
      };
      current.started += 1;
      current.failed += run.status === 'failed' ? 1 : 0;
      current.completed += run.status === 'completed' ? 1 : 0;
      current.recovered += run.status === 'failed' && String(run.errorMessage || '').includes('recuper') ? 1 : 0;
      if (run.startedAt && run.finishedAt) {
        current.durations.push(Math.max(0, Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000)));
      }
      acc[run.agentName] = current;
      return acc;
    }, {})
  ).map((agent) => ({
    agentName: agent.agentName,
    started: agent.started,
    completed: agent.completed,
    failed: agent.failed,
    recovered: agent.recovered,
    failureRatePercent: agent.started ? Math.round((agent.failed / agent.started) * 100) : 0,
    averageDurationSeconds: average(agent.durations),
  }));

  const alerts = [
    ...(staleRunningRunsCount > 0
      ? [{ code: 'stale_running_runs', message: `Existem ${staleRunningRunsCount} execucoes acima da janela esperada.` }]
      : []),
    ...(failedRunsLast24h > 5
      ? [{ code: 'failure_spike', message: `Foram detectadas ${failedRunsLast24h} falhas de agentes nas ultimas ${lookbackHours}h.` }]
      : []),
    ...(recoveredRunsLast24h > 3
      ? [{ code: 'recovery_spike', message: `O watchdog recuperou ${recoveredRunsLast24h} execucoes nas ultimas ${lookbackHours}h.` }]
      : []),
  ];

  return {
    checkedAt: new Date().toISOString(),
    windowHours: Math.max(1, Number(lookbackHours || 24)),
    summary: {
      startedRunsLast24h,
      failedRunsLast24h,
      recoveredRunsLast24h,
      runningRuns: runningRuns.length,
      staleRunningRuns: staleRunningRunsCount,
      backlogTasks,
      inProgressTasks,
      reviewTasks,
      qaTasks,
    },
    inMemory: {
      summary: inMemory.totals,
      byAgent: inMemory.byAgent,
      recentEvents: inMemory.recentEvents.slice(0, 20),
    },
    runningRuns: runningRuns.map((run) => ({
      ...run,
      runningForSeconds: run.startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000))
        : null,
    })),
    byAgent,
    alerts,
  };
}

export async function getAiOperationsOverview(userUuid, projectUuid = null) {
  const budgets = buildBudgetConfig();
  const projectFilter = projectUuid ? { project: { uuid: projectUuid } } : {};
  const now = Date.now();

  const agentRuns = await prisma.agentRun.findMany({
    where: {
      project: {
        workspace: {
          ownerUser: {
            uuid: userUuid,
          },
        },
      },
      ...projectFilter,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
    select: {
      uuid: true,
      agentName: true,
      status: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      tokensInput: true,
      tokensOutput: true,
      costUsd: true,
      inputPayload: true,
      project: { select: { uuid: true, name: true } },
      task: { select: { uuid: true, title: true } },
    },
  });

  const generatedRuns = await prisma.generatedAppRun.findMany({
    where: {
      generatedApp: {
        project: {
          workspace: {
            ownerUser: {
              uuid: userUuid,
            },
          },
          ...(projectUuid ? { uuid: projectUuid } : {}),
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: {
      uuid: true,
      runType: true,
      status: true,
      logSummary: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      generatedApp: { select: { project: { select: { uuid: true, name: true } } } },
      taskImplementation: {
        select: {
          task: { select: { uuid: true, title: true } },
          buildStatus: true,
          testStatus: true,
          status: true,
        },
      },
    },
  });

  const enrichedRuns = agentRuns.map((run) => {
    const runtimeMeta = extractRuntimeMetaFromPayload(run.inputPayload);
    const durationSeconds =
      run.startedAt && run.finishedAt
        ? Math.max(0, Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000))
        : null;
    const currentRunningSeconds =
      run.status === 'running' && run.startedAt
        ? Math.max(0, Math.round((now - new Date(run.startedAt).getTime()) / 1000))
        : null;
    const totalTokens = asNumber(run.tokensInput) + asNumber(run.tokensOutput);
    const configuredBudget = budgets[run.agentName] || null;

    return {
      uuid: run.uuid,
      agentName: run.agentName,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationSeconds,
      currentRunningSeconds,
      errorMessage: run.errorMessage,
      tokensInput: asNumber(run.tokensInput),
      tokensOutput: asNumber(run.tokensOutput),
      totalTokens,
      costUsd: Number(run.costUsd || 0),
      configuredBudget,
      overBudget: configuredBudget ? totalTokens > configuredBudget : false,
      runtimeMeta,
      project: run.project,
      task: run.task,
    };
  });

  const statusCounts = enrichedRuns.reduce((acc, run) => {
    acc[run.status] = (acc[run.status] || 0) + 1;
    return acc;
  }, {});

  const completedDurations = enrichedRuns
    .map((run) => run.durationSeconds)
    .filter((value) => value !== null && value !== undefined);
  const recentWindowRuns = enrichedRuns.slice(0, 20);
  const recentFailedRuns = recentWindowRuns.filter((run) => run.status === 'failed');
  const staleRunningRuns = enrichedRuns.filter((run) => run.status === 'running' && (run.currentRunningSeconds || 0) > 600);
  const budgetPressure = buildBudgetPressureSummary(enrichedRuns);

  const byAgent = Object.values(
    enrichedRuns.reduce((acc, run) => {
      const current = acc[run.agentName] || {
        agentName: run.agentName,
        runs: 0,
        failed: 0,
        completed: 0,
        avgDurationSeconds: [],
        avgTokens: [],
        costUsd: 0,
        overBudgetCount: 0,
      };
      current.runs += 1;
      current.failed += run.status === 'failed' ? 1 : 0;
      current.completed += run.status === 'completed' ? 1 : 0;
      if (run.durationSeconds !== null) current.avgDurationSeconds.push(run.durationSeconds);
      if (run.totalTokens) current.avgTokens.push(run.totalTokens);
      current.costUsd += run.costUsd || 0;
      current.overBudgetCount += run.overBudget ? 1 : 0;
      acc[run.agentName] = current;
      return acc;
    }, {})
  ).map((item) => ({
    agentName: item.agentName,
    runs: item.runs,
    failed: item.failed,
    completed: item.completed,
    failureRate: item.runs ? Math.round((item.failed / item.runs) * 100) : 0,
    averageDurationSeconds: average(item.avgDurationSeconds),
    averageTokens: average(item.avgTokens),
    costUsd: Number(item.costUsd.toFixed(6)),
    overBudgetCount: item.overBudgetCount,
  }));

  const topFailingAgents = [...byAgent]
    .filter((item) => item.failed > 0)
    .sort((a, b) => {
      if (b.failed !== a.failed) return b.failed - a.failed;
      return b.failureRate - a.failureRate;
    })
    .slice(0, 5);

  const qualityImplementations = generatedRuns
    .map((run) => ({
      uuid: run.uuid,
      runType: run.runType,
      status: run.status,
      project: run.generatedApp.project,
      task: run.taskImplementation?.task || null,
      qualityScore: null,
      reviewStatus: run.taskImplementation?.status || null,
      buildStatus: run.taskImplementation?.buildStatus || null,
      testStatus: run.taskImplementation?.testStatus || null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      logSummary: run.logSummary,
    }))
    .slice(0, 20);

  const implementationFailures = qualityImplementations.filter((run) => run.status === 'failed');

  const taskImplementations = await prisma.taskImplementation.findMany({
    where: {
      task: {
        project: {
          workspace: {
            ownerUser: {
              uuid: userUuid,
            },
          },
          ...(projectUuid ? { uuid: projectUuid } : {}),
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
    select: {
      id: true,
      status: true,
      buildStatus: true,
      testStatus: true,
      updatedAt: true,
      task: {
        select: {
          uuid: true,
          title: true,
          project: { select: { uuid: true, name: true } },
        },
      },
    },
  });

  const implementationIds = taskImplementations.map((item) => item.id);
  const implementationArtifacts = implementationIds.length
    ? await prisma.taskArtifact.findMany({
        where: {
          taskImplementationId: { in: implementationIds },
          artifactScope: 'implementation',
          isCurrent: true,
          OR: [
            { title: { startsWith: 'Implementation Diff Review - ' } },
            { title: { startsWith: 'Implementation Execution State - ' } },
            { title: { startsWith: 'Implementation Repair Scope Assessment - ' } },
            { title: { startsWith: 'Implementation Repair Enforcement - ' } },
            { title: { startsWith: 'Implementation Debug Diagnosis - ' } },
          ],
        },
        select: {
          taskImplementationId: true,
          title: true,
          content: true,
        },
      })
    : [];

  const implementationArtifactsById = implementationArtifacts.reduce((acc, artifact) => {
    const current = acc.get(artifact.taskImplementationId) || {};
    if (artifact.title.startsWith('Implementation Diff Review - ')) {
      current.diffReview = parseJsonContent(artifact.content);
    }
    if (artifact.title.startsWith('Implementation Execution State - ')) {
      current.executionState = parseJsonContent(artifact.content);
    }
    if (artifact.title.startsWith('Implementation Repair Scope Assessment - ')) {
      current.repairScopeAssessment = parseJsonContent(artifact.content)?.scopeAssessment || null;
    }
    if (artifact.title.startsWith('Implementation Repair Enforcement - ')) {
      current.repairEnforcement = parseJsonContent(artifact.content);
    }
    if (artifact.title.startsWith('Implementation Debug Diagnosis - ')) {
      current.debugDiagnosis = parseJsonContent(artifact.content);
    }
    acc.set(artifact.taskImplementationId, current);
    return acc;
  }, new Map());

  const laneNames = ['backend', 'frontend', 'shared'];
  const implementationByLane = laneNames.map((lane) => {
    const implementationsForLane = taskImplementations
      .map((implementation) => {
        const artifacts = implementationArtifactsById.get(implementation.id) || {};
        const diffReview = artifacts.diffReview || null;
        const executionState = artifacts.executionState || null;
        const laneRisk = diffReview?.qualitySignals?.laneRisks?.find((item) => item.lane === lane) || null;
        const laneRecommendation =
          diffReview?.qualitySignals?.laneRecommendations?.find((item) => item.lane === lane) || null;
        const currentLaneWorkstreams = executionState?.currentWorkstreamsByLane?.[lane] || [];
        const completedLaneWorkstreams = executionState?.completedWorkstreamsByLane?.[lane] || [];
        const repairingLane =
          executionState?.phase === 'repair' &&
          Array.isArray(executionState?.repairScope?.workstreamIds) &&
          executionState.repairScope.workstreamIds.some((id) =>
            lane === 'backend'
              ? id === 'backend_module'
              : lane === 'frontend'
                ? id === 'frontend_feature'
                : id === 'shared_contracts' || id === 'persistence_and_docs'
          );

        const touchedLane =
          Boolean(laneRisk) ||
          currentLaneWorkstreams.length > 0 ||
          completedLaneWorkstreams.length > 0;

        if (!touchedLane) return null;

        return {
          implementationId: implementation.id,
          status: implementation.status,
          buildStatus: implementation.buildStatus,
          testStatus: implementation.testStatus,
          updatedAt: implementation.updatedAt,
          project: implementation.task.project,
          task: { uuid: implementation.task.uuid, title: implementation.task.title },
          laneRisk,
          laneRecommendation,
          activeWorkstreams: currentLaneWorkstreams.length,
          completedWorkstreams: completedLaneWorkstreams.length,
          repairingLane,
        };
      })
      .filter(Boolean);

    return {
      lane,
      implementations: implementationsForLane.length,
      integrated: implementationsForLane.filter((item) => item.status === 'integrated').length,
      failed: implementationsForLane.filter((item) => item.status === 'failed').length,
      blocked: implementationsForLane.filter((item) => item.laneRisk?.level === 'high').length,
      active: implementationsForLane.filter((item) => item.activeWorkstreams > 0).length,
      repairing: implementationsForLane.filter((item) => item.repairingLane).length,
      averageReviewScore: averageNullable(implementationsForLane.map((item) => item.laneRisk?.reviewScore)),
      averageSpecialistScore: averageNullable(implementationsForLane.map((item) => item.laneRisk?.specialistScore)),
      averageRiskScore: averageNullable(implementationsForLane.map((item) => item.laneRisk?.score)),
      highRiskCount: implementationsForLane.filter((item) => item.laneRisk?.level === 'high').length,
      recommendations: implementationsForLane
        .map((item) => item.laneRecommendation?.recommendation)
        .filter(Boolean)
        .slice(0, 3),
    };
  });

  const repairSnapshots = taskImplementations
    .map((implementation) => {
      const artifacts = implementationArtifactsById.get(implementation.id) || {};
      return normalizeRepairTelemetryArtifacts(artifacts);
    })
    .filter((item) => item.writeSetStatus !== 'unknown' || item.rootCause || item.nextExecutor);

  const rootCauseCounts = repairSnapshots.reduce((acc, item) => {
    if (!item.rootCause) return acc;
    acc[item.rootCause] = (acc[item.rootCause] || 0) + 1;
    return acc;
  }, {});

  const executorCounts = repairSnapshots.reduce((acc, item) => {
    if (!item.nextExecutor) return acc;
    acc[item.nextExecutor] = (acc[item.nextExecutor] || 0) + 1;
    return acc;
  }, {});

  const complianceCounts = repairSnapshots.reduce((acc, item) => {
    const key = item.writeSetStatus || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const repairAdherenceValues = repairSnapshots
    .map((item) => item.adherencePercent)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));

  const repairGovernance = {
    totalImplementationsObserved: taskImplementations.length,
    repairsObserved: repairSnapshots.length,
    localRepairRatePercent: percent(complianceCounts.compliant || 0, repairSnapshots.length),
    escalatedRatePercent: percent(repairSnapshots.filter((item) => item.escalated).length, repairSnapshots.length),
    averageAdherencePercent: averageNullable(repairAdherenceValues),
    complianceCounts,
    topRootCauses: Object.entries(rootCauseCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([rootCause, count]) => ({ rootCause, count })),
    executorMix: Object.entries(executorCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([executor, count]) => ({ executor, count })),
  };

  return {
    summary: {
      totalRuns: enrichedRuns.length,
      completedRuns: statusCounts.completed || 0,
      failedRuns: statusCounts.failed || 0,
      runningRuns: statusCounts.running || 0,
      successRatePercent: enrichedRuns.length ? Math.round(((statusCounts.completed || 0) / enrichedRuns.length) * 100) : 0,
      recentFailureRatePercent: recentWindowRuns.length ? Math.round((recentFailedRuns.length / recentWindowRuns.length) * 100) : 0,
      totalCostUsd: Number(enrichedRuns.reduce((sum, run) => sum + run.costUsd, 0).toFixed(6)),
      totalEstimatedTokens: enrichedRuns.reduce((sum, run) => sum + run.totalTokens, 0),
      averageRunDurationSeconds: average(completedDurations),
      p95RunDurationSeconds: percentile(completedDurations, 95),
      overBudgetRuns: enrichedRuns.filter((run) => run.overBudget).length,
      staleRunningRuns: staleRunningRuns.length,
      implementationFailures: implementationFailures.length,
      budgetPressurePercent: budgetPressure.pressurePercent,
      recentBudgetPressurePercent: budgetPressure.recentPressurePercent,
      budgetPressureLevel: budgetPressure.level,
      budgetPressureLabel: budgetPressure.label,
    },
    reliability: {
      topFailingAgents,
      recentFailures: recentFailedRuns.slice(0, 8).map((run) => ({
        uuid: run.uuid,
        agentName: run.agentName,
        project: run.project,
        task: run.task,
        createdAt: run.createdAt,
        errorMessage: run.errorMessage,
      })),
      staleRunningRuns: staleRunningRuns.map((run) => ({
        uuid: run.uuid,
        agentName: run.agentName,
        project: run.project,
        task: run.task,
        startedAt: run.startedAt,
        currentRunningSeconds: run.currentRunningSeconds,
      })),
    },
    byAgent,
    implementationByLane,
    recentRuns: enrichedRuns.slice(0, 20),
    generatedRuns: qualityImplementations,
    budgetPressure,
    alerts: [
      ...(enrichedRuns.some((run) => run.overBudget)
        ? [{ code: 'agent_budget_exceeded', message: 'Existem execuções recentes acima do budget configurado por agente.' }]
        : []),
      ...(enrichedRuns.some((run) => run.status === 'failed')
        ? [{ code: 'agent_failures_detected', message: 'Foram detectadas falhas recentes em execuções de agentes.' }]
        : []),
      ...(qualityImplementations.some((run) => run.status === 'failed')
        ? [{ code: 'implementation_validation_failed', message: 'Existem execuções de implementação/validação com falha recente.' }]
        : []),
    ],
  };
}

export async function getProductionReadiness(userUuid, projectUuid = null) {
  const health = await getOperationalHealth();
  const aiOverview = await getAiOperationsOverview(userUuid, projectUuid);
  const recentAudit = await readRecentAuditEntries({ limit: 30, userUuid, projectUuid });
  const refreshCookie = getRefreshCookieOptions();
  const defaultRateLimit = getRateLimitConfig(false);
  const sensitiveRateLimit = getRateLimitConfig(true);
  const production = process.env.NODE_ENV === 'production';
  const providersConfigured = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
  };

  const readinessChecks = [
    { code: 'database', label: 'Banco operacional', status: health.database === 'ok' ? 'ok' : 'failed' },
    {
      code: 'auth_secret',
      label: 'Segredo de autenticação configurado',
      status: process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET ? 'ok' : production ? 'failed' : 'warning',
    },
    {
      code: 'ai_settings_secret',
      label: 'Segredo de criptografia das credenciais de IA configurado',
      status: process.env.AI_SETTINGS_SECRET || process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET ? 'ok' : production ? 'failed' : 'warning',
    },
    {
      code: 'cors',
      label: 'Origem de frontend definida',
      status: process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL ? 'ok' : production ? 'failed' : 'warning',
    },
    { code: 'provider_api', label: 'Pelo menos uma API remota configurada', status: Object.values(providersConfigured).some(Boolean) ? 'ok' : 'warning' },
    { code: 'audit_log', label: 'Auditoria operacional ativa', status: recentAudit.length ? 'ok' : 'warning' },
    { code: 'success_rate', label: 'Taxa de sucesso acima de 70%', status: (aiOverview.summary.successRatePercent || 0) >= 70 ? 'ok' : 'warning' },
    { code: 'budget_pressure', label: 'Pressao de budget controlada', status: (aiOverview.summary.overBudgetRuns || 0) === 0 ? 'ok' : 'warning' },
    { code: 'stale_runs', label: 'Sem runs travados', status: (aiOverview.summary.staleRunningRuns || 0) === 0 ? 'ok' : 'warning' },
  ];

  const warningCount = readinessChecks.filter((check) => check.status === 'warning').length;
  const failedCount = readinessChecks.filter((check) => check.status === 'failed').length;
  const blockers = readinessChecks.filter((check) => check.status === 'failed');
  const warnings = readinessChecks.filter((check) => check.status === 'warning');
  const releaseVersion = process.env.PLATFORM_VERSION || '1.0.0';
  const releaseChannel = process.env.PLATFORM_RELEASE_CHANNEL || 'internal';
  const releaseSha = process.env.PLATFORM_RELEASE_SHA || null;
  const frontendOrigin = process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
  const gateStatus = failedCount ? 'no-go' : warningCount ? 'attention' : 'go';
  const readinessAlerts = [
    ...(warningCount
      ? [{ code: 'readiness_attention', message: `Existem ${warningCount} checks de readiness exigindo atencao.` }]
      : []),
    ...(failedCount
      ? [{ code: 'readiness_failed', message: `Existem ${failedCount} checks críticos falhando na plataforma.` }]
      : []),
    ...((aiOverview.reliability.topFailingAgents || []).slice(0, 2).map((agent) => ({
      code: `agent_instability_${agent.agentName}`,
      message: `${agent.agentName} concentra ${agent.failed} falhas recentes (${agent.failureRate}% de falha).`,
    }))),
    ...((aiOverview.summary.budgetPressureLevel || 'low') === 'high'
      ? [
          {
            code: 'budget_pressure_high',
            message: `A pressao de budget esta alta: ${aiOverview.summary.recentBudgetPressurePercent || 0}% nas execucoes recentes.`,
          },
        ]
      : []),
  ];
  const runbook = buildReadinessRunbook({ readinessChecks, aiOverview, production });
  const releaseReadiness = buildReleaseReadinessSummary({ readinessChecks, aiOverview, production });

  return {
    status: failedCount ? 'degraded' : warningCount ? 'attention' : 'ok',
    checkedAt: new Date().toISOString(),
    gate: {
      status: gateStatus,
      goNoGo: gateStatus === 'go',
      blockers,
      warnings,
    },
    release: {
      version: releaseVersion,
      channel: releaseChannel,
      sha: releaseSha,
      nodeVersion: process.version,
      frontendOrigin,
      apiBasePath: '/api',
    },
    releaseReadiness,
    checks: readinessChecks,
    runbook,
    security: {
      environment: process.env.NODE_ENV || 'development',
      secureRefreshCookie: Boolean(refreshCookie.secure),
      strictSameSite: refreshCookie.sameSite === 'strict',
      corsRestricted: Boolean(process.env.NODE_ENV === 'production' && (process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL)),
      authSecretConfigured: Boolean(process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET),
      aiSettingsSecretConfigured: Boolean(process.env.AI_SETTINGS_SECRET || process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET),
      csrfProtectionEnabled: true,
      accessTokenTtlMinutes: 15,
      refreshTokenTtlDays: getRefreshTokenTtlDays(),
      rateLimitDefault: defaultRateLimit,
      rateLimitSensitive: sensitiveRateLimit,
    },
    governance: {
      auditLogPath: getAuditLogPath(),
      recentAuditEntries: recentAudit.length,
      recentAuditFailures: recentAudit.filter((entry) => entry.success === false).length,
      requestTracingEnabled: true,
      rateLimitEnabled: true,
      auditEnabled: true,
      implementationRemoteOnly: process.env.AI_DISABLE_OLLAMA_FALLBACK === '1',
      sensitiveActionsTracked: [
        'auth_login',
        'auth_register',
        'project_create',
        'project_generate_backlog',
        'project_generate_architecture',
        'task_generate_requirements',
        'task_generate_qa',
        'task_generate_implementation',
      ],
    },
    providersConfigured,
    ai: {
      successRatePercent: aiOverview.summary.successRatePercent || 0,
      recentFailureRatePercent: aiOverview.summary.recentFailureRatePercent || 0,
      staleRunningRuns: aiOverview.summary.staleRunningRuns || 0,
      overBudgetRuns: aiOverview.summary.overBudgetRuns || 0,
      budgetPressurePercent: aiOverview.summary.budgetPressurePercent || 0,
      recentBudgetPressurePercent: aiOverview.summary.recentBudgetPressurePercent || 0,
      budgetPressureLevel: aiOverview.summary.budgetPressureLevel || 'low',
      budgetPressureLabel: aiOverview.summary.budgetPressureLabel || 'pressao baixa',
      topFailingAgents: aiOverview.reliability.topFailingAgents || [],
    },
    alerts: readinessAlerts,
  };
}

export async function getAuditTrail(userUuid, { projectUuid = null, limit = 40 } = {}) {
  return readRecentAuditEntries({
    userUuid,
    projectUuid,
    limit: Math.min(100, Math.max(1, Number(limit || 40))),
  });
}

export async function getGovernanceOverview(userUuid, { projectUuid = null } = {}) {
  const lookbackDays = 7;
  const repairsFromDate = new Date();
  repairsFromDate.setDate(repairsFromDate.getDate() - (lookbackDays - 1));
  repairsFromDate.setHours(0, 0, 0, 0);
  const auditTrail = await readRecentAuditEntries({
    userUuid,
    projectUuid,
    limit: 120,
  });

  const byAction = Object.values(
    auditTrail.reduce((acc, entry) => {
      const current = acc[entry.actionType] || {
        actionType: entry.actionType,
        total: 0,
        failures: 0,
        averageDurationMsValues: [],
      };
      current.total += 1;
      current.failures += entry.success ? 0 : 1;
      current.averageDurationMsValues.push(Number(entry.durationMs || 0));
      acc[entry.actionType] = current;
      return acc;
    }, {})
  ).map((entry) => ({
    actionType: entry.actionType,
    total: entry.total,
    failures: entry.failures,
    failureRatePercent: entry.total ? Math.round((entry.failures / entry.total) * 100) : 0,
    averageDurationMs: average(entry.averageDurationMsValues),
  }));

  const topActionTypes = [...byAction].sort((a, b) => b.total - a.total).slice(0, 5);
  const failureHotspots = [...byAction]
    .filter((entry) => entry.failures > 0)
    .sort((a, b) => {
      if (b.failures !== a.failures) return b.failures - a.failures;
      return b.failureRatePercent - a.failureRatePercent;
    })
    .slice(0, 5);
  const latencyHotspots = [...byAction]
    .filter((entry) => entry.averageDurationMs > 0)
    .sort((a, b) => b.averageDurationMs - a.averageDurationMs)
    .slice(0, 5);

  const uniqueUsers = new Set(auditTrail.map((entry) => entry.userUuid).filter(Boolean)).size;

  const repairArtifacts = await prisma.taskArtifact.findMany({
    where: {
      artifactScope: 'implementation',
      createdAt: { gte: repairsFromDate },
      task: {
        project: {
          workspace: {
            ownerUser: {
              uuid: userUuid,
            },
          },
          ...(projectUuid ? { uuid: projectUuid } : {}),
        },
      },
      OR: [
        { title: { startsWith: 'Implementation Repair Scope Assessment - ' } },
        { title: { startsWith: 'Implementation Repair Enforcement - ' } },
      ],
    },
    select: {
      taskImplementationId: true,
      title: true,
      content: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const repairBuckets = new Map();
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const current = new Date(repairsFromDate);
    current.setDate(repairsFromDate.getDate() + offset);
    const key = current.toISOString().slice(0, 10);
    repairBuckets.set(key, {
      date: key,
      repairs: 0,
      compliant: 0,
      escalated: 0,
    });
  }

  const repairGroups = repairArtifacts.reduce((acc, artifact) => {
    const key = `${artifact.taskImplementationId}:${new Date(artifact.createdAt).toISOString().slice(0, 19)}`;
    const current = acc.get(key) || {
      createdAt: artifact.createdAt,
      scopeAssessment: null,
      enforcement: null,
    };
    if (artifact.title.startsWith('Implementation Repair Scope Assessment - ')) {
      current.scopeAssessment = parseJsonContent(artifact.content)?.scopeAssessment || null;
    }
    if (artifact.title.startsWith('Implementation Repair Enforcement - ')) {
      current.enforcement = parseJsonContent(artifact.content) || null;
    }
    acc.set(key, current);
    return acc;
  }, new Map());

  for (const repairEvent of repairGroups.values()) {
    const bucketKey = new Date(repairEvent.createdAt).toISOString().slice(0, 10);
    const bucket = repairBuckets.get(bucketKey);
    if (!bucket) continue;
    bucket.repairs += 1;
    if (repairEvent.scopeAssessment?.status === 'compliant') {
      bucket.compliant += 1;
    }
    if (repairEvent.enforcement?.enforcementDirective) {
      bucket.escalated += 1;
    }
  }

  const repairEvents = Array.from(repairGroups.values());
  const compliantRepairs = repairEvents.filter((event) => event.scopeAssessment?.status === 'compliant').length;
  const escalatedRepairs = repairEvents.filter((event) => event.enforcement?.enforcementDirective).length;
  const repairGovernance = {
    repairsObserved: repairEvents.length,
    localRepairRatePercent: percent(compliantRepairs, repairEvents.length),
    escalatedRatePercent: percent(escalatedRepairs, repairEvents.length),
  };

  return {
    summary: {
      totalEvents: auditTrail.length,
      failureEvents: auditTrail.filter((entry) => entry.success === false).length,
      uniqueActors: uniqueUsers,
      coveredActionTypes: byAction.length,
    },
    topActionTypes,
    failureHotspots,
    latencyHotspots,
    recentEvents: auditTrail.slice(0, 10),
    repairGovernance: {
      ...repairGovernance,
      trend: Array.from(repairBuckets.values()).map((bucket) => ({
        ...bucket,
        localRatePercent: percent(bucket.compliant, bucket.repairs),
        escalatedRatePercent: percent(bucket.escalated, bucket.repairs),
      })),
    },
  };
}

export async function getOperationalHistory(userUuid, { projectUuid = null, days = 7 } = {}) {
  const lookbackDays = Math.min(30, Math.max(1, Number(days || 7)));
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (lookbackDays - 1));
  fromDate.setHours(0, 0, 0, 0);

  const projectFilter = projectUuid ? { project: { uuid: projectUuid } } : {};
  const runs = await prisma.agentRun.findMany({
    where: {
      createdAt: { gte: fromDate },
      project: {
        workspace: {
          ownerUser: {
            uuid: userUuid,
          },
        },
      },
      ...projectFilter,
    },
    select: {
      status: true,
      createdAt: true,
      tokensInput: true,
      tokensOutput: true,
      costUsd: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const buckets = new Map();
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const current = new Date(fromDate);
    current.setDate(fromDate.getDate() + offset);
    const key = current.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      estimatedTokens: 0,
      costUsd: 0,
    });
  }

  for (const run of runs) {
    const key = new Date(run.createdAt).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.totalRuns += 1;
    bucket.completedRuns += run.status === 'completed' ? 1 : 0;
    bucket.failedRuns += run.status === 'failed' ? 1 : 0;
    bucket.estimatedTokens += Number(run.tokensInput || 0) + Number(run.tokensOutput || 0);
    bucket.costUsd = Number((bucket.costUsd + Number(run.costUsd || 0)).toFixed(6));
  }

  return {
    days: lookbackDays,
    series: Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      successRatePercent: bucket.totalRuns ? Math.round((bucket.completedRuns / bucket.totalRuns) * 100) : 0,
    })),
  };
}

export async function getActiveAlerts(userUuid, { projectUuid = null } = {}) {
  const [readiness, governance, aiOverview] = await Promise.all([
    getProductionReadiness(userUuid, projectUuid),
    getGovernanceOverview(userUuid, { projectUuid }),
    getAiOperationsOverview(userUuid, projectUuid),
  ]);

  const alerts = [];

  for (const alert of readiness.alerts || []) {
    alerts.push({
      severity: alert.code === 'readiness_failed' ? 'high' : 'medium',
      source: 'readiness',
      code: alert.code,
      message: alert.message,
      recommendedAction:
        alert.code === 'readiness_failed'
          ? 'Corrigir os checks críticos antes de ampliar a operação.'
          : 'Revisar os checks de readiness e estabilizar a operação antes da próxima release.',
    });
  }

  for (const hotspot of (governance.failureHotspots || []).slice(0, 3)) {
    alerts.push({
      severity: hotspot.failureRatePercent >= 50 ? 'high' : 'medium',
      source: 'governance',
      code: `hotspot_${hotspot.actionType}`,
      message: `${hotspot.actionType} concentra ${hotspot.failures} falhas recentes (${hotspot.failureRatePercent}%).`,
      recommendedAction: `Revisar o fluxo ${hotspot.actionType} e adicionar remediação automática ou validação preventiva.`,
    });
  }

  if ((aiOverview.summary.staleRunningRuns || 0) > 0) {
    alerts.push({
      severity: 'high',
      source: 'runtime',
      code: 'stale_running_runs',
      message: `Existem ${aiOverview.summary.staleRunningRuns} runs travados ha mais de 10 minutos.`,
      recommendedAction: 'Cancelar execuções travadas, revisar timeout e criar playbook automático de recuperação.',
    });
  }

  if ((aiOverview.summary.overBudgetRuns || 0) > 0) {
    alerts.push({
      severity: 'medium',
      source: 'cost',
      code: 'over_budget_runs',
      message: `Foram detectadas ${aiOverview.summary.overBudgetRuns} execuções acima do budget configurado.`,
      recommendedAction: 'Reduzir contexto, revisar provider/modelo e reforcar budgets por agente.',
    });
  }

  if ((aiOverview.summary.budgetPressureLevel || 'low') === 'high') {
    alerts.push({
      severity: 'medium',
      source: 'cost',
      code: 'budget_pressure_high',
      message: `A pressao de budget esta alta: ${aiOverview.summary.recentBudgetPressurePercent || 0}% nas execucoes recentes.`,
      recommendedAction: 'Ajustar budgets por agente, cortar contexto e revisar o provider dominante.',
    });
  }

  return alerts.slice(0, 10);
}

export async function getPipelineCoherenceOverview(userUuid, { projectUuid = null } = {}) {
  const projects = await prisma.project.findMany({
    where: {
      workspace: {
        ownerUser: {
          uuid: userUuid,
        },
      },
      ...(projectUuid ? { uuid: projectUuid } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      uuid: true,
      name: true,
      status: true,
      templateKey: true,
      updatedAt: true,
      intakeConfig: true,
      tasks: {
        where: {
          taskType: { not: 'agent_job' },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          uuid: true,
          title: true,
          status: true,
          updatedAt: true,
          artifacts: {
            where: {
              isCurrent: true,
              title: {
                in: ['[SYSTEM] Requirement Spec', '[SYSTEM] Test Spec'],
              },
            },
            select: {
              title: true,
              createdAt: true,
            },
          },
          implementations: {
            orderBy: { updatedAt: 'desc' },
            select: {
              uuid: true,
              status: true,
              buildStatus: true,
              testStatus: true,
              updatedAt: true,
              artifacts: {
                where: {
                  isCurrent: true,
                  OR: [
                    { title: { startsWith: 'Implementation Manifest -' } },
                    { title: { startsWith: 'Coherence Report -' } },
                  ],
                },
                select: {
                  title: true,
                  content: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const driftFlagFrequencies = {};
  const projectSnapshots = projects.map((project) => {
    const intakeConfig = project.intakeConfig || {};
    const hasProjectDna = Boolean(intakeConfig.projectDna);
    const hasBacklogContract = Boolean(intakeConfig.backlogContract);
    const hasSolutionBlueprint = Boolean(intakeConfig.solutionBlueprint);

    let requirementSpecCount = 0;
    let testSpecCount = 0;
    let implementationCount = 0;
    let implementationManifestCount = 0;
    let coherenceApprovedCount = 0;
    let coherenceWarningCount = 0;
    let coherenceBlockedCount = 0;
    let coherenceUnknownCount = 0;
    let latestCoherenceAt = null;

    for (const task of project.tasks) {
      if (task.artifacts.some((artifact) => artifact.title === '[SYSTEM] Requirement Spec')) {
        requirementSpecCount += 1;
      }
      if (task.artifacts.some((artifact) => artifact.title === '[SYSTEM] Test Spec')) {
        testSpecCount += 1;
      }

      for (const implementation of task.implementations) {
        implementationCount += 1;

        const manifestArtifact = startsWithTitle(implementation.artifacts, 'Implementation Manifest -');
        if (manifestArtifact) {
          implementationManifestCount += 1;
        }

        const coherenceArtifact = startsWithTitle(implementation.artifacts, 'Coherence Report -');
        if (!coherenceArtifact) {
          continue;
        }

        latestCoherenceAt =
          !latestCoherenceAt || new Date(coherenceArtifact.createdAt) > new Date(latestCoherenceAt)
            ? coherenceArtifact.createdAt
            : latestCoherenceAt;

        const parsed = parseJsonContent(coherenceArtifact.content);
        const status = String(parsed?.status || '').toLowerCase();
        countDriftFlags(driftFlagFrequencies, parsed?.driftFlags || []);

        if (status === 'approved') {
          coherenceApprovedCount += 1;
        } else if (status === 'warning') {
          coherenceWarningCount += 1;
        } else if (status === 'blocked') {
          coherenceBlockedCount += 1;
        } else {
          coherenceUnknownCount += 1;
        }
      }
    }

    const storyCount = project.tasks.length;
    const requirementCoveragePercent = percent(requirementSpecCount, storyCount);
    const testCoveragePercent = percent(testSpecCount, storyCount);
    const manifestCoveragePercent = percent(implementationManifestCount, implementationCount);
    const coherenceCoveragePercent = percent(
      coherenceApprovedCount + coherenceWarningCount + coherenceBlockedCount + coherenceUnknownCount,
      implementationCount
    );

    const coherenceScore = averageNullable([
      hasProjectDna ? 100 : 0,
      hasBacklogContract ? 100 : 0,
      hasSolutionBlueprint ? 100 : 0,
      requirementCoveragePercent,
      testCoveragePercent,
      manifestCoveragePercent,
      coherenceCoveragePercent,
    ]);

    const alerts = [
      ...(!hasProjectDna ? ['missing_project_dna'] : []),
      ...(!hasBacklogContract ? ['missing_backlog_contract'] : []),
      ...(!hasSolutionBlueprint ? ['missing_solution_blueprint'] : []),
      ...(requirementCoveragePercent < 100 ? ['requirements_contract_gap'] : []),
      ...(testCoveragePercent < 100 ? ['qa_contract_gap'] : []),
      ...(manifestCoveragePercent < 100 ? ['implementation_manifest_gap'] : []),
      ...(coherenceBlockedCount > 0 ? ['coherence_blocked'] : []),
    ];

    return {
      projectUuid: project.uuid,
      projectName: project.name,
      status: project.status,
      templateKey: project.templateKey,
      updatedAt: project.updatedAt,
      latestCoherenceAt,
      coherenceScore,
      contracts: {
        projectDna: hasProjectDna,
        backlogContract: hasBacklogContract,
        solutionBlueprint: hasSolutionBlueprint,
      },
      stories: {
        total: storyCount,
        requirementSpecCount,
        testSpecCount,
        requirementCoveragePercent,
        testCoveragePercent,
      },
      implementations: {
        total: implementationCount,
        implementationManifestCount,
        manifestCoveragePercent,
        coherenceCoveragePercent,
        approved: coherenceApprovedCount,
        warning: coherenceWarningCount,
        blocked: coherenceBlockedCount,
        unknown: coherenceUnknownCount,
      },
      alerts,
    };
  });

  const summary = {
    projects: projectSnapshots.length,
    stories: projectSnapshots.reduce((sum, item) => sum + item.stories.total, 0),
    implementations: projectSnapshots.reduce((sum, item) => sum + item.implementations.total, 0),
    averageCoherenceScore: averageNullable(projectSnapshots.map((item) => item.coherenceScore)),
    blockedImplementations: projectSnapshots.reduce((sum, item) => sum + item.implementations.blocked, 0),
    warningImplementations: projectSnapshots.reduce((sum, item) => sum + item.implementations.warning, 0),
    approvedImplementations: projectSnapshots.reduce((sum, item) => sum + item.implementations.approved, 0),
  };

  const contractCoverage = {
    projectDnaPercent: percent(projectSnapshots.filter((item) => item.contracts.projectDna).length, projectSnapshots.length),
    backlogContractPercent: percent(
      projectSnapshots.filter((item) => item.contracts.backlogContract).length,
      projectSnapshots.length
    ),
    solutionBlueprintPercent: percent(
      projectSnapshots.filter((item) => item.contracts.solutionBlueprint).length,
      projectSnapshots.length
    ),
    requirementSpecPercent: percent(
      projectSnapshots.reduce((sum, item) => sum + item.stories.requirementSpecCount, 0),
      summary.stories
    ),
    testSpecPercent: percent(
      projectSnapshots.reduce((sum, item) => sum + item.stories.testSpecCount, 0),
      summary.stories
    ),
    implementationManifestPercent: percent(
      projectSnapshots.reduce((sum, item) => sum + item.implementations.implementationManifestCount, 0),
      summary.implementations
    ),
    coherenceReportPercent: percent(
      projectSnapshots.reduce(
        (sum, item) =>
          sum +
          item.implementations.approved +
          item.implementations.warning +
          item.implementations.blocked +
          item.implementations.unknown,
        0
      ),
      summary.implementations
    ),
  };

  const topDriftFlags = Object.entries(driftFlagFrequencies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const alerts = [
    ...(summary.blockedImplementations > 0
      ? [
          {
            code: 'pipeline_coherence_blocked',
            severity: 'high',
            message: `Existem ${summary.blockedImplementations} implementacoes bloqueadas pelo guardiao de coerencia.`,
          },
        ]
      : []),
    ...(summary.averageCoherenceScore !== null && summary.averageCoherenceScore < 80
      ? [
          {
            code: 'pipeline_coherence_score_low',
            severity: 'medium',
            message: `A coerencia media da esteira caiu para ${summary.averageCoherenceScore}.`,
          },
        ]
      : []),
    ...(contractCoverage.requirementSpecPercent < 100
      ? [
          {
            code: 'pipeline_requirement_gap',
            severity: 'medium',
            message: 'Nem todas as stories possuem Requirement Spec estruturado.',
          },
        ]
      : []),
    ...(contractCoverage.testSpecPercent < 100
      ? [
          {
            code: 'pipeline_test_gap',
            severity: 'medium',
            message: 'Nem todas as stories possuem Test Spec estruturado.',
          },
        ]
      : []),
  ];

  return {
    checkedAt: new Date().toISOString(),
    summary,
    contractCoverage,
    topDriftFlags,
    alerts,
    projects: projectSnapshots,
  };
}

function qualityFinding(code, severity, description, evidence = {}) {
  return { code, severity, description, confidence: 1, evidence };
}

function artifactReportFindings(artifacts = []) {
  return artifacts.flatMap((artifact) =>
    (artifact.reviews || []).flatMap((review) => {
      const report = review.qualityReport && typeof review.qualityReport === 'object' ? review.qualityReport : {};
      return (Array.isArray(report.findings) ? report.findings : []).map((finding) => ({
        code: finding.code || 'quality_finding',
        severity: finding.severity || 'medium',
        description: finding.message || 'Finding registrado pelo Quality Gate.',
        confidence: 1,
        evidence: { artifactUuid: artifact.uuid, artifactType: artifact.artifactType },
      }));
    })
  );
}

export async function getPipelineQualityOverview(userUuid, { projectUuid = null } = {}) {
  const projects = await prisma.project.findMany({
    where: {
      workspace: { ownerUser: { uuid: userUuid } },
      ...(projectUuid ? { uuid: projectUuid } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      uuid: true,
      name: true,
      intakeConfig: true,
      tasks: {
        where: { taskType: { not: 'agent_job' } },
        select: {
          uuid: true,
          title: true,
          artifacts: {
            where: { isCurrent: true },
            select: {
              uuid: true, title: true, content: true, artifactType: true, version: true,
              createdByUserId: true,
              reviews: { select: { decision: true, reviewedBy: true, qualityReport: true } },
            },
          },
        },
      },
      agentRuns: { select: { agentName: true, status: true, startedAt: true, finishedAt: true } },
    },
  });

  const snapshots = projects.map((project) => {
    const contract = project.intakeConfig?.backlogContract || {};
    const stories = Array.isArray(contract.stories) ? contract.stories : [];
    const tasks = project.tasks || [];
    const findings = [];
    let requirementSpecs = 0;
    let testSpecs = 0;
    let completeRequirementSpecs = 0;
    let testableRequirementSpecs = 0;
    let acceptanceCriteria = 0;
    let tracedAcceptanceCriteria = 0;
    let scenarios = 0;
    let functionalCases = 0;
    let humanReviews = 0;
    let automatedRejections = 0;
    let humanRejections = 0;
    let repairs = 0;
    let qualityEvaluations = 0;

    for (const task of tasks) {
      const requirementArtifact = task.artifacts.find((artifact) => artifact.title === '[SYSTEM] Requirement Spec');
      const testArtifact = task.artifacts.find((artifact) => artifact.title === '[SYSTEM] Test Spec');
      const requirement = parseJsonContent(requirementArtifact?.content);
      const test = parseJsonContent(testArtifact?.content);
      if (requirementArtifact) requirementSpecs += 1;
      if (testArtifact) testSpecs += 1;
      const functional = Array.isArray(requirement?.functionalRequirements) ? requirement.functionalRequirements : [];
      const criteria = Array.isArray(requirement?.acceptanceCriteria) ? requirement.acceptanceCriteria : [];
      const flows = requirement?.flows || {};
      if (requirementArtifact && functional.length && criteria.length && Array.isArray(flows.main) && flows.main.length) completeRequirementSpecs += 1;
      if (requirementArtifact && criteria.length) testableRequirementSpecs += 1;
      acceptanceCriteria += criteria.length;
      const traces = Array.isArray(test?.acceptanceTraceability) ? test.acceptanceTraceability : [];
      tracedAcceptanceCriteria += Math.min(criteria.length, traces.length);
      scenarios += Array.isArray(test?.scenarios) ? test.scenarios.length : 0;
      functionalCases += Array.isArray(test?.functionalCases) ? test.functionalCases.length : 0;
      if (requirementArtifact && !criteria.length) findings.push(qualityFinding('completeness_gap', 'high', 'Requirement Spec sem critérios de aceite.', { taskUuid: task.uuid }));
      if (requirementArtifact && !functional.length) findings.push(qualityFinding('completeness_gap', 'high', 'Requirement Spec sem requisitos funcionais.', { taskUuid: task.uuid }));
      if (testArtifact && !traces.length) findings.push(qualityFinding('acceptance_coverage_gap', 'high', 'Test Spec sem rastreabilidade de critérios de aceite.', { taskUuid: task.uuid }));
      if (testArtifact && !scenarios.length) findings.push(qualityFinding('scenario_coverage_gap', 'high', 'Test Spec sem cenários de teste.', { taskUuid: task.uuid }));
      for (const artifact of task.artifacts) {
        repairs += Math.max(0, Number(artifact.version || 1) - 1);
        for (const review of artifact.reviews || []) {
          if (review.qualityReport && typeof review.qualityReport === 'object') qualityEvaluations += 1;
          if (review.reviewedBy) humanReviews += 1;
          if (String(review.decision || '').toLowerCase() === 'rejected') {
            if (review.reviewedBy) humanRejections += 1;
            else automatedRejections += 1;
          }
        }
      }
      findings.push(...artifactReportFindings(task.artifacts));
    }

    const storyCount = stories.length || tasks.length;
    const storiesWithSource = stories.filter((story) => Array.isArray(story?.source_ids) && story.source_ids.length).length;
    const completedRuns = project.agentRuns.filter((run) => run.status === 'completed');
    const failedRuns = project.agentRuns.filter((run) => run.status === 'failed');
    const durations = completedRuns
      .filter((run) => run.startedAt && run.finishedAt)
      .map((run) => new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
      .filter((value) => value >= 0);
    const unsupported = findings.filter((finding) => /invented|unsupported/i.test(finding.code)).length;
    const ambiguity = findings.filter((finding) => /ambigu|open_question/i.test(finding.code)).length;
    const contradiction = findings.filter((finding) => /contradict/i.test(finding.code)).length;
    const inconsistency = findings.filter((finding) => /inconsisten/i.test(finding.code)).length;
    const analysed = Math.max(1, requirementSpecs + testSpecs);
    const measuredRate = (value) => (qualityEvaluations ? percent(value, analysed) : null);
    const metrics = {
      ambiguity_rate: measuredRate(ambiguity),
      contradiction_rate: measuredRate(contradiction),
      inconsistency_rate: measuredRate(inconsistency),
      unsupported_content_rate: measuredRate(unsupported),
      completeness: percent(completeRequirementSpecs, requirementSpecs),
      testability: percent(testableRequirementSpecs, requirementSpecs),
      requirement_coverage: percent(requirementSpecs, storyCount),
      acceptance_criteria_coverage: percent(tracedAcceptanceCriteria, acceptanceCriteria),
      scenario_coverage: percent(functionalCases, scenarios),
      traceability_coverage: percent(storiesWithSource + requirementSpecs + testSpecs, storyCount * 3),
    };
    const scoreInputs = [metrics.completeness, metrics.testability, metrics.requirement_coverage, metrics.acceptance_criteria_coverage, metrics.scenario_coverage, metrics.traceability_coverage];
    if (metrics.unsupported_content_rate !== null) scoreInputs.push(100 - metrics.unsupported_content_rate);
    const score = average(scoreInputs);
    const hasBlocker = findings.some((finding) => finding.severity === 'critical');
    const hasRevision = findings.some((finding) => finding.severity === 'high') || score < 85;
    return {
      projectUuid: project.uuid,
      projectName: project.name,
      metrics,
      process_metrics: {
        human_revision_rate: percent(humanReviews, Math.max(1, requirementSpecs + testSpecs)),
        repair_rate: percent(repairs, Math.max(1, requirementSpecs + testSpecs)),
        rejection_rate: percent(automatedRejections + humanRejections, Math.max(1, requirementSpecs + testSpecs)),
        automated_rejection_rate: percent(automatedRejections, Math.max(1, requirementSpecs + testSpecs)),
        human_rejection_rate: percent(humanRejections, Math.max(1, requirementSpecs + testSpecs)),
        generation_time_ms: average(durations),
        agent_runs: project.agentRuns.length,
        failed_agent_runs: failedRuns.length,
      },
      quality_gate: { score, threshold: 85, decision: hasBlocker ? 'BLOCK' : hasRevision ? 'REVISE' : 'PASS' },
      findings: findings.slice(0, 50),
      evidence: { stories: storyCount, requirement_specs: requirementSpecs, test_specs: testSpecs, acceptance_criteria: acceptanceCriteria, scenarios, quality_evaluations: qualityEvaluations },
    };
  });

  const allFindings = snapshots.flatMap((snapshot) => snapshot.findings);
  return {
    evaluation_version: '1.0',
    evaluated_at: new Date().toISOString(),
    summary: {
      projects: snapshots.length,
      quality_score: average(snapshots.map((snapshot) => snapshot.quality_gate.score)),
      pass: snapshots.filter((snapshot) => snapshot.quality_gate.decision === 'PASS').length,
      revise: snapshots.filter((snapshot) => snapshot.quality_gate.decision === 'REVISE').length,
      block: snapshots.filter((snapshot) => snapshot.quality_gate.decision === 'BLOCK').length,
      findings: allFindings.length,
    },
    projects: snapshots,
  };
}

export function buildBudgetPreview(agentName, payload) {
  const budgets = buildBudgetConfig();
  const estimatedInputTokens = estimateTokenCount(payload);
  const budget = budgets[agentName] || null;
  return {
    budget,
    estimatedInputTokens,
    overBudget: budget ? estimatedInputTokens > budget : false,
  };
}
