import { spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

const TEST_PORT = String(process.env.AUTH_USER_FLOW_TEST_PORT || process.env.PORT || '3103');
const API_BASE = process.env.AUTH_USER_FLOW_TEST_API_BASE || `http://127.0.0.1:${TEST_PORT}`;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
const SERVER_START_TIMEOUT_MS = 15_000;
const TEST_SECRET =
  process.env.AI_SETTINGS_SECRET ||
  process.env.AUTH_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  'local-authenticated-flow-smoke-secret';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSetCookie(setCookieHeader = []) {
  const jar = new Map();

  for (const entry of setCookieHeader) {
    const firstPart = String(entry || '').split(';')[0];
    const separatorIndex = firstPart.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();
    jar.set(key, value);
  }

  return jar;
}

function serializeCookies(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
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

  throw new Error('Timeout aguardando backend responder no authenticated-user-flow smoke.');
}

async function expectJson(pathname, init, expectedStatus) {
  const response = await fetch(`${API_BASE}${pathname}`, init);
  const payload = await readJson(response);
  assert(
    response.status === expectedStatus,
    `Esperava status ${expectedStatus} em ${pathname}, mas recebi ${response.status}. Corpo: ${payload.text}`
  );
  return { response, ...payload };
}

async function runChecks() {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const registerPayload = {
    name: 'Security Smoke User',
    email: `security-smoke-${uniqueSuffix}@example.com`,
    password: 'SenhaForte123!',
    workspaceName: `Workspace ${uniqueSuffix}`,
  };

  const registerResult = await expectJson(
    '/api/auth/register',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: FRONTEND_ORIGIN,
      },
      body: JSON.stringify(registerPayload),
    },
    201
  );

  const accessToken = registerResult.json?.accessToken;
  assert(accessToken, 'Registro nao retornou accessToken.');
  assert(registerResult.json?.user?.email === registerPayload.email, 'Registro nao retornou o usuario esperado.');
  assert(registerResult.json?.workspace?.uuid, 'Registro nao retornou workspace inicial.');

  const cookieJar = parseSetCookie(registerResult.response.headers.getSetCookie());
  const csrfToken = cookieJar.get('factory_csrf_token');
  const refreshToken = cookieJar.get('factory_refresh_token');

  assert(csrfToken, 'Registro nao retornou cookie CSRF.');
  assert(refreshToken, 'Registro nao retornou refresh token cookie.');

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Origin: FRONTEND_ORIGIN,
  };

  const meResult = await expectJson('/api/auth/me', { method: 'GET', headers: authHeaders }, 200);
  assert(meResult.json?.user?.email === registerPayload.email, 'GET /auth/me nao retornou o usuario autenticado.');

  const aiSettingsBefore = await expectJson('/api/auth/ai-settings', { method: 'GET', headers: authHeaders }, 200);
  assert(aiSettingsBefore.json?.openai?.apiKey === '', 'GET /auth/ai-settings nao deveria expor apiKey em texto puro.');

  const updatePayload = {
    providerPreference: 'openai',
    agentAliases: {
      developer: 'Dev Prime',
    },
    openai: {
      enabled: true,
      apiKey: 'sk-test-flow-1234',
      model: 'gpt-4.1-mini',
    },
  };

  const updatedSettings = await expectJson(
    '/api/auth/ai-settings',
    {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    },
    200
  );

  assert(updatedSettings.json?.openai?.apiKey === '', 'PUT /auth/ai-settings nao deveria ecoar apiKey em texto puro.');
  assert(updatedSettings.json?.openai?.apiKeyConfigured === true, 'PUT /auth/ai-settings deveria marcar apiKey como configurada.');
  assert(updatedSettings.json?.openai?.apiKeyPreview === '****1234', 'PUT /auth/ai-settings deveria mascarar a apiKey.');
  assert(updatedSettings.json?.agentAliases?.developer === 'Dev Prime', 'PUT /auth/ai-settings nao persistiu alias esperado.');

  const runtimeResult = await expectJson('/api/auth/ai-runtime', { method: 'GET', headers: authHeaders }, 200);
  assert(runtimeResult.json?.provider === 'openai', 'GET /auth/ai-runtime nao refletiu providerPreference salvo.');
  assert(runtimeResult.json?.hasOpenAiKey === true, 'GET /auth/ai-runtime nao reconheceu chave configurada.');
  assert(Array.isArray(runtimeResult.json?.providerOrder), 'GET /auth/ai-runtime nao retornou providerOrder.');
  assert(runtimeResult.json.providerOrder.includes('openai'), 'GET /auth/ai-runtime nao incluiu openai no providerOrder.');

  const readinessResult = await expectJson('/api/observability/readiness', { method: 'GET', headers: authHeaders }, 200);
  assert(readinessResult.json?.security?.csrfProtectionEnabled === true, 'Readiness nao refletiu CSRF ativo.');
  assert(readinessResult.json?.security?.aiSettingsSecretConfigured === true, 'Readiness nao refletiu segredo de AI settings.');

  const governanceResult = await expectJson('/api/observability/governance', { method: 'GET', headers: authHeaders }, 200);
  assert(governanceResult.json?.summary, 'Governance nao retornou summary.');

  const logoutResult = await expectJson(
    '/api/auth/logout',
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        Cookie: serializeCookies(cookieJar),
        'X-CSRF-Token': csrfToken,
      },
    },
    200
  );
  assert(logoutResult.json?.success === true, 'Logout nao retornou sucesso.');

  await expectJson(
    '/api/auth/refresh',
    {
      method: 'POST',
      headers: {
        Origin: FRONTEND_ORIGIN,
        Cookie: serializeCookies(cookieJar),
        'X-CSRF-Token': csrfToken,
      },
    },
    401
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
    console.log('Authenticated user flow smoke tests passed.');
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
