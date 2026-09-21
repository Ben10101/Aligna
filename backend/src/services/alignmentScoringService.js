const DIMENSION_KEYS = ['clarity', 'completeness', 'testability', 'ambiguity', 'consistency', 'specificity', 'scope_definition'];
const HIGH = 25;
const MEDIUM = 14;
const LOW = 7;

function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function severityPoints(severity) { return severity === 'high' ? HIGH : severity === 'low' ? LOW : MEDIUM; }
function evidence(message, source = 'deterministic') { return { message, source }; }
function deduction(finding, points) {
  return { points, code: finding.code || finding.category || 'finding', message: finding.message, evidence: finding.evidence || null, source: finding.source || 'deterministic' };
}

export function calculateOverallScore(scores) {
  const normalized = DIMENSION_KEYS.map((key) => key === 'ambiguity' ? 100 - clamp(scores[key]) : clamp(scores[key]));
  return clamp(normalized.reduce((total, value) => total + value, 0) / normalized.length);
}

function scorePositiveDimension(key, positiveEvidence, deductions) {
  const totalDeductions = deductions.reduce((sum, item) => sum + item.points, 0);
  return { dimension: key, score: clamp(100 - totalDeductions), direction: 'higher_is_better', positive_evidence: positiveEvidence, negative_evidence: deductions.map(({ message, evidence: itemEvidence, source }) => ({ message, evidence: itemEvidence, source })), deductions };
}

function hasScopeSignal(input) {
  return /\b(apenas|somente|exceto|acima de|abaixo de|entre|limite|prazo|perfil|papel|permiss[aã]o|para [^.!?]{6,})\b/i.test(input);
}

export function buildAlignmentScore({ input, extracted = {}, findings = [], businessRules = [], acceptanceCriteria = [] }) {
  const byCode = new Set(findings.map((entry) => entry.code));
  const byCategory = (category) => findings.filter((entry) => entry.category === category);
  const positives = {
    clarity: [], completeness: [], testability: [], consistency: [], specificity: [], scope_definition: [],
  };
  if (extracted.actor) positives.clarity.push(evidence('Ator identificado.', 'deterministic'));
  if (extracted.action) { positives.clarity.push(evidence('Ação principal identificada.', 'deterministic')); positives.testability.push(evidence('Ação observável para validação.', 'deterministic')); }
  if (extracted.outcome) { positives.clarity.push(evidence('Objetivo de negócio identificado.', 'deterministic')); positives.completeness.push(evidence('Resultado esperado identificado.', 'deterministic')); }
  if (businessRules.length) { positives.completeness.push(evidence(`${businessRules.length} regra(s) de negócio explícita(s).`, 'deterministic')); positives.specificity.push(evidence('Há restrições ou obrigatoriedades explícitas.', 'deterministic')); }
  if (acceptanceCriteria.length) positives.testability.push(evidence(`${acceptanceCriteria.length} critério(s) de aceite disponível(is).`, 'deterministic'));
  if (hasScopeSignal(input)) positives.scope_definition.push(evidence('Há delimitadores explícitos de escopo.', 'deterministic'));

  const vague = findings.filter((entry) => entry.code === 'vague_term');
  const missing = (code) => findings.filter((entry) => entry.code === code);
  const contradictions = byCategory('contradiction');
  const assumptions = byCategory('assumption');
  const ambiguityFindings = byCategory('ambiguity');
  const genericMissing = byCategory('missing_information').filter((entry) => !['actor', 'outcome', 'business_rules', 'context', 'exception_flow'].includes(entry.code));
  const genericAmbiguity = ambiguityFindings.filter((entry) => entry.code !== 'vague_term');
  const clarityDeductions = [...vague, ...genericAmbiguity, ...missing('actor'), ...missing('outcome'), ...missing('context')].map((entry) => deduction(entry, severityPoints(entry.severity)));
  const completenessDeductions = [...genericMissing, ...missing('actor'), ...missing('outcome'), ...missing('business_rules'), ...missing('context'), ...missing('exception_flow')].map((entry) => deduction(entry, severityPoints(entry.severity)));
  const testabilityDeductions = [...genericMissing, ...missing('business_rules'), ...missing('exception_flow'), ...vague, ...genericAmbiguity].map((entry) => deduction(entry, severityPoints(entry.severity)));
  const consistencyDeductions = [...contradictions, ...assumptions].map((entry) => deduction(entry, severityPoints(entry.severity)));
  const specificityDeductions = [...vague, ...missing('business_rules'), ...missing('context')].map((entry) => deduction(entry, severityPoints(entry.severity)));
  const scopeDeductions = [...findings.filter((entry) => entry.category === 'scope_risk'), ...missing('context')].map((entry) => deduction(entry, severityPoints(entry.severity)));
  if (!hasScopeSignal(input)) scopeDeductions.push({ points: MEDIUM, code: 'scope_not_delimited', message: 'Não há delimitador explícito de escopo.', evidence: null, source: 'deterministic' });
  const ambiguityDeductions = ambiguityFindings.map((entry) => deduction(entry, severityPoints(entry.severity)));

  const dimensions = {
    clarity: scorePositiveDimension('clarity', positives.clarity, clarityDeductions),
    completeness: scorePositiveDimension('completeness', positives.completeness, completenessDeductions),
    testability: scorePositiveDimension('testability', positives.testability, testabilityDeductions),
    ambiguity: { dimension: 'ambiguity', score: clamp(ambiguityDeductions.reduce((sum, entry) => sum + entry.points, 0)), direction: 'lower_is_better', positive_evidence: [], negative_evidence: ambiguityDeductions.map(({ message, evidence: itemEvidence, source }) => ({ message, evidence: itemEvidence, source })), deductions: ambiguityDeductions },
    consistency: scorePositiveDimension('consistency', positives.consistency, consistencyDeductions),
    specificity: scorePositiveDimension('specificity', positives.specificity, specificityDeductions),
    scope_definition: scorePositiveDimension('scope_definition', positives.scope_definition, scopeDeductions),
  };
  const scalarScores = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, dimensions[key].score]));
  return {
    overall: calculateOverallScore(scalarScores),
    ...scalarScores,
    dimensions,
    missing_information: findings.filter((entry) => entry.category === 'missing_information').map((entry) => ({ message: entry.message, recommendation: entry.recommendation, evidence: entry.evidence || null })),
    scoring_source: 'deterministic',
    scoring_version: '2.0',
  };
}

export { DIMENSION_KEYS };
