/**
 * Mapeador de Campos para Criação de Projeto no Aligna
 * Converte dados do formulário em estrutura enriquecida para o projeto
 */

export class ProjectFieldMapper {
  /**
   * Extrai dados do formulário de novo projeto
   * @param {Object} formData - Dados do formulário
   * @returns {Object} Dados estruturados para criar o projeto
   */
  static mapFormDataToProject(formData) {
    const { name, description, vision } = formData;

    return {
      // Dados básicos do projeto
      basic: {
        name: this.extractProjectName(name),
        shortDescription: this.normalizeDescription(description),
        fullVision: this.normalizeVision(vision),
      },

      // Metadados extraídos da visão
      metadata: this.extractMetadataFromVision(vision),

      // Estrutura enriquecida
      enriched: this.enrichProjectData({
        name,
        description,
        vision,
      }),

      // Checklist de inicialização
      initializationChecklist: this.generateInitializationChecklist({
        name,
        description,
        vision,
      }),
    };
  }

  /**
   * Extrai o nome do projeto garantindo que seja válido
   */
  static extractProjectName(name) {
    return (name || '').trim().slice(0, 255);
  }

  /**
   * Normaliza a descrição (resumo curto)
   */
  static normalizeDescription(description) {
    return (description || '')
      .trim()
      .slice(0, 500)
      .replace(/\s+/g, ' '); // Remove espaços extras
  }

  /**
   * Normaliza a visão do produto
   */
  static normalizeVision(vision) {
    return (vision || '')
      .trim()
      .slice(0, 2000)
      .replace(/\s+/g, ' ');
  }

  /**
   * Extrai metadados da visão do produto
   * Tenta identificar: objetivo, público-alvo, resultado esperado
   */
  static extractMetadataFromVision(vision) {
    const normalizedVision = (vision || '').toLowerCase();

    return {
      primaryObjective: this.extractPrimaryObjective(vision),
      targetAudience: this.extractTargetAudience(vision),
      expectedOutcome: this.extractExpectedOutcome(vision),
      keywords: this.extractKeywords(vision),
    };
  }

  /**
   * Extrai o objetivo principal da visão
   */
  static extractPrimaryObjective(vision) {
    if (!vision) return null;

    // Procura por padrões como "objetivo:", "objetivo é:", "principal:"
    const patterns = [
      /objetivo\s*(?:principal|é)?:?\s*([^.!?,;]+)/i,
      /o que\s*(?:é|for)?\s*([^.!?,;]+)/i,
      /^([^.!?,]+)/,
    ];

    for (const pattern of patterns) {
      const match = vision.match(pattern);
      if (match && match[1]) {
        return match[1].trim().slice(0, 200);
      }
    }

    return null;
  }

  /**
   * Extrai o público-alvo da visão
   */
  static extractTargetAudience(vision) {
    if (!vision) return null;

    const patterns = [
      /(?:público|público-alvo|destinado|para)\s*(?:é|alvo)?:?\s*([^.!?,;]+)/i,
      /(?:usuários?|clientes?|pessoas?)\s+(?:que|com)\s+([^.!?,;]+)/i,
    ];

    for (const pattern of patterns) {
      const match = vision.match(pattern);
      if (match && match[1]) {
        return match[1].trim().slice(0, 200);
      }
    }

    return null;
  }

  /**
   * Extrai o resultado esperado da visão
   */
  static extractExpectedOutcome(vision) {
    if (!vision) return null;

    const patterns = [
      /resultado\s*(?:esperado|é)?:?\s*([^.!?,;]+)/i,
      /esperado\s*(?:é)?:?\s*([^.!?,;]+)/i,
      /(?:espera-?se|objetivo).+?(?:é|ser)\s+([^.!?,;]+)/i,
    ];

    for (const pattern of patterns) {
      const match = vision.match(pattern);
      if (match && match[1]) {
        return match[1].trim().slice(0, 200);
      }
    }

    return null;
  }

  /**
   * Extrai palavras-chave da visão
   */
  static extractKeywords(vision) {
    if (!vision) return [];

    const stopWords = [
      'o', 'a', 'um', 'uma', 'de', 'da', 'do', 'e', 'ou', 'para', 'com', 'sem',
      'por', 'em', 'é', 'são', 'foi', 'foram', 'ser', 'está', 'estão', 'tem', 'têm',
      'esse', 'essa', 'este', 'esta', 'qual', 'quais', 'que', 'já', 'mas', 'como',
    ];

    const words = vision
      .toLowerCase()
      .replace(/[.,!?;:()]/g, '')
      .split(/\s+/)
      .filter(
        word =>
          word.length > 4 &&
          !stopWords.includes(word) &&
          !/^\d+$/.test(word)
      )
      .slice(0, 10);

    return [...new Set(words)]; // Remove duplicatas
  }

