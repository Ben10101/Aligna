import { prisma } from '../lib/prisma.js';
import { logInfo, logWarn } from '../utils/logger.js';
import { recordRuntimeEvent } from './runtimeTelemetryService.js';

function resolveRunAgeCutoff(maxAgeSeconds) {
  const parsed = Number(maxAgeSeconds);
  const ageSeconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 720;
  return new Date(Date.now() - ageSeconds * 1000);
}

function getRecoveryTargetStatus(task) {
  const artifacts = task?.artifacts || [];
  const hasRequirements = artifacts.some(
    (artifact) => artifact.isCurrent && artifact.artifactScope === 'refinement' && artifact.artifactType === 'requirements'
  );
  const hasValidationCases = artifacts.some(
    (artifact) => artifact.isCurrent && artifact.artifactScope === 'refinement' && ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType)
  );

  if (hasValidationCases) {
    return {
      status: 'done',
      assigneeType: 'agent',
      assigneeAgentName: 'qa_engineer',
      startedAt: task?.startedAt || null,
      completedAt: task?.completedAt || null,
      currentArtifactSummary: task?.currentArtifactSummary || null,
    };
  }

  if (hasRequirements) {
    return {
      status: 'in_review',
      assigneeType: 'agent',
      assigneeAgentName: 'requirements_analyst',
      startedAt: task?.startedAt || null,
      completedAt: null,
      currentArtifactSummary: task?.currentArtifactSummary || null,
    };
  }

  return {
    status: 'backlog',
    assigneeType: task?.taskType === 'story' ? 'agent' : 'unassigned',
    assigneeAgentName: task?.taskType === 'story' ? 'requirements_analyst' : null,
    startedAt: null,
    completedAt: null,
    currentArtifactSummary: null,
  };
}

async function reconcileTaskAfterRecoveredRun(tx, taskId, note) {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: {
      artifacts: {
        where: { isCurrent: true, artifactScope: 'refinement' },
        select: { artifactType: true, artifactScope: true, isCurrent: true },
      },
    },
  });

  if (!task) return;

  const target = getRecoveryTargetStatus(task);
  const needsTaskUpdate =
    task.status !== target.status ||
    task.assigneeType !== target.assigneeType ||
    (task.assigneeAgentName || null) !== (target.assigneeAgentName || null) ||
    String(task.startedAt || '') !== String(target.startedAt || '') ||
    String(task.completedAt || '') !== String(target.completedAt || '') ||
    (task.currentArtifactSummary || null) !== (target.currentArtifactSummary || null);

  if (!needsTaskUpdate) return;

  await tx.task.update({
    where: { id: task.id },
    data: {
      status: target.status,
      assigneeType: target.assigneeType,
      assigneeAgentName: target.assigneeAgentName,
      startedAt: target.startedAt,
      completedAt: target.completedAt,
      currentArtifactSummary: target.currentArtifactSummary,
    },
  });

  await tx.taskStatusHistory.create({
    data: {
      taskId: task.id,
      fromStatus: task.status,
      toStatus: target.status,
      changedByUserId: null,
      note,
    },
  });
}

export async function recoverStaleAgentRuns({
  maxAgeSeconds = 720,
  reason = 'Execucao interrompida por reinicio ou encerramento inesperado do backend.',
} = {}) {
  const cutoff = resolveRunAgeCutoff(maxAgeSeconds);
  const staleRuns = await prisma.agentRun.findMany({
    where: {
      status: 'running',
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      uuid: true,
      agentName: true,
      taskId: true,
      projectId: true,
      startedAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });

  for (const run of staleRuns) {
    await prisma.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'stale',
          finishedAt: new Date(),
          errorMessage: reason,
        },
      });

      if (run.taskId) {
        await reconcileTaskAfterRecoveredRun(
          tx,
          run.taskId,
          `Execucao antiga recuperada automaticamente. ${reason}`
        );
      }
    });

    recordRuntimeEvent('agent_run_recovered', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId: run.projectId,
      taskId: run.taskId,
      recoveryMode: 'watchdog',
      recoveryReason: reason,
    });
    logInfo('agent_run_recovered', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId: run.projectId,
      taskId: run.taskId,
      recoveryMode: 'watchdog',
      reason,
    });
    recordRuntimeEvent('agent_run_stale', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId: run.projectId,
      taskId: run.taskId,
      recoveryMode: 'watchdog',
    });
    logWarn('agent_run_stale', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId: run.projectId,
      taskId: run.taskId,
      recoveryMode: 'watchdog',
      reason,
    });
  }

  if (staleRuns.length > 0) {
    logInfo('agent_run_recovery_batch_completed', {
      recoveryMode: 'watchdog',
      recoveredCount: staleRuns.length,
    });
  }

  return {
    recoveredCount: staleRuns.length,
    runs: staleRuns.map((run) => ({
      uuid: run.uuid,
      agentName: run.agentName,
      startedAt: run.startedAt,
    })),
  };
}

export async function recoverBlockingAgentRunsForStart({
  projectId,
  agentName,
  taskId = null,
  maxAgeSeconds = 720,
  reason = 'Execucao travada recuperada automaticamente antes de iniciar uma nova tentativa.',
} = {}) {
  if (!projectId || !agentName) {
    return {
      recoveredCount: 0,
      runs: [],
    };
  }

  const cutoff = resolveRunAgeCutoff(maxAgeSeconds);
  const staleRuns = await prisma.agentRun.findMany({
    where: {
      projectId,
      agentName,
      taskId,
      status: 'running',
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      uuid: true,
      agentName: true,
      taskId: true,
      startedAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });

  for (const run of staleRuns) {
    await prisma.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'stale',
          finishedAt: new Date(),
          errorMessage: reason,
        },
      });

      if (run.taskId) {
        await reconcileTaskAfterRecoveredRun(
          tx,
          run.taskId,
          `Execucao travada liberada automaticamente para nova tentativa. ${reason}`
        );
      }
    });

    recordRuntimeEvent('agent_run_recovered', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId,
      taskId: run.taskId,
      recoveryMode: 'preflight',
      recoveryReason: reason,
    });
    logInfo('agent_run_recovered', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId,
      taskId: run.taskId,
      recoveryMode: 'preflight',
      reason,
    });
    recordRuntimeEvent('agent_run_stale', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId,
      taskId: run.taskId,
      recoveryMode: 'preflight',
    });
    logWarn('agent_run_stale', {
      agentName: run.agentName,
      runUuid: run.uuid,
      projectId,
      taskId: run.taskId,
      recoveryMode: 'preflight',
      reason,
    });
  }

  if (staleRuns.length > 0) {
    logInfo('agent_run_recovery_batch_completed', {
      recoveryMode: 'preflight',
      agentName,
      projectId,
      taskId,
      recoveredCount: staleRuns.length,
    });
  }

  return {
    recoveredCount: staleRuns.length,
    runs: staleRuns.map((run) => ({
      uuid: run.uuid,
      agentName: run.agentName,
      startedAt: run.startedAt,
    })),
  };
}
