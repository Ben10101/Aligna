import { validateRequirementModel } from './requirementSchemaService.js';

const PROBLEM_TYPES = new Set([
  'AMBIGUITY', 'MISSING_INFORMATION', 'CONTRADICTION', 'UNTESTABLE',
  'SCOPE_RISK', 'ASSUMPTION', 'BUSINESS_RULE_GAP', 'EDGE_CASE',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);

function createError(message) {
  const error = new Error(`Challenge report inválido: ${message}`);
  error.code = 'INVALID_CHALLENGE_REPORT';
  return error;
}

function normalizeText(value, maxLength = 2000) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function assertText(value, path, { nullable = false, maxLength = 2000 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) throw createError(`${path} precisa ser uma string não vazia.`);
  if (value.length > maxLength) throw createError(`${path} excede ${maxLength} caracteres.`);
}

export function validateChallengeReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw createError('raiz precisa ser um objeto JSON.');
  if (!Array.isArray(report.problems)) throw createError('problems precisa ser uma lista.');
  report.problems.forEach((problem, index) => {
    const path = `problems[${index}]`;
    if (!problem || typeof problem !== 'object' || Array.isArray(problem)) throw createError(`${path} precisa ser um objeto.`);
    assertText(problem.id, `${path}.id`, { maxLength: 120 });
    assertText(problem.type, `${path}.type`, { maxLength: 40 });
    if (!PROBLEM_TYPES.has(problem.type)) throw createError(`${path}.type contém enum inválido.`);
    assertText(problem.evidence, `${path}.evidence`, { maxLength: 1000 });
    assertText(problem.explanation, `${path}.explanation`);
    assertText(problem.impact, `${path}.impact`);
    assertText(problem.severity, `${path}.severity`, { maxLength: 20 });
    if (!SEVERITIES.has(problem.severity)) throw createError(`${path}.severity contém enum inválido.`);
    assertText(problem.clarification_question, `${path}.clarification_question`, { nullable: true, maxLength: 1000 });
    assertText(problem.source, `${path}.source`, { maxLength: 40 });
  });
  return report;
}

function evidenceFrom(input, preferred = '') {
  return normalizeText(preferred || input, 300);
}

function problem(type, index, input, { evidence, explanation, impact, severity = 'medium', question = null, source = 'deterministic' }) {
  return {
    id: `CH-${String(index + 1).padStart(3, '0')}`,
    type,
    evidence: evidenceFrom(input, evidence),
    explanation,
    impact,
    severity,
    clarification_question: question,
    source,
  };
}

function contains(input, pattern) {
  return pattern.test(String(input || ''));
}