  /**
   * Enriquece os dados do projeto com estrutura padronizada
   */
  static enrichProjectData({ name, description, vision }) {
    const now = new Date().toISOString();

    return {
      // Identidade do projeto
      identity: {
        title: name.trim(),
        tagline: description.trim(),
        fullDescription: vision.trim(),
      },

      // Estrutura de fases
      phases: this.generateDefaultPhases(),

      // Questões de discovery
      discovery: {
        businessObjective: 'Define qual é o principal objetivo do negócio',
        targetUsers: 'Descreva quem são os usuários alvo',
        successCriteria: 'Como você medirá o sucesso?',
        constraints: 'Quais são as restrições (tempo, orçamento, tecnologia)?',
        dependencies: 'Existem dependências externas?',
      },

      // Estrutura de equipe recomendada
      recommendedTeam: this.generateRecommendedTeam(vision),

      // Timeline inicial
      timeline: {
        createdAt: now,
        phase1StartDate: null,
        phase2StartDate: null,
        plannedCompletion: null,
      },

      // Riscos identificados
      risks: this.identifyRisks(name, description, vision),
    };
  }

  /**
   * Gera as fases padrão do projeto
   */
  static generateDefaultPhases() {
    return [
      {
        number: 1,
        name: 'Discovery & Planning',
        description: 'Entendimento de requisitos, definição de escopo',
        estimatedDuration: '2-3 semanas',
        keyActivities: [
          'Reunião de kick-off',
          'Coleta de requisitos',
          'Definição de escopo',
          'Planejamento detalhado',
        ],
      },
      {
        number: 2,
        name: 'Design & Architecture',
        description: 'Desenho da solução e validação técnica',
        estimatedDuration: '2-4 semanas',
        keyActivities: [
          'Design do sistema',
          'Revisão técnica',
          'Prototipagem',
          'Validação com stakeholders',
        ],
      },
      {
        number: 3,
        name: 'Development',
        description: 'Desenvolvimento e construção da solução',
        estimatedDuration: '4-8 semanas',
        keyActivities: [
          'Development iterativo',
          'Testes contínuos',
          'Code review',
          'Integração',
        ],
      },
      {
        number: 4,
        name: 'Testing & QA',
        description: 'Testes abrangentes e garantia de qualidade',
        estimatedDuration: '2-3 semanas',
        keyActivities: [
          'Testes funcionais',
          'Testes de performance',
          'Testes de segurança',
          'UAT',
        ],
      },
      {
        number: 5,
        name: 'Deployment & Launch',
        description: 'Preparação e lançamento em produção',
        estimatedDuration: '1-2 semanas',
        keyActivities: [
          'Preparação de ambiente',
          'Deploy para produção',
          'Monitoramento inicial',
          'Suporte pós-lançamento',
        ],
      },
    ];
  }

  /**
   * Gera a estrutura recomendada de equipe
   */
  static generateRecommendedTeam(vision) {
    const visionLower = (vision || '').toLowerCase();

    const baseTeam = [
      { role: 'Product Owner', skills: ['Visão de produto', 'Stakeholder management'] },
      { role: 'Arquiteto', skills: ['Arquitetura de solução', 'Decisões técnicas'] },
      { role: 'Tech Lead', skills: ['Liderança técnica', 'Code review'] },
      { role: 'Developer', skills: ['Programação', 'Testes'] },
    ];

    // Adiciona roles específicas conforme o escopo
    if (visionLower.includes('front') || visionLower.includes('ui') || visionLower.includes('interface')) {
      baseTeam.push({ role: 'Frontend Developer', skills: ['UI/UX', 'React/Vue'] });
    }

    if (visionLower.includes('backend') || visionLower.includes('api')) {
      baseTeam.push({ role: 'Backend Developer', skills: ['APIs', 'Databases'] });
    }

    if (visionLower.includes('mobile') || visionLower.includes('app')) {
      baseTeam.push({ role: 'Mobile Developer', skills: ['iOS/Android'] });
    }

    if (visionLower.includes('dados') || visionLower.includes('data') || visionLower.includes('analytics')) {
      baseTeam.push({ role: 'Data Specialist', skills: ['Analytics', 'SQL'] });
    }

    if (visionLower.includes('segurança') || visionLower.includes('security') || visionLower.includes('compliance')) {
      baseTeam.push({ role: 'Security Specialist', skills: ['Segurança', 'Compliance'] });
    }

    baseTeam.push(
      { role: 'QA Engineer', skills: ['Testes', 'Automação'] },
      { role: 'DevOps Engineer', skills: ['CI/CD', 'Infraestrutura'] }
    );

    return baseTeam;
  }

