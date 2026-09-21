import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'src', 'pages');

const contracts = [
  {
    label: 'HomePage',
    file: 'HomePage.jsx',
    includes: ['Aligna', 'Requirement Intelligence', 'Da ideia ao requisito validado', 'Critérios de aceite', 'Histórico do requisito'],
  },
  {
    label: 'CodeStudioPage',
    file: 'CodeStudioPage.jsx',
    includes: ['Implementação', 'Workspace de entrega', 'Acompanhamento no produto', 'Painel operacional da esteira'],
  },
  {
    label: 'ProjectsPage',
    file: 'ProjectsPage.jsx',
    includes: ['Projetos criados', 'Projetos disponíveis', 'Abrir projeto'],
  },
];

async function main() {
  for (const contract of contracts) {
    const target = path.join(root, contract.file);
    const content = await readFile(target, 'utf8');
    for (const token of contract.includes) {
      if (!content.includes(token)) {
        throw new Error(`Contrato visual falhou em ${contract.label}: token ausente "${token}".`);
      }
    }
  }

  console.log('Visual contract concluido com sucesso.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
