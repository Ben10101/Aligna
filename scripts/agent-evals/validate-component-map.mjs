import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildFrontendScreenSpec } from '../../backend/src/services/generationSpecService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'agent-evals', 'fixtures', 'component-map-generalization.json');

const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));

const results = fixture.map((entry) => {
  const screenSpec = buildFrontendScreenSpec({
    technicalSpec: entry.technicalSpec,
    task: { title: entry.id },
  });

  const mismatches = [];

  if (screenSpec.pageArchetype !== entry.expected.pageArchetype) {
    mismatches.push(`pageArchetype esperado=${entry.expected.pageArchetype} atual=${screenSpec.pageArchetype}`);
  }

  for (const [key, expectedValue] of Object.entries(entry.expected.componentMap || {})) {
    const actualValue = screenSpec.componentMap?.[key] ?? null;
    if (actualValue !== expectedValue) {
      mismatches.push(`componentMap.${key} esperado=${expectedValue} atual=${actualValue}`);
    }
  }

  return {
    id: entry.id,
    pageArchetype: screenSpec.pageArchetype,
    componentMap: screenSpec.componentMap,
    ok: mismatches.length === 0,
    mismatches,
  };
});

const failed = results.filter((result) => !result.ok);

console.log(
  JSON.stringify(
    {
      valid: failed.length === 0,
      results,
    },
    null,
    2
  )
);

if (failed.length) {
  process.exit(1);
}