export function challengeRequirementDeterministically({ requirement, requirementModel, context = '' }) {
  validateRequirementModel(requirementModel);
  const input = normalizeText(requirement, 20000);
  const problems = [];
  const add = (type, details) => problems.push(problem(type, problems.length, input, details));

  if (!requirementModel.actor) add('MISSING_INFORMATION', {
    explanation: 'O requisito não identifica o ator responsável pelo fluxo.', impact: 'Desenvolvimento, permissões e testes podem ser implementados para o perfil errado.', severity: 'high', question: 'Qual ator inicia ou consome este fluxo?',
  });
  if (!requirementModel.goal) add('MISSING_INFORMATION', {
    explanation: 'O resultado de negócio não foi definido.', impact: 'O Product Owner não consegue validar se a entrega atingiu o objetivo.', severity: 'high', question: 'Qual resultado de negócio deve ser alcançado?',
  });
  if (!requirementModel.business_rules.length) add('BUSINESS_RULE_GAP', {
    explanation: 'Não há regra de negócio confirmada no modelo.', impact: 'O comportamento pode variar entre implementadores e não terá uma base verificável.', severity: 'high', question: 'Quais regras, limites, permissões ou obrigatoriedades devem ser aplicadas?',
  });
  if (!requirementModel.acceptance_criteria.length) add('UNTESTABLE', {
    explanation: 'Não há critério de aceite BDD confirmado.', impact: 'QA e Product Owner não têm uma condição objetiva de validação.', severity: 'high', question: 'Quais condições observáveis definem que o requisito foi aceito?',
  });
  if (!contains(input, /\b(erro|falha|exce[cç][aã]o|inv[aá]lid|sem acesso|n[aã]o permitido)\b/i)) add('EDGE_CASE', {
    explanation: 'A entrada não descreve comportamento para falha, exceção ou validação negativa.', impact: 'Fluxos de erro podem ficar sem implementação ou teste.', severity: 'medium', question: 'Como o sistema deve se comportar em caso de erro, dado inválido ou acesso negado?',
  });
  for (const entry of requirementModel.ambiguities) add('AMBIGUITY', {
    evidence: entry.evidence || input, explanation: entry.message, impact: 'Há mais de uma interpretação plausível para a implementação.', severity: 'medium', question: entry.recommendation,
  });
  for (const entry of requirementModel.contradictions) add('CONTRADICTION', {
    evidence: entry.evidence || input, explanation: entry.message, impact: 'Regras conflitantes impedem uma decisão de implementação confiável.', severity: 'high', question: entry.recommendation,
  });
  for (const entry of requirementModel.assumptions) add('ASSUMPTION', {
    evidence: entry.evidence || input, explanation: entry.message, impact: 'Uma hipótese não confirmada pode virar comportamento incorreto.', severity: 'medium', question: entry.recommendation,
  });
  if (contains(input, /\b(permiss[aã]o|perfil|acesso|autoriz[aã])\b/i) && !requirementModel.business_rules.some((rule) => /\b(permiss[aã]o|perfil|acesso|autoriz[aã])/i.test(rule.statement))) add('MISSING_INFORMATION', {
    explanation: 'A entrada menciona acesso ou permissão sem definir a regra correspondente.', impact: 'Pode haver autorização incorreta ou bloqueio indevido.', severity: 'high', question: 'Quais perfis podem executar e visualizar este fluxo?',
  });
  if (contains(input, /\b(status|estado)\b/i) && !requirementModel.main_flow.length && !requirementModel.alternative_flows.length) add('MISSING_INFORMATION', {
    explanation: 'A entrada menciona estado ou status sem transições estruturadas.', impact: 'O ciclo de vida pode ser interpretado de formas diferentes.', severity: 'medium', question: 'Quais estados existem e quais transições são permitidas?',
  });
  if (contains(input, /\b(api|integra[cç][aã]o|webhook|sistema externo|provider)\b/i) && !requirementModel.dependencies.length) add('MISSING_INFORMATION', {
    explanation: 'A entrada indica uma dependência externa sem contrato ou disponibilidade conhecidos.', impact: 'A implementação pode falhar por falta de integração definida.', severity: 'medium', question: 'Qual dependência externa é necessária e qual contrato deve ser usado?',
  });
  if (contains(input, /\b(todos?|qualquer|completo|global)\b/i)) add('SCOPE_RISK', {
    explanation: 'A entrada usa um quantificador amplo sem delimitar o escopo.', impact: 'A entrega pode crescer além do requisito pretendido.', severity: 'medium', question: 'Qual é o conjunto exato coberto por este requisito?',
  });

  return validateChallengeReport({ version: '1.0', problems });
}

export function validateChallengerCandidates(candidates, input) {
  const source = Array.isArray(candidates) ? candidates : [];
  const accepted = [];
  const rejected = [];
  const normalizedInput = normalizeText(input, 20000).toLocaleLowerCase('pt-BR');
  for (const candidate of source) {
    const proposed = {
      id: `CH-LLM-${String(accepted.length + 1).padStart(3, '0')}`,
      type: normalizeText(candidate?.type, 40).toUpperCase(),
      evidence: normalizeText(candidate?.evidence, 1000),
      explanation: normalizeText(candidate?.explanation, 2000),
      impact: normalizeText(candidate?.impact, 2000),
      severity: normalizeText(candidate?.severity, 20).toLowerCase(),
      clarification_question: candidate?.clarification_question == null ? null : normalizeText(candidate.clarification_question, 1000),
      source: 'llm',
    };
    try {
      validateChallengeReport({ problems: [proposed] });
      if (!normalizedInput.includes(proposed.evidence.toLocaleLowerCase('pt-BR'))) throw createError('evidence não é rastreável na entrada.');
      accepted.push(proposed);
    } catch (error) {
      rejected.push({ reason: error.code || 'invalid_problem' });
    }
  }
  return { accepted, rejected };
}

export { PROBLEM_TYPES, SEVERITIES };
