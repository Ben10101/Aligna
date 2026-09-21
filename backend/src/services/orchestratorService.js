import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_ARGS_PREFIX = ['-u', '-X', 'utf8'];
const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function getPythonCmd() {
  // IMPORTANTE (ESM): dotenv.config() roda após imports; ler process.env aqui garante pegar o .env já carregado.
  return process.env.PYTHON_CMD || 'python';
}

function getPythonEnv(envOverrides = {}) {
  return {
    ...process.env,
    ...envOverrides,
    ALIGNA_AGENT_RUNTIME_MODE: envOverrides.ALIGNA_AGENT_RUNTIME_MODE || process.env.ALIGNA_AGENT_RUNTIME_MODE || 'modern-single-agent',
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  };
}

function getAgentTimeoutMs() {
  const rawValue = process.env.AGENT_RUN_TIMEOUT_MS;
  const parsedValue = Number(rawValue);

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return DEFAULT_AGENT_TIMEOUT_MS;
}

function assertObjectPayload(payload, label) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${label} precisa ser um objeto JSON valido.`);
  }
}

function extractProviderDiagnostic(stderrData = '') {
  const allowedKeys = [
    'event', 'task', 'agent', 'provider', 'model', 'provider_order',
    'ollama_included', 'success', 'failure', 'retry', 'provider_retry',
    'fallback', 'will_retry', 'latency_ms', 'delay_seconds',
  ];
  const events = [];

  for (const line of String(stderrData).split(/\r?\n/)) {
    const payload = line.replace(/^\[Model Router\]\s*/, '').trim();
    if (!payload.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(payload);
      if (!parsed?.event && !Object.prototype.hasOwnProperty.call(parsed, 'provider')) continue;
      const event = {};
      for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) event[key] = parsed[key];
      }
      events.push(event);
    } catch {
      // stderr can contain non-JSON diagnostics; they must not break a run.
    }
  }

  return events.length ? { providerAttempts: events.slice(-30) } : null;
}

/**
 * Executa o pipeline completo de geração de projetos (funcionalidade antiga).
 */
export function orchestrateProject(projectId, idea) {
  return new Promise((resolve, reject) => {
    if (!projectId || !String(projectId).trim()) {
      return reject(new Error('projectId é obrigatório para executar o orchestrator.'));
    }

    if (!idea || !String(idea).trim()) {
      return reject(new Error('idea é obrigatória para executar o orchestrator.'));
    }

    const orchestratorPath = path.join(__dirname, '..', '..', '..', 'orchestrator', 'factory.py');
    const pythonCmd = getPythonCmd();
    const pythonProcess = spawn(pythonCmd, [...PYTHON_ARGS_PREFIX, orchestratorPath, projectId, idea], {
      env: getPythonEnv(),
    });

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`[Python STDERR] ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Erro ao executar orchestrator: ${stderrData}`));
      }
      try {
        const result = JSON.parse(stdoutData);
        resolve(result);
      } catch (e) {
        reject(new Error(`Falha ao analisar JSON do orchestrator: ${e.message}. Output: ${stdoutData}`));
      }
    });
  });
}

/**
 * Executa um único agente de IA.
 */
export function runSingleAgent(agent, payload, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      assertObjectPayload(payload, `Payload do agente ${agent}`);
    } catch (error) {
      return reject(error);
    }

    const agentRunnerPath = path.join(__dirname, '..', '..', '..', 'orchestrator', 'run_single_agent.py');
    const pythonCmd = getPythonCmd();
    const timeoutMs = getAgentTimeoutMs();
    const pythonProcess = spawn(pythonCmd, [...PYTHON_ARGS_PREFIX, agentRunnerPath], {
      env: getPythonEnv(options.envOverrides || {}),
    });

    let stdoutData = '';
    let stderrData = '';
    let timeoutHandle = null;
    let timeoutError = null;
    let settled = false;

    const emitDiagnostic = () => {
      const diagnostic = extractProviderDiagnostic(stderrData);
      if (diagnostic && typeof options.diagnosticSink === 'function') {
        options.diagnosticSink(diagnostic);
      }
      return diagnostic;
    };

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    pythonProcess.on('error', (err) => {
      // Quando o executável não existe ou não pode ser iniciado (ENOENT, EACCES, etc.)
      settle(reject, new Error(`Falha ao iniciar Python (${pythonCmd}): ${err.message}`));
    });

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`[Python STDERR] ${data}`);
    });

    timeoutHandle = setTimeout(() => {
      timeoutError = new Error(
        `Tempo limite excedido ao executar o agente ${agent} (${Math.round(timeoutMs / 1000)}s).`
      );
      console.error(`[Agent Timeout] ${timeoutError.message}`);
      pythonProcess.kill();

      setTimeout(() => {
        if (!settled) {
          pythonProcess.kill('SIGKILL');
        }
      }, 5000).unref?.();
    }, timeoutMs);

    pythonProcess.on('close', (code, signal) => {
      const providerDiagnostic = emitDiagnostic();
      if (timeoutError) {
        timeoutError.agentDiagnostic = providerDiagnostic;
        return settle(reject, timeoutError);
      }

      if (code !== 0) {
        // Muitas vezes o script Python escreve o erro em JSON no stdout
        // ({"success": false, "error": "mensagem"}) e sai com código 1.
        // Tentamos extrair essa mensagem para deixar o erro mais claro.
        let detailedError = stderrData;
        let diagnostic = null;
        try {
          if (stdoutData) {
            const parsed = JSON.parse(stdoutData);
            if (parsed && parsed.error) {
              detailedError = parsed.error;
            }
            if (parsed?.diagnostic) {
              diagnostic = parsed.diagnostic;
            }
          }
        } catch {
          // Se não for JSON válido, ignoramos e ficamos com stderrData
        }
        if (!detailedError) {
          detailedError = `Processo Python finalizou com code=${code ?? 'null'} signal=${signal ?? 'null'} (sem saída em stdout/stderr)`;
        }
        const agentError = new Error(`Erro ao executar agente ${agent}: ${detailedError}`);
        agentError.agentDiagnostic = diagnostic || providerDiagnostic;
        return settle(reject, agentError);
      }
      try {
        const result = JSON.parse(stdoutData);
        if (result.success) {
          settle(resolve, result.data);
        } else {
          const agentError = new Error(`Erro no script do agente ${agent}: ${result.error}`);
          agentError.agentDiagnostic = providerDiagnostic;
          settle(reject, agentError);
        }
      } catch (e) {
        const agentError = new Error(`Falha ao analisar JSON do agente ${agent}: ${e.message}. Output: ${stdoutData}`);
        agentError.agentDiagnostic = providerDiagnostic;
        settle(reject, agentError);
      }
    });

    // Envia o payload para o script Python via stdin
    pythonProcess.stdin.write(JSON.stringify({ agent, payload, runtime_mode: 'modern-single-agent' }));
    pythonProcess.stdin.end();
  });
}

/**
 * Executa o pipeline de sub-agentes para implementação.
 */
export function runImplementationPipeline(payload, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      assertObjectPayload(payload, 'Payload do pipeline de implementacao');
    } catch (error) {
      return reject(error);
    }

    const pipelineRunnerPath = path.join(__dirname, '..', '..', '..', 'orchestrator', 'run_implementation_pipeline.py');
    const pythonCmd = getPythonCmd();
    const timeoutMs = getAgentTimeoutMs();
    const pythonProcess = spawn(pythonCmd, [...PYTHON_ARGS_PREFIX, pipelineRunnerPath], {
      env: getPythonEnv(options.envOverrides || {}),
    });

    let stdoutData = '';
    let stderrData = '';
    let timeoutHandle = null;
    let timeoutError = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    pythonProcess.on('error', (err) => {
      settle(reject, new Error(`Falha ao iniciar Python (${pythonCmd}): ${err.message}`));
    });

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`[Pipeline STDERR] ${data}`);
    });

    timeoutHandle = setTimeout(() => {
      timeoutError = new Error(`Tempo limite excedido ao executar o pipeline de implementação.`);
      pythonProcess.kill();
    }, timeoutMs);

    pythonProcess.on('close', (code, signal) => {
      if (timeoutError) return settle(reject, timeoutError);

      if (code !== 0) {
        let detailedError = stderrData;
        try {
          if (stdoutData) {
            const parsed = JSON.parse(stdoutData);
            if (parsed && parsed.error) detailedError = parsed.error;
          }
        } catch {}
        return settle(reject, new Error(`Erro no pipeline: ${detailedError || 'Sem saida'}`));
      }

      try {
        const result = JSON.parse(stdoutData);
        if (result.success) {
          settle(resolve, result.data);
        } else {
          settle(reject, new Error(`Erro no script do pipeline: ${result.error}`));
        }
      } catch (e) {
        settle(reject, new Error(`Falha ao analisar JSON do pipeline: ${e.message}`));
      }
    });

    pythonProcess.stdin.write(JSON.stringify({ payload }));
    pythonProcess.stdin.end();
  });
}
