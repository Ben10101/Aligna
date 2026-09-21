import { PROJECT_TEMPLATE_CATALOG } from './catalog.js';

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');
}

export function inferProjectTemplateKey(input = {}) {
  const haystack = normalizeText([
    input.projectName,
    input.idea,
    input.description,
    input.vision,
    input.summary,
  ]
    .filter(Boolean)
    .join('\n'));

  if (!haystack.trim()) return null;

  const templateMatchers = [
    {
      key: 'internal-support-hub',
      patterns: [/\bchamado\b/, /\bsuporte\b/, /\bticket\b/, /\bsla\b/, /\batendimento\b/],
    },
    {
      key: 'corporate-reimbursement-saas',
      patterns: [/\breembolso\b/, /\bdespesa\b/, /\bcomprovante\b/, /\baprovacao\b/, /\bfinanceir/],
    },
    {
      key: 'education-platform-suite',
      patterns: [/\bead\b/, /\bcurso\b/, /\baula\b/, /\bmatricula\b/, /\baluno\b/, /\bmodulo\b/],
    },
  ];

  let bestMatch = null;

  for (const candidate of templateMatchers) {
    const score = candidate.patterns.reduce((total, pattern) => total + (pattern.test(haystack) ? 1 : 0), 0);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { key: candidate.key, score };
    }
  }

  return bestMatch?.score > 0 ? bestMatch.key : null;
}

export function resolveProjectTemplate(projectTemplateKey, fallback = {}) {
  const template = PROJECT_TEMPLATE_CATALOG[projectTemplateKey];

  if (template) {
    return template;
  }

  return {
    templateKey: 'project/generic-saas',
    label: fallback.label || fallback.projectName || 'Projeto SaaS',
    domain: fallback.domain || 'generic',
    summary:
      fallback.summary ||
      'Projeto base com frontend web, backend API e jornadas principais organizadas por modulos.',
    positioning:
      fallback.positioning ||
      'Produto gerado a partir de um blueprint generico, pronto para receber modulos e linguagem de dominio.',
    audiences: fallback.audiences || ['usuario final', 'operacao'],
    coreCapabilities: fallback.coreCapabilities || ['cadastro principal', 'acompanhamento operacional'],
    frontend: {
      homeLabel: fallback.homeLabel || 'Workspace do produto',
      navigationStyle: fallback.navigationStyle || 'generic-suite',
      defaultProductMode: fallback.defaultProductMode || 'structured-workspace',
      visualTone: fallback.visualTone || 'profissional',
    },
    featureKeys: fallback.featureKeys || [],
  };
}

export { PROJECT_TEMPLATE_CATALOG };
