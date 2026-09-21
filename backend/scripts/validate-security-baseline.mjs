import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const checks = [
  {
    label: 'Template API base',
    filePath: path.join(REPO_ROOT, 'backend', 'src', 'templates', 'fullstack', 'react-express-prisma', 'apps', 'api', 'src', 'server.ts.tpl'),
    mustInclude: ['origin(origin, callback)', "express.json({ limit: '1mb' })", 'allowedOrigins'],
    mustNotInclude: ['app.use(cors())'],
  },
  {
    label: 'Generated implementation server',
    filePath: path.join(REPO_ROOT, 'backend', 'src', 'services', 'implementationService.js'),
    mustInclude: ['origin(origin, callback)', "express.json({ limit: '1mb' })", 'allowedOrigins'],
    mustNotInclude: ["JWT_SECRET || 'your-secret-key-change", 'app.use(cors())\\napp.use(express.json())'],
  },
  {
    label: 'Legacy backend generator',
    filePath: path.join(REPO_ROOT, 'orchestrator', 'backendGenerator.py'),
    mustInclude: ["JWT_SECRET = process.env.JWT_SECRET", "throw new Error('JWT_SECRET must be configured before starting the backend')", "express.json({{ limit: '1mb' }})", 'allowedOrigins'],
    mustNotInclude: ["your-secret-key-change-in-prod", 'app.use(cors())', 'app.use(express.json())'],
  },
  {
    label: 'Project builder',
    filePath: path.join(REPO_ROOT, 'orchestrator', 'projectBuilder.py'),
    mustInclude: ["express.json({ limit: '1mb' })", 'allowedOrigins', 'credentials: true'],
    mustNotInclude: ['app.use(cors())\napp.use(express.json())'],
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const failures = [];

  for (const check of checks) {
    const content = await readFile(check.filePath, 'utf8');

    for (const expected of check.mustInclude) {
      if (!content.includes(expected)) {
        failures.push(`${check.label}: trecho obrigatório ausente -> ${expected}`);
      }
    }

    for (const forbidden of check.mustNotInclude) {
      if (content.includes(forbidden)) {
        failures.push(`${check.label}: padrão inseguro encontrado -> ${forbidden}`);
      }
    }
  }

  assert(!failures.length, `Baseline de segurança falhou.\n- ${failures.join('\n- ')}`);
  console.log('Security baseline validation passed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
