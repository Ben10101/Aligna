const SECTION_RE = /^##\s+(.+)$/gim;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, terms) {
  const value = normalize(text);
  return terms.some((term) => value.includes(normalize(term)));
}

function section(content, title) {
  const normalizedTitle = normalize(title);
  const matches = [...String(content || '').matchAll(SECTION_RE)];
  const current = matches.findIndex((match) => normalize(match[1]) === normalizedTitle);
  if (current < 0) return '';
  const start = matches[current].index + matches[current][0].length;
  const end = matches[current + 1]?.index ?? String(content || '').length;
  return String(content || '').slice(start, end).trim();
}

function countBddScenarios(content = '') {
  const blocks = [...String(content || '').matchAll(/^###\s+Cen[aá]rio\b[^\n]*\r?\n([\s\S]*?)(?=^###\s+Cen[aá]rio\b|(?![\s\S]))/gim)];
  return blocks.filter((match) => {
    const normalized = normalize(match[0]).replace(/[*_`#]/g, ' ');
    return /\bdado\b/.test(normalized) && /\bquando\b/.test(normalized) && /\bentao\b/.test(normalized);
  }).length;
}

export function evaluateArtifactQuality({ artifactType, content, relatedRequirement = '' }) {
  const text = String(content || '');
  const findings = [];
  const requirementText = String(relatedRequirement || '');
  const storyAction = hasAny(requirementText, ['anexar', 'upload', 'comprovante'])
    ? 'upload'
    : hasAny(requirementText, ['enviar', 'submeter', 'encaminhar'])
      ? 'submit'
      : hasAny(requirementText, ['revisar', 'visualizar', 'consultar'])
        ? 'review'
        : null;

  if (!text.trim()) findings.push({ code: 'empty_artifact', severity: 'critical', message: 'Artefato vazio.' });
  if (artifactType === 'requirements') {
    const compactFormat = Boolean(section(text, 'Historia e objetivo'));
    const requiredSections = compactFormat
      ? ['Historia e objetivo', 'Comportamento e regras confirmadas', 'Cenarios de aceite', 'Decisoes pendentes', 'Status']
      : ['User Story Refinada', 'Requisitos Funcionais', 'Criterios de Aceite'];
    for (const required of requiredSections) {
      if (!section(text, required)) findings.push({ code: 'missing_section', severity: 'high', message: `Seção obrigatória ausente: ${required}.` });
    }
    const acceptanceSection = compactFormat ? section(text, 'Cenarios de aceite') : section(text, 'Criterios de Aceite');
    const bddScenarioCount = countBddScenarios(acceptanceSection);
    // Os subtítulos editoriais ("Sucesso" e "Exceções") não definem a
    // validade do aceite. Um cenário BDD pode estar em qualquer subseção;
    // a contagem estrutural abaixo garante a cobertura. Só marcadores reais
    // de rascunho devem bloquear a publicação.
    if (/\ba validar durante a revis[aã]o\b/i.test(acceptanceSection)) {
      findings.push({ code: 'acceptance_placeholder', severity: 'critical', message: 'Cenários de aceite contêm texto provisório e precisam de critérios verificáveis.' });
    }
    if (!bddScenarioCount) {
      findings.push({ code: 'missing_bdd_acceptance_criteria', severity: 'critical', message: 'Requisito sem cenário BDD verificável nos critérios de aceite.' });
    }
    if (hasAny(text, ['status inicial pendente', 'status previsto no requisito']) && !hasAny(requirementText, ['pendente', 'status'])) {
      findings.push({ code: 'unsupported_status', severity: 'critical', message: 'O requisito afirma um status não definido na fonte.' });
    }
    if (hasAny(text, ['nao se aplica']) && hasAny(text, ['somente gestores autorizados', 'campos obrigatorios', 'comprovante'])) {
      findings.push({ code: 'contradictory_not_applicable', severity: 'high', message: 'O artefato usa “Não se aplica” em uma área relacionada a uma regra explícita.' });
    }
  }
  if (artifactType === 'qa_validation_cases') {
    // The visible QA document is localized. Run traceability checks against
    // the normalized text so "Critério" and "não executado" have the same
    // meaning as their ASCII contract forms.
    const normalizedQaText = normalize(text);
    const caseCount = (text.match(/^###\s*CT[-\s]*\d+\b/gim) || []).length;
    const criterionRefs = (normalizedQaText.match(/criterio\s+relacionado\s*:\s*(?:ca|dq)[-\s]*\d+/g) || []).length;
    if (!normalizedQaText.includes('cobertura dos criterios de aceite') || !normalizedQaText.includes('casos de validacao')) {
      findings.push({ code: 'missing_validation_structure', severity: 'critical', message: 'Casos de validação sem cobertura explícita dos critérios de aceite.' });
    }
    if (!caseCount || caseCount !== criterionRefs) {
      findings.push({ code: 'invalid_case_traceability', severity: 'critical', message: 'Todo caso de validação deve possuir um critério de aceite ou decisão de QA relacionada.' });
    }
    if (/#{3,6}\s+(?!CT[-\s]*\d+\b)/gi.test(text)) {
      findings.push({ code: 'invalid_case_field_heading', severity: 'critical', message: 'Um caso de QA contém um heading inesperado; regenere o Requirement Spec e os casos para evitar cenário anexado em campo.' });
    }
    if (!normalizedQaText.includes('status: nao executado')) {
      findings.push({ code: 'premature_execution_claim', severity: 'critical', message: 'O artefato de preparação não pode afirmar execução de testes.' });
    }
  }
  if (artifactType === 'test_plan') {
    const lower = normalize(text);
    if (storyAction === 'submit' && hasAny(text, ['anexar comprovante pdf', 'vincula o comprovante', 'arquivo fora dos formatos'])) {
      findings.push({ code: 'wrong_action_coverage', severity: 'critical', message: 'O QA cobre upload/anexo, mas a história trata de envio/submissão.' });
    }
    if (storyAction === 'upload' && hasAny(text, ['aciona o envio da solicitacao', 'fila de analise do gestor'])) {
      findings.push({ code: 'wrong_action_coverage', severity: 'critical', message: 'O QA cobre submissão, mas a história trata de upload/anexo.' });
    }
    if (!hasAny(text, ['criterios de aceite', 'ca-01', 'aceite'])) findings.push({ code: 'missing_traceability', severity: 'high', message: 'QA sem ligação explícita com critérios de aceite.' });
    if (hasAny(text, ['endpoint']) && !hasAny(requirementText, ['endpoint', 'post /', 'get /', 'put /', 'patch /', 'delete /'])) {
      findings.push({ code: 'invented_transport', severity: 'high', message: 'QA menciona endpoint sem contrato de transporte no requisito.' });
    }
    if (/(limite|maximo|minimo|255 caracteres|tamanho maximo)/i.test(lower) && !hasAny(requirementText, ['limite', 'maximo', 'minimo', 'tamanho'])) {
      findings.push({ code: 'invented_limit', severity: 'high', message: 'QA introduz limite não definido no requisito.' });
    }
    if (!hasAny(text, ['caminho feliz', 'excecao', 'cenarios de teste'])) findings.push({ code: 'missing_scenarios', severity: 'high', message: 'QA sem cenários de teste verificáveis.' });
  }

  const critical = findings.filter((item) => item.severity === 'critical').length;
  const high = findings.filter((item) => item.severity === 'high').length;
  const score = Math.max(0, Math.round(100 - critical * 30 - high * 15 - Math.max(0, findings.length - critical - high) * 5));
  return {
    decision: critical > 0 ? 'BLOCK' : findings.length ? 'REVISE' : 'PASS',
    score,
    threshold: 85,
    dimensions: {
      traceability: findings.some((item) => item.code === 'missing_traceability') ? 0 : 25,
      coverage: findings.some((item) => item.code === 'missing_scenarios' || item.code === 'wrong_action_coverage') ? 0 : 20,
      unsupportedContent: findings.some((item) => item.code.startsWith('invented') || item.code === 'unsupported_status') ? 0 : 25,
      testability: findings.some((item) => item.code === 'missing_scenarios') ? 0 : 15,
      coherence: findings.some((item) => item.code === 'wrong_action_coverage' || item.code === 'contradictory_not_applicable') ? 0 : 15,
    },
    findings,
  };
}

export function assertArtifactQuality(args) {
  const report = evaluateArtifactQuality(args);
  if (report.decision === 'BLOCK' || report.score < report.threshold) {
    const error = new Error(`Artefato bloqueado pelo Quality Gate (score ${report.score}/${report.threshold}): ${report.findings.map((item) => item.message).join(' ')}`);
    error.code = 'ARTIFACT_QUALITY_GATE_BLOCKED';
    error.qualityReport = report;
    throw error;
  }
  return report;
}
