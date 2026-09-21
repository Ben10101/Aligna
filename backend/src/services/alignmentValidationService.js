const ALLOWED_CATEGORIES = new Set(['missing_information', 'ambiguity', 'assumption', 'contradiction']);
const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high']);

function normalize(value, maxLength) { return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength); }

export function validateSemanticFindings(findings, input) {
  const accepted = []; const rejected = []; const normalizedInput = normalize(input, 20000).toLocaleLowerCase('pt-BR');
  for (const candidate of Array.isArray(findings) ? findings : []) {
    const category = normalize(candidate?.category, 40); const evidence = normalize(candidate?.evidence, 500); const message = normalize(candidate?.message, 600); const recommendation = normalize(candidate?.recommendation, 600); const severity = normalize(candidate?.severity, 20) || 'medium';
    if (!ALLOWED_CATEGORIES.has(category)) { rejected.push({ reason: 'invalid_category' }); continue; }
    if (!ALLOWED_SEVERITIES.has(severity)) { rejected.push({ reason: 'invalid_severity' }); continue; }
    if (!message || !recommendation) { rejected.push({ reason: 'incomplete_finding' }); continue; }
    if ((category === 'ambiguity' || category === 'contradiction') && (!evidence || !normalizedInput.includes(evidence.toLocaleLowerCase('pt-BR')))) { rejected.push({ reason: 'untraceable_evidence' }); continue; }
    accepted.push({ id: `semantic:${category}:${accepted.length + 1}`, category, severity, evidence: evidence || null, message, recommendation });
  }
  return { accepted, rejected };
}
