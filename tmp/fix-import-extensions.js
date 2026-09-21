const fs = require('fs');
const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /function\s+toImportPath\s*\(\s*fromRelativePath\s*,\s*toRelativePath\s*\)\s*\{[\s\S]*?return\s+relativePath\.startsWith\s*\(\s*'\.'\s*\)\s*\?\s*relativePath\s*:\s*`\.\/\$\{relativePath\}`\s*;[\s\S]*?\}/;

const replacement = `function toImportPath(fromRelativePath, toRelativePath) {
  const fromDir = path.posix.dirname(fromRelativePath.replace(/\\\\/g, '/'));
  let toFile = toRelativePath.replace(/\\\\/g, '/');
  // Strip TS/JS extensions for imports
  toFile = toFile.replace(/\\.(ts|tsx|js|jsx)$/, '');
  const relativePath = path.posix.relative(fromDir, toFile);
  return relativePath.startsWith('.') ? relativePath : \`./\${relativePath}\`;
}`;

// Alternative version with single backslashes just in case
const replacementSingle = `function toImportPath(fromRelativePath, toRelativePath) {
  const fromDir = path.posix.dirname(fromRelativePath.replace(/\\/g, '/'));
  let toFile = toRelativePath.replace(/\\/g, '/');
  // Strip TS/JS extensions for imports
  toFile = toFile.replace(/\\.(ts|tsx|js|jsx)$/, '');
  const relativePath = path.posix.relative(fromDir, toFile);
  return relativePath.startsWith('.') ? relativePath : \`./\${relativePath}\`;
}`;

if (regex.test(content)) {
    // We want to use single backslashes in the final file because the file uses single backslashes
    content = content.replace(regex, replacementSingle);
    fs.writeFileSync(filePath, content);
    console.log('Successfully fixed toImportPath with regex');
} else {
    console.error('Regex did not match toImportPath');
}
