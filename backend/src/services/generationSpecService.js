import { buildPatternHints, resolveUiArchetype } from './uiArchetypeService.js';

function normalizeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function uniqueList(items = []) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function normalizeField(field = {}) {
  return {
    name: normalizeText(field.name, 'title'),
    label: normalizeText(field.label || field.name, 'Title'),
    inputType: normalizeText(field.inputType || field.type || 'text', 'text'),
    required: Boolean(field.required),
    options: Array.isArray(field.selectOptions)
      ? field.selectOptions.filter(Boolean)
      : Array.isArray(field.options)
        ? field.options.filter(Boolean)
        : [],
  };
}

function deriveEntityName(technicalSpec = {}) {
  return (
    technicalSpec.entityName ||
    technicalSpec.primaryEntity ||
    technicalSpec.backend?.entityName ||
    technicalSpec.shared?.entityName ||
    'GeneratedItem'
  );
}

function buildFrontendComponentMap({ pageArchetype, sections = [] } = {}) {
  const sectionSet = new Set((sections || []).filter(Boolean));

  if (pageArchetype === 'executive-dashboard') {
    return {
      recordsLead: 'insightStrip',
      highlights: 'insightCards',
    };
  }

  if (pageArchetype === 'operations-queue' || pageArchetype === 'review-queue') {
    return {
      recordsLead: 'queueRail',
      activity: sectionSet.has('activity') ? 'activityTimeline' : null,
    };
  }

  if (pageArchetype === 'approval-flow') {
    return {
      recordsLead: 'approvalSteps',
      summary: sectionSet.has('summary') ? 'settingsSnapshot' : null,
      activity: sectionSet.has('activity') ? 'activityTimeline' : null,
    };
  }

  if (pageArchetype === 'evidence-workbench') {
    return {
      recordsLead: 'evidenceRail',
    };
  }

  if (pageArchetype === 'settings-console') {
    return {
      summary: 'settingsSnapshot',
      activity: sectionSet.has('activity') ? 'activityTimeline' : null,
    };
  }

  if (pageArchetype === 'intake-form') {
    return {
      summary: 'settingsSnapshot',
    };
  }

  return {
    recordsLead: sectionSet.has('queue') ? 'queueRail' : sectionSet.has('steps') ? 'approvalSteps' : null,
    activity: sectionSet.has('activity') ? 'activityTimeline' : null,
    summary: sectionSet.has('summary') ? 'settingsSnapshot' : null,
  };
}

function buildBackendOperationMap({ pageArchetype, domainSignals = {}, fields = [] } = {}) {
  const fieldNames = new Set(fields.map((field) => field.name));
  const hasStatusField = ['status', 'approvalStatus', 'slaStatus'].some((name) => fieldNames.has(name));
  const hasAttachmentField = ['attachmentUrl', 'attachmentName', 'fileUrl', 'fileName', 'evidenceUrl'].some((name) =>
    fieldNames.has(name)
  );
  const hasApprovalField = ['approver', 'approvalStatus', 'decision', 'reviewDecision'].some((name) =>
    fieldNames.has(name)
  );
  const hasPriorityField = ['priority', 'severity', 'slaStatus'].some((name) => fieldNames.has(name));
  const hasSettingsField = ['enabled', 'notificationChannel', 'digestFrequency', 'accessScope'].some((name) =>
    fieldNames.has(name)
  );

  const operationMap = {
    list: pageArchetype === 'operations-queue' || pageArchetype === 'review-queue' ? 'paginatedQueue' : 'collectionRead',
    detail: 'detailRead',
    create: pageArchetype === 'intake-form' ? 'intakeCreate' : 'recordCreate',
    update: pageArchetype === 'settings-console' || hasSettingsField ? 'settingsUpdate' : 'recordUpdate',
    delete: pageArchetype === 'settings-console' || hasSettingsField ? 'archiveDisable' : 'recordDelete',
  };

  if (pageArchetype === 'approval-flow' || domainSignals.hasApproval || hasApprovalField) {
    operationMap.review = 'decisionAction';
  }

  if (pageArchetype === 'evidence-workbench' || domainSignals.hasAttachment || hasAttachmentField) {
    operationMap.attach = 'evidenceIngest';
  }

  if (
    pageArchetype === 'executive-dashboard' ||
    pageArchetype === 'operations-queue' ||
    pageArchetype === 'review-queue' ||
    pageArchetype === 'settings-console' ||
    domainSignals.hasAuditTrail ||
    hasApprovalField ||
    hasAttachmentField
  ) {
    operationMap.audit = 'timelineRead';
  }

  if (
    pageArchetype === 'operations-queue' ||
    pageArchetype === 'review-queue' ||
    domainSignals.hasPriority ||
    hasPriorityField
  ) {
    operationMap.prioritize = 'prioritySort';
  }

  if (hasStatusField || domainSignals.hasApproval || hasApprovalField || hasPriorityField) {
    operationMap.status = 'statusTransition';
  }

  return operationMap;
}

