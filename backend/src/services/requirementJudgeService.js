import { validateRequirementModel } from './requirementSchemaService.js';
import { validateChallengeReport } from './requirementChallengerService.js';

const DECISIONS = new Set(['PASS', 'REVISE', 'BLOCK']);
const DIMENSIONS = new Set([
  'consistency', 'hallucination', 'scope', 'ambiguity', 'missing_information',
  'business_rules', 'acceptance_criteria', 'testability', 'contradiction', 'challenger_quality',
]);

function error(message) {
  const value = new Error(`Judge report inválido: ${message}`);
  value.code = 'INVALID_JUDGE_REPORT';
  return value;
}

function text(value, max = 2000) {
  return typeof value === 'string' ? value.replace(/\r/g, '').trim().slice(0, max) : '';
}

function includes(input, value) {
  const candidate = text(value, 20000).toLocaleLowerCase('pt-BR');
  return Boolean(candidate) && text(input, 20000).toLocaleLowerCase('pt-BR').includes(candidate);
}

function makeFinding(dimension, message, evidence = null, severity = 'medium', feedback = null) {
  return { id: null, dimension, message, evidence, severity, feedback };
}

export function validateJudgeReport(report, input = '') {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw error('raiz precisa ser um objeto JSON.');
  if (!DECISIONS.has(report.decision)) throw error('decision precisa ser PASS, REVISE ou BLOCK.');
  for (const key of ['findings', 'challenger_false_positives', 'feedback_for_analyzer']) {
    if (!Array.isArray(report[key])) throw error(`${key} precisa ser uma lista.`);
  }
  const normalizedInput = text(input, 20000).toLocaleLowerCase('pt-BR');
  report.findings.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw error(`findings[${index}] precisa ser um objeto.`);
    if (!DIMENSIONS.has(entry.dimension)) throw error(`findings[${index}].dimension inválida.`);
    if (!text(entry.message)) throw error(`findings[${index}].message é obrigatório.`);
    if (!['low', 'medium', 'high'].includes(text(entry.severity, 20))) throw error(`findings[${index}].severity inválida.`);
    if (entry.evidence != null && (!text(entry.evidence, 1000) || !normalizedInput.includes(text(entry.evidence, 1000).toLocaleLowerCase('pt-BR')))) {
      throw error(`findings[${index}].evidence não é rastreável na entrada.`);
    }
  });
  report.challenger_false_positives.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !text(entry.reason)) throw error(`challenger_false_positives[${index}] inválido.`);
  });
  report.feedback_for_analyzer.forEach((entry, index) => {
    if (!text(entry, 2000)) throw error(`feedback_for_analyzer[${index}] inválido.`);
  });
  return report;
}

function evidenceFinding(findings, dimension, item, label, input, severity = 'medium') {
  if (item && (!item.evidence || !includes(input, item.evidence))) {
    findings.push(makeFinding(dimension, `${label} não possui evidência rastreável na entrada.`, item.evidence || null, severity, `Remova ou confirme ${label}.`));
  }
}

export function judgeRequirementDeterministically({ requirement, requirementModel, challengeReport }) {
  validateRequirementModel(requirementModel);
  validateChallengeReport(challengeReport);
  const findings = [];
  const falsePositives = [];
  const input = text(requirement, 20000);

  for (const [field, label] of [['actor', 'O ator'], ['action', 'A ação'], ['goal', 'O objetivo']]) {
    if (requirementModel[field] && !includes(input, requirementModel[field])) {
      findings.push(makeFinding('hallucination', `${label} informado pelo Analyst não é sustentado pela entrada.`, null, 'high', `Confirme ${label.toLocaleLowerCase('pt-BR')} com o solicitante ou remova-o.`));
    }
  }
  for (const rule of requirementModel.business_rules) evidenceFinding(findings, 'business_rules', rule, `A regra ${rule.id}`, input);
  for (const entry of [...requirementModel.functional_requirements, ...requirementModel.main_flow, ...requirementModel.alternative_flows, ...requirementModel.exception_flows, ...requirementModel.dependencies, ...requirementModel.scope.in_scope]) {
    evidenceFinding(findings, entry.id?.startsWith('SC-') ? 'scope' : 'consistency', entry, `O item ${entry.id}`, input);
  }
  for (const criterion of requirementModel.acceptance_criteria) {
    const supported = criterion.evidence && includes(input, criterion.evidence)
      && includes(input, requirementModel.action || criterion.when)
      && includes(input, requirementModel.goal || criterion.then);
    if (!supported) findings.push(makeFinding('acceptance_criteria', `O critério ${criterion.id} introduz ou depende de comportamento não especificado.`, criterion.evidence || null, 'medium', 'Mantenha somente condições explicitamente confirmadas na entrada.'));
  }
  if (!requirementModel.acceptance_criteria.length) findings.push(makeFinding('testability', 'Não há critério de aceite confirmado e testável.', null, 'high', 'Defina condições observáveis de aceite.'));
  if (requirementModel.contradictions.length) findings.push(makeFinding('contradiction', 'Há contradições não resolvidas no requisito.', requirementModel.contradictions[0].evidence || null, 'high', 'Defina qual comportamento prevalece.'));
  for (const missing of requirementModel.missing_information) findings.push(makeFinding('missing_information', missing.message, missing.evidence || null, 'medium', missing.recommendation));
  for (const ambiguity of requirementModel.ambiguities) findings.push(makeFinding('ambiguity', ambiguity.message, ambiguity.evidence || null, 'medium', ambiguity.recommendation));

  for (const problem of challengeReport.problems) {
    const unsupportedEvidence = !includes(input, problem.evidence);
    const ruleFalsePositive = problem.type === 'BUSINESS_RULE_GAP' && requirementModel.business_rules.some((rule) => rule.evidence && includes(input, rule.evidence));
    const acceptanceFalsePositive = problem.type === 'UNTESTABLE' && requirementModel.acceptance_criteria.length > 0;
    if (unsupportedEvidence || ruleFalsePositive || acceptanceFalsePositive) {
      falsePositives.push({ problem_id: problem.id, reason: unsupportedEvidence ? 'evidence_not_traceable' : 'contradicts_validated_model' });
    }
  }

  const hasBlocker = findings.some((entry) => entry.dimension === 'contradiction' || (entry.dimension === 'hallucination' && entry.severity === 'high'));
  const decision = hasBlocker ? 'BLOCK' : findings.length ? 'REVISE' : 'PASS';
  findings.forEach((entry, index) => { entry.id = `J-${String(index + 1).padStart(3, '0')}`; });
  return {
    decision,
    findings,
    challenger_false_positives: falsePositives,
    feedback_for_analyzer: findings.map((entry) => entry.feedback || entry.message).filter(Boolean),
  };
}

export { DECISIONS, DIMENSIONS };
