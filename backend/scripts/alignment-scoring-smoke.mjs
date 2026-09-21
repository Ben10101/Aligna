import assert from 'node:assert/strict';
import { buildAlignmentScore, calculateOverallScore, DIMENSION_KEYS } from '../src/services/alignmentScoringService.js';

function scores(value, ambiguity = 100 - value) {
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [key, key === 'ambiguity' ? ambiguity : value]));
}

assert.equal(calculateOverallScore(scores(0)), 0);
assert.equal(calculateOverallScore(scores(1)), 1);
assert.equal(calculateOverallScore(scores(50)), 50);
assert.equal(calculateOverallScore(scores(99)), 99);
assert.equal(calculateOverallScore(scores(100)), 100);

assert.equal(calculateOverallScore(scores(100, 100)), 86);
assert.equal(calculateOverallScore(scores(0, 0)), 14);
assert.equal(calculateOverallScore({ clarity: 100, completeness: 0, testability: 100, ambiguity: 100, consistency: 0, specificity: 100, scope_definition: 0 }), 43);

const score = buildAlignmentScore({
  input: 'Como gerente, preciso aprovar pedidos acima de R$ 500 para reduzir fraude. O sistema deve exigir dupla validação.',
  extracted: { actor: 'gerente', action: 'aprovar pedidos acima de R$ 500', outcome: 'reduzir fraude' },
  businessRules: ['O sistema deve exigir dupla validação.'],
  acceptanceCriteria: ['Dado gerente, quando aprovar, então reduzir fraude.'],
  findings: [{ category: 'missing_information', code: 'exception_flow', severity: 'medium', message: 'Fluxo de exceção ausente.', recommendation: 'Defina erro.', evidence: null, source: 'semantic' }],
});
for (const key of DIMENSION_KEYS) {
  assert.equal(score.dimensions[key].dimension, key);
  assert.equal(typeof score.dimensions[key].score, 'number');
  assert.ok(Array.isArray(score.dimensions[key].positive_evidence));
  assert.ok(Array.isArray(score.dimensions[key].negative_evidence));
  assert.ok(Array.isArray(score.dimensions[key].deductions));
}
assert.ok(score.dimensions.testability.deductions.some((item) => item.code === 'exception_flow'));
assert.equal(score.scoring_source, 'deterministic');
console.log('Alignment scoring smoke concluído com sucesso.');
