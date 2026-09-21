
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const projects = await prisma.project.findMany({
    where: { name: { contains: 'Compra de Ingressos' } }
  });
  
  if (projects.length === 0) return;
  const project = projects[0];
  
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    include: { artifacts: true }
  });
  
  let report = '# Relatório de Análise de Software\n';
  report += '## Projeto: ' + project.name + '\n\n';
  
  let reqs = 0;
  let qas = 0;
  let qaCases = 0;
  
  for (const t of tasks) {
    if (t.taskType === 'epic') continue;
    
    const req = t.artifacts.find(a => a.artifactType === 'requirement_spec' && a.isCurrent);
    const qa = t.artifacts.find(a => a.artifactType === 'qa_validation_cases' && a.isCurrent);
    
    if (req || qa) {
      report += '### Funcionalidade: ' + t.title + '\n';
    }
    
    if (req) {
      reqs++;
      const txt = req.content;
      const bddCount = (txt.match(/DADO/g) || []).length;
      report += '- **Critérios BDD Identificados**: ' + bddCount + '\n';
    }
    
    if (qa) {
      qas++;
      const txt = qa.content;
      const casesCount = (txt.match(/### CT-/g) || []).length;
      qaCases += casesCount;
      report += '- **Casos de Validação de QA Gerados**: ' + casesCount + '\n';
    }
    
    if (req || qa) report += '\n';
  }
  
  report += '## Síntese de Cobertura\n';
  report += '- **Histórias Documentadas**: ' + reqs + '\n';
  report += '- **Histórias com Testes (QA)**: ' + qas + '\n';
  report += '- **Total de Casos de QA Gerados**: ' + qaCases + ' cenários\n';
  
  require('fs').writeFileSync('report.md', report);
  console.log('Report saved');
}
main().catch(console.error);

