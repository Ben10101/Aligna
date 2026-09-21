import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.md', '.html']);
const SUSPICIOUS_PATTERNS = [
  /Ã./,
  /Â./,
  /â€¢/,
  /â†’/,
  /â€œ|â€|â€˜|â€™/,
];

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!TEXT_EXTENSIONS.has(extname(fullPath))) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');
    const matched = SUSPICIOUS_PATTERNS.find((pattern) => pattern.test(content));
    if (matched) {
      offenders.push({
        file: fullPath,
        pattern: matched.toString(),
      });
    }
  }
}

walk(ROOT);

if (offenders.length) {
  console.error('Mojibake detectado em arquivos do frontend:');
  for (const offender of offenders) {
    console.error(`- ${offender.file} (${offender.pattern})`);
  }
  process.exit(1);
}

console.log('Encoding check ok: nenhum sinal de mojibake encontrado em src/.');
