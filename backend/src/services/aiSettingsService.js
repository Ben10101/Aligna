import { prisma } from '../lib/prisma.js';
import { decryptSensitiveValue, encryptSensitiveValue } from '../utils/crypto.js';

const ENCRYPTED_VALUE_PREFIX = 'enc::';
// OpenRouter retired this free slug. Keep the runtime resilient for users
// who had the old UI preset saved before it became unavailable.
const RETIRED_OPENROUTER_FALLBACK_MODELS = new Set(['openai/gpt-oss-120b:free']);
const RETIRED_GEMINI_MODELS = new Set(['gemini-2.0-flash', 'models/gemini-2.0-flash']);
const RETIRED_GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'qwen/qwen3.6-27b']);
const RETIRED_NVIDIA_MODELS = new Set(['qwen/qwen3.5-122b-a10b', 'meta/llama-3.3-70b-instruct']);

const DEFAULT_AI_SETTINGS = {
  providerPreference: 'auto',
  agentAliases: {
    project_manager: 'PM Agent',
    requirements_analyst: 'Requirements Agent',
    qa_engineer: 'QA Agent',
    architect: 'Architect Agent',
  },
  ollama: {
    enabled: false,
    host: 'http://127.0.0.1:11434',
    model: 'gemma3:4b',
  },
  gemini: {
    enabled: false,
    apiKey: '',
    model: 'gemini-3.6-flash',
  },
  openai: {
    enabled: false,
    apiKey: '',
    model: 'gpt-4.1-mini',
  },
  deepseek: {
    enabled: false,
    apiKey: '',
    model: 'deepseek-chat',
  },
  nvidia: {
    enabled: false,
    apiKey: '',
    model: 'deepseek-ai/deepseek-v4-flash-0731',
  },
  anthropic: {
    enabled: false,
    apiKey: '',
    model: 'claude-3-5-sonnet-latest',
  },
  groq: {
    enabled: false,
    apiKey: '',
    model: 'openai/gpt-oss-120b',
  },
  huggingface: {
    enabled: false,
    apiKey: '',
    model: 'meta-llama/Llama-3.1-8B-Instruct:hf-inference',
  },
  openrouter: {
    enabled: false,
    apiKey: '',
    model: 'openai/gpt-4.1-mini',
    fallbackModels: [],
  },
};

const REMOTE_PROVIDER_KEYS = ['gemini', 'openai', 'deepseek', 'nvidia', 'anthropic', 'groq', 'huggingface', 'openrouter'];
const ALLOWED_PROVIDER_PREFERENCES = ['auto', 'ollama', ...REMOTE_PROVIDER_KEYS];

function getAiSettingsSecret() {
  const secret = process.env.AI_SETTINGS_SECRET || process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret?.trim()) {
    throw new Error('AI_SETTINGS_SECRET ou AUTH_ACCESS_SECRET/JWT_SECRET precisa estar configurado para proteger as credenciais de IA.');
  }
  return secret;
}

function normalizeAgentAliases(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = { ...fallback };

  for (const [key, alias] of Object.entries(source)) {
    normalized[key] = String(alias || '').trim() || fallback[key] || key;
  }

  return normalized;
}

function normalizeProviderSettings(current = {}, fallback = {}) {
  const source = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const normalized = {
    ...fallback,
    ...source,
  };

  delete normalized.apiKeyConfigured;
  delete normalized.apiKeyPreview;
  delete normalized.clearApiKey;
  // Settings created by older clients may contain checkbox values serialized
  // as strings. Runtime routing relies on strict booleans, especially for
  // Ollama preference, so normalize them at the source of truth.
  if (typeof normalized.enabled !== 'boolean') {
    normalized.enabled = String(normalized.enabled || '').trim().toLowerCase() === 'true';
  }

  if (RETIRED_GEMINI_MODELS.has(String(normalized.model || '').trim().toLowerCase())) {
    normalized.model = DEFAULT_AI_SETTINGS.gemini.model;
  }
  if (RETIRED_GROQ_MODELS.has(String(normalized.model || '').trim().toLowerCase())) {
    normalized.model = DEFAULT_AI_SETTINGS.groq.model;
  }
  if (RETIRED_NVIDIA_MODELS.has(String(normalized.model || '').trim().toLowerCase())) {
    normalized.model = DEFAULT_AI_SETTINGS.nvidia.model;
  }
  if (['openai/gpt-oss-120b:cerebras', 'qwen/qwen2.5-7b-instruct:hf-inference'].includes(String(normalized.model || '').trim().toLowerCase())) {
    normalized.model = DEFAULT_AI_SETTINGS.huggingface.model;
  }
  return normalized;
}