function inferOperationMethod(operationName) {
  switch (operationName) {
    case 'list':
    case 'detail':
    case 'audit':
      return 'GET';
    case 'create':
    case 'review':
    case 'attach':
      return 'POST';
    case 'update':
    case 'status':
    case 'prioritize':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
    default:
      return 'POST';
  }
}

function inferOperationPath(routeBase, operationName) {
  switch (operationName) {
    case 'list':
    case 'create':
      return routeBase;
    case 'detail':
    case 'update':
    case 'delete':
      return `${routeBase}/:id`;
    case 'status':
      return `${routeBase}/:id/status`;
    case 'review':
      return `${routeBase}/:id/review`;
    case 'attach':
      return `${routeBase}/:id/attachments`;
    case 'audit':
      return `${routeBase}/:id/audit`;
    case 'prioritize':
      return `${routeBase}/:id/prioritize`;
    default:
      return routeBase;
  }
}

function buildSectionBlueprint(sectionName, index, screenSpec = {}) {
  const normalized = normalizeText(sectionName, 'section').toLowerCase();
  const sectionTitle = normalizeText(sectionName, `Section ${index + 1}`);
  const intentByName = {
    hero: 'contextualizar a pagina e explicar o proximo passo',
    metrics: 'mostrar sinais rapidos de saude e progresso',
    filters: 'refinar a leitura e reduzir ruido visual',
    records: 'listar os registros principais do fluxo',
    list: 'listar os registros principais do fluxo',
    form: 'capturar ou ajustar os dados de entrada',
    summary: 'resumir o estado atual do contexto',
    activity: 'exibir historico e rastreabilidade',
    queue: 'priorizar e organizar o trabalho em andamento',
    steps: 'guiar a execucao em etapas',
    settings: 'configurar regras e parametros',
  };
  const intent = intentByName[normalized] || 'apoiar a experiencia principal da pagina';
  const isPrimary = index === 0;
  const isSecondary = index > 2;

  return {
    id: normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `section-${index + 1}`,
    name: sectionTitle,
    intent,
    priority: isPrimary ? 'high' : isSecondary ? 'low' : 'medium',
    content: [sectionTitle],
    primaryCTAs: isPrimary ? ['continuar'] : [],
    secondaryCTAs: isPrimary ? [] : ['ver detalhes'],
    states: {
      empty: `Nenhum conteudo disponivel em ${sectionTitle}.`,
      loading: `Carregando ${sectionTitle}...`,
      error: `Nao foi possivel carregar ${sectionTitle}.`,
      success: `${sectionTitle} carregado com sucesso.`,
    },
    visibilityRules: screenSpec.pageArchetype === 'settings-console' && normalized === 'records'
      ? ['mostrar quando houver registros configuraveis']
      : [],
  };
}

function buildJourneyBlueprints({ task, technicalSpec, productSpec, backlogContract = null, personas = [] } = {}) {
  const storyBlueprints = Array.isArray(backlogContract?.stories) && backlogContract.stories.length
    ? backlogContract.stories
    : [
        {
          id: 'journey_1',
          title: task?.title || productSpec?.productName || deriveEntityName(technicalSpec),
          description: productSpec?.positioning || technicalSpec.summary || task?.description || '',
        },
      ];

  const primaryPersonaId = personas[0]?.id || 'persona-primary';

  return storyBlueprints.slice(0, 5).map((story, index) => {
    const storyId = story.id || `story_${index + 1}`;
    const storyTitle = normalizeText(story.title, `Journey ${index + 1}`);
    const storyDescription = normalizeText(story.description, '');
    const acceptanceCriteria = Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length
      ? story.acceptanceCriteria.filter(Boolean)
      : [
          `A jornada ${storyTitle} pode ser executada sem ambiguidade.`,
          'O fluxo principal entrega feedback claro para o usuario.',
        ];

    return {
      id: `journey_${index + 1}`,
      title: storyTitle,
      personaId: primaryPersonaId,
      trigger: storyDescription || storyTitle,
      steps: [
        'Abrir o contexto do projeto',
        'Executar a acao principal',
        'Confirmar o resultado e registrar o estado final',
      ],
      successCriteria: [
        `A historia ${storyTitle} conclui sem inconsistencias.`,
        'O usuario recebe retorno claro na interface.',
      ],
      failureModes: [
        'Campos obrigatorios ausentes',
        'Validacao de negocio impede a operacao',
        'Falha de API ou permissao bloqueia o fluxo',
      ],
      edgeCases: [
        'Dados duplicados',
        'Registro vazio ou incompleto',
        'Estado intermediario de processamento',
      ],
      primaryCTA: technicalSpec.domain?.submitLabel || 'Confirmar',
      acceptanceCriteria,
      relatedStoryIds: [storyId],
    };
  });
}

