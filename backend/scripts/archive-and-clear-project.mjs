import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

function json(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function loadProject(projectId) {
  return prisma.project.findUnique({
    where: { id: BigInt(projectId) },
    include: {
      tasks: {
        include: {
          comments: true,
          artifacts: { include: { reviews: true } },
          statusHistory: true,
          attachments: true,
          checklistItems: true,
          dependencies: true,
          dependedOnBy: true,
          agentRuns: true,
          implementations: true,
        },
      },
      agentRuns: true,
      generatedApps: {
        include: {
          modules: true,
          implementations: true,
          runs: true,
          files: true,
        },
      },
    },
  });
}

async function main() {
  const projectId = argValue('project-id');
  const snapshotDir = argValue('snapshot-dir') || path.join(__dirname, '..', '..', 'archives', 'projects');
  const dryRun = process.argv.includes('--dry-run');
  const clearBacklog = process.argv.includes('--clear-backlog');
  if (!/^\d+$/.test(projectId)) throw new Error('Use --project-id=<id numérico>.');

  const project = await loadProject(projectId);
  if (!project) throw new Error(`Projeto ${projectId} não encontrado.`);

  const summary = {
    projectId: project.id.toString(),
    projectUuid: project.uuid,
    projectName: project.name,
    tasks: project.tasks.length,
    taskArtifacts: project.tasks.reduce((total, task) => total + task.artifacts.length, 0),
    agentRuns: project.agentRuns.length,
    generatedApps: project.generatedApps.length,
    generatedFiles: project.generatedApps.reduce((total, app) => total + app.files.length, 0),
    backlogStories: Array.isArray(project.intakeConfig?.backlogContract?.stories)
      ? project.intakeConfig.backlogContract.stories.length
      : 0,
  };

  if (dryRun) {
    console.log(json({ dryRun: true, ...summary }));
    return;
  }

  await mkdir(snapshotDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(snapshotDir, `project-${projectId}-${timestamp}.json`);
  await writeFile(snapshotPath, json({
    schemaVersion: 1,
    archivedAt: new Date().toISOString(),
    purpose: 'Snapshot before clearing active project operational data.',
    project,
  }), 'utf8');

  // Only operational records are removed. The Project row and its settings,
  // membership, workspace binding, identity, and metadata remain intact.
  await prisma.$transaction(async (tx) => {
    await tx.agentRun.deleteMany({ where: { projectId: project.id } });
    await tx.task.deleteMany({ where: { projectId: project.id } });
    await tx.generatedApp.deleteMany({ where: { projectId: project.id } });
    if (clearBacklog) {
      const intakeConfig = { ...(project.intakeConfig || {}) };
      for (const key of ['backlogContract', 'backlogClarifications', 'pmElicitation', 'requirementsContract', 'lastGeneratedAt']) {
        delete intakeConfig[key];
      }
      await tx.project.update({ where: { id: project.id }, data: { intakeConfig } });
    }
  });

  const remaining = await prisma.project.findUnique({
    where: { id: project.id },
    include: {
      _count: { select: { tasks: true, agentRuns: true, generatedApps: true } },
    },
  });
  if (!remaining || remaining._count.tasks || remaining._count.agentRuns || remaining._count.generatedApps) {
    throw new Error('A limpeza não foi confirmada; o snapshot foi preservado e a operação deve ser revisada.');
  }

  console.log(json({
    cleared: true,
    clearedBacklog: clearBacklog,
    snapshotPath,
    ...summary,
    remaining: remaining._count,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
