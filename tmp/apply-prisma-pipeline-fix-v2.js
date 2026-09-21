const fs = require('fs');
const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

const validationTarget = /await ensureGeneratedProjectPrismaSchemaConsistency\(generatedApp\.rootPath\);\r?\n\r?\n\s+for \(const scriptName of \['lint', 'test', 'build:api', 'build:web'\]\) \{/;

const validationReplacement = `await ensureGeneratedProjectPrismaSchemaConsistency(generatedApp.rootPath);

  // Ensure and generate Prisma Client before build
  reports.push(await runGeneratedProjectCommand(generatedApp.rootPath, 'db:generate'));

  for (const scriptName of ['lint', 'test', 'build:api', 'build:web']) {`;

if (validationTarget.test(content)) {
    content = content.replace(validationTarget, validationReplacement);
    fs.writeFileSync(filePath, content);
    console.log('Validation suite updated successfully');
} else {
    console.error('Validation suite target NOT found with regex');
}
