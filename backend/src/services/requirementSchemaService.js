const MAX_REQUIREMENT_LENGTH = 20000;
const ITEM_STATUSES = new Set(['confirmed', 'missing_information', 'assumption', 'ambiguity', 'contradiction']);
const FINDING_CATEGORIES = new Set(['ambiguity', 'missing_information', 'assumption', 'contradiction']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message) {
  const error = new Error(`Requirement model inválido: ${message}`);
  error.code = 'INVALID_REQUIREMENT_MODEL';
  return error;
}

function assertString(value, path, { nullable = false, maxLength = 20000 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) throw validationError(`${path} precisa ser uma string não vazia.`);
  if (value.length > maxLength) throw validationError(`${path} excede ${maxLength} caracteres.`);
}

function assertItem(value, path) {
  if (!isObject(value)) throw validationError(`${path} precisa ser um objeto.`);
  assertString(value.id, `${path}.id`, { maxLength: 120 });
  assertString(value.statement, `${path}.statement`, { maxLength: 2000 });
  assertString(value.status, `${path}.status`, { maxLength: 40 });
  if (!ITEM_STATUSES.has(value.status)) throw validationError(`${path}.status contém enum inválido.`);
  if (value.evidence !== null) assertString(value.evidence, `${path}.evidence`, { maxLength: 1000 });
}

function assertItemList(value, path) {
  if (!Array.isArray(value)) throw validationError(`${path} precisa ser uma lista.`);
  value.forEach((item, index) => assertItem(item, `${path}[${index}]`));
}

function assertAcceptanceCriteria(value) {
  if (!Array.isArray(value)) throw validationError('acceptance_criteria precisa ser uma lista.');
  value.forEach((criterion, index) => {
    const path = `acceptance_criteria[${index}]`;
    if (!isObject(criterion)) throw validationError(`${path} precisa ser um objeto.`);
    assertString(criterion.id, `${path}.id`, { maxLength: 120 });
    assertString(criterion.given, `${path}.given`, { maxLength: 1000 });
    assertString(criterion.when, `${path}.when`, { maxLength: 1000 });
    assertString(criterion.then, `${path}.then`, { maxLength: 1000 });
    assertString(criterion.status, `${path}.status`, { maxLength: 40 });
    if (criterion.status !== 'confirmed') throw validationError(`${path}.status precisa ser confirmed.`);
    if (criterion.evidence !== null) assertString(criterion.evidence, `${path}.evidence`, { maxLength: 1000 });
  });
}

function assertFindings(value, path) {
  if (!Array.isArray(value)) throw validationError(`${path} precisa ser uma lista.`);
  value.forEach((finding, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isObject(finding)) throw validationError(`${itemPath} precisa ser um objeto.`);
    assertString(finding.id, `${itemPath}.id`, { maxLength: 120 });
    assertString(finding.category, `${itemPath}.category`, { maxLength: 40 });
    if (!FINDING_CATEGORIES.has(finding.category)) throw validationError(`${itemPath}.category contém enum inválido.`);
    assertString(finding.message, `${itemPath}.message`, { maxLength: 2000 });
    assertString(finding.recommendation, `${itemPath}.recommendation`, { maxLength: 2000 });
    if (finding.evidence !== null) assertString(finding.evidence, `${itemPath}.evidence`, { maxLength: 1000 });
  });
}

export function validateRequirementModel(model) {
  if (!isObject(model)) throw validationError('raiz precisa ser um objeto JSON.');
  assertString(model.requirement, 'requirement', { maxLength: MAX_REQUIREMENT_LENGTH });
  for (const key of ['user_story', 'actor', 'goal', 'action', 'object', 'context']) {
    assertString(model[key], key, { nullable: true, maxLength: 4000 });
  }
  for (const key of ['functional_requirements', 'business_rules', 'main_flow', 'alternative_flows', 'exception_flows', 'dependencies', 'risks']) {
    assertItemList(model[key], key);
  }
  assertAcceptanceCriteria(model.acceptance_criteria);
  for (const key of ['ambiguities', 'missing_information', 'assumptions', 'contradictions']) assertFindings(model[key], key);
  if (!isObject(model.scope)) throw validationError('scope precisa ser um objeto.');
  for (const key of ['in_scope', 'out_of_scope', 'not_defined']) assertItemList(model.scope[key], `scope.${key}`);
  if (!Array.isArray(model.clarification_questions)) throw validationError('clarification_questions precisa ser uma lista.');
  model.clarification_questions.forEach((question, index) => {
    const path = `clarification_questions[${index}]`;
    if (!isObject(question)) throw validationError(`${path} precisa ser um objeto.`);
    assertString(question.id, `${path}.id`, { maxLength: 120 });
    assertString(question.question, `${path}.question`, { maxLength: 1000 });
    assertString(question.relates_to, `${path}.relates_to`, { maxLength: 120 });
  });
  return model;
}

export { MAX_REQUIREMENT_LENGTH };
