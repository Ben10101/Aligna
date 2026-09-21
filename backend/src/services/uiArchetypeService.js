function uniqueList(items = []) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function normalizeSourceText(technicalSpec = {}, task = null) {
  return [
    technicalSpec.featureKey,
    technicalSpec.entityName,
    technicalSpec.summary,
    technicalSpec.frontend?.pageTitle,
    technicalSpec.frontend?.pageDescription,
    technicalSpec.frontend?.navigationLabel,
    technicalSpec.architecture?.sourceSummary?.modules?.join(' '),
    technicalSpec.architecture?.sourceSummary?.stack?.join(' '),
    task?.title,
    task?.description,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function countRegex(text, regex) {
  const matches = String(text || '').match(regex);
  return matches ? matches.length : 0;
}

export function inferDomainSignals({ technicalSpec = {}, task = null } = {}) {
  const text = normalizeSourceText(technicalSpec, task);
  const fields = technicalSpec.domain?.fields || [];
  const fieldNames = fields.map((field) => String(field.name || '').toLowerCase());

  const workflowScore = countRegex(text, /\baprova|\brevis|\btriag|\bfluxo|\betapa|\bescal|\bfila/g);
  const approvalScore = countRegex(text, /\baprova|\baprovacao|\bdecis|\bparecer/g);
  const monitoringScore = countRegex(text, /\bmonitor|\bpainel|\bindicador|\bdesempenho|\bperformance|\bmetric/g);
  const attachmentScore = countRegex(text, /\banexo|\barquivo|\bdocumento|\bcomprov|\bevidenc|\bupload/g);
  const settingsScore = countRegex(text, /\bconfigur|\bpreferenc|\bajuste|\bpermiss|\bperfil de acesso/g);
  const priorityScore = countRegex(text, /\bprioridade|\burgenc|\bcritica|\bcritico|\bsla/g);
  const ownershipScore = countRegex(text, /\bresponsavel|\bowner|\bassignee|\btime|\bequipe/g);
  const auditScore = countRegex(text, /\bhistorico|\bauditoria|\blog\b|\brastre/g);
  const collaborationScore = countRegex(text, /\bcoment|\bcolabor|\bequipe|\btime/g);

  return {
    hasWorkflow: workflowScore > 0,
    hasApproval: approvalScore > 0,
    hasVolume: monitoringScore > 0 || /\bvolume|\bquantidade|\blista|\bregistro/.test(text),
    hasPriority: priorityScore > 0,
    hasOwner: ownershipScore > 0,
    hasSla: /\bsla|\btempo medio|\btempo de resposta|\bprazo/.test(text),
    hasAttachment: attachmentScore > 0,
    hasSettings: settingsScore > 0,
    hasMonitoring: monitoringScore > 0,
    hasAuditTrail: auditScore > 0,
    hasCollaboration: collaborationScore > 0,
    dataDensity:
      fields.length >= 6 || /\bmetric|\bfila|\blista|\bregistro|\bindicador/.test(text)
        ? 'high'
        : fields.length >= 4
          ? 'medium'
          : 'low',
    primaryAction:
      technicalSpec.domain?.submitLabel ||
      (approvalScore > 0
        ? 'approve'
        : /\bescal/.test(text)
          ? 'escalate'
          : settingsScore > 0
            ? 'configure'
            : 'create'),
    primaryEntity:
      technicalSpec.entityName ||
      technicalSpec.primaryEntity ||
      technicalSpec.backend?.entityName ||
      'GeneratedItem',
    fieldNames,
    rawScores: {
      workflowScore,
      approvalScore,
      monitoringScore,
      attachmentScore,
      settingsScore,
      priorityScore,
      ownershipScore,
      auditScore,
      collaborationScore,
    },
  };
}

function scoreArchetypes({ signals, screenTemplate, productMode, uiIntent }) {
  const scores = {
    'executive-dashboard': 0,
    'evidence-workbench': 0,
    'settings-console': 0,
    'operations-queue': 0,
    'review-queue': 0,
    'approval-flow': 0,
    'intake-form': 0,
    'record-management': 0,
  };

  if (signals.hasMonitoring) scores['executive-dashboard'] += 4;
  if (signals.hasVolume) scores['executive-dashboard'] += 2;
  if (signals.hasPriority) scores['executive-dashboard'] += 1;
  if (screenTemplate === 'dashboard') scores['executive-dashboard'] += 4;
  if (productMode === 'manager-cockpit') scores['executive-dashboard'] += 5;

  if (signals.hasAttachment) scores['evidence-workbench'] += 5;
  if (signals.hasWorkflow) scores['evidence-workbench'] += 1;
  if (productMode === 'evidence-workbench') scores['evidence-workbench'] += 5;
  if (uiIntent === 'attach') scores['evidence-workbench'] += 4;
  if (screenTemplate === 'workspace') scores['evidence-workbench'] += 1;

  if (signals.hasSettings) scores['settings-console'] += 5;
  if (screenTemplate === 'settings') scores['settings-console'] += 4;
  if (productMode === 'self-service-settings' || productMode === 'governance-console') scores['settings-console'] += 5;
  if (uiIntent === 'configure') scores['settings-console'] += 2;

  if (signals.hasWorkflow) scores['operations-queue'] += 3;
  if (signals.hasPriority) scores['operations-queue'] += 3;
  if (signals.hasOwner) scores['operations-queue'] += 2;
  if (screenTemplate === 'workspace') scores['operations-queue'] += 2;
  if (uiIntent === 'review') scores['operations-queue'] += 1;

  if (signals.hasWorkflow) scores['review-queue'] += 2;
  if (signals.hasApproval) scores['review-queue'] += 2;
  if (signals.hasAuditTrail) scores['review-queue'] += 1;
  if (productMode === 'review-workbench') scores['review-queue'] += 5;
  if (uiIntent === 'review') scores['review-queue'] += 4;

  if (signals.hasApproval) scores['approval-flow'] += 7;
  if (signals.hasAuditTrail) scores['approval-flow'] += 3;
  if (screenTemplate === 'wizard') scores['approval-flow'] += 3;
  if (uiIntent === 'approve' || uiIntent === 'review') scores['approval-flow'] += 2;
  if (signals.hasApproval && screenTemplate === 'wizard') scores['approval-flow'] += 4;
  if (signals.hasApproval && uiIntent === 'review') scores['approval-flow'] += 2;

  if (uiIntent === 'create' || uiIntent === 'update') scores['intake-form'] += 4;
  if (screenTemplate === 'crud') scores['intake-form'] += 2;
  if (signals.dataDensity === 'low') scores['intake-form'] += 1;

  scores['record-management'] += 1;
  if (screenTemplate === 'crud') scores['record-management'] += 3;
  if (signals.dataDensity === 'medium' || signals.dataDensity === 'high') scores['record-management'] += 1;

  return scores;
}

function resolveFallbackPattern(pageArchetype) {
  if (pageArchetype === 'executive-dashboard') return 'vercel-analytics';
  if (pageArchetype === 'evidence-workbench') return 'notion-evidence';
  if (pageArchetype === 'settings-console') return 'stripe-settings';
  if (pageArchetype === 'operations-queue' || pageArchetype === 'review-queue') return 'linear-queue';
  if (pageArchetype === 'approval-flow') return 'github-review';
  if (pageArchetype === 'intake-form') return 'stripe-records';
  return 'stripe-records';
}

function resolveRecommendedSections(pageArchetype) {
  const byArchetype = {
    'executive-dashboard': ['hero', 'metrics', 'filters', 'records'],
    'evidence-workbench': ['hero', 'queue', 'form', 'records'],
    'settings-console': ['hero', 'form', 'summary', 'activity'],
    'operations-queue': ['hero', 'queue', 'filters', 'records'],
    'review-queue': ['hero', 'queue', 'summary', 'activity'],
    'approval-flow': ['hero', 'steps', 'summary', 'activity'],
    'intake-form': ['hero', 'form', 'summary', 'records'],
    'record-management': ['hero', 'filters', 'list', 'form'],
  };
  return byArchetype[pageArchetype] || byArchetype['record-management'];
}

export function resolveUiArchetype({
  technicalSpec = {},
  task = null,
  screenTemplate = 'crud',
  productMode = 'structured-workspace',
  uiIntent = 'custom',
} = {}) {
  const signals = inferDomainSignals({ technicalSpec, task });
  const scores = scoreArchetypes({ signals, screenTemplate, productMode, uiIntent });
  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [pageArchetype, confidenceScore] = orderedScores[0];
  const fallbackPattern = resolveFallbackPattern(pageArchetype);

  return {
    pageArchetype,
    fallbackPattern,
    domainSignals: signals,
    recommendedSections: resolveRecommendedSections(pageArchetype),
    confidenceScore,
    alternativeArchetypes: orderedScores.slice(1, 4).map(([key, score]) => ({ key, score })),
    scoredArchetypes: scores,
  };
}

export function buildPatternHints(archetypeResolution = {}) {
  const { pageArchetype, fallbackPattern, domainSignals } = archetypeResolution;
  return uniqueList([
    pageArchetype,
    fallbackPattern,
    domainSignals?.hasMonitoring ? 'metrics-first' : null,
    domainSignals?.hasPriority ? 'priority-visible' : null,
    domainSignals?.hasAttachment ? 'evidence-context' : null,
    domainSignals?.hasSettings ? 'summary-before-secondary-actions' : null,
    domainSignals?.hasApproval ? 'decision-focused' : null,
    domainSignals?.hasWorkflow ? 'workflow-guided' : null,
    domainSignals?.hasAuditTrail ? 'audit-visible' : null,
  ]);
}
