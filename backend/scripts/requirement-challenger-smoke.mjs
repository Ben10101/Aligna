import assert from 'node:assert/strict';
import { analyzeAlignmentInput } from '../src/services/alignmentService.js';
import {
  challengeRequirementDeterministically,
  validateChallengeReport,
  validateChallengerCandidates,
} from '../src/services/requirementChallengerService.js';

async function modelFor(input) {
  const result = await analyzeAlignmentInput(input, { semanticEnabled: false, requirementEngineLlmEnabled: false });
  return result.requirement_model;
}

const completeInput = 'Como gerente de operações, preciso aprovar reembolsos acima de R$ 500 para reduzir fraude. O sistema deve exigir dupla validação. Em caso de erro, o sistema deve informar a correção necessária.';
const completeReport = challengeRequirementDeterministically({ requirement: completeInput, requirementModel: await modelFor(completeInput) });
assert.ok(Array.isArray(completeReport.problems));
assert.ok(completeReport.problems.every((problem) => problem.evidence && problem.explanation && problem.impact && problem.severity));

const incompleteInput = 'Quero aprovar solicitações.';
const incompleteReport = challengeRequirementDeterministically({ requirement: incompleteInput, requirementModel: await modelFor(incompleteInput) });
assert.ok(incompleteReport.problems.some((problem) => problem.type === 'MISSING_INFORMATION'));
assert.ok(incompleteReport.problems.some((problem) => problem.type === 'UNTESTABLE'));

const ambiguousInput = 'Como gestor, quero aprovar solicitações rapidamente para melhorar o processo.';
const ambiguousReport = challengeRequirementDeterministically({ requirement: ambiguousInput, requirementModel: await modelFor(ambiguousInput) });
assert.ok(ambiguousReport.problems.some((problem) => problem.type === 'AMBIGUITY'));

const contradictionInput = 'Como gestor, preciso permitir exportar relatórios para auditoria. O sistema deve permitir exportar relatórios. O sistema não pode permitir exportar relatórios.';
const contradictionReport = challengeRequirementDeterministically({ requirement: contradictionInput, requirementModel: await modelFor(contradictionInput) });
assert.ok(contradictionReport.problems.some((problem) => problem.type === 'CONTRADICTION'));

const candidates = validateChallengerCandidates([
  { type: 'AMBIGUITY', evidence: 'aprovar reembolsos', explanation: 'A aprovação pode ter interpretações distintas.', impact: 'Implementações podem divergir.', severity: 'medium', clarification_question: 'Quem aprova?' },
  { type: 'EDGE_CASE', evidence: 'trecho inexistente', explanation: 'Não rastreável.', impact: 'Teste inadequado.', severity: 'low', clarification_question: null },
], completeInput);
assert.equal(candidates.accepted.length, 1);
assert.equal(candidates.rejected.length, 1);

assert.throws(() => validateChallengeReport({ problems: [{ type: 'INVALID', evidence: 'x', explanation: 'x', impact: 'x', severity: 'low', clarification_question: null, source: 'test', id: 'x' }] }), /enum/i);
console.log('Requirement Challenger smoke concluído com sucesso.');
