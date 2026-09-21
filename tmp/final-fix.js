const fs = require('fs');

const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Correct the messed up functions at the top of backendModuleFiles
const badToPrismaModelId = `const toPrismaModelId = (spec) => {
    const name = String(spec.backend?.serviceName || spec.shared?.requestContractName || 'entity');
    const clean = name.replace(/Service$|Router$|Request$|Response$/, '');
    return clean.charAt(0).toLowerCase() + clean.slice(1);`;

const badRenderAutonomousTemplate = `const renderAutonomousTemplate = (template) =>
    String(template || '')
      .replaceAll('__SHARED_IMPORT_PATH__', escapeTemplate(sharedImportPath))
      .replaceAll('__REQUEST_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.requestContractName))
      .replaceAll('__RESPONSE_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.responseContractName))
      .replaceAll('__LIST_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.listContractName))
      .replaceAll('__ENTITY_NAME__', escapeTemplate(entityName))
      .replaceAll('__PAGE_COMPONENT_NAME__', escapeTemplate(technicalSpec.frontend.pageComponentName))
      .replaceAll('__ROUTE_BASE__', escapeTemplate(technicalSpec.backend.routeBase))
      .replaceAll('__SUBMIT_LABEL__', escapeTemplate(technicalSpec.domain.submitLabel))
      .replaceAll('__SUCCESS_MESSAGE__', escapeTemplate(technicalSpec.domain.successMessage))
      .replaceAll('__BACKEND_ROUTER_NAME__', escapeTemplate(technicalSpec.backend.routerName))
      .replaceAll('__BACKEND_SERVICE_NAME__', escapeTemplate(technicalSpec.backend.serviceName))
      .replaceAll('__BACKEND_SERVICE_INSTANCE_NAME__', escapeTemplate(technicalSpec.backend.serviceInstanceName))
      .replaceAll('__PRISMA_MODEL_ID__', escapeTemplate(toPrismaModelId(technicalSpec)));`;

const goodToPrismaModelId = `  const toPrismaModelId = (spec) => {
    const name = String(spec.backend?.serviceName || spec.shared?.requestContractName || 'entity');
    const clean = name.replace(/Service$|Router$|Request$|Response$/, '');
    return clean.charAt(0).toLowerCase() + clean.slice(1);
  };`;

const goodRenderAutonomousTemplate = `  const renderAutonomousTemplate = (template) =>
    String(template || '')
      .replaceAll('__SHARED_IMPORT_PATH__', escapeTemplate(sharedImportPath))
      .replaceAll('__REQUEST_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.requestContractName))
      .replaceAll('__RESPONSE_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.responseContractName))
      .replaceAll('__LIST_CONTRACT_NAME__', escapeTemplate(technicalSpec.shared.listContractName))
      .replaceAll('__ENTITY_NAME__', escapeTemplate(entityName))
      .replaceAll('__PAGE_COMPONENT_NAME__', escapeTemplate(technicalSpec.frontend.pageComponentName))
      .replaceAll('__ROUTE_BASE__', escapeTemplate(technicalSpec.backend.routeBase))
      .replaceAll('__SUBMIT_LABEL__', escapeTemplate(technicalSpec.domain.submitLabel))
      .replaceAll('__SUCCESS_MESSAGE__', escapeTemplate(technicalSpec.domain.successMessage))
      .replaceAll('__BACKEND_ROUTER_NAME__', escapeTemplate(technicalSpec.backend.routerName))
      .replaceAll('__BACKEND_SERVICE_NAME__', escapeTemplate(technicalSpec.backend.serviceName))
      .replaceAll('__BACKEND_SERVICE_INSTANCE_NAME__', escapeTemplate(technicalSpec.backend.serviceInstanceName))
      .replaceAll('__PRISMA_MODEL_ID__', escapeTemplate(toPrismaModelId(technicalSpec)));`;

content = content.replace(badToPrismaModelId, goodToPrismaModelId);
content = content.replace(badRenderAutonomousTemplate, goodRenderAutonomousTemplate);

// 2. Remove the stray };
const strayBrace = `  
  };
  
  const autonomousBackendServiceTemplate`;
const cleanBrace = `  const autonomousBackendServiceTemplate`;
content = content.replace(strayBrace, cleanBrace);

// 3. One more check for exact matching (in case of double line breaks)
const insertionPointPattern = /}\);[\r\n\s]+(\s+|)const toPrismaModelId/;
if (content.indexOf('toPrismaModelId') === -1) {
    console.error('Final check: definition not found!');
}

fs.writeFileSync(filePath, content);
console.log('Final fix applied successfully');
