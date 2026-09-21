import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const target = join(process.cwd(), 'src', 'pages', 'CodeStudioPage.jsx');
const content = readFileSync(target, 'utf8');

const requiredTokens = [
  'getOperationalHealth',
  'getAiOperationsOverview',
  'Acompanhamento no produto',
  'Estado visivel da esteira',
  'Status por agente',
  'Tendência recente',
  'Plano restante',
  'Pendências em observação',
  'health?.status',
  'health?.database',
  'health?.runtime?.failureRunsLast24h',
  'operationsOverview?.summary?.failedRunsLast24h',
  'operationsOverview?.byAgent',
  'operationsOverview?.reliability?.topFailingAgents',
  'trendSummary?.recent?.fallbackFullRatePercent',
  'TRACKING_ITEMS',
];

const missing = requiredTokens.filter((token) => !content.includes(token));

if (missing.length) {
  console.error('Smoke test da CodeStudioPage falhou.');
  for (const token of missing) {
    console.error(`- token ausente: ${token}`);
  }
  process.exit(1);
}

console.log('CodeStudioPage smoke ok.');
