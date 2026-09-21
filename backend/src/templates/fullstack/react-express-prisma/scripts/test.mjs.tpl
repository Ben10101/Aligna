import { access, readFile, readdir } from 'fs/promises';
import path from 'path';

const root = process.cwd();

async function assertFile(relativePath) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    throw new Error(`Arquivo obrigatorio ausente: ${relativePath}`);
  }
}

async function readSafe(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function listFeatureDirs() {
  const featuresRoot = path.join(root, 'apps', 'web', 'src', 'features');
  try {
    const entries = await readdir(featuresRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function listDirectories(relativePath) {
  try {
    const entries = await readdir(path.join(root, relativePath), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

const requiredFiles = [
  'apps/api/src/server.ts',
  'apps/web/src/App.tsx',
  'prisma/schema.prisma',
];

for (const file of requiredFiles) {
  await assertFile(file);
}

const serverContent = await readSafe('apps/api/src/server.ts');
const appContent = await readSafe('apps/web/src/App.tsx');
const schemaContent = await readSafe('prisma/schema.prisma');
const featureDirs = await listFeatureDirs();
const apiModuleDirs = await listDirectories('apps/api/src/modules');
const contractFiles = await readdir(path.join(root, 'packages', 'shared', 'src', 'contracts')).catch(() => []);

if (!serverContent.includes("app.get('/health'")) {
  throw new Error('API sem rota /health registrada.');
}

for (const featureDir of featureDirs) {
  const pagePath = `apps/web/src/features/${featureDir}/page.tsx`;
  const servicePath = `apps/web/src/features/${featureDir}/service.ts`;
  const apiRouterPath = `apps/api/src/modules/${featureDir}/router.ts`;
  const apiServicePath = `apps/api/src/modules/${featureDir}/service.ts`;
  const contractPath = `packages/shared/src/contracts/${featureDir}.ts`;
  await assertFile(pagePath);
  await assertFile(servicePath);
  await assertFile(apiRouterPath);
  await assertFile(apiServicePath);
  await assertFile(contractPath);

  const pageContent = await readSafe(pagePath);
  const routerContent = await readSafe(apiRouterPath);
  const backendServiceContent = await readSafe(apiServicePath);
  const contractContent = await readSafe(contractPath);
  const importsSharedUi =
    pageContent.includes('packages/ui/src/index.tsx') ||
    pageContent.includes('/packages/ui/src/index.tsx');
  if (!importsSharedUi) {
    throw new Error(`Feature ${featureDir} nao esta usando o design system compartilhado.`);
  }
  if (!routerContent.includes(".get('/',") || !routerContent.includes(".post('/',")) {
    throw new Error(`Modulo ${featureDir} sem rotas GET/POST basicas.`);
  }
  if (!backendServiceContent.includes('buildSeedRecordsFromTask')) {
    throw new Error(`Modulo ${featureDir} sem seeds basicos para validacao incremental.`);
  }
  if (!/Request\s*\{/.test(contractContent) || !/Response\s*\{/.test(contractContent) || !/ListResponse\s*\{/.test(contractContent)) {
    throw new Error(`Contrato ${featureDir} sem Request/Response/ListResponse completos.`);
  }
  const expectedModelName = contractContent.match(/export interface ([A-Za-z0-9]+)Request/)?.[1]?.replace(/Request$/, '');
  if (expectedModelName && !schemaContent.includes(`model ${expectedModelName} {`)) {
    throw new Error(`Schema Prisma sem model esperado para ${featureDir}: ${expectedModelName}.`);
  }
}

const frontendRoutes = [...appContent.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
const apiRoutes = [...serverContent.matchAll(/app\.use\('([^']+)'/g)].map((match) => match[1]);

if (featureDirs.length && frontendRoutes.length < featureDirs.length) {
  throw new Error('O frontend nao registrou todas as rotas das features geradas.');
}

if (featureDirs.length && apiRoutes.length < featureDirs.length) {
  throw new Error('A API nao registrou todas as rotas das features geradas.');
}

if (featureDirs.length !== apiModuleDirs.length) {
  throw new Error('Quantidade de features web difere da quantidade de modulos da API.');
}

if (featureDirs.length !== contractFiles.filter((file) => String(file).endsWith('.ts')).length) {
  throw new Error('Quantidade de contratos compartilhados difere das features geradas.');
}

if (!schemaContent.includes('model ')) {
  throw new Error('Schema Prisma sem nenhum model.');
}

if (!/createdAt\s+DateTime/.test(schemaContent) || !/updatedAt\s+DateTime/.test(schemaContent)) {
  throw new Error('Schema Prisma sem trilha minima de datas nas models geradas.');
}

console.log('Smoke tests do projeto gerado concluidos com sucesso.');
