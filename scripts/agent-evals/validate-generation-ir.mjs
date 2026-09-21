import { createGenerationIR, validateGenerationIR } from '../../backend/src/services/generationSpecService.js';

const technicalSpec = {
  projectTemplateKey: 'project/internal-support-hub',
  featureKey: 'support-ticket-attachments',
  summary: 'Fluxo para anexar comprovantes a chamados internos com contexto do caso.',
  entityName: 'TicketAttachment',
  frontend: {
    suggestedRoute: '/tickets/attachments',
    navigationLabel: 'Comprovantes',
    pageTitle: 'Anexos do Chamado',
    productMode: 'evidence-workbench',
    layoutVariant: 'evidence-split',
  },
  backend: {
    routeBase: '/api/v1/ticket-attachments',
  },
  architecture: {
    screenTemplate: 'workspace',
  },
  structured: {
    classification: {
      screenTemplate: 'workspace',
      productMode: 'evidence-workbench',
      intent: 'attach',
    },
  },
  domain: {
    fields: [
      { name: 'documentType', label: 'Tipo do documento', inputType: 'select', required: true, selectOptions: ['nota_fiscal', 'comprovante'] },
      { name: 'referenceUrl', label: 'Link do arquivo', inputType: 'url', required: true },
    ],
  },
  shared: {
    requestContractName: 'TicketAttachmentRequest',
    responseContractName: 'TicketAttachmentResponse',
    listContractName: 'TicketAttachmentListResponse',
  },
  ux: {
    permissions: {
      actor: 'analista',
    },
    states: {
      loading: 'Carregando anexos',
      empty: 'Nenhum anexo ainda',
      success: 'Anexo salvo',
    },
  },
};

const generationIR = createGenerationIR({
  project: {
    name: 'Central de Chamados Internos',
    templateKey: 'project/internal-support-hub',
  },
  technicalSpec,
  domainTemplate: {
    templateKey: 'support-ticket-attachments',
    productMode: 'evidence-workbench',
  },
  task: {
    title: 'Anexar comprovantes a um chamado',
  },
});

const validation = validateGenerationIR(generationIR);

console.log(
  JSON.stringify(
    {
      valid: validation.valid,
      issues: validation.issues,
      frontend: generationIR.frontend.screenSpec,
      backend: generationIR.backend.moduleSpec,
    },
    null,
    2
  )
);

if (!validation.valid) {
  process.exit(1);
}
