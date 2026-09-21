function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function estimateTokenCount(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

export function buildAiRuntimeMeta(envOverrides = {}) {
  const providerOrder = String(envOverrides.AI_PROVIDER_ORDER || process.env.AI_PROVIDER_ORDER || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const primaryProvider = providerOrder[0] || envOverrides.LLM_PROVIDER || process.env.LLM_PROVIDER || 'unknown';

  const modelByProvider = {
    ollama: envOverrides.OLLAMA_MODEL || process.env.OLLAMA_MODEL || null,
    gemini: envOverrides.GEMINI_MODEL || process.env.GEMINI_MODEL || null,
    openrouter: envOverrides.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || null,
    groq: envOverrides.GROQ_MODEL || process.env.GROQ_MODEL || null,
    openai: envOverrides.OPENAI_MODEL || process.env.OPENAI_MODEL || null,
    deepseek: envOverrides.DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || null,
    nvidia: envOverrides.NVIDIA_MODEL || process.env.NVIDIA_MODEL || null,
    anthropic: envOverrides.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || null,
  };

  return {
    providerOrder,
    primaryProvider,
    primaryModel: modelByProvider[primaryProvider] || null,
    localFallbackDisabled: String(envOverrides.AI_DISABLE_OLLAMA_FALLBACK || process.env.AI_DISABLE_OLLAMA_FALLBACK || '') === '1',
    policyVersion: envOverrides.AI_POLICY_VERSION || process.env.AI_POLICY_VERSION || 'v1',
    promptVersion: envOverrides.AI_PROMPT_VERSION || process.env.AI_PROMPT_VERSION || 'v1',
    releaseVersion: envOverrides.PLATFORM_VERSION || process.env.PLATFORM_VERSION || '1.0.0',
    capturedAt: new Date().toISOString(),
  };
}

export function withAiRuntimeMeta(payload, envOverrides = {}) {
  return {
    ...payload,
    _runtimeMeta: buildAiRuntimeMeta(envOverrides),
  };
}

function estimateCostUsd(primaryProvider, totalTokens) {
  const rates = {
    openrouter: 0.0000025,
    openai: 0.0000035,
    deepseek: 0.0000012,
    nvidia: 0.0000018,
    anthropic: 0.000004,
    gemini: 0.0000015,
    groq: 0.000001,
    ollama: 0,
    auto: 0.000002,
  };

  const rate = rates[primaryProvider] ?? rates.auto;
  return Number((totalTokens * rate).toFixed(6));
}

export function buildAgentRunUsage(payload, result, envOverrides = {}) {
  const inputPayload = payload || {};
  const outputPayload = typeof result === 'string' ? result : JSON.stringify(result || {});
  const tokensInput = estimateTokenCount(inputPayload);
  const tokensOutput = estimateTokenCount(outputPayload);
  const runtimeMeta = buildAiRuntimeMeta(envOverrides);

  return {
    tokensInput,
    tokensOutput,
    costUsd: estimateCostUsd(runtimeMeta.primaryProvider, tokensInput + tokensOutput),
    runtimeMeta,
  };
}

export function extractRuntimeMetaFromPayload(inputPayload) {
  const parsed = typeof inputPayload === 'string' ? safeJsonParse(inputPayload, {}) : inputPayload || {};
  return parsed?._runtimeMeta || null;
}

export function buildBudgetConfig() {
  return {
    project_manager: Number(process.env.BUDGET_PROJECT_MANAGER_TOKENS || 2400),
    requirements_analyst: Number(process.env.BUDGET_REQUIREMENTS_TOKENS || 2600),
    qa_engineer: Number(process.env.BUDGET_QA_TOKENS || 2200),
    architect: Number(process.env.BUDGET_ARCHITECT_TOKENS || 2800),
  };
}
