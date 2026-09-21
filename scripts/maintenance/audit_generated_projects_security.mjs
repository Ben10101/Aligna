import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const repoRoot = process.cwd();
const generatedRoot = path.join(repoRoot, 'generated-projects');
const reportPath = path.join(repoRoot, 'docs', 'GENERATED_PROJECTS_SECURITY_STATUS.md');

async function listDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readSafe(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function evaluateServerBaseline(content) {
  if (!content) {
    return {
      status: 'missing',
      findings: ['apps/api/src/server.ts ausente'],
    };
  }

  const findings = [];
  if (content.includes('app.use(cors())')) {
    findings.push('usa `cors()` aberto');
  }
  if (content.includes('app.use(express.json())')) {
    findings.push('usa `express.json()` sem limite explicito');
  }
  if (!content.includes('allowedOrigins')) {
    findings.push('nao declara allowlist de origens');
  }
  if (!content.includes("express.json({ limit: '1mb' })")) {
    findings.push('nao aplica limite de body parser de 1mb');
  }

  return {
    status: findings.length ? 'legacy' : 'aligned',
    findings,
  };
}

async function main() {
  const projects = await listDirectories(generatedRoot);
  const results = [];

  for (const projectName of projects) {
    const serverPath = path.join(generatedRoot, projectName, 'apps', 'api', 'src', 'server.ts');
    const content = await readSafe(serverPath);
    const evaluation = evaluateServerBaseline(content);
    results.push({
      projectName,
      ...evaluation,
    });
  }

  const report = [
    '# Generated Projects Security Status',
    '',
    '## Summary',
    '',
    `Projetos avaliados: **${results.length}**`,
    `Alinhados com baseline atual: **${results.filter((item) => item.status === 'aligned').length}**`,
    `Legados/inseguros: **${results.filter((item) => item.status === 'legacy').length}**`,
    `Ausentes/incompletos: **${results.filter((item) => item.status === 'missing').length}**`,
    '',
    '## Details',
    '',
    ...results.flatMap((item) => [
      `### ${item.projectName}`,
      '',
      `Status: **${item.status}**`,
      ...(item.findings.length ? item.findings.map((finding) => `- ${finding}`) : ['- sem achados para esta regra de baseline']),
      '',
    ]),
  ].join('\n');

  await writeFile(reportPath, report, 'utf8');
  console.log(`Generated projects security report written to ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