function normalizeModelList(value) {
  const normalize = (item) => String(item || '').trim();
  const isAvailable = (item) => item && !RETIRED_OPENROUTER_FALLBACK_MODELS.has(item.toLowerCase());
  if (Array.isArray(value)) {
    return value
      .map(normalize)
      .filter(isAvailable);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/)
      .map(normalize)
      .filter(isAvailable);
  }

  return [];
}

function normalizeProviderPreference(value, fallback = DEFAULT_AI_SETTINGS.providerPreference) {
  return String(value || fallback).trim().toLowerCase() || fallback;
}

function isEncryptedApiKey(value) {
  return String(value || '').startsWith(ENCRYPTED_VALUE_PREFIX);
}

function decryptApiKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!isEncryptedApiKey(normalized)) return normalized;
  return decryptSensitiveValue(normalized.slice(ENCRYPTED_VALUE_PREFIX.length), getAiSettingsSecret());
}

function encryptApiKey(value) {
  const plain = String(value || '').trim();
  if (!plain) return '';
  return `${ENCRYPTED_VALUE_PREFIX}${encryptSensitiveValue(plain, getAiSettingsSecret())}`;
}

function maskApiKey(value) {
  const plain = String(value || '').trim();
  if (!plain) return null;
  const suffix = plain.slice(-4);
  return `****${suffix}`;
}

function exposeRemoteProvider(providerSettings, { includeSecrets = false } = {}) {
  const normalized = normalizeProviderSettings(providerSettings, { enabled: false, apiKey: '', model: '' });
  const plainApiKey = decryptApiKey(normalized.apiKey);

  return {
    ...normalized,
    apiKey: includeSecrets ? plainApiKey : '',
    apiKeyConfigured: Boolean(plainApiKey),
    apiKeyPreview: includeSecrets ? null : maskApiKey(plainApiKey),
  };
}

function exposeAiSettings(settings, { includeSecrets = false } = {}) {
  const normalized = normalizeAiSettings(settings);

  return {
    providerPreference: normalized.providerPreference,
    agentAliases: normalized.agentAliases,
    ollama: normalizeProviderSettings(normalized.ollama, DEFAULT_AI_SETTINGS.ollama),
    gemini: exposeRemoteProvider(normalized.gemini, { includeSecrets }),
    openai: exposeRemoteProvider(normalized.openai, { includeSecrets }),
    deepseek: exposeRemoteProvider(normalized.deepseek, { includeSecrets }),
    nvidia: exposeRemoteProvider(normalized.nvidia, { includeSecrets }),
    anthropic: exposeRemoteProvider(normalized.anthropic, { includeSecrets }),
    groq: exposeRemoteProvider(normalized.groq, { includeSecrets }),
    huggingface: exposeRemoteProvider(normalized.huggingface, { includeSecrets }),
    openrouter: {
      ...exposeRemoteProvider(normalized.openrouter, { includeSecrets }),
      fallbackModels: normalizeModelList(normalized.openrouter?.fallbackModels),
    },
  };
}

function mergeRemoteProvider(currentProvider, inputProvider, fallback, { encryptSecrets = false } = {}) {
  const current = normalizeProviderSettings(currentProvider, fallback);
  const patch = inputProvider && typeof inputProvider === 'object' && !Array.isArray(inputProvider) ? inputProvider : {};
  const next = normalizeProviderSettings(
    {
      ...current,
      ...patch,
    },
    fallback
  );

  const currentPlainApiKey = decryptApiKey(current.apiKey);
  let nextPlainApiKey = currentPlainApiKey;

  if (patch.clearApiKey === true) {
    nextPlainApiKey = '';
  } else if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
    const candidate = String(patch.apiKey || '').trim();
    nextPlainApiKey = candidate || currentPlainApiKey;
  }

  next.apiKey = encryptSecrets ? encryptApiKey(nextPlainApiKey) : nextPlainApiKey;
  return next;
}