function buildTraceabilityEntries({ backlogStories = [], journeys = [], screenSpec = {}, moduleSpec = {} } = {}) {
  const firstJourneyId = journeys[0]?.id || null;
  return backlogStories.slice(0, 10).map((story, index) => ({
    acceptanceCriterion:
      Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length
        ? story.acceptanceCriteria[0]
        : `A historia ${story.title} deve ser executada com feedback claro.`,
    storyId: story.id || `story_${index + 1}`,
    testId: `test_${index + 1}`,
    uiSectionId: screenSpec.sections?.[0]?.id || null,
    apiOperation: moduleSpec.operationMap?.create || moduleSpec.operationMap?.update || 'recordCreate',
    journeyId: firstJourneyId,
  }));
}

function buildSpecV2({ project = null, technicalSpec = {}, task = null, productSpec = {}, frontend = {}, backend = {} } = {}) {
  const screenSpec = frontend.screenSpec || {};
  const moduleSpec = backend.moduleSpec || {};
  const backlogContract = project?.intakeConfig?.backlogContract || technicalSpec.backlogContract || null;
  const objective = technicalSpec.implementationObjective || {};
  const projectName = project?.name || productSpec.productName || technicalSpec.projectName || deriveEntityName(technicalSpec);
  const summary =
    normalizeText(project?.vision || project?.description || technicalSpec.summary || productSpec.positioning || '') ||
    projectName;
  const problemStatement =
    normalizeText(project?.description || technicalSpec.summary || productSpec.positioning || '') ||
    `Problema do produto ${projectName} ainda nao explicitado.`;

  const backlogStories = Array.isArray(backlogContract?.stories)
    ? backlogContract.stories.map((story, index) => ({
        id: story.id || `story_${index + 1}`,
        title: normalizeText(story.title, `Story ${index + 1}`),
        description: normalizeText(story.description, ''),
        personaId: story.personaId || null,
        journeyId: story.journeyId || null,
        priority: story.priority || 'medium',
        acceptanceCriteria: Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria.filter(Boolean) : [],
        businessRules: Array.isArray(story.businessRules) ? story.businessRules.filter(Boolean) : [],
        testScenarios: Array.isArray(story.testScenarios) ? story.testScenarios.filter(Boolean) : [],
        tags: Array.isArray(story.tags) ? story.tags.filter(Boolean) : [],
      }))
    : [];

  if (!backlogStories.length) {
    backlogStories.push({
      id: 'story_1',
      title: task?.title || productSpec.productName || `Como ${technicalSpec.ux?.permissions?.actor || 'usuario'}, eu quero executar o fluxo principal, para validar a primeira versao do produto.`,
      description: normalizeText(productSpec.positioning || technicalSpec.summary || '', ''),
      personaId: 'persona_1',
      journeyId: 'journey_1',
      priority: 'high',
      acceptanceCriteria: [
        'A primeira versao do produto precisa estar clara e executavel.',
      ],
      businessRules: uniqueList([
        ...(Array.isArray(technicalSpec.businessRules) ? technicalSpec.businessRules : []),
      ]),
      testScenarios: [
        'Fluxo principal com dados validos',
        'Fluxo principal com dados invalidos',
      ],
      tags: ['fallback', 'spec-v2'],
    });
  }

  const personas = uniqueList([
    technicalSpec.ux?.permissions?.actor,
    technicalSpec.ux?.permissions?.owner,
    technicalSpec.ux?.permissions?.reviewer,
    technicalSpec.ux?.permissions?.auditor,
  ]).map((name, index) => ({
    id: `persona_${index + 1}`,
    name,
    role:
      index === 0 ? 'primary-actor' : index === 1 ? 'owner' : index === 2 ? 'reviewer' : 'auditor',
    responsibilities: [
      index === 0 ? 'Executar o fluxo principal do produto.' : 'Acompanhar e validar o fluxo do produto.',
      'Contribuir com a evolucao do backlog.',
    ],
    permissions: [
      index === 0 ? 'create' : 'view',
      index === 1 ? 'edit' : 'review',
    ],
    painPoints: [
      'Contexto disperso entre telas e contratos.',
      'Falta de rastreabilidade entre historias e execucao.',
    ],
    primaryJourneys: [],
  }));

  if (!personas.length) {
    personas.push({
      id: 'persona_1',
      name: technicalSpec.ux?.permissions?.actor || 'usuario principal',
      role: 'primary-actor',
      responsibilities: ['Executar o fluxo principal do produto.'],
      permissions: ['create', 'view'],
      painPoints: ['Contexto disperso entre telas e contratos.'],
      primaryJourneys: [],
    });
  }

  const journeys = buildJourneyBlueprints({
    task,
    technicalSpec,
    productSpec,
    backlogContract,
    personas,
  });
  const primaryJourneyIds = journeys.slice(0, 3).map((journey) => journey.id);
  personas.forEach((persona, index) => {
    persona.primaryJourneys = primaryJourneyIds.slice(index, index + 2);
  });

  const inScope = uniqueList([
    ...(Array.isArray(backlogContract?.capabilities) ? backlogContract.capabilities.map((item) => item?.name || '').filter(Boolean) : []),
    ...(Array.isArray(backlogContract?.epics) ? backlogContract.epics.map((item) => item?.name || '').filter(Boolean) : []),
    productSpec.capabilities?.[0],
    productSpec.archetype?.pageArchetype,
    screenSpec.pageArchetype,
  ]);

  const outOfScope = uniqueList([
    ...(Array.isArray(objective.nonGoals) ? objective.nonGoals : []),
    ...(Array.isArray(technicalSpec.nonGoals) ? technicalSpec.nonGoals : []),
  ]);

  const assumptions = uniqueList([
    project?.status ? `O projeto esta em status ${project.status}.` : null,
    screenSpec.route ? `A experiencia principal navega por ${screenSpec.route}.` : null,
    moduleSpec.routeBase ? `A API principal responde em ${moduleSpec.routeBase}.` : null,
    backlogContract?.stories?.length ? 'Existe backlog inicial para rastrear a evolucao do produto.' : 'O backlog pode ser refinado antes da execucao final.',
  ]);

  const dependencies = uniqueList([
    technicalSpec.shared?.contractPath ? `Contrato compartilhado em ${technicalSpec.shared.contractPath}.` : null,
    moduleSpec.routeBase ? `Backend base em ${moduleSpec.routeBase}.` : null,
    screenSpec.route ? `Frontend base em ${screenSpec.route}.` : null,
    project?.templateKey ? `Template do projeto: ${project.templateKey}.` : null,
  ]);

  const risks = [
    {
      id: 'contract_drift',
      label: 'Risco de divergencia entre backlog, UI e API.',
      severity: backlogContract?.stories?.length ? 'medium' : 'high',
      mitigation: 'Manter rastreabilidade em spec, testes e contratos de superficie.',
    },
  ];

  if (!backlogContract?.stories?.length) {
    risks.push({
      id: 'missing_backlog_contract',
      label: 'Backlog ainda sem contrato estruturado.',
      severity: 'high',
      mitigation: 'Gerar ou importar o backlog antes de validar a implementacao final.',
    });
  }

  if (!Array.isArray(screenSpec.sections) || screenSpec.sections.length < 3) {
    risks.push({
      id: 'ui_sections_sparse',
      label: 'Spec de UI com poucas secoes semanticas.',
      severity: 'medium',
      mitigation: 'Enriquecer sections com intencao, CTAs e estados de interface.',
    });
  }

  const domainFieldNames = (technicalSpec.domain?.fields || []).map((field) => field.name).filter(Boolean);
  const stateFieldNames = domainFieldNames.filter((name) => /status|state|approval/i.test(name));
  const domainStates =
    uniqueList([
      ...(Array.isArray(technicalSpec.domain?.states) ? technicalSpec.domain.states : []),
      ...(stateFieldNames.length ? stateFieldNames : []),
      ...(Array.isArray(technicalSpec.ux?.states) ? Object.keys(technicalSpec.ux.states) : []),
    ]).slice(0, 6);

  const fields = (technicalSpec.domain?.fields || []).map(normalizeField);
  const entityName = deriveEntityName(technicalSpec);
  const entities = [
    {
      name: entityName,
      description: summary,
      fields,
      relationships: Array.isArray(technicalSpec.domain?.relationships)
        ? technicalSpec.domain.relationships.map((relationship) => ({
            target: normalizeText(relationship.target || relationship.entity || '', ''),
            type: normalizeText(relationship.type || 'one-to-many', 'one-to-many'),
            cardinality: normalizeText(relationship.cardinality || '', ''),
            description: normalizeText(relationship.description || '', ''),
          }))
        : [],
      states: domainStates,
      invariants: uniqueList([
        ...(Array.isArray(technicalSpec.businessRules) ? technicalSpec.businessRules : []),
        'Os dados principais precisam permanecer consistentes entre UI, API e persistencia.',
      ]),
      businessRules: uniqueList([
        ...(Array.isArray(technicalSpec.businessRules) ? technicalSpec.businessRules : []),
        ...(Array.isArray(objective.nonGoals) ? objective.nonGoals : []),
      ]),
    },
  ];

  const screenSections = (screenSpec.sections || []).map((sectionName, index) =>
    buildSectionBlueprint(sectionName, index, screenSpec)
  );

  const operations = uniqueList(Object.keys(moduleSpec.operationMap || {})).map((operationName) => {
    const method = inferOperationMethod(operationName);
    return {
      name: operationName,
      method,
      path: inferOperationPath(moduleSpec.routeBase || '/api/v1/items', operationName),
      requestSchema: moduleSpec.contracts?.request || null,
      responseSchema: moduleSpec.contracts?.response || null,
      statusCodes:
        operationName === 'delete'
          ? ['204', '404', '403']
          : operationName === 'create'
            ? ['201', '400', '409']
            : ['200', '400', '403', '404'],
      permissions: operationName === 'delete' ? ['owner', 'manager'] : ['editor', 'manager', 'owner'],
      sideEffects:
        operationName === 'create'
          ? ['persist record', 'emit audit event']
          : operationName === 'update'
            ? ['persist update', 'refresh derived state']
            : operationName === 'status'
              ? ['transition state', 'emit audit event']
              : [],
    };
  });

  const traceability = buildTraceabilityEntries({
    backlogStories,
    journeys,
    screenSpec: { sections: screenSections },
    moduleSpec,
  });

  const testPlan = journeys.map((journey, index) => ({
    id: `test_${index + 1}`,
    title: `Validar ${journey.title}`,
    journeyId: journey.id,
    storyId: journey.relatedStoryIds?.[0] || null,
    type: index === 0 ? 'happy-path' : 'regression',
    steps: journey.steps,
    expectedResult: journey.successCriteria.join(' '),
    automationHint: 'Cobrir fluxo feliz e bloqueios de validacao.',
  }));

  const nfrs = uniqueList([
    'typed-contracts',
    'schema-validation',
    'generated-tests',
    'runtime-observability',
    'audit-trail-for-critical-actions',
  ]).map((requirement, index) => ({
    id: `nfr_${index + 1}`,
    category:
      index === 0
        ? 'security'
        : index === 1
          ? 'reliability'
          : index === 2
            ? 'testability'
            : index === 3
              ? 'observability'
              : 'audibility',
    requirement,
    metric:
      index === 0
        ? 'contract coverage'
        : index === 1
          ? 'schema coverage'
          : index === 2
            ? 'test coverage'
            : index === 3
              ? 'telemetry coverage'
              : 'audit coverage',
    target:
      index === 0
        ? '100%'
        : index === 1
          ? '100%'
          : index === 2
            ? '100%'
            : index === 3
              ? '100%'
              : '100%',
  }));

  const auditEvents = uniqueList([
    'briefing_started',
    'briefing_completed',
    'story_generated',
    'story_updated',
    'api_operation_executed',
    'spec_v2_materialized',
  ]).map((name) => ({
    name,
    description:
      name === 'briefing_started'
        ? 'Registro quando o briefing entra em execucao.'
        : name === 'briefing_completed'
          ? 'Registro quando o briefing finaliza com resultado legivel.'
          : name === 'story_generated'
            ? 'Registro de novas stories geradas pelo PM Agent.'
            : name === 'story_updated'
              ? 'Registro de edicao de story pelo usuario.'
              : name === 'api_operation_executed'
                ? 'Registro de operacoes sensiveis da API.'
                : 'Registro de materializacao da spec V2.',
    actor:
      name === 'story_updated'
        ? 'usuario'
        : name === 'api_operation_executed'
          ? 'sistema'
          : 'agent',
    payloadFields: name === 'story_generated' || name === 'story_updated' ? ['storyId', 'title', 'description'] : ['projectUuid'],
  }));

  const telemetry = uniqueList([
    'briefing_generation_duration',
    'backlog_parsing_success',
    'spec_v2_traceability_coverage',
    'ui_section_render_coverage',
  ]).map((name) => ({
    name,
    description:
      name === 'briefing_generation_duration'
        ? 'Tempo total da geracao do briefing.'
        : name === 'backlog_parsing_success'
          ? 'Sucesso na importacao e parse do backlog em stories.'
          : name === 'spec_v2_traceability_coverage'
            ? 'Cobertura de rastreabilidade entre story, teste, UI e API.'
            : 'Cobertura das secoes da UI derivadas da spec.',
    successSignal: 'fluxo concluido com dados persistidos',
    failureSignal: 'contrato ou parse incompleto',
  }));

  return {
    specVersion: '2.0',
    project: {
      uuid: project?.uuid || null,
      name: projectName,
      slug: project?.slug || null,
      summary,
      problemStatement,
      goals: uniqueList([
        objective.primaryGoal,
        objective.userOutcome,
        ...(Array.isArray(objective.successDefinition) ? objective.successDefinition : []),
        productSpec.capabilities?.[0] ? `Entregar ${productSpec.capabilities[0]}` : null,
      ]).slice(0, 6),
      inScope,
      outOfScope,
      assumptions,
      dependencies,
      risks,
    },
    personas,
    domainModel: {
      entities,
    },
    journeys,
    backlog: {
      stories: backlogStories,
      epics: Array.isArray(backlogContract?.epics)
        ? backlogContract.epics.map((epic, index) => ({
            id: epic.id || `epic_${index + 1}`,
            title: normalizeText(epic.name || epic.title, `Epic ${index + 1}`),
            scope: normalizeText(epic.scope || epic.description || '', ''),
            storyIds: Array.isArray(epic.storyIds) ? epic.storyIds.filter(Boolean) : [],
          }))
        : [],
      releaseSlices: Array.isArray(backlogContract?.releaseSlices)
        ? backlogContract.releaseSlices.map((slice, index) => ({
            id: slice.id || `release_${index + 1}`,
            name: normalizeText(slice.name || slice.title, `Release ${index + 1}`),
            goal: normalizeText(slice.goal || slice.description || '', ''),
            inclusions: Array.isArray(slice.inclusions) ? slice.inclusions.filter(Boolean) : [],
            exclusions: Array.isArray(slice.exclusions) ? slice.exclusions.filter(Boolean) : [],
          }))
        : [],
    },
    ui: {
      screenSpec: {
        ...screenSpec,
        sections: screenSections,
      },
    },
    api: {
      moduleSpec: {
        ...moduleSpec,
        operations,
      },
    },
    qa: {
      testPlan,
      traceability,
    },
    nfrs,
    observability: {
      auditEvents,
      telemetry,
    },
    changeLog: [
      {
        version: '2.0',
        date: new Date().toISOString(),
        summary: 'Spec v2 materializada a partir do generationIR legado.',
      },
    ],
  };
}

