import { analyzeSemanticAlignment } from './alignmentSemanticService.js';
import { validateSemanticFindings } from './alignmentValidationService.js';
import { logInfo, logWarn } from '../utils/logger.js';
import { buildRequirementEngine } from './requirementEngineService.js';
import { buildAlignmentScore } from './alignmentScoringService.js';
import { compareRequirementWithVisual } from './visualRequirementService.js';

export const ALIGNMENT_ANALYSIS_VERSION = '2.0';

function normalizeText(value = '') {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function compactText(value, maxLength = 280) {
  const text = normalizeText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}...`;
}

function sentences(input) {
  return normalizeText(input).split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function containsWholeTerm(input, term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'iu').test(input);
}

function finding({ category, code, severity = 'medium', message, recommendation, evidence = '' }) {
  return { id: `${category}:${code}`, category, code, severity, message, recommendation, evidence: evidence || null, source: 'deterministic' };
}

function detectActor(input) {
  const match = input.match(/como\s+([^,.\n]+?)(?:,\s*(?:eu\s+)?(?:quero|preciso|gostaria|desejo)|[,.]|$)/i);
  if (match?.[1]) return match[1].trim();
  return input.match(/\b(cliente|usu[aá]rio|gestor|administrador|admin|operador|analista|financeiro)\b/i)?.[1] || '';
}

function detectOutcome(input) {
  return input.match(/(?:para|a fim de|com o objetivo de|de modo que)\s+([^.!?\n]{8,180})/i)?.[1]?.trim() || '';
}

function detectAction(input) {
  return (sentences(input)[0] || '').replace(/^como\s+[^,]+,\s*/i, '').replace(/^(?:eu\s+)?(?:quero|preciso|gostaria|desejo)\s+/i, '').trim();
}

function explicitBullets(input) {
  return input.split('\n').map((line) => line.trim()).filter((line) => /^(?:[-*]|\d+\.)\s+/.test(line)).map((line) => line.replace(/^(?:[-*]|\d+\.)\s+/, '').trim());
}

function extractBusinessRules(input, bullets) {
  const rules = sentences(input).filter((sentence) => /\b(deve|n[aã]o pode|somente|apenas|obrigat[oó]rio|limite|prazo|permiss[aã]o|perfil|papel|autoriz)/i.test(sentence));
  return unique([...rules, ...bullets.filter((item) => /\b(deve|n[aã]o pode|somente|apenas|obrigat[oó]rio)\b/i.test(item))]).slice(0, 6);
}

function analyzeDeterministically(rawInput) {
  const input = normalizeText(rawInput);
  if (!input) throw new Error('A descrição da ideia ou da feature é obrigatória.');

  const actor = detectActor(input);
  const action = detectAction(input);
  const outcome = detectOutcome(input);
  const bullets = explicitBullets(input);
  const businessRules = extractBusinessRules(input, bullets);
  const findings = [];
  const vagueTerms = ['rápido', 'rapidamente', 'simples', 'intuitivo', 'moderno', 'robusto', 'fácil', 'melhor', 'otimizado', 'eficiente', 'automático', 'dinâmico'];

  for (const term of vagueTerms.filter((item) => containsWholeTerm(input, item))) {
    findings.push(finding({ category: 'ambiguity', code: 'vague_term', severity: 'medium', evidence: term, message: `O termo "${term}" não possui um critério objetivo no texto.`, recommendation: 'Substitua-o por uma métrica, limite, prazo ou exemplo verificável.' }));
  }
  if (!actor) findings.push(finding({ category: 'missing_information', code: 'actor', severity: 'high', message: 'O ator que inicia ou consome o fluxo não foi informado.', recommendation: 'Informe o perfil responsável pelo fluxo.' }));
  if (!outcome) findings.push(finding({ category: 'missing_information', code: 'outcome', severity: 'high', message: 'O resultado ou objetivo de negócio não foi informado.', recommendation: 'Informe o resultado esperado ou o valor de negócio.' }));
  if (!businessRules.length) findings.push(finding({ category: 'missing_information', code: 'business_rules', severity: 'medium', message: 'Não há regra de negócio verificável explícita.', recommendation: 'Descreva limites, permissões, obrigatoriedades ou restrições.' }));
  if (!/\b(exceto|caso|falh|erro|inv[aá]lid|sem acesso|n[aã]o permitid)\b/i.test(input)) findings.push(finding({ category: 'missing_information', code: 'exception_flow', severity: 'medium', message: 'O comportamento para erro, exceção ou acesso negado não foi informado.', recommendation: 'Descreva o resultado esperado para cenários negativos.' }));
  if (input.length < 90) findings.push(finding({ category: 'missing_information', code: 'context', severity: 'high', message: 'A descrição não contém contexto suficiente para validação confiável.', recommendation: 'Inclua ator, objetivo, regra e comportamento esperado.' }));

  const types = new Set(findings.map((item) => item.code));
  const acceptanceCriteria = bullets.slice(0, 3);
  if (actor && action && outcome) acceptanceCriteria.unshift(`Dado ${actor}, quando ${action.toLocaleLowerCase('pt-BR')}, então o sistema deve ${outcome.toLocaleLowerCase('pt-BR')}.`);

  return {
    input, input_summary: compactText(input, 220), extracted: { actor: actor || null, action: action || null, outcome: outcome || null }, findings,
    missing_information: findings.filter((item) => item.category === 'missing_information'), business_rules: businessRules,
    acceptance_criteria: unique(acceptanceCriteria).slice(0, 6),
    test_scenarios: [actor && action && outcome ? `Cenário feliz: ${actor} ${action.toLocaleLowerCase('pt-BR')} e obtém ${outcome.toLocaleLowerCase('pt-BR')}.` : null, types.has('exception_flow') ? null : 'Pendente: defina um cenário negativo antes de criar casos de teste.'].filter(Boolean),
    user_story: actor && action && outcome ? `Como ${actor}, eu quero ${action} para ${outcome}.` : 'User story pendente: há informações obrigatórias ausentes.',
  };
}

function publicFinding(item) {
  return { type: item.code, severity: item.severity, message: item.message, recommendation: item.recommendation, evidence: item.evidence, source: item.source };
}

export async function analyzeAlignmentInput(rawInput = '', options = {}) {
  const deterministic = analyzeDeterministically(rawInput);
  const semanticRequested = options.semanticEnabled === true;
  let semantic = { status: semanticRequested ? 'unavailable' : 'skipped', findings: [], reason: semanticRequested ? 'semantic_analysis_failed' : 'disabled_by_configuration' };
  if (semanticRequested) {
    try { semantic = await analyzeSemanticAlignment(deterministic.input, { ...options, envOverrides: options.semanticEnvOverrides || options.envOverrides }); }
    catch (error) { logWarn('alignment.semantic_analysis_failed', { error, analysisVersion: ALIGNMENT_ANALYSIS_VERSION }); }
  }
  const validation = validateSemanticFindings(semantic.findings, deterministic.input);
  const validatedSemanticFindings = validation.accepted.map((item) => ({ ...item, source: 'semantic' }));
  const allFindings = [...deterministic.findings, ...validatedSemanticFindings];
  const clarityScore = buildAlignmentScore({
    input: deterministic.input,
    extracted: deterministic.extracted,
    findings: allFindings,
    businessRules: deterministic.business_rules,
    acceptanceCriteria: deterministic.acceptance_criteria,
  });
  const requirementEngine = await buildRequirementEngine(deterministic.input, deterministic, allFindings, {
    llmEnabled: options.requirementEngineLlmEnabled === true,
    envOverrides: options.requirementEngineEnvOverrides || options.envOverrides,
  });
  const result = {
    analysis_version: ALIGNMENT_ANALYSIS_VERSION, input_summary: deterministic.input_summary, user_story: deterministic.user_story,
    acceptance_criteria: deterministic.acceptance_criteria, business_rules: deterministic.business_rules, test_scenarios: deterministic.test_scenarios, clarity_score: clarityScore,
    ambiguity_alerts: allFindings.filter((item) => item.category === 'ambiguity').map(publicFinding), missing_information: deterministic.missing_information.map(publicFinding), findings: allFindings.map(publicFinding),
    requirement_model: requirementEngine.requirementModel,
    requirement_engine: requirementEngine.report,
    challenge_report: requirementEngine.challengeReport,
    judge_report: requirementEngine.judgeReport,
    ...(options.visualRequirementModel ? { visual_analysis: compareRequirementWithVisual(deterministic.input, options.visualRequirementModel, deterministic.business_rules) } : {}),
    analysis: {
      deterministic: { extracted: deterministic.extracted, finding_count: deterministic.findings.length },
      semantic: { status: semantic.status, reason: semantic.reason || null, findings: validatedSemanticFindings.map(publicFinding) },
      validation: { rejected_count: validation.rejected.length, rejected_reasons: validation.rejected.map((item) => item.reason) },
      scoring: { source: 'deterministic', version: '2.0', inputs: ['validated_findings', 'deterministic_extraction', 'business_rules', 'acceptance_criteria'] },
      traceability: allFindings.map((item) => ({ finding_id: item.id, source: item.source, evidence: item.evidence || null })),
    },
  };
  logInfo('alignment.analysis_completed', { analysisVersion: ALIGNMENT_ANALYSIS_VERSION, semanticStatus: semantic.status, deterministicFindings: deterministic.findings.length, acceptedSemanticFindings: validatedSemanticFindings.length });
  return result;
}

export { analyzeDeterministically };
