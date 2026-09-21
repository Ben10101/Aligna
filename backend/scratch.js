
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const projects = await prisma.project.findMany({
    where: { name: { contains: 'Compra de Ingressos para Shows' } }
  });
  
  if (projects.length === 0) {
    console.log('No project found');
    return;
  }
  
  const project = projects[0];
  console.log('Project:', project.name);
  
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    include: {
      artifacts: true
    }
  });
  
  for (const t of tasks) {
    console.log('\n--- Task:', t.name, '---');
    for (const a of t.artifacts) {
      console.log('Artifact:', a.type);
      console.log(a.content.substring(0, 500));
      console.log('...');
    }
  }
}
main().catch(console.error).finally(() => prisma['$disconnect']());

