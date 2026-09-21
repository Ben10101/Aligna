import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const EVAL_ROOT = path.join(REPO_ROOT, 'agent-evals');
const CASES_DIR = path.join(EVAL_ROOT, 'cases');
const RESULTS_DIR = path.join(EVAL_ROOT, 'results');
const RESULT_TEMPLATE = path.join(EVAL_ROOT, 'result-template.md');
const CASE_COMMANDS = {
  'generator-security-baseline': ['npm --prefix backend run test:security:baseline'],
  'backend-auth-hardening': [
    'npm --prefix backend run test:security:smoke',
    'npm --prefix backend run test:auth-governance:smoke',
    'npm --prefix backend run test:auth-user-flow:smoke',
  ],
  'frontend-bundle-discipline': ['npm --prefix frontend run build'],
  'aligna-platform-flow': ['npm --prefix backend run test:e2e:platform'],
  'aligna-ui-copy-generation': [
    'python orchestrator/generate_implementation_ui.py < agent-evals/fixtures/aligna-ui-copy-generation.json',
  ],
  'developer-backend-depth': [
    'python scripts/agent-evals/run-developer-agent.py developer_backend agent-evals/fixtures/developer-backend-depth.json',
  ],
  'developer-frontend-depth': [
    'python scripts/agent-evals/run-developer-agent.py developer_frontend agent-evals/fixtures/developer-frontend-depth.json',
  ],
  'generation-ir-contract': ['node scripts/agent-evals/validate-generation-ir.mjs'],
  'ui-archetype-generalization': ['node scripts/agent-evals/validate-ui-archetypes.mjs'],
  'component-map-generalization': ['node scripts/agent-evals/validate-component-map.mjs'],
  'project-manager-backlog-quality': ['node scripts/agent-evals/validate-pm-backlog.mjs'],
  'pipeline-coherence-observability': ['npm --prefix backend run test:pipeline-coherence:smoke'],
};

function usage() {
  console.log(
    'Usage: node scripts/agent-evals/run-eval.mjs <case-id> [--prompt-version <value>] [--evaluator <name>] [--model <name>] [--target <value>] [--provider-order <csv>] [--llm-provider <value>] [--disable-ollama-fallback] [--run]'
  );
}

function getFlag(args, flagName) {
  const index = args.indexOf(flagName);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureCaseExists(caseId) {
  const casePath = path.join(CASES_DIR, `${caseId}.md`);
  await readFile(casePath, 'utf8');
  return casePath;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueResultPath(baseName) {
  let attempt = 0;
  while (true) {
    const candidateName = attempt === 0 ? `${baseName}.md` : `${baseName}-${attempt + 1}.md`;
    const candidatePath = path.join(RESULTS_DIR, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }
}

function runCommand(command, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolve({
        command,
        code: code ?? 1,
        status: code === 0 ? 'passed' : 'failed',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        env: extraEnv,
      });
    });
  });
}

