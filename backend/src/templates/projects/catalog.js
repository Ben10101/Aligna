export const PROJECT_TEMPLATE_CATALOG = {
  'internal-support-hub': {
    templateKey: 'project/internal-support-hub',
    label: 'Central de Chamados Internos',
    domain: 'support',
    summary:
      'Workspace de suporte interno com tickets, anexos, preferencias de notificacao, governanca de acesso e cockpit gerencial.',
    positioning:
      'Produto para operacao interna que precisa reduzir fila, melhorar SLA e dar visibilidade para lideranca sem virar um CRUD generico.',
    audiences: ['colaborador', 'analista de suporte', 'gestor'],
    coreCapabilities: [
      'abertura e acompanhamento de chamados',
      'anexos e evidencias por caso',
      'notificacoes configuraveis',
      'controle de acesso por papel',
      'cockpit de performance do atendimento',
    ],
    frontend: {
      homeLabel: 'Cockpit do produto',
      navigationStyle: 'operational-workspace',
      defaultProductMode: 'manager-cockpit',
      visualTone: 'operacional',
    },
    featureKeys: [
      'support-performance-dashboard',
      'support-ticket-attachments',
      'ticket-notification-preferences',
      'access-control-roles',
    ],
  },
  'corporate-reimbursement-saas': {
    templateKey: 'project/corporate-reimbursement-saas',
    label: 'Plataforma SaaS de Reembolsos Corporativos',
    domain: 'finance-ops',
    summary:
      'Plataforma para solicitacao, validacao, aprovacao e auditoria de reembolsos com politicas, comprovantes e leitura gerencial.',
    positioning:
      'Produto de operacao financeira que precisa equilibrar velocidade, conformidade e rastreabilidade sem sobrecarregar o usuario final.',
    audiences: ['colaborador', 'aprovador', 'financeiro', 'administrador'],
    coreCapabilities: [
      'solicitacao de reembolso com comprovantes',
      'politicas e niveis de aprovacao',
      'alertas e notificacoes de status',
      'relatorios e exportacao',
      'painel gerencial de performance e risco',
    ],
    frontend: {
      homeLabel: 'Centro de operacoes financeiras',
      navigationStyle: 'governed-workbench',
      defaultProductMode: 'review-workbench',
      visualTone: 'financeiro-operacional',
    },
    featureKeys: [
      'support-ticket-attachments',
      'ticket-notification-preferences',
      'access-control-roles',
      'support-performance-dashboard',
    ],
  },
  'education-platform-suite': {
    templateKey: 'project/education-platform-suite',
    label: 'Plataforma de EAD',
    domain: 'education',
    summary:
      'Suite educacional com catalogo, modulos, aulas, materiais, matriculas, player e configuracoes comerciais do curso.',
    positioning:
      'Produto de aprendizagem com foco em descoberta, organizacao pedagogica e consumo fluido, sem cara de painel administrativo pesado.',
    audiences: ['aluno', 'instrutor', 'operacao academica', 'administrador'],
    coreCapabilities: [
      'catalogo de cursos',
      'estrutura de modulos e aulas',
      'biblioteca de materiais',
      'matriculas e liberacao de acesso',
      'player e acompanhamento de consumo',
    ],
    frontend: {
      homeLabel: 'Workspace academico',
      navigationStyle: 'learning-suite',
      defaultProductMode: 'curriculum-designer',
      visualTone: 'editorial',
    },
    featureKeys: [
      'course-catalog',
      'course-modules',
      'course-lessons',
      'lesson-materials',
      'course-pricing',
      'course-search',
      'course-enrollment',
      'course-player',
    ],
  },
};
