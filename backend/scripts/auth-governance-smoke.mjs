import { spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

const TEST_PORT = String(process.env.AUTH_GOV_TEST_PORT || process.env.PORT || '3102');
const API_BASE = process.env.AUTH_GOV_TEST_API_BASE || `http://127.0.0.1:${TEST_PORT}`;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
const SERVER_START_TIMEOUT_MS = 15_000;
const TEST_SECRET =
  process.env.AI_SETTINGS_SECRET ||
  process.env.AUTH_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  'local-auth-governance-smoke-secret';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function expectStatus(pathname, init, expectedStatus, expectedMessagePart) {
  const response = await fetch(`${API_BASE}${pathname}`, init);
  const payload = await readJson(response);

  assert(
    response.status === expectedStatus,
    `Esperava status ${expectedStatus} em ${pathname}, mas recebi ${response.status}. Corpo: ${payload.text}`
  );

  if (expectedMessagePart) {
    assert(
      payload.text.includes(expectedMessagePart),
      `Esperava encontrar "${expectedMessagePart}" em ${pathname}, mas o corpo foi: ${payload.text}`
    );
  }
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if ([200, 503].includes(response.status)) {
        return;
      }
    } catch {
      // backend ainda subindo
    }

    await delay(500);
  }

  throw new Error('Timeout aguardando backend responder no auth-governance smoke.');
}

async function runChecks() {
  const healthResponse = await fetch(`${API_BASE}/health`);
  const healthPayload = await readJson(healthResponse);
  assert([200, 503].includes(healthResponse.status), `Health retornou status inesperado: ${healthResponse.status}`);
  assert(healthPayload.json?.status, 'Health nao retornou campo status.');
  assert(healthPayload.json?.environment, 'Health nao retornou campo environment.');

  await expectStatus('/api/auth/me', { method: 'GET' }, 401, 'Autenticacao obrigatoria');
  await expectStatus('/api/auth/ai-runtime', { method: 'GET' }, 401, 'Autenticacao obrigatoria');
  await expectStatus('/api/observability/readiness', { method: 'GET' }, 401, 'Autenticacao obrigatoria');
  await expectStatus('/api/observability/governance', { method: 'GET' }, 401, 'Autenticacao obrigatoria');

  await expectStatus(
    '/api/auth/refresh',
    {
      method: 'POST',
      headers: {
        Origin: FRONTEND_ORIGIN,
      },
    },
    403,
    'Validacao CSRF falhou'
  );

  await expectStatus(
    '/api/auth/refresh',
    {
      method: 'POST',
      headers: {
        Origin: FRONTEND_ORIGIN,
        Cookie: 'factory_csrf_token=csrf-value',
        'X-CSRF-Token': 'csrf-value',
      },
    },
    401,
    'Refresh token ausente'
  );

  await expectStatus(
    '/api/auth/logout',
    {
      method: 'POST',
      headers: {
        Origin: FRONTEND_ORIGIN,
        Cookie: 'factory_csrf_token=csrf-value',
        'X-CSRF-Token': 'csrf-value',
      },
    },
    401,
    'Autenticacao obrigatoria'
  );
}

async function main() {
  const serverProcess = spawn('node', ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: TEST_PORT,
      AUTH_ACCESS_SECRET: process.env.AUTH_ACCESS_SECRET || TEST_SECRET,
      AI_SETTINGS_SECRET: process.env.AI_SETTINGS_SECRET || TEST_SECRET,
    },
  });

  let stdout = '';
  let stderr = '';
  serverProcess.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  serverProcess.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  serverProcess.on('exit', (code) => {
    if (code && code !== 0) {
      stderr += `\nProcesso do backend encerrou com codigo ${code}.`;
    }
  });

  try {
    await waitForServer();
    await runChecks();
    console.log('Auth and governance smoke tests passed.');
  } finally {
    serverProcess.kill('SIGTERM');
    await delay(1000);

    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  }

  if (serverProcess.exitCode && serverProcess.exitCode !== 0) {
    throw new Error(`Backend finalizou com codigo ${serverProcess.exitCode}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
