function normalizeArtifactText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractArtifactSection(content = '', sectionTitle = '', nextSectionTitles = []) {
  const normalized = normalizeArtifactText(content);
  if (!normalized) return '';

  const title = escapeRegExp(normalizeArtifactText(sectionTitle));
  const nextPattern = nextSectionTitles.length
    ? `(?=\\n##+\\s+(?:${nextSectionTitles.map((item) => escapeRegExp(normalizeArtifactText(item))).join('|')})|$)`
    : '$';
  const match = normalized.match(new RegExp(`##+\\s+${title}\\s*([\\s\\S]*?)${nextPattern}`, 'i'));
  return (match?.[1] || '').trim();
}

function extractArtifactSectionWithAliases(content = '', sectionTitles = [], nextSectionTitles = []) {
  for (const sectionTitle of sectionTitles) {
    const section = extractArtifactSection(content, sectionTitle, nextSectionTitles);
    if (section) return section;
  }
  return '';
}

function hasAnySectionTitle(normalizedContent = '', aliases = []) {
  return aliases.some((alias) => normalizedContent.includes(normalizeArtifactText(alias)));
}

function countNumberedItems(section = '') {
  return (section.match(/(?:^|\n)\s*(?:[-*]\s+)?(?:ct\s*0*\d+|\d+[\.\)])/gi) || []).length;
}

