const fs = require('fs');

const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update updateApiPackageJson
const apiPkgTarget = `  parsed.dependencies.zod = parsed.dependencies.zod || '^3.24.1';`;
const apiPkgReplacement = `  parsed.dependencies.zod = parsed.dependencies.zod || '^3.24.1';
  parsed.dependencies['@prisma/client'] = parsed.dependencies['@prisma/client'] || '^6.0.1';
  parsed.devDependencies.prisma = parsed.devDependencies.prisma || '^6.0.1';`;

if (content.includes(apiPkgTarget)) {
    content = content.replace(apiPkgTarget, apiPkgReplacement);
    console.log('API package.json dependencies updated');
}

// 2. Update updateRootPackageJson
const rootPkgTarget = `    'build:api': 'npm --workspace apps/api run build',`;
const rootPkgReplacement = `    'build:api': 'npm --workspace apps/api run build',
    'db:generate': 'npx prisma generate',`;

if (content.includes(rootPkgTarget)) {
    content = content.replace(rootPkgTarget, rootPkgReplacement);
    console.log('Root package.json scripts updated');
}

// 3. Update runGeneratedProjectValidationSuite
const validationTarget = `  await ensureGeneratedProjectPrismaSchemaConsistency(generatedApp.rootPath);

  for (const scriptName of ['lint', 'test', 'build:api', 'build:web']) {`;

const validationReplacement = `  await ensureGeneratedProjectPrismaSchemaConsistency(generatedApp.rootPath);

  // Ensure and generate Prisma Client before build
  reports.push(await runGeneratedProjectCommand(generatedApp.rootPath, 'db:generate'));

  for (const scriptName of ['lint', 'test', 'build:api', 'build:web']) {`;

if (content.includes(validationTarget)) {
    content = content.replace(validationTarget, validationReplacement);
    console.log('Validation suite updated to include db:generate');
} else {
    // Try without extra newline just in case
    const validationTargetAlt = `  await ensureGeneratedProjectPrismaSchemaConsistency(generatedApp.rootPath);
  for (const scriptName of ['lint', 'test', 'build:api', 'build:web']) {`;
    if (content.includes(validationTargetAlt)) {
      content = content.replace(validationTargetAlt, validationReplacement);
      console.log('Validation suite updated (alt match)');
    }
}

fs.writeFileSync(filePath, content);
console.log('All changes applied successfully');