export function buildProductSpec({ project = null, technicalSpec = {}, domainTemplate = null, task = null } = {}) {
  const fields = (technicalSpec.domain?.fields || []).map(normalizeField);
  const entityName = deriveEntityName(technicalSpec);
  const screenTemplate =
    technicalSpec.architecture?.screenTemplate ||
    technicalSpec.structured?.classification?.screenTemplate ||
    'crud';
  const productMode =
    technicalSpec.frontend?.productMode ||
    technicalSpec.structured?.classification?.productMode ||
    domainTemplate?.productMode ||
    'structured-workspace';
  const uiIntent =
    technicalSpec.structured?.classification?.intent ||
    technicalSpec.uiIntent ||
    'custom';
  const archetype = resolveUiArchetype({ technicalSpec, task, screenTemplate, productMode, uiIntent });

  return {
    version: 1,
    projectTemplateKey:
      technicalSpec.projectTemplateKey ||
      project?.templateKey ||
      project?.intakeConfig?.projectTemplateKey ||
      null,
    productName: project?.name || technicalSpec.projectName || entityName,
    positioning: project?.vision || technicalSpec.summary || project?.description || '',
    domain: domainTemplate?.templateKey || technicalSpec.featureKey || 'custom-domain',
    personas: uniqueList([
      technicalSpec.ux?.permissions?.actor,
      technicalSpec.ux?.permissions?.owner,
      technicalSpec.ux?.permissions?.reviewer,
    ]),
    entities: [
      {
        name: entityName,
        fields,
      },
    ],
    capabilities: uniqueList([
      technicalSpec.featureKey,
      screenTemplate,
      uiIntent,
      archetype.pageArchetype,
      ...buildPatternHints(archetype),
    ]),
    archetype: {
      pageArchetype: archetype.pageArchetype,
      fallbackPattern: archetype.fallbackPattern,
      confidenceScore: archetype.confidenceScore,
      alternativeArchetypes: archetype.alternativeArchetypes,
      domainSignals: archetype.domainSignals,
    },
    journeys: [
      {
        taskTitle: task?.title || technicalSpec.featureName || entityName,
        route: technicalSpec.frontend?.suggestedRoute || null,
        screenTemplate,
        productMode,
        uiIntent,
        pageArchetype: archetype.pageArchetype,
        archetypeConfidence: archetype.confidenceScore,
      },
    ],
    permissions: technicalSpec.ux?.permissions || {},
    nonFunctionalRequirements: uniqueList([
      'typed-contracts',
      'schema-validation',
      'generated-tests',
      'runtime-observability',
    ]),
  };
}

