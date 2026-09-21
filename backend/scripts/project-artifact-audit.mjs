import { prisma } from '../src/lib/prisma.js';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function mdEscape(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function buildQaFlags(content) {
  const text = String(content || '');
  const flags = [];
  if (/\b(?:POST|GET|PUT|PATCH|DELETE)\s+\//i.test(text)) flags.push('endpoint explicito');
  if (/\b(?:HTTP\s*)?(200|201|202|204|400|401|403|404|409|422|500)\b/.test(text)) flags.push('codigo HTTP explicito');
  if (/\b255 caracteres\b|\b999999\b|EV-\{ano\}|ID sequencial|timestamp ISO 8601|limite de 50 resultados|<=\s*2\s*s|≤\s*2\s*s/i.test(text)) {
    flags.push('detalhe tecnico inventado');
  }
  return flags;
}

function buildRequirementFlags(content) {
  const text = String(content || '');
  const flags = [];
  if (!/##\s+User Story Refinada/i.test(text)) flags.push('estrutura nao canonica: User Story');
  if (!/##\s+Requisitos Funcionais/i.test(text)) flags.push('estrutura nao canonica: RFs');
  if (!/##\s+Crit[eé]rios de Aceite(?:\s+\(BDD\))?/i.test(text)) flags.push('estrutura nao canonica: CA');
  return flags;
}

function buildArchitectureFlags(solutionBlueprint) {
  const flags = [];
  const contracts = solutionBlueprint?.contractsAndIntegrations || [];
  const risks = solutionBlueprint?.technicalRisksAndTradeoffs || [];
  const sequence = solutionBlueprint?.implementationSequence || [];

  if (contracts.some((item) => /\b(?:POST|GET|PUT|PATCH|DELETE)\s+\//i.test(String(item)))) {
    flags.push('contratos tecnicos fechados cedo');
  }
  if (risks.some((item) => /mitiga[cç][aã]o\s*$/i.test(String(item)))) {
    flags.push('risco truncado');
  }
  if (sequence.some((item) => /rollback.+`[^`]*$/i.test(String(item)))) {
    flags.push('sequencia truncada');
  }
  return flags;
}

function summarizeProject(project) {
  const backlogStories = project.intakeConfig?.backlogContract?.stories || [];
  const architecture = project.intakeConfig?.solutionBlueprint || null;
  const qaRows = [];
  const requirementRows = [];

  for (const task of project.tasks) {
    for (const artifact of task.artifacts) {
      if (artifact.artifactType === 'test_plan') {
        const flags = buildQaFlags(artifact.content);
        if (flags.length) {
          qaRows.push({
            taskId: String(task.id),
            title: task.title,
            flags,
          });
        }
      }
      if (artifact.artifactType === 'requirements') {
        const flags = buildRequirementFlags(artifact.content);
        if (flags.length) {
          requirementRows.push({
            taskId: String(task.id),
            title: task.title,
            flags,
          });
        }
      }
    }
  }

  return {
    backlogStoriesCount: backlogStories.length,
    architectureFlags: buildArchitectureFlags(architecture),
    qaRows,
    requirementRows,
  };
}

function renderMarkdown(project, summary) {
  const lines = [];
  lines.push(`# Auditoria de Artefatos`);
  lines.push('');
  lines.push(`Projeto: **${project.name}**`);
  lines.push(`UUID: \`${project.uuid}\``);
  lines.push(`Data da auditoria: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Resumo`);
  lines.push('');
  lines.push(`- Stories no backlog: ${summary.backlogStoriesCount}`);
  lines.push(`- Tasks no projeto: ${project.tasks.length}`);
  lines.push(`- Tasks com flags de requisitos: ${summary.requirementRows.length}`);
  lines.push(`- Tasks com flags de QA: ${summary.qaRows.length}`);
  lines.push(`- Flags na arquitetura: ${summary.architectureFlags.length ? summary.architectureFlags.join(', ') : 'nenhuma'}`);
  lines.push('');

  lines.push(`## Requisitos com Atenção`);
  lines.push('');
  if (!summary.requirementRows.length) {
    lines.push(`Nenhum desvio estrutural relevante encontrado.`);
  } else {
    lines.push(`| Task | Titulo | Flags |`);
    lines.push(`|---|---|---|`);
    for (const row of summary.requirementRows) {
      lines.push(`| ${row.taskId} | ${mdEscape(row.title)} | ${mdEscape(row.flags.join(', '))} |`);
    }
  }
  lines.push('');

  lines.push(`## QA com Atenção`);
  lines.push('');
  if (!summary.qaRows.length) {
    lines.push(`Nenhum desvio de QA relevante encontrado.`);
  } else {
    lines.push(`| Task | Titulo | Flags |`);
    lines.push(`|---|---|---|`);
    for (const row of summary.qaRows) {
      lines.push(`| ${row.taskId} | ${mdEscape(row.title)} | ${mdEscape(row.flags.join(', '))} |`);
    }
  }
  lines.push('');

  lines.push(`## Arquitetura`);
  lines.push('');
  if (!summary.architectureFlags.length) {
    lines.push(`Arquitetura sem flags principais nesta auditoria.`);
  } else {
    for (const flag of summary.architectureFlags) {
      lines.push(`- ${flag}`);
    }
  }
  lines.push('');

  lines.push(`## Recomendações`);
  lines.push('');
  lines.push(`- Regenerar os test plans antigos com o QA endurecido para reduzir endpoint/codigo HTTP assumidos sem base no requisito.`);
  lines.push(`- Regerar ou revisar manualmente a arquitetura mestre antes de usá-la como contrato técnico de implementação.`);
  lines.push(`- Priorizar artefatos canônicos de requisitos quando houver variação de heading ou drift estrutural.`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const projectName = process.argv.slice(2).join(' ').trim();
if (!projectName) {
  console.error('Uso: node scripts/project-artifact-audit.mjs "Nome do projeto"');
  process.exit(1);
}

const project = await prisma.project.findFirst({
  where: { name: { contains: projectName } },
  select: {
    id: true,
    uuid: true,
    name: true,
    intakeConfig: true,
    tasks: {
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        artifacts: {
          where: { isCurrent: true },
          select: {
            artifactType: true,
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

const summary = summarizeProject(project);
const markdown = renderMarkdown(project, summary);
process.stdout.write(markdown);
await prisma.$disconnect();
