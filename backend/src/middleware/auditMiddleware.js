import { appendAuditEntry } from '../services/auditLogService.js';

function matchesAuditedRoute(req) {
  return (
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/api/projects') ||
    req.path.startsWith('/api/tasks') ||
    req.path.includes('/generate-backlog') ||
    req.path.includes('/generate-architecture') ||
    req.path.includes('/requirements/run') ||
    req.path.includes('/qa/run') ||
    req.path.startsWith('/api/observability/')
  );
}

function inferActionType(req) {
  if (req.path.includes('/auth/login')) return 'auth_login';
  if (req.path.includes('/auth/register')) return 'auth_register';
  if (req.path.includes('/auth/refresh')) return 'auth_refresh';
  if (req.path.includes('/auth/logout')) return 'auth_logout';
  if (req.path.includes('/generate-backlog')) return 'project_generate_backlog';
  if (req.path.includes('/generate-architecture')) return 'project_generate_architecture';
  if (req.path.includes('/requirements/run')) return 'task_generate_requirements';
  if (req.path.includes('/qa/run')) return 'task_generate_qa';
  if (req.path.startsWith('/api/projects') && req.method === 'POST') return 'project_create';
  if (req.path.includes('/comments') && req.method === 'POST') return 'task_comment_create';
  if (req.path.startsWith('/api/tasks') && req.method === 'PATCH') return 'task_update';
  if (req.path.startsWith('/api/observability/')) return 'observability_access';
  return 'operational_event';
}

function extractEntityUuid(req, key) {
  return req.params?.[key] || req.body?.[key] || req.query?.[key] || null;
}

export function apiAuditLogger(req, res, next) {
  if (!matchesAuditedRoute(req)) {
    return next();
  }

  const startedAt = Date.now();
  res.on('finish', () => {
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 400;

    appendAuditEntry({
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      userUuid: req.authUser?.uuid || null,
      userEmail: req.authUser?.email || null,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      projectUuid: extractEntityUuid(req, 'projectUuid'),
      taskUuid: extractEntityUuid(req, 'taskUuid'),
      actionType: inferActionType(req),
      success,
    }).catch((error) => {
      console.error('Falha ao registrar auditoria operacional:', error.message);
    });
  });

  next();
}