export function buildFrontendScreenSpec({ technicalSpec = {}, task = null, domainTemplate = null } = {}) {
  const fields = (technicalSpec.domain?.fields || []).map(normalizeField);
  const screenTemplate =
    technicalSpec.architecture?.screenTemplate ||
    technicalSpec.structured?.classification?.screenTemplate ||
    'crud';
  const productMode =
    technicalSpec.frontend?.productMode ||
    technicalSpec.structured?.classification?.productMode ||
    domainTemplate?.productMode ||
    'structured-workspace';
  const uiIntent =
    technicalSpec.structured?.classification?.intent ||
    technicalSpec.uiIntent ||
    'custom';
  const archetype = resolveUiArchetype({ technicalSpec, task, screenTemplate, productMode, uiIntent });

  const sectionsByTemplate = {
    settings: ['hero', 'form', 'summary', 'activity'],
    dashboard: ['hero', 'metrics', 'filters', 'records'],
    workspace: ['hero', 'queue', 'form', 'records'],
    wizard: ['hero', 'steps', 'form', 'summary'],
    crud: ['hero', 'filters', 'list', 'form'],
  };
  const sections = archetype.recommendedSections || sectionsByTemplate[screenTemplate] || sectionsByTemplate.crud;

  return {
    version: 1,
    route: technicalSpec.frontend?.suggestedRoute || null,
    navigationLabel: technicalSpec.frontend?.navigationLabel || task?.title || deriveEntityName(technicalSpec),
    pageTitle: technicalSpec.frontend?.pageTitle || task?.title || deriveEntityName(technicalSpec),
    screenTemplate,
    productMode,
    uiIntent,
    pageArchetype: archetype.pageArchetype,
    fallbackPattern: archetype.fallbackPattern,
    confidenceScore: archetype.confidenceScore,
    alternativeArchetypes: archetype.alternativeArchetypes,
    domainSignals: archetype.domainSignals,
    layoutVariant: technicalSpec.frontend?.layoutVariant || technicalSpec.structured?.classification?.layoutVariant || null,
    sections,
    componentMap: buildFrontendComponentMap({
      pageArchetype: archetype.pageArchetype,
      sections,
    }),
    dataSources: uniqueList([
      technicalSpec.backend?.routeBase,
      technicalSpec.shared?.listContractName,
      technicalSpec.shared?.responseContractName,
    ]),
    fields: fields.map((field) => ({
      name: field.name,
      label: field.label,
      inputType: field.inputType,
      required: field.required,
    })),
    states: uniqueList([
      'loading',
      'empty',
      'error',
      'success',
      ...(technicalSpec.ux?.states ? Object.keys(technicalSpec.ux.states) : []),
    ]),
    patternHints: buildPatternHints(archetype),
  };
}

