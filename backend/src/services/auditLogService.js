import { mkdir, appendFile, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.join(__dirname, '..', '..', 'runtime');
const auditLogPath = path.join(runtimeDir, 'audit-log.ndjson');

async function ensureRuntimeDir() {
  await mkdir(runtimeDir, { recursive: true });
}

function normalizeAuditEntry(entry) {
  return {
    timestamp: entry.timestamp || new Date().toISOString(),
    requestId: entry.requestId || null,
    userUuid: entry.userUuid || null,
    userEmail: entry.userEmail || null,
    method: entry.method || 'GET',
    path: entry.path || '/',
    statusCode: Number(entry.statusCode || 0),
    durationMs: Number(entry.durationMs || 0),
    ip: entry.ip || 'unknown',
    projectUuid: entry.projectUuid || null,
    taskUuid: entry.taskUuid || null,
    actionType: entry.actionType || 'operational_event',
    success: Boolean(entry.success),
  };
}

export async function appendAuditEntry(entry) {
  await ensureRuntimeDir();
  const payload = `${JSON.stringify(normalizeAuditEntry(entry))}\n`;
  await appendFile(auditLogPath, payload, 'utf8');
}

export async function readRecentAuditEntries({ limit = 40, userUuid = null, projectUuid = null } = {}) {
  try {
    const raw = await readFile(auditLogPath, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => (userUuid ? entry.userUuid === userUuid : true))
      .filter((entry) => (projectUuid ? entry.projectUuid === projectUuid : true))
      .slice(-limit)
      .reverse();
  } catch {
    // O log de auditoria é observabilidade auxiliar: indisponibilidade de I/O
    // não deve tornar endpoints operacionais (como readiness) indisponíveis.
    return [];
  }
}

export function getAuditLogPath() {
  return auditLogPath;
}
