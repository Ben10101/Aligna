import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './lib/prisma.js';
import projectRoutes from './routes/projectRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import authRoutes from './routes/authRoutes.js';
import observabilityRoutes from './routes/observabilityRoutes.js';
import alignmentRoutes from './routes/alignmentRoutes.js';
import { recoverStaleAgentRuns } from './services/agentRunRecoveryService.js';
import { resumeProjectManagerRetryQueue } from './controllers/projectDataController.js';
import { attachAuthUser } from './middleware/authMiddleware.js';
import { apiAuditLogger } from './middleware/auditMiddleware.js';
import { apiRateLimiter, applySecurityHeaders, attachRequestContext } from './middleware/securityMiddleware.js';
import { logError, logInfo, logWarn } from './utils/logger.js';


BigInt.prototype.toJSON = function () {
  return this.toString();
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

const app = express();
const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL || '';
const isProduction = process.env.NODE_ENV === 'production';
let recoveryIntervalHandle = null;

function getRequiredAuthSecret() {
  const secret = process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret?.trim()) {
    throw new Error('AUTH_ACCESS_SECRET ou JWT_SECRET precisa estar configurado antes de iniciar o backend.');
  }
  return secret;
}

function getRequiredDatabaseUrl() {
  if (!DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL precisa estar configurada antes de iniciar o backend.');
  }

  try {
    const parsed = new URL(DATABASE_URL);
    if (!parsed.protocol || !parsed.hostname) {
      throw new Error('DATABASE_URL invalida.');
    }
  } catch {
    throw new Error('DATABASE_URL invalida.');
  }

  return DATABASE_URL;
}

function resolveTrustProxySetting() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return process.env.TRUST_PROXY;
}

function getSafeDatabaseLabel() {
  if (!DATABASE_URL) return 'DATABASE_URL ausente';

  try {
    const parsed = new URL(DATABASE_URL);
    return `${parsed.protocol.replace(':', '')}://${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch {
    return 'DATABASE_URL presente (nao foi possivel parsear)';
  }
}

function parseOriginList(value, label) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`${label} contem uma origem invalida: ${origin}`);
      }
    });
}

function buildAllowedOrigins() {
  const defaults = isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const configured = [
    ...parseOriginList(process.env.FRONTEND_ORIGIN, 'FRONTEND_ORIGIN'),
    ...parseOriginList(process.env.VITE_FRONTEND_URL, 'VITE_FRONTEND_URL'),
  ];

  return [...new Set([...defaults, ...configured])];
}

function validateRuntimeConfiguration() {
  getRequiredAuthSecret();
  getRequiredDatabaseUrl();

  if (isProduction && !allowedOrigins.length) {
    throw new Error('FRONTEND_ORIGIN ou VITE_FRONTEND_URL precisa ser configurado em producao.');
  }

  if (isProduction && !(process.env.AI_SETTINGS_SECRET || process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET)) {
    throw new Error('AI_SETTINGS_SECRET precisa estar configurado em producao.');
  }
}

const allowedOrigins = buildAllowedOrigins();

validateRuntimeConfiguration();
app.set('trust proxy', resolveTrustProxySetting());
app.use(applySecurityHeaders);
app.use(attachRequestContext);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !isProduction || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origem nao autorizada: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/api', attachAuthUser, apiRateLimiter, apiAuditLogger);

app.use('/', observabilityRoutes);
app.use('/api', observabilityRoutes);
app.use('/api', authRoutes);
app.use('/api', alignmentRoutes);
app.use('/api', projectRoutes);
app.use('/api', agentRoutes);
app.use('/api', dataRoutes);

app.use((err, _req, res, _next) => {
  logError('http_request_failed', {
    requestId: _req?.requestId || null,
    method: _req?.method || null,
    path: _req?.originalUrl || _req?.url || null,
    error: err,
  });
  const statusCode = err.statusCode || (err.message?.includes('nao encontrado') ? 404 : 500);

  res.status(statusCode).json({
    message: err.message || 'Erro interno do servidor',
    ...(err.code ? { code: err.code } : {}),
    ...(Array.isArray(err.findings) ? { findings: err.findings } : {}),
  });
});

async function startServer() {
  logInfo('backend_starting', {
    port: PORT,
    databaseTarget: getSafeDatabaseLabel(),
    environment: process.env.NODE_ENV || 'development',
  });

  try {
    await prisma.$connect();
    logInfo('database_connected', {
      databaseTarget: getSafeDatabaseLabel(),
    });
    // This backend owns local Python child processes. After it restarts, no prior
    // process can still complete, so release every persisted running run now.
    // Waiting for the execution timeout here left the UI blocked by ghost runs.
    const startupRecoveryWindowSeconds = 0;
    const configuredWatchdogWindow = Number(process.env.AGENT_RUN_WATCHDOG_MAX_AGE_SECONDS || 900);
    // Startup can safely release every run from a previous process. The
    // periodic watchdog runs alongside live child processes and must never
    // use that zero-second window.
    const recoveryWindowSeconds = Number.isFinite(configuredWatchdogWindow)
      ? Math.max(120, configuredWatchdogWindow)
      : 900;
    const recoveryResult = await recoverStaleAgentRuns({
      maxAgeSeconds: startupRecoveryWindowSeconds,
      reason: 'Execucao interrompida pela reinicializacao do backend local.',
    });

    if (recoveryResult.recoveredCount > 0) {
      logWarn('backend_startup_recovered_runs', {
        recoveredCount: recoveryResult.recoveredCount,
        recoveryWindowSeconds: startupRecoveryWindowSeconds,
      });
    }

    // Retry jobs are represented in the project's persisted recovery state.
    // Re-register their timers after a backend restart so an unavailable
    // provider never requires the user to manually recreate the request.
    await resumeProjectManagerRetryQueue();

    recoveryIntervalHandle = setInterval(async () => {
      try {
        const result = await recoverStaleAgentRuns({
          maxAgeSeconds: recoveryWindowSeconds,
          reason: 'Execucao marcada como falha por watchdog de recuperacao do backend.',
        });
        if (result.recoveredCount > 0) {
          logWarn('agent_run_watchdog_recovered_runs', {
            recoveredCount: result.recoveredCount,
            recoveryWindowSeconds,
          });
        }
      } catch (error) {
        logError('run_watchdog_failed', {
          recoveryWindowSeconds,
          error,
        });
      }
    }, 60 * 1000);
  } catch (error) {
    logError('database_connection_failed', {
      databaseTarget: getSafeDatabaseLabel(),
      error,
    });
    return;
  }

  app.listen(PORT, () => {
    logInfo('backend_started', {
      baseUrl: `http://localhost:${PORT}`,
      apiBaseUrl: `http://localhost:${PORT}/api`,
    });
  });
}

startServer();

process.on('SIGINT', async () => {
  if (recoveryIntervalHandle) clearInterval(recoveryIntervalHandle);
  await prisma.$disconnect().catch(() => null);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (recoveryIntervalHandle) clearInterval(recoveryIntervalHandle);
  await prisma.$disconnect().catch(() => null);
  process.exit(0);
});

export default app;
