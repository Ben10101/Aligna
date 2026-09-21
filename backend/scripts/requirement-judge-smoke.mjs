import assert from 'node:assert/strict';
import { runRequirementJudgeWorkflow } from '../src/services/requirementEngineService.js';

const input = 'Como gerente, preciso aprovar reembolsos para reduzir fraudes. O sistema deve exigir dupla validação.';
const item = (id, statement, evidence) => ({ id, statement, evidence, status: 'confirmed' });
function model() {
  return {
    requirement: input, user_story: input, actor: 'gerente', goal: 'reduzir fraudes', action: 'aprovar reembolsos', object: null, context: input,
    functional_requirements: [item('FR-01', 'aprovar reembolsos', 'aprovar reembolsos')],
    business_rules: [item('BR-01', 'exigir dupla validação', 'exigir dupla validação')],
    main_flow: [], alternative_flows: [], exception_flows: [],
    acceptance_criteria: [{ id: 'AC-01', given: 'gerente', when: 'aprovar reembolsos', then: 'reduzir fraudes', status: 'confirmed', evidence: 'aprovar reembolsos' }],
    ambiguities: [], missing_information: [], assumptions: [], contradictions: [], dependencies: [], risks: [],
    scope: { in_scope: [], out_of_scope: [], not_defined: [] }, clarification_questions: [],
  };
}
const challenge = { version: '1.0', problems: [] };
const run = (requirementModel, options = {}) => runRequirementJudgeWorkflow({ input, requirementModel, challengeReport: challenge, options });

const pass = await run(model());
assert.equal(pass.judgeReport.decision, 'PASS');

const reviseModel = model();
reviseModel.business_rules[0].evidence = 'regra inventada';
const revise = await run(reviseModel);
assert.equal(revise.judgeReport.decision, 'REVISE');

const blockModel = model();
blockModel.contradictions.push({ id: 'C-01', category: 'contradiction', message: 'Há conflito.', recommendation: 'Defina a regra.', evidence: 'aprovar reembolsos' });
const block = await run(blockModel);
assert.equal(block.judgeReport.decision, 'BLOCK');

const invalidJson = await run(model(), { judgeRunner: async () => ({ judge_candidate: 'not-json' }) });
assert.equal(invalidJson.judgeReport.decision, 'PASS');
assert.equal(invalidJson.stage.status, 'degraded');

const timeout = await run(model(), { judgeRunner: async () => { throw new Error('Tempo limite excedido'); } });
assert.equal(timeout.judgeReport.decision, 'PASS');
assert.equal(timeout.stage.status, 'degraded');

const reviseCandidate = { decision: 'REVISE', findings: [], challenger_false_positives: [], feedback_for_analyzer: ['Esclareça a evidência.'] };
const exhaustion = await run(model(), {
  llmEnabled: true,
  maxJudgeRetries: 1,
  judgeRunner: async () => ({ judge_candidate: reviseCandidate }),
  analyzerRunner: async () => ({ findings: [] }),
});
assert.equal(exhaustion.judgeReport.decision, 'REVISE');
assert.equal(exhaustion.stage.reason, 'retry_exhausted');
assert.equal(exhaustion.stage.retries, 1);

console.log('Requirement Judge smoke concluído com sucesso.');
