import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma.js';

function parseArgValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const index = process.argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(prefix));
  if (index === -1) return fallback;
  const arg = process.argv[index];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length) || fallback;
  return process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

async function main() {
  const projectSlug = parseArgValue('project-slug', 'plataforma-de-operacoes-de-visitas-corporativas');
  const project = await prisma.project.findFirst({
    where: {
      OR: [{ slug: projectSlug }, { uuid: projectSlug }],
    },
    select: {
      id: true,
      uuid: true,
      slug: true,
      name: true,
    },
  });

  if (!project) {
    throw new Error(`Projeto nao encontrado para slug/uuid: ${projectSlug}`);
  }

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      uuid: true,
      status: true,
      assigneeType: true,
      assigneeAgentName: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const now = new Date();
  let changedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      if (task.status === 'done') continue;

      // eslint-disable-next-line no-await-in-loop
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'done',
          startedAt: task.startedAt || now,
          completedAt: now,
        },
      });

      // eslint-disable-next-line no-await-in-loop
      await tx.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: task.status,
          toStatus: 'done',
          changedByUserId: null,
          changedByAgentName: 'system',
          note: 'Kanban concluido manualmente.',
        },
      });

      changedCount += 1;
    }

    await tx.task.updateMany({
      where: {
        projectId: project.id,
        status: { not: 'done' },
      },
      data: {
        status: 'done',
        startedAt: now,
        completedAt: now,
      },
    });

    const remaining = await tx.task.count({
      where: {
        projectId: project.id,
        status: { not: 'done' },
      },
    });

    if (remaining > 0) {
      throw new Error(`Ainda existem ${remaining} tasks fora de done.`);
    }
  });

  console.log(
    JSON.stringify(
      {
        projectUuid: project.uuid,
        projectSlug: project.slug,
        projectName: project.name,
        changedCount,
        totalTasks: tasks.length,
        status: 'done',
        note: 'Todas as tasks do kanban foram concluidas.',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
