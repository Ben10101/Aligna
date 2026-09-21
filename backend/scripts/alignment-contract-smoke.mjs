import assert from 'node:assert/strict';
import { analyzeAlignmentInput } from '../src/services/alignmentService.js';
import { validateSemanticFindings } from '../src/services/alignmentValidationService.js';

const input = 'Como gerente de operações, preciso aprovar reembolsos acima de R$ 500 com dupla validação para reduzir fraude. Em caso de erro, o sistema deve informar a correção necessária.';
const result = await analyzeAlignmentInput(input, { semanticEnabled: false });
assert.equal(result.analysis_version, '2.0');
assert.equal(result.analysis.semantic.status, 'skipped');
assert.equal(result.analysis.scoring.source, 'deterministic');
assert.ok(result.user_story.includes('gerente de operações'));
assert.ok(result.acceptance_criteria.length > 0);
assert.ok(result.business_rules.length > 0);
assert.equal(typeof result.clarity_score.overall, 'number');

const validation = validateSemanticFindings([
  { category: 'ambiguity', severity: 'medium', evidence: 'aprovar reembolsos', message: 'Escopo de aprovação pode variar.', recommendation: 'Defina responsáveis.' },
  { category: 'ambiguity', severity: 'medium', evidence: 'trecho inexistente', message: 'Não rastreável.', recommendation: 'Corrija.' },
], input);
assert.equal(validation.accepted.length, 1);
assert.deepEqual(validation.rejected.map((item) => item.reason), ['untraceable_evidence']);
console.log('Alignment contract smoke concluído com sucesso.');
