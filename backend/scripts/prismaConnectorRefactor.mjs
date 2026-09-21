/**
 * Fase 2 – Patch simples: Memory Stubs → Prisma Connectors
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '..', 'src', 'services', 'implementationService.js');

async function run() {
  let content = await fs.readFile(filePath, 'utf8');
  let changes = 0;

  // 1. Adicionar helper toPrismaModelId antes de renderAutonomousTemplate
  const helperTarget = '  const renderAutonomousTemplate = (template) =>';
  if (!content.includes('toPrismaModelId')) {
    const helper = `  const toPrismaModelId = (spec) => {
    const name = String(spec.backend?.serviceName || spec.shared?.requestContractName || 'entity');
    const clean = name.replace(/Service$|Router$|Request$|Response$/, '');
    return clean.charAt(0).toLowerCase() + clean.slice(1);
  };
  const renderAutonomousTemplate = (template) =>`;
    content = content.replace(helperTarget, helper);
    changes++;
    console.log('✅ toPrismaModelId inserido');
  } else {
    console.log('⏭  toPrismaModelId já existe');
  }

  // 2. Adicionar __PRISMA_MODEL_ID__ ao renderAutonomousTemplate
  const renderAnchor = `.replaceAll('__BACKEND_SERVICE_INSTANCE_NAME__', escapeTemplate(technicalSpec.backend.serviceInstanceName));`;
  const renderAnchorNew = `.replaceAll('__BACKEND_SERVICE_INSTANCE_NAME__', escapeTemplate(technicalSpec.backend.serviceInstanceName))
      .replaceAll('__PRISMA_MODEL_ID__', escapeTemplate(toPrismaModelId(technicalSpec)));`;
  if (content.includes(renderAnchor)) {
    content = content.replace(renderAnchor, renderAnchorNew);
    changes++;
    console.log('✅ __PRISMA_MODEL_ID__ adicionado ao renderAutonomousTemplate');
  } else {
    console.log('⚠️  Ancora renderAutonomousTemplate não encontrada (pode já existir)');
  }

  // 3. Router GET: sync → async no fallback inline do router.ts
  const syncGet = `.get('/', (_req, res) => {\\n  res.json(\${technicalSpec.backend.serviceInstanceName}.list());\\n});\\n`;
  const asyncGet = `.get('/', async (_req, res) => {\\n  try {\\n    const data = await \${technicalSpec.backend.serviceInstanceName}.list();\\n    res.json(data);\\n  } catch (error) {\\n    res.status(500).json({ message: 'Falha ao buscar registros.' });\\n  }\\n});\\n`;
  if (content.includes(syncGet)) {
    content = content.replace(syncGet, asyncGet);
    changes++;
    console.log('✅ Router GET fallback: sync → async');
  } else {
    console.log('⚠️  Padrão GET sync não encontrado');
  }

  // 4. Router POST: (req, res) → async (req, res) no fallback inline
  const syncPostFn = `.post('/', (req, res) => {\\n  try {\\n    const payload`;
  const asyncPostFn = `.post('/', async (req, res) => {\\n  try {\\n    const payload`;
  if (content.includes(syncPostFn)) {
    content = content.replace(syncPostFn, asyncPostFn);
    changes++;
    console.log('✅ Router POST fn: sync → async');
  } else {
    console.log('⚠️  Padrão POST fn não encontrado');
  }

  // 5. Router POST: create(input) → await create(input)
  const syncCreate = `const created = \${technicalSpec.backend.serviceInstanceName}.create(input);\\n    res.status(201).json(created);`;
  const asyncCreate = `const created = await \${technicalSpec.backend.serviceInstanceName}.create(input);\\n    res.status(201).json(created);`;
  if (content.includes(syncCreate)) {
    content = content.replace(syncCreate, asyncCreate);
    changes++;
    console.log('✅ Router POST: create → await create');
  } else {
    console.log('⚠️  Padrão create sync não encontrado');
  }

  await fs.writeFile(filePath, content, 'utf8');
  console.log(`\n✅ Fase 2 concluída — ${changes} alterações aplicadas em implementationService.js`);
}

run().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