function summarizeOutput(output = '') {
  const normalized = String(output || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return normalized.slice(-3).join(' | ');
}

function extractJsonPayload(output = '') {
  const text = String(output || '').trim();
  if (!text) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildRuntimeOverrides(args) {
  const overrides = {};
  const providerOrder = getFlag(args, '--provider-order');
  const llmProvider = getFlag(args, '--llm-provider');
  const disableOllamaFallback = args.includes('--disable-ollama-fallback');

  if (providerOrder) {
    overrides.AI_PROVIDER_ORDER = providerOrder;
  }

  if (llmProvider) {
    overrides.LLM_PROVIDER = llmProvider;
  }

  if (disableOllamaFallback) {
    overrides.AI_DISABLE_OLLAMA_FALLBACK = '1';
  }

  return overrides;
}

function formatEnvSummary(env = {}) {
  const keys = ['LLM_PROVIDER', 'AI_PROVIDER_ORDER', 'AI_DISABLE_OLLAMA_FALLBACK'];
  const parts = keys
    .filter((key) => env[key] !== undefined && env[key] !== '')
    .map((key) => `${key}=${env[key]}`);
  return parts.join(' | ');
}

async function runMappedCommands(caseId, args) {
  const commands = CASE_COMMANDS[caseId] || [];
  const results = [];
  const extraEnv = buildRuntimeOverrides(args);

  for (const command of commands) {
    results.push(await runCommand(command, REPO_ROOT, extraEnv));
  }

  return results;
}

async function buildResultContent({ caseId, promptVersion, evaluator, model, target }) {
  const template = await readFile(RESULT_TEMPLATE, 'utf8');
  return template
    .replace('- date:', `- date: ${formatDate()}`)
    .replace('- evaluator:', `- evaluator: ${evaluator}`)
    .replace('- prompt_version:', `- prompt_version: ${promptVersion}`)
    .replace('- case_id:', `- case_id: ${caseId}`)
    .replace('- target_agent_or_flow:', `- target_agent_or_flow: ${target}`)
    .replace('- model:', `- model: ${model}`);
}

function appendValidationSection(content, commandResults) {
  if (!commandResults.length) return content;

  const lines = ['','## Automated Validation',''];

  for (const result of commandResults) {
    lines.push(`- \`${result.command}\`: ${result.status}`);
    const envSummary = formatEnvSummary(result.env);
    if (envSummary) {
      lines.push(`  env: ${envSummary}`);
    }
    const parsedOutput = extractJsonPayload(result.stdout);
    const providerHint = parsedOutput?.meta?.providerHint;
    const source = parsedOutput?.meta?.source;
    if (source || providerHint) {
      lines.push(`  runtime: source=${source || 'unknown'}${providerHint ? ` | provider_hint=${providerHint}` : ''}`);
    }
    const artifactVersion = parsedOutput?.artifact_version || parsedOutput?.data?.artifact_version;
    if (artifactVersion) {
      lines.push(`  artifact_version: ${artifactVersion}`);
    }
    const primaryEntity =
      parsedOutput?.primary_entity ||
      parsedOutput?.data?.primary_entity ||
      parsedOutput?.delivery_summary?.entity ||
      parsedOutput?.backend_summary?.entity ||
      parsedOutput?.frontend_summary?.entity;
    if (primaryEntity) {
      lines.push(`  primary_entity: ${primaryEntity}`);
    }
    const modules =
      parsedOutput?.modules ||
      parsedOutput?.data?.modules ||
      parsedOutput?.experience?.ui_sections ||
      parsedOutput?.api_contract?.operations;
    if (Array.isArray(modules) && modules.length) {
      lines.push(`  signal: ${modules.slice(0, 4).join(' | ')}`);
    }
    const summary = summarizeOutput(result.stdout || result.stderr);
    if (summary) {
      lines.push(`  summary: ${summary}`);
    }
  }

  return `${content.trimEnd()}\n${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const caseId = args[0];

  if (!caseId || caseId.startsWith('-')) {
    usage();
    process.exit(1);
  }

  await ensureCaseExists(caseId);
  await mkdir(RESULTS_DIR, { recursive: true });

  const promptVersion = getFlag(args, '--prompt-version') || process.env.AI_PROMPT_VERSION || 'v1';
  const evaluator = getFlag(args, '--evaluator') || 'Codex';
  const model = getFlag(args, '--model') || 'manual-eval';
  const target = getFlag(args, '--target') || `${caseId} workflow`;
  const shouldRun = args.includes('--run');
  const baseName = `${formatDate()}-${slugify(caseId)}-${slugify(promptVersion)}`;
  const resultPath = await resolveUniqueResultPath(baseName);
  const commandResults = shouldRun ? await runMappedCommands(caseId, args) : [];
  let content = await buildResultContent({ caseId, promptVersion, evaluator, model, target });
  content = appendValidationSection(content, commandResults);

  await writeFile(resultPath, content, 'utf8');
  console.log(path.relative(REPO_ROOT, resultPath));

  if (commandResults.some((result) => result.status === 'failed')) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`Failed to create eval result: ${error.message}`);
  process.exit(1);
});
