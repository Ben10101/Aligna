import { readFile, readdir } from 'fs/promises';
import path from 'path';

const root = process.cwd();

async function readSafe(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function listFeaturePages() {
  const featuresRoot = path.join(root, 'apps', 'web', 'src', 'features');
  try {
    const entries = await readdir(featuresRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(featuresRoot, entry.name, 'page.tsx'));
  } catch {
    return [];
  }
}

const failures = [];
const appContent = await readSafe('apps/web/src/App.tsx');

if (!appContent.includes('AppFrame') || !appContent.includes('AppHeader') || !appContent.includes('SidebarNav')) {
  failures.push('O shell principal nao usa o trio AppFrame/AppHeader/SidebarNav.');
}

for (const pagePath of await listFeaturePages()) {
  const pageContent = await readSafe(path.relative(root, pagePath));
  const importsSharedUi =
    pageContent.includes('packages/ui/src/index.tsx') ||
    pageContent.includes('/packages/ui/src/index.tsx');
  if (!importsSharedUi) {
    failures.push(`${path.relative(root, pagePath)} nao usa o design system compartilhado.`);
  }
}

if (failures.length) {
  console.error('E2E smoke do projeto gerado falhou.\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('E2E smoke do projeto gerado concluido com sucesso.');