function hasBrokenEnding(content = '') {
  const text = String(content || '').trimEnd();
  if (!text) return true;

  // A closing fence (```) and a closing bold marker (**) naturally appear at
  // the end of valid Markdown. The previous suffix-only rule rejected the
  // public requirements format because its status is intentionally bold.
  const codeFenceCount = (text.match(/```/g) || []).length;
  if (codeFenceCount % 2 !== 0) return true;

  const boldMarkerCount = (text.match(/\*\*/g) || []).length;
  if (boldMarkerCount % 2 !== 0) return true;

  const lastLine = text.split(/\r?\n/).pop().trim();
  return /^(?:[-*+]\s*|\d+[.)]\s*|\\)$/.test(lastLine);
}

function assertRequirementsCompleteness(content) {
  const normalized = normalizeArtifactText(content);

  if (!normalized) {
    throw new Error('O agente requirements_analyst retornou um artefato vazio.');
  }

  const legacyRequiredSections = [
    'user story refinada',
    'requisitos funcionais',
    'fluxo principal',
    'fluxos alternativos',
    'fluxos de excecao',
    'regras de negocio',
    'criterios de aceite',
  ];

  const publicRequiredSections = [
    'historia e objetivo',
    'comportamento e regras confirmadas',
    'cenarios de aceite',
    'decisoes pendentes',
    'status',
  ];

  const requiredSections = normalized.includes('requisito refinado')
    ? publicRequiredSections
    : legacyRequiredSections;
  for (const section of requiredSections) {
    if (!normalized.includes(section)) {
      throw new Error(`O artefato de requisitos foi retornado de forma incompleta: secao ausente (${section}).`);
    }
  }

  if (!normalized.includes('dado') || !normalized.includes('quando') || !normalized.includes('entao')) {
    throw new Error('O artefato de requisitos foi retornado sem criterios de aceite BDD completos.');
  }

  if (hasBrokenEnding(content)) {
    throw new Error('O agente requirements_analyst retornou um texto aparentemente truncado no final.');
  }
}

function assertLegacyQaCompleteness(content) {
  const normalized = normalizeArtifactText(content);

  if (!normalized) {
    throw new Error('O agente qa_engineer retornou um artefato vazio.');
  }

  const requiredSections = [
    ['Estrategia de testes', ['estrategia de testes', 'estrategia de teste', 'estrategia']],
    ['Dados de teste', ['dados de teste', 'dados testes']],
    ['Riscos e metricas', ['riscos e metricas', 'riscos e sinais', 'riscos', 'riscos e metricas operacionais']],
    ['Qualidade nao funcional', ['qualidade nao funcional', 'qualidade nao funcional e operacao', 'qualidade operacional', 'nfr']],
    [
      'Rastreabilidade dos Criterios de Aceite',
      [
        'rastreabilidade dos criterios de aceite',
        'rastreabilidade de criterios de aceite',
        'rastreabilidade criterios de aceite',
        'rastreabilidade dos criterios aceite',
        'rastreabilidade de criterios aceite',
        'traceabilidade dos criterios de aceite',
      ],
    ],
    ['Smoke Minimo da Feature', ['smoke minimo da feature', 'smoke minimo', 'smoke da feature', 'smoke feature']],
    ['Cenarios de teste', ['cenarios de teste', 'cenarios']],
    ['Casos de teste funcionais', ['casos de teste funcionais', 'casos funcionais', 'casos de teste']],
    ['Usabilidade e acessibilidade', ['usabilidade e acessibilidade', 'usabilidade', 'acessibilidade']],
  ];

  for (const [sectionName, aliases] of requiredSections) {
    if (!hasAnySectionTitle(normalized, aliases)) {
      throw new Error(`O plano de testes foi retornado de forma incompleta: secao ausente (${sectionName}).`);
    }
  }

  const functionalCasesSection = extractArtifactSection(content, 'Casos de teste funcionais', [
    'Usabilidade e acessibilidade',
    'Fim do plano de testes',
  ]);
  const numberedCases = countNumberedItems(functionalCasesSection);
  const hasCt01 = /ct\s*0*1/i.test(functionalCasesSection);
  const scenarioCount = (functionalCasesSection.match(/(?:^|\n)\s*(?:[-*]\s+)?cenario\s*0*\d+/gi) || []).length;
  const expectedResultCount = (functionalCasesSection.match(/resultado esperado/gi) || []).length;
  const hasStructuredFunctionalCases = (numberedCases >= 3 || scenarioCount >= 3) && expectedResultCount >= 3;

  const nonFunctionalSection = extractArtifactSection(content, 'Qualidade nao funcional', [
    'Cenarios de teste',
    'Casos de teste funcionais',
  ]);
  const nonFunctionalKeywords = [
    'performance',
    'seguranca',
    'confiabilidade',
    'observabilidade',
    'concorrencia',
    'recuperacao',
    'disponibilidade',
  ];
  const coveredNonFunctionalTopics = nonFunctionalKeywords.filter((keyword) => nonFunctionalSection.includes(keyword)).length;

  const traceabilitySection = extractArtifactSection(content, 'Rastreabilidade dos Criterios de Aceite', [
    'Smoke Minimo da Feature',
    'Cenarios de teste',
  ]);
  const traceabilitySectionAliases = extractArtifactSectionWithAliases(content, [
    'Rastreabilidade dos Criterios de Aceite',
    'Rastreabilidade de Criterios de Aceite',
    'Rastreabilidade dos Criterios Aceite',
    'Rastreabilidade de Criterios Aceite',
    'Traceabilidade dos Criterios de Aceite',
  ], [
    'Smoke Minimo da Feature',
    'Smoke Minimo',
    'Cenarios de teste',
  ]);
  const traceabilitySource = traceabilitySection || traceabilitySectionAliases;
  const traceabilityHits =
    (traceabilitySource.match(/ca[\s\-]*0*\d+\b|criterio|cenario|caso|ct\s*0*\d+/gi) || []).length;

  const smokeSection = extractArtifactSection(content, 'Smoke Minimo da Feature', [
    'Cenarios de teste',
    'Casos de teste funcionais',
  ]);
  const smokeBullets = (smokeSection.match(/(?:^|\n)\s*[-*]\s+/g) || []).length;
  const smokeSteps = Math.max(countNumberedItems(smokeSection), smokeBullets);

  if (!hasCt01 && !hasStructuredFunctionalCases) {
    throw new Error('O plano de testes foi retornado sem casos de teste funcionais completos.');
  }

  if (coveredNonFunctionalTopics < 3) {
    throw new Error('O plano de testes foi retornado com cobertura nao funcional insuficiente.');
  }

  if (traceabilityHits < 2) {
    throw new Error('O plano de testes foi retornado sem rastreabilidade suficiente dos criterios de aceite.');
  }

  if (smokeSteps < 2) {
    throw new Error('O plano de testes foi retornado sem um smoke minimo suficientemente detalhado.');
  }

  if (hasBrokenEnding(content)) {
    throw new Error('O agente qa_engineer retornou um texto aparentemente truncado no final.');
  }
}

// New QA contract: preparation cases tied to approved acceptance criteria.
// This intentionally replaces the legacy quota-based test-plan checker above.
function assertQaCompleteness(content) {
  const normalized = normalizeArtifactText(content);
  if (!normalized) throw new Error('O agente qa_engineer retornou um artefato vazio.');
  for (const section of ['casos de validacao', 'cobertura dos criterios de aceite', 'lacunas de qualidade', 'decisao de preparacao']) {
    if (!normalized.includes(section)) {
      throw new Error(`Os casos de validação foram retornados de forma incompleta: seção ausente (${section}).`);
    }
  }
  // JavaScript does not support Python's \Z anchor; there it matches a literal
  // "Z" and can truncate a case whose title contains that letter (for example,
  // "Validação"). Use an explicit end-of-input assertion instead.
  const cases = String(content).match(/^###\s*CT[-\s]*\d+\b[\s\S]*?(?=^###\s*CT[-\s]*\d+\b|^##\s+|(?![\s\S]))/gim) || [];
  if (!cases.length) throw new Error('Os casos de validação não possuem CT-xx.');
  const requiredFields = [
    { label: 'criterio relacionado:', aliases: ['criterio relacionado:', 'criterio de aceite:', 'criterio de aceite relacionado:', 'ca relacionado:'] },
    { label: 'pre-condicao:', aliases: ['pre-condicao:', 'precondicao:'] },
    { label: 'dados:', aliases: ['dados:', 'massa de dados:'] },
    { label: 'acao:', aliases: ['acao:', 'passos:', 'procedimento:'] },
    { label: 'resultado esperado:', aliases: ['resultado esperado:', 'resultado:', 'comportamento esperado:'] },
    { label: 'tipo:', aliases: ['tipo:'] },
    { label: 'status:', aliases: ['status:'] },
    { label: 'evidencia:', aliases: ['evidencia:'] },
  ];
  for (const item of cases) {
    const itemNormalized = normalizeArtifactText(item);
    for (const field of requiredFields) {
      const matchingAlias = field.aliases.find((alias) => {
        const aliasName = alias.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s*${aliasName}\\s*:`, 'im').test(itemNormalized);
      });
      if (!matchingAlias) throw new Error(`Caso de validação sem campo obrigatório (${field.label}).`);
      const fieldName = matchingAlias.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`^\\s*${fieldName}\\s*:\\s*\\S+`, 'im').test(itemNormalized)) {
        throw new Error(`Caso de validação possui campo obrigatório vazio (${field.label}).`);
      }
    }
    const action = itemNormalized.match(/^\s*acao\s*:\s*(.+)$/im)?.[1] || '';
    if (/\b(executar o comportamento|dados relacionados|aplicar a regra|selecionar dados)\b/i.test(action)) {
      throw new Error('Caso de validação possui ação genérica; descreva a interação observável.');
    }
    if (!itemNormalized.includes('status: nao executado')) {
      throw new Error('Casos de preparação devem permanecer como não executados.');
    }
  }
  if (!normalized.includes('fim_dos_casos_de_validacao') || hasBrokenEnding(content)) {
    throw new Error('O agente qa_engineer retornou casos de validação truncados.');
  }
}

