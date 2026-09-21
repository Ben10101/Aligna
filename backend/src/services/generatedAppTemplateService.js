import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.join(__dirname, '..', 'templates', 'fullstack', 'react-express-prisma');

function replaceTokens(content, tokens) {
  return Object.entries(tokens).reduce(
    (acc, [key, value]) => acc.replaceAll(`__${key}__`, String(value ?? '')),
    content
  );
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function shouldIncludeTemplateFile(relativeTemplatePath, includeRelativeRoots = []) {
  if (!includeRelativeRoots?.length) return true;

  const normalizedPath = relativeTemplatePath.replace(/\\/g, '/');
  return includeRelativeRoots.some((root) => {
    const normalizedRoot = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

async function materializeTemplateFiles({
  destinationRoot,
  projectName,
  projectSlug,
  includeRelativeRoots = [],
}) {
  const templateFiles = (await walk(TEMPLATE_ROOT)).filter((templateFile) =>
    shouldIncludeTemplateFile(path.relative(TEMPLATE_ROOT, templateFile), includeRelativeRoots)
  );
  const tokens = {
    PROJECT_NAME: projectName,
    PROJECT_SLUG: projectSlug,
  };

  const writtenFiles = [];

  for (const templateFile of templateFiles) {
    const relativeTemplatePath = path.relative(TEMPLATE_ROOT, templateFile);
    const outputRelativePath = relativeTemplatePath.endsWith('.tpl')
      ? relativeTemplatePath.slice(0, -4)
      : relativeTemplatePath;
    const outputPath = path.join(destinationRoot, outputRelativePath);
    const outputDir = path.dirname(outputPath);

    await mkdir(outputDir, { recursive: true });
    const content = await readFile(templateFile, 'utf8');
    const finalContent = replaceTokens(content, tokens);
    await writeFile(outputPath, finalContent, 'utf8');

    const fileStats = await stat(outputPath);
    writtenFiles.push({
      relativePath: outputRelativePath.replace(/\\/g, '/'),
      absolutePath: outputPath,
      fileType: path.extname(outputPath).replace('.', '') || 'text',
      checksum: checksum(finalContent),
      size: fileStats.size,
    });
  }

  return writtenFiles;
}

export async function materializeFullstackTemplate({ destinationRoot, projectName, projectSlug }) {
  return materializeTemplateFiles({ destinationRoot, projectName, projectSlug });
}

export async function materializeFullstackTemplateSubset({
  destinationRoot,
  projectName,
  projectSlug,
  includeRelativeRoots = [],
}) {
  return materializeTemplateFiles({
    destinationRoot,
    projectName,
    projectSlug,
    includeRelativeRoots,
  });
}