  /**
   * Identifica riscos potenciais baseado no escopo
   */
  static identifyRisks(name, description, vision) {
    const risks = [];
    const combinedText = `${name} ${description} ${vision}`.toLowerCase();

    // Riscos genéricos
    risks.push({
      id: 'scope_creep',
      title: 'Scope Creep',
      description: 'Expansão não controlada do escopo do projeto',
      severity: 'high',
      mitigation: 'Definir escopo claro e executar mudanças via change control',
    });

    risks.push({
      id: 'timeline_delay',
      title: 'Atraso na Timeline',
      description: 'Possível atraso na entrega das fases',
      severity: 'medium',
      mitigation: 'Planejamento buffer e monitoramento contínuo',
    });

    // Riscos específicos
    if (combinedText.includes('urgente') || combinedText.includes('rápido') || combinedText.includes('apressado')) {
      risks.push({
        id: 'rushed_delivery',
        title: 'Entrega Apressada',
        description: 'Qualidade comprometida por timeline apertado',
        severity: 'high',
        mitigation: 'Priorizar features críticas e aceitar MVP',
      });
    }

    if (combinedText.includes('novo') || combinedText.includes('primeira') || combinedText.includes('inovação')) {
      risks.push({
        id: 'unproven_approach',
        title: 'Abordagem Não Testada',
        description: 'Tecnologia ou metodologia não validada anteriormente',
        severity: 'medium',
        mitigation: 'PoC para validar abordagem antes de escalar',
      });
    }

    if (combinedText.includes('integração') || combinedText.includes('migrate') || combinedText.includes('migração')) {
      risks.push({
        id: 'integration_risk',
        title: 'Risco de Integração',
        description: 'Complexidade na integração com sistemas existentes',
        severity: 'high',
        mitigation: 'Mapeamento detalhado de integrações e testes early',
      });
    }

    if (combinedText.includes('performance') || combinedText.includes('escala') || combinedText.includes('grande volume')) {
      risks.push({
        id: 'performance_risk',
        title: 'Risco de Performance',
        description: 'Possível degradação de performance sob carga',
        severity: 'medium',
        mitigation: 'Testes de carga e otimização proativa',
      });
    }

    return risks;
  }

  /**
   * Gera um checklist de inicialização do projeto
   */
  static generateInitializationChecklist(formData) {
    return {
      planning: [
        { task: 'Definir stakeholders e responsáveis', completed: false },
        { task: 'Criar documento de escopo detalhado', completed: false },
        { task: 'Estabelecer objetivos SMART', completed: false },
        { task: 'Identificar dependências e bloqueadores', completed: false },
        { task: 'Aprovar orçamento e recursos', completed: false },
      ],
      team: [
        { task: 'Montar equipe central', completed: false },
        { task: 'Definir RACI matrix', completed: false },
        { task: 'Realizar kickoff meeting', completed: false },
        { task: 'Configurar ferramentas de comunicação', completed: false },
      ],
      technical: [
        { task: 'Setup do repositório Git', completed: false },
        { task: 'Configurar CI/CD pipeline', completed: false },
        { task: 'Preparar ambiente de desenvolvimento', completed: false },
        { task: 'Documentar arquitetura inicial', completed: false },
      ],
      governance: [
        { task: 'Definir cadência de reuniões', completed: false },
        { task: 'Estabelecer processo de mudanças', completed: false },
        { task: 'Configurar rastreamento de riscos', completed: false },
        { task: 'Criar dashboard de métricas', completed: false },
      ],
    };
  }

  /**
   * Gera um relatório completo do mapeamento
   */
  static generateMappingReport(formData) {
    const mapped = this.mapFormDataToProject(formData);

    return {
      timestamp: new Date().toISOString(),
      formInputs: formData,
      mappedData: mapped,
      summary: {
        projectName: mapped.basic.name,
        keywordsIdentified: mapped.metadata.keywords,
        identifiedObjective: mapped.metadata.primaryObjective,
        targetAudience: mapped.metadata.targetAudience,
        expectedOutcome: mapped.metadata.expectedOutcome,
        recommendedTeamSize: mapped.enriched.recommendedTeam.length,
        riskCount: mapped.enriched.risks.length,
        totalChecklistItems: Object.values(mapped.initializationChecklist).reduce(
          (acc, section) => acc + section.length,
          0
        ),
      },
    };
  }
}

export default ProjectFieldMapper;
