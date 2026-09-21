import { prisma } from '../src/lib/prisma.js';

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const deletedAgentRuns = await tx.agentRun.deleteMany({});
    const deletedGeneratedApps = await tx.generatedApp.deleteMany({});
    const deletedTasks = await tx.task.deleteMany({});

    const updatedProjects = await tx.project.updateMany({
      data: {
        status: 'draft',
        intakeConfig: null,
        boardConfig: null,
        agentsConfig: null,
        automationConfig: null,
        startMode: null,
        templateKey: null,
      },
    });

    return {
      deletedAgentRuns: deletedAgentRuns.count,
      deletedGeneratedApps: deletedGeneratedApps.count,
      deletedTasks: deletedTasks.count,
      updatedProjects: updatedProjects.count,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
