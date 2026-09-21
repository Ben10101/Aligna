/**
 * Fase 2 – Patch Final: Substitui service.ts fallback inline (linha 6073)
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '..', 'src', 'services', 'implementationService.js');

async function run() {
  let content = await fs.readFile(filePath, 'utf8');

  const OLD = `import { randomUUID } from 'crypto';\\nimport type { \${technicalSpec.shared.requestContractName}, \${technicalSpec.shared.responseContractName} } from '\${sharedImportPath}';\\n\\ntype InternalRecord = \${technicalSpec.shared.responseContractName} & {\\n  updatedAt?: string;\\n  reviewDecision?: 'approved' | 'rejected';\\n  reviewNote?: string;\\n  attachmentCount?: number;\\n  latestAttachment?: string;\\n  priority?: string;\\n  title?: string;\\n  name?: string;\\n  subject?: string;\\n};\\n\\nconst records: InternalRecord[] = [];\\n\\n\${validateInputFunction}/**\\n\${businessRulesComment}\\n */\\nexport class \${technicalSpec.backend.serviceName} {\\n\${listImplementation}  create(input: \${technicalSpec.shared.requestContractName}): \${technicalSpec.shared.responseContractName} {\\n\${validateInputRules ? \`    validateInput(input, records);\\n\` : ''}    const item: InternalRecord = {\\n      id: randomUUID(),\\n\${responseFieldAssignments}\\n      status: \${createStatusValue},\\n      createdAt: new Date().toISOString(),\${createUpdatedAtField}\\n    };\\n\\n    records.push(item);\\n    return item;\\n  }\\n\\n\${reviewMethod}\${attachMethod}\${activityMethod}  buildSeedRecordsFromTask(): \${technicalSpec.shared.requestContractName}[] {\\n    return \${seedRequestLiteral};\\n  }\\n}\\n\\nexport const \${technicalSpec.backend.serviceInstanceName} = new \${technicalSpec.backend.serviceName}();\\nfor (const seedInput of \${technicalSpec.backend.serviceInstanceName}.buildSeedRecordsFromTask()) {\\n  records.push(\${technicalSpec.backend.serviceInstanceName}.create(seedInput));\\n}\\n\``;

  const NEW = `import { PrismaClient } from '@prisma/client';\\nimport type { \${technicalSpec.shared.requestContractName}, \${technicalSpec.shared.responseContractName} } from '\${sharedImportPath}';\\n\\nconst prisma = new PrismaClient();\\n\\n\${validateInputFunction}/**\\n\${businessRulesComment}\\n */\\nexport class \${technicalSpec.backend.serviceName} {\\n\${listImplementation}  async create(input: \${technicalSpec.shared.requestContractName}): Promise<\${technicalSpec.shared.responseContractName}> {\\n    const item = await prisma['\${prismaModelIdVar}'].create({\\n      data: {\\n\${responseFieldAssignments}\\n        status: \${createStatusValue},\\n      }\\n    });\\n    return item as unknown as \${technicalSpec.shared.responseContractName};\\n  }\\n\\n\${reviewMethod}\${attachMethod}\${activityMethod}}\\n\\nexport const \${technicalSpec.backend.serviceInstanceName} = new \${technicalSpec.backend.serviceName}();\\n\``;

  if (!content.includes(OLD)) {
    console.error('❌ OLD marker not found in file!');
    // Debug: find what's there
    const pos = content.indexOf('import { randomUUID } from');
    if (pos > 0) {
      console.log('Found at pos', pos, ':');
      console.log(JSON.stringify(content.slice(pos, pos + 200)));
    }
    process.exit(1);
  }

  content = content.replace(OLD, NEW);
  await fs.writeFile(filePath, content, 'utf8');
  console.log('✅ Service fallback substituído com Prisma!');
}

run().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
