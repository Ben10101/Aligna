import assert from 'node:assert/strict';
import { analyzeAlignmentInput } from '../src/services/alignmentService.js';
import { validateRequirementModel } from '../src/services/requirementSchemaService.js';

async function analyze(input) {
  return analyzeAlignmentInput(input, { semanticEnabled: false, requirementEngineLlmEnabled: false });
}

const complete = await analyze('Como gerente de operações, preciso aprovar reembolsos acima de R$ 500 para reduzir fraude. O sistema deve exigir dupla validação. Em caso de erro, o sistema deve informar a correção necessária.');
assert.ok(complete.requirement_model.actor);
assert.ok(complete.requirement_model.goal);
assert.ok(complete.requirement_model.business_rules.length >= 2);
assert.equal(complete.requirement_engine.status, 'completed');

const incomplete = await analyze('Quero aprovar solicitações.');
assert.ok(incomplete.requirement_model.missing_information.length > 0);

const ambiguous = await analyze('Como gestor, quero aprovar solicitações rapidamente para melhorar o processo.');
assert.ok(ambiguous.requirement_model.ambiguities.length > 0);

const contradictory = await analyze('Como gestor, preciso permitir exportar relatórios para auditoria. O sistema deve permitir exportar relatórios. O sistema não pode permitir exportar relatórios.');
assert.ok(contradictory.requirement_model.contradictions.length > 0);

const shortRequirement = await analyze('Aprovar.');
assert.ok(shortRequirement.requirement_model.missing_information.length > 0);

const longRequirement = await analyze(`Como gestor, preciso registrar dados para auditoria. ${'Detalhe explícito. '.repeat(1800)}`);
assert.equal(longRequirement.requirement_model.requirement.length, 20000);
assert.ok(longRequirement.requirement_model.missing_information.some((item) => item.id.includes('input_truncated')));

const noActor = await analyze('Permitir aprovar solicitações para reduzir fraudes. O sistema deve registrar a decisão.');
assert.equal(noActor.requirement_model.actor, null);
assert.ok(noActor.requirement_model.missing_information.some((item) => item.id.includes('actor')));

const noGoal = await analyze('Como gestor, preciso aprovar solicitações. O sistema deve registrar a decisão.');
assert.equal(noGoal.requirement_model.goal, null);
assert.ok(noGoal.requirement_model.missing_information.some((item) => item.id.includes('outcome')));

const noRule = await analyze('Como gestor, preciso acompanhar solicitações para reduzir atrasos.');
assert.equal(noRule.requirement_model.business_rules.length, 0);
assert.ok(noRule.requirement_model.missing_information.some((item) => item.id.includes('business_rules')));

const multipleRules = await analyze('Como gestor, preciso aprovar solicitações para reduzir fraudes. O sistema deve exigir dupla validação. O sistema não pode aprovar valores acima de R$ 500 sem revisão. Em caso de erro, deve informar a correção.');
assert.ok(multipleRules.requirement_model.business_rules.length >= 3);

const invalidModel = structuredClone(complete.requirement_model);
invalidModel.acceptance_criteria = [{ id: 'AC-X', given: 'a', when: 'b', then: 'c', status: 'assumption', evidence: null }];
assert.throws(() => validateRequirementModel(invalidModel), /critério|acceptance_criteria/i);
assert.throws(() => validateRequirementModel({}), /requirement/i);

console.log('Requirement Engine smoke concluído com sucesso.');