export function buildFrontendDataSpec({ technicalSpec = {} } = {}) {
  const routeBase = technicalSpec.backend?.routeBase || '/api/v1/items';
  const entityName = deriveEntityName(technicalSpec);

  return {
    queryClient: 'tanstack-query',
    queries: [
      {
        key: [`${entityName.toLowerCase()}-list`],
        method: 'GET',
        path: routeBase,
        purpose: 'list',
      },
    ],
    mutations: [
      {
        key: `${entityName.toLowerCase()}-create`,
        method: 'POST',
        path: routeBase,
        purpose: 'create',
      },
    ],
    formLibrary: 'react-hook-form',
    schemaLibrary: 'zod',
  };
}

export function buildBackendModuleSpec({ technicalSpec = {}, task = null } = {}) {
  const entityName = deriveEntityName(technicalSpec);
  const routeBase = technicalSpec.backend?.routeBase || `/api/v1/${entityName.toLowerCase()}s`;
  const fields = (technicalSpec.domain?.fields || []).map(normalizeField);
  const screenTemplate =
    technicalSpec.architecture?.screenTemplate ||
    technicalSpec.structured?.classification?.screenTemplate ||
    'crud';
  const productMode =
    technicalSpec.frontend?.productMode ||
    technicalSpec.structured?.classification?.productMode ||
    'structured-workspace';
  const uiIntent =
    technicalSpec.structured?.classification?.intent ||
    technicalSpec.uiIntent ||
    'custom';
  const archetype = resolveUiArchetype({ technicalSpec, task, screenTemplate, productMode, uiIntent });
  const operationMap = buildBackendOperationMap({
    pageArchetype: archetype.pageArchetype,
    domainSignals: archetype.domainSignals,
    fields,
  });

  return {
    version: 1,
    entityName,
    routeBase,
    moduleName: technicalSpec.featureKey || entityName.toLowerCase(),
    files: [
      'router.ts',
      'controller.ts',
      'service.ts',
      'repository.ts',
      'schema.ts',
      'mapper.ts',
      'seed.ts',
      `${entityName.toLowerCase()}.test.ts`,
    ],
    contracts: {
      request: technicalSpec.shared?.requestContractName || `${entityName}Request`,
      response: technicalSpec.shared?.responseContractName || `${entityName}Response`,
      list: technicalSpec.shared?.listContractName || `${entityName}ListResponse`,
    },
    pageArchetype: archetype.pageArchetype,
    domainSignals: archetype.domainSignals,
    validationLibrary: 'zod',
    testLibrary: 'vitest-supertest',
    logger: 'pino',
    operationMap,
    operations: uniqueList(['list', 'detail', 'create', 'update', 'delete', ...Object.keys(operationMap)]),
    fields: fields.map((field) => ({
      name: field.name,
      required: field.required,
      inputType: field.inputType,
    })),
    taskTitle: task?.title || null,
  };
}

