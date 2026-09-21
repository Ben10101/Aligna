const fs = require('fs');

const filePath = 'c:/Users/bleao/ai-software-factory/backend/src/services/implementationService.js';
let content = fs.readFileSync(filePath, 'utf8');

function extractVarBlock(content, startText, endText) {
    const startIdx = content.indexOf(startText);
    if (startIdx === -1) return null;
    const endPartIdx = content.indexOf(endText, startIdx);
    if (endPartIdx === -1) return null;
    const finalIdx = content.indexOf(';', endPartIdx) + 1;
    return content.slice(startIdx, finalIdx);
}

const toPrismaModelIdDef = extractVarBlock(content, 'const toPrismaModelId = (spec) =>', 'return clean.charAt(0).toLowerCase() + clean.slice(1);');
const renderAutonomousTemplateDef = extractVarBlock(content, 'const renderAutonomousTemplate = (template) =>', 'replaceAll(\'__PRISMA_MODEL_ID__\', escapeTemplate(toPrismaModelId(technicalSpec)))');

if (toPrismaModelIdDef && renderAutonomousTemplateDef) {
    console.log('Found definitions');
    content = content.replace(toPrismaModelIdDef, '');
    content = content.replace(renderAutonomousTemplateDef, '');

    // Flexible regex for the insertion point
    const insertionRegex = /const sharedImportPath = toImportPath\(\s*`\$\{technicalSpec\.backend\.modulePath\}\/service\.ts`,\s*technicalSpec\.shared\.contractPath\s*\);/;
    const match = content.match(insertionRegex);

    if (match) {
        const insertionPoint = match.index + match[0].length;
        const before = content.slice(0, insertionPoint);
        const after = content.slice(insertionPoint);
        content = before + '\n' + toPrismaModelIdDef + '\n' + renderAutonomousTemplateDef + after;
        fs.writeFileSync(filePath, content);
        console.log('Fix applied successfully');
    } else {
        console.error('Could not find insertion marker with regex');
    }
} else {
    console.error('Could not find definitions');
}
