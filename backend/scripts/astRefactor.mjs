import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '..', 'src', 'services', 'implementationService.js');

async function run() {
  let content = await fs.readFile(filePath, 'utf8');

  // Add import
  if (!content.includes("import ts from 'typescript';")) {
    content = content.replace(
      "import { prisma } from '../lib/prisma.js';",
      "import ts from 'typescript';\nimport { prisma } from '../lib/prisma.js';"
    );
  }

  // Replace function
  const functionRegex = /function buildPrismaModelFromContract\(contractName, contractContent\) \{[\s\S]*?return `model \$\{modelName\} \{\\n  id        BigInt   @id @default\(autoincrement\(\)\) @db\.UnsignedBigInt\\n\$\{fields\.join\('\\n'\)\}\$\{fields\.length \? '\\n' : ''\}  status    String   @default\("draft"\) @db\.VarChar\(40\)\\n  createdAt DateTime @default\(now\(\)\) @db\.DateTime\(0\)\\n  updatedAt DateTime @updatedAt @db\.DateTime\(0\)\\n\}`;?\n\}/m;

  const newFunction = `function buildPrismaModelFromContract(contractName, contractContent) {
  const modelNameCandidate = pascalCase(contractName, 'GeneratedContractModel');
  const sourceFile = ts.createSourceFile('temp.ts', contractContent || '', 99, true);

  let targetNode = null;
  let modelName = modelNameCandidate;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      if (name.endsWith('Request')) {
        targetNode = node;
        modelName = name.replace(/Request$/, '');
      }
    }
  });

  if (!targetNode) {
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        if (name.endsWith('Request') && ts.isTypeLiteralNode(node.type)) {
          targetNode = node.type;
          modelName = name.replace(/Request$/, '');
        }
      }
    });
  }

  const fields = [];
  if (targetNode && targetNode.members) {
    for (const member of targetNode.members) {
      if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && member.name && member.type) {
        let fieldName = member.name.getText(sourceFile);
        let fieldType = member.type.getText(sourceFile);
        
        if (fieldName.startsWith("'") || fieldName.startsWith('"')) {
          fieldName = fieldName.slice(1, -1);
        }

        const line = buildPrismaFieldLineFromContractField(fieldName, fieldType);
        if (line) {
          fields.push(line);
        }
      }
    }
  }

  return \\\`model \\\${modelName} {\\n  id        BigInt   @id @default(autoincrement()) @db.UnsignedBigInt\\n\\\${fields.join('\\n')}\\\${fields.length ? '\\n' : ''}  status    String   @default("draft") @db.VarChar(40)\\n  createdAt DateTime @default(now()) @db.DateTime(0)\\n  updatedAt DateTime @updatedAt @db.DateTime(0)\\n}\\\`;
}`;

  content = content.replace(functionRegex, newFunction);
  await fs.writeFile(filePath, content, 'utf8');
  console.log('Patched implementationService.js!');
}

run().catch(console.error);