export function createGenerationIR({ project = null, technicalSpec = {}, domainTemplate = null, task = null } = {}) {
  const productSpec = buildProductSpec({ project, technicalSpec, domainTemplate, task });
  const frontend = {
    screenSpec: buildFrontendScreenSpec({ technicalSpec, task, domainTemplate }),
    dataSpec: buildFrontendDataSpec({ technicalSpec }),
    componentPattern: 'react-typescript-vite',
  };
  const backend = {
    moduleSpec: buildBackendModuleSpec({ technicalSpec, task }),
    apiStyle: 'express-typescript-prisma',
  };
  const specV2 = buildSpecV2({ project, technicalSpec, task, productSpec, frontend, backend });

  return {
    version: 1,
    productSpec,
    frontend,
    backend,
    specV2,
  };
}

export function validateGenerationIR(generationIR = {}) {
  const issues = [];
  const screenSpec = generationIR?.frontend?.screenSpec || {};
  const moduleSpec = generationIR?.backend?.moduleSpec || {};
  const specV2 = generationIR?.specV2 || {};

  if (!generationIR?.version) issues.push('generationIR sem version.');
  if (!generationIR?.productSpec?.productName) issues.push('productSpec sem productName.');
  if (!screenSpec.route) issues.push('frontend.screenSpec sem route.');
  if (!screenSpec.screenTemplate) issues.push('frontend.screenSpec sem screenTemplate.');
  if (!Array.isArray(screenSpec.sections) || !screenSpec.sections.length) {
    issues.push('frontend.screenSpec sem sections.');
  }
  if (!moduleSpec.routeBase) issues.push('backend.moduleSpec sem routeBase.');
  if (!Array.isArray(moduleSpec.files) || !moduleSpec.files.length) {
    issues.push('backend.moduleSpec sem files.');
  }
  if (!moduleSpec.operationMap || !Object.keys(moduleSpec.operationMap).length) {
    issues.push('backend.moduleSpec sem operationMap.');
  }
  if (!specV2?.specVersion) issues.push('specV2 sem specVersion.');
  if (!specV2?.project?.name) issues.push('specV2.project sem name.');
  if (!specV2?.ui?.screenSpec?.sections?.length) issues.push('specV2.ui.screenSpec sem sections.');
  if (!specV2?.api?.moduleSpec?.operations?.length) issues.push('specV2.api.moduleSpec sem operations.');
  if (!specV2?.qa?.testPlan?.length) issues.push('specV2.qa sem testPlan.');

  return {
    valid: issues.length === 0,
    issues,
  };
}
