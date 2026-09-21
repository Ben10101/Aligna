import { spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { fileURLToPath } from 'url';
import { decryptSensitiveValue, encryptSensitiveValue } from '../src/utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

const TEST_PORT = String(process.env.SECURITY_TEST_PORT || process.env.PORT || '3101');
const API_BASE = process.env.SECURITY_TEST_API_BASE || `http://127.0.0.1:${TEST_PORT}`;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
const SERVER_START_TIMEOUT_MS = 15_000;
const TEST_SECRET =
  process.env.AI_SETTINGS_SECRET ||
  process.env.AUTH_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  'local-security-smoke-secret';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectStatus(path, init, expectedStatus, expectedMessagePart) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();

  assert(
    response.status === expectedStatus,
    `Esperava status ${expectedStatus} em ${path}, mas recebi ${response.status}. Corpo: ${text}`
  );

  if (expectedMessagePart) {
    assert(
      text.includes(expectedMessagePart),
      `Esperava encontrar "${expectedMessagePart}" em ${path}, mas o corpo foi: ${text}`
    );
  }
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          Origin: FRONTEND_ORIGIN,
        },
      });

      if ([401, 403, 500].includes(response.status)) {
        return;
      }
    } catch {
      // Aguarda o backend terminar de subir.
    }

    await delay(500);
  }

  throw new Error('Timeout aguardando o backend responder.');
}

function runCryptoChecks() {
  const original = 'security-roundtrip-value';
  const encrypted = encryptSensitiveValue(original, TEST_SECRET);
  const decrypted = decryptSensitiveValue(encrypted, TEST_SECRET);

  assert(encrypted && encrypted !== original, 'O valor criptografado nao deveria ficar em texto puro.');
  assert(decrypted === original, 'Falha no roundtrip de criptografia sensivel.');
}

async function runHttpChecks() {
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
        Cookie: 'factory_csrf_token=csrf-cookie-value',
        'X-CSRF-Token': 'csrf-header-value',
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
        Origin: 'http://malicious.example',
        Cookie: 'factory_csrf_token=csrf-value',
        'X-CSRF-Token': 'csrf-value',
      },
    },
    403,
    'Origem da requisicao nao autorizada'
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
}

async function main() {
  runCryptoChecks();

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
    await runHttpChecks();
    console.log('Security smoke tests passed.');
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
