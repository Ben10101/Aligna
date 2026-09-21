import assert from 'node:assert/strict';
import { analyzeAlignmentInput } from '../src/services/alignmentService.js';
import { buildClarificationState } from '../src/services/alignmentClarificationService.js';

const incomplete = await analyzeAlignmentInput('Quero aprovar solicitações.', { semanticEnabled: false, requirementEngineLlmEnabled: false });
const needsClarification = buildClarificationState(incomplete);
assert.equal(needsClarification.status, 'required');
assert.ok(needsClarification.questions.length > 0);
assert.ok(needsClarification.questions.every((item) => item.question.length <= 500));
assert.ok(needsClarification.critical_issues.some((item) => item.code === 'actor'));

const complete = await analyzeAlignmentInput('Como gerente, preciso aprovar reembolsos para reduzir fraude. O sistema deve exigir dupla validação. Em caso de erro, o sistema deve informar a correção necessária.', { semanticEnabled: false, requirementEngineLlmEnabled: false });
const finalized = buildClarificationState(complete);
assert.equal(finalized.status, 'completed');
assert.equal(finalized.finalization.no_critical_problems, true);
assert.equal(finalized.finalization.main_criteria_testable, true);
assert.equal(finalized.finalization.essential_rules_defined, true);
console.log('Alignment clarification smoke concluído com sucesso.');