async function readStoredAiSettingsForUser(userUuid) {
  const user = await prisma.user.findUnique({
    where: { uuid: userUuid },
    select: { aiSettings: true },
  });

  return normalizeAiSettings(user?.aiSettings || {});
}

function hasLegacyPlaintextSecrets(settings) {
  return REMOTE_PROVIDER_KEYS.some((providerKey) => {
    const apiKey = String(settings?.[providerKey]?.apiKey || '').trim();
    return apiKey && !isEncryptedApiKey(apiKey);
  });
}

function buildEncryptedSettingsSnapshot(settings) {
  return mergeAiSettings(settings, {}, { encryptSecrets: true });
}

async function migrateLegacySecretsIfNeeded(userUuid, settings) {
  if (!hasLegacyPlaintextSecrets(settings)) {
    return settings;
  }

  const encryptedSettings = buildEncryptedSettingsSnapshot(settings);
  await prisma.user.update({
    where: { uuid: userUuid },
    data: { aiSettings: encryptedSettings },
  });

  return encryptedSettings;
}

function assertValidUrlIfPresent(value, label) {
  const text = String(value || '').trim();
  if (!text) return;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} precisa ser uma URL valida.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} precisa usar http ou https.`);
  }
}

function assertTextLength(value, maxLength, label) {
  if (String(value || '').trim().length > maxLength) {
    throw new Error(`${label} excede o limite de ${maxLength} caracteres.`);
  }
}

function validateAiSettingsPayload(settings) {
  if (!ALLOWED_PROVIDER_PREFERENCES.includes(settings.providerPreference)) {
    throw new Error('providerPreference invalido.');
  }

  assertValidUrlIfPresent(settings.ollama?.host, 'Host do Ollama');
  assertTextLength(settings.ollama?.model, 120, 'Modelo do Ollama');

  for (const [aliasKey, aliasValue] of Object.entries(settings.agentAliases || {})) {
    assertTextLength(aliasValue, 60, `Alias do agente ${aliasKey}`);
  }

  for (const providerKey of REMOTE_PROVIDER_KEYS) {
    const provider = settings[providerKey] || {};
    assertTextLength(provider.model, 160, `Modelo de ${providerKey}`);

    const apiKey = decryptApiKey(provider.apiKey);
    assertTextLength(apiKey, 512, `API key de ${providerKey}`);
  }

  const fallbackModels = normalizeModelList(settings.openrouter?.fallbackModels);
  if (fallbackModels.length > 8) {
    throw new Error('OpenRouter aceita no maximo 8 modelos de fallback.');
  }

  for (const [index, model] of fallbackModels.entries()) {
    assertTextLength(model, 160, `Fallback ${index + 1} do OpenRouter`);
  }
}

export function normalizeAiSettings(input = {}) {
  const normalizedOpenRouter = normalizeProviderSettings(input.openrouter, DEFAULT_AI_SETTINGS.openrouter);

  return {
    providerPreference: normalizeProviderPreference(input.providerPreference, DEFAULT_AI_SETTINGS.providerPreference),
    agentAliases: normalizeAgentAliases(input.agentAliases, DEFAULT_AI_SETTINGS.agentAliases),
    ollama: normalizeProviderSettings(input.ollama, DEFAULT_AI_SETTINGS.ollama),
    gemini: normalizeProviderSettings(input.gemini, DEFAULT_AI_SETTINGS.gemini),
    openai: normalizeProviderSettings(input.openai, DEFAULT_AI_SETTINGS.openai),
    deepseek: normalizeProviderSettings(input.deepseek, DEFAULT_AI_SETTINGS.deepseek),
    nvidia: normalizeProviderSettings(input.nvidia, DEFAULT_AI_SETTINGS.nvidia),
    anthropic: normalizeProviderSettings(input.anthropic, DEFAULT_AI_SETTINGS.anthropic),
    groq: normalizeProviderSettings(input.groq, DEFAULT_AI_SETTINGS.groq),
    huggingface: normalizeProviderSettings(input.huggingface, DEFAULT_AI_SETTINGS.huggingface),
    openrouter: {
      ...normalizedOpenRouter,
      fallbackModels: normalizeModelList(normalizedOpenRouter.fallbackModels),
    },
  };
}

export function mergeAiSettings(currentSettings = {}, input = {}, options = {}) {
  const current = normalizeAiSettings(currentSettings);
  const patch = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const encryptSecrets = options.encryptSecrets === true;

  return {
    providerPreference: normalizeProviderPreference(patch.providerPreference, current.providerPreference),
    agentAliases: normalizeAgentAliases(
      {
        ...current.agentAliases,
        ...(patch.agentAliases || {}),
      },
      DEFAULT_AI_SETTINGS.agentAliases
    ),
    ollama: normalizeProviderSettings(
      {
        ...current.ollama,
        ...(patch.ollama || {}),
      },
      DEFAULT_AI_SETTINGS.ollama
    ),
    gemini: mergeRemoteProvider(current.gemini, patch.gemini, DEFAULT_AI_SETTINGS.gemini, { encryptSecrets }),
    openai: mergeRemoteProvider(current.openai, patch.openai, DEFAULT_AI_SETTINGS.openai, { encryptSecrets }),
    deepseek: mergeRemoteProvider(current.deepseek, patch.deepseek, DEFAULT_AI_SETTINGS.deepseek, { encryptSecrets }),
    nvidia: mergeRemoteProvider(current.nvidia, patch.nvidia, DEFAULT_AI_SETTINGS.nvidia, { encryptSecrets }),
    anthropic: mergeRemoteProvider(current.anthropic, patch.anthropic, DEFAULT_AI_SETTINGS.anthropic, { encryptSecrets }),
    groq: mergeRemoteProvider(current.groq, patch.groq, DEFAULT_AI_SETTINGS.groq, { encryptSecrets }),
    huggingface: mergeRemoteProvider(current.huggingface, patch.huggingface, DEFAULT_AI_SETTINGS.huggingface, { encryptSecrets }),
    openrouter: {
      ...mergeRemoteProvider(current.openrouter, patch.openrouter, DEFAULT_AI_SETTINGS.openrouter, { encryptSecrets }),
      fallbackModels: normalizeModelList(patch.openrouter?.fallbackModels ?? current.openrouter?.fallbackModels),
    },
  };
}

export async function getAiSettingsForUser(userUuid, options = {}) {
  const storedSettings = await migrateLegacySecretsIfNeeded(userUuid, await readStoredAiSettingsForUser(userUuid));
  return exposeAiSettings(storedSettings, { includeSecrets: options.includeSecrets === true });
}

export async function updateAiSettingsForUser(userUuid, input = {}) {
  const currentStoredSettings = await migrateLegacySecretsIfNeeded(userUuid, await readStoredAiSettingsForUser(userUuid));
  const nextStoredSettings = mergeAiSettings(currentStoredSettings, input, { encryptSecrets: true });
  validateAiSettingsPayload(nextStoredSettings);

  await prisma.user.update({
    where: { uuid: userUuid },
    data: { aiSettings: nextStoredSettings },
  });

  return exposeAiSettings(nextStoredSettings);
}

export async function buildRuntimeAiEnvForUser(userUuid, options = {}) {
  const settings = await getAiSettingsForUser(userUuid, { includeSecrets: true });
  const localProviderEnabled = settings.ollama?.enabled === true;
  const localProviderPreferred = settings.providerPreference === 'ollama' && localProviderEnabled;
  // Choosing Ollama in the UI must be sufficient to use it. Previously it
  // was added only by callers that explicitly requested a local fallback,
  // which made the selected local provider unreachable for normal agent runs.
  const includeLocalFallback = options.includeLocalFallback === true || localProviderPreferred;
  const agentName = String(options.agentName || '').trim().toLowerCase();
  const remoteProviders = REMOTE_PROVIDER_KEYS.filter(
    (providerKey) => settings[providerKey]?.enabled && settings[providerKey]?.apiKey
  );
  const agentForcesNvidia = false;
  const preferredProvider =
    agentForcesNvidia
      ? 'nvidia'
      : settings.providerPreference && settings.providerPreference !== 'auto' && settings.providerPreference !== 'ollama'
      ? settings.providerPreference
      : null;
  const orderedRemoteProviders = [
    ...(preferredProvider && remoteProviders.includes(preferredProvider) ? [preferredProvider] : []),
    ...remoteProviders.filter((providerKey) => providerKey !== preferredProvider),
  ];
  const providerOrder = [
    ...(localProviderPreferred ? ['ollama'] : orderedRemoteProviders),
    ...(localProviderPreferred ? orderedRemoteProviders : []),
    ...(includeLocalFallback && !localProviderPreferred && localProviderEnabled ? ['ollama'] : []),
  ];
  const effectiveProviderPreference =
    localProviderPreferred || includeLocalFallback || settings.providerPreference !== 'ollama'
      ? settings.providerPreference || 'auto'
      : preferredProvider || 'auto';
  const env = {
    LLM_PROVIDER: effectiveProviderPreference,
    AI_PROVIDER_ORDER: providerOrder.join(','),
    AI_DISABLE_OLLAMA_FALLBACK: includeLocalFallback ? '0' : '1',
    OLLAMA_HOST: settings.ollama?.host || DEFAULT_AI_SETTINGS.ollama.host,
    OLLAMA_MODEL: settings.ollama?.model || DEFAULT_AI_SETTINGS.ollama.model,
    GEMINI_MODEL: settings.gemini?.model || DEFAULT_AI_SETTINGS.gemini.model,
    OPENAI_MODEL: settings.openai?.model || DEFAULT_AI_SETTINGS.openai.model,
    DEEPSEEK_MODEL: settings.deepseek?.model || DEFAULT_AI_SETTINGS.deepseek.model,
    NVIDIA_MODEL: settings.nvidia?.model || DEFAULT_AI_SETTINGS.nvidia.model,
    ANTHROPIC_MODEL: settings.anthropic?.model || DEFAULT_AI_SETTINGS.anthropic.model,
    GROQ_MODEL: settings.groq?.model || DEFAULT_AI_SETTINGS.groq.model,
    HF_MODEL: settings.huggingface?.model || DEFAULT_AI_SETTINGS.huggingface.model,
    OPENROUTER_MODEL: settings.openrouter?.model || DEFAULT_AI_SETTINGS.openrouter.model,
    OPENROUTER_MODEL_FALLBACKS: normalizeModelList(settings.openrouter?.fallbackModels).join(','),
  };

  if (agentName) {
    env.AI_AGENT_NAME = agentName;
  }

  if (settings.gemini?.enabled && settings.gemini?.apiKey) env.GEMINI_API_KEY = settings.gemini.apiKey;
  if (settings.openai?.enabled && settings.openai?.apiKey) env.OPENAI_API_KEY = settings.openai.apiKey;
  if (settings.deepseek?.enabled && settings.deepseek?.apiKey) env.DEEPSEEK_API_KEY = settings.deepseek.apiKey;
  if (settings.nvidia?.enabled && settings.nvidia?.apiKey) env.NVIDIA_API_KEY = settings.nvidia.apiKey;
  if (settings.anthropic?.enabled && settings.anthropic?.apiKey) env.ANTHROPIC_API_KEY = settings.anthropic.apiKey;
  if (settings.groq?.enabled && settings.groq?.apiKey) env.GROQ_API_KEY = settings.groq.apiKey;
  if (settings.huggingface?.enabled && settings.huggingface?.apiKey) env.HF_TOKEN = settings.huggingface.apiKey;
  if (settings.openrouter?.enabled && settings.openrouter?.apiKey) env.OPENROUTER_API_KEY = settings.openrouter.apiKey;

  return env;
}

export { DEFAULT_AI_SETTINGS };
