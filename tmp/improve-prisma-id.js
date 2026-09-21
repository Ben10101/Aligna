const fs = require('fs');

const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `  const toPrismaModelId = (spec) => {
    const name = String(spec.backend?.serviceName || spec.shared?.requestContractName || 'entity');
    const clean = name.replace(/Service$|Router$|Request$|Response$/, '');
    return clean.charAt(0).toLowerCase() + clean.slice(1);
  };`;

const replacement = `  const toPrismaModelId = (spec) => {
    const name = String(spec.entityName || spec.backend?.serviceName || spec.shared?.requestContractName || 'entity');
    const clean = name.replace(/Service$|Router$|Request$|Response$/, '');
    return clean.charAt(0).toLowerCase() + clean.slice(1);
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content);
    console.log('Improvement applied successfully');
} else {
    console.error('Target function not found. Did the content change?');
}