function assertArchitectureCompleteness(content) {
  const normalized = normalizeArtifactText(content);

  if (!normalized) {
    throw new Error('O agente architect retornou um artefato vazio.');
  }

  const requiredSections = [
    'visao geral',
    'stack tecnologico',
    'modulos e responsabilidades',
    'diagrama de arquitetura',
    'estrutura de diretorios sugerida',
    'modelo de dados e entidades principais',
    'contratos e integracoes',
    'padroes de design',
    'observabilidade e operacao',
    'estrategia de deploy',
    'seguranca',
    'riscos tecnicos e trade-offs',
    'sequencia recomendada de implementacao',
  ];

  for (const section of requiredSections) {
    if (!normalized.includes(section)) {
      throw new Error(`O artefato de arquitetura foi retornado de forma incompleta: secao ausente (${section}).`);
    }
  }

  const observabilitySection = extractArtifactSection(content, 'Observabilidade e Operacao', [
    'Estrategia de Deploy',
    'Seguranca',
    'Riscos Tecnicos e Trade-offs',
  ]);
  const observabilityKeywords = ['log', 'metric', 'alert', 'monitor', 'health', 'dashboard', 'runbook'];
  const observabilityCoverage = observabilityKeywords.filter((keyword) => observabilitySection.includes(keyword)).length;
  const observabilitySteps = countNumberedItems(observabilitySection);

  const risksSection = extractArtifactSection(content, 'Riscos Tecnicos e Trade-offs', [
    'Sequencia Recomendada de Implementacao',
  ]);
  const risksKeywords = ['trade-off', 'risco', 'impacto', 'mitigacao', 'custo'];
  const risksCoverage = risksKeywords.filter((keyword) => risksSection.includes(keyword)).length;
  const risksSteps = countNumberedItems(risksSection);

  const sequenceSection = extractArtifactSection(content, 'Sequencia Recomendada de Implementacao', []);
  const sequenceSteps = countNumberedItems(sequenceSection);

  const contractsSection = extractArtifactSection(content, 'Contratos e Integracoes', [
    'Padroes de Design',
    'Observabilidade e Operacao',
  ]);
  const contractsCoverage = ['api', 'evento', 'integracao', 'contrato', 'payload'].filter((keyword) =>
    contractsSection.includes(keyword)
  ).length;

  if (observabilityCoverage < 3 && observabilitySteps < 2) {
    throw new Error('O artefato de arquitetura foi retornado sem profundidade suficiente em observabilidade e operacao.');
  }

  if (risksCoverage < 3 && risksSteps < 2) {
    throw new Error('O artefato de arquitetura foi retornado sem riscos tecnicos e trade-offs suficientes.');
  }

  if (sequenceSteps < 3) {
    throw new Error('O artefato de arquitetura foi retornado sem uma sequencia de implementacao suficientemente detalhada.');
  }

  if (contractsCoverage < 2) {
    throw new Error('O artefato de arquitetura foi retornado com contratos e integracoes pouco especificados.');
  }

  if (hasBrokenEnding(content)) {
    throw new Error('O agente architect retornou um texto aparentemente truncado no final.');
  }
}

export function assertArtifactCompleteness(agentName, content) {
  if (agentName === 'requirements_analyst') {
    assertRequirementsCompleteness(content);
    return;
  }

  if (agentName === 'qa_engineer') {
    assertQaCompleteness(content);
    return;
  }

  if (agentName === 'architect') {
    assertArchitectureCompleteness(content);
    return;
  }

  if (!String(content || '').trim()) {
    throw new Error(`O agente ${agentName} retornou um artefato vazio.`);
  }
}
