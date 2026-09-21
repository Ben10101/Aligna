import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveUiArchetype } from '../../backend/src/services/uiArchetypeService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'agent-evals', 'fixtures', 'ui-archetype-generalization.json');

const fixtures = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));

const results = fixtures.map((fixture) => {
  const technicalSpec = fixture.technicalSpec || {};
  const task = fixture.task || {};
  const screenTemplate =
    technicalSpec.architecture?.screenTemplate ||
    technicalSpec.structured?.classification?.screenTemplate ||
    'crud';
  const productMode =
    technicalSpec.frontend?.productMode ||
    technicalSpec.structured?.classification?.productMode ||
    'structured-workspace';
  const uiIntent =
    technicalSpec.structured?.classification?.intent ||
    technicalSpec.uiIntent ||
    'custom';
  const resolved = resolveUiArchetype({ technicalSpec, task, screenTemplate, productMode, uiIntent });

  return {
    name: fixture.name,
    expectedArchetype: fixture.expectedArchetype,
    actualArchetype: resolved.pageArchetype,
    expectedPattern: fixture.expectedPattern,
    actualPattern: resolved.fallbackPattern,
    confidenceScore: resolved.confidenceScore,
    alternatives: resolved.alternativeArchetypes,
    passed:
      resolved.pageArchetype === fixture.expectedArchetype &&
      resolved.fallbackPattern === fixture.expectedPattern,
  };
});

const failed = results.filter((item) => !item.passed);

console.log(JSON.stringify({ passed: failed.length === 0, results }, null, 2));

if (failed.length) {
  process.exit(1);
}
