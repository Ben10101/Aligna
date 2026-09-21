import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { getAiRuntimeSummary, getAiSettings, testAiProvider, updateAiSettings } from '../services/api';

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Automatico' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'groq', label: 'Groq' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'openrouter', label: 'OpenRouter' },
];

const EMPTY_SETTINGS = {
  providerPreference: 'auto',
  agentAliases: {
    project_manager: 'PM Agent',
    requirements_analyst: 'Requirements Agent',
    qa_engineer: 'QA Agent',
  },
  ollama: { enabled: true, host: 'http://127.0.0.1:11434', model: 'gemma3:4b' },
  gemini: { enabled: false, apiKey: '', model: 'gemini-3.6-flash' },
  openai: { enabled: false, apiKey: '', model: 'gpt-4.1-mini' },
  deepseek: { enabled: false, apiKey: '', model: 'deepseek-chat' },
  nvidia: { enabled: false, apiKey: '', model: 'deepseek-ai/deepseek-v4-flash-0731' },
  anthropic: { enabled: false, apiKey: '', model: 'claude-3-5-sonnet-latest' },
  groq: { enabled: false, apiKey: '', model: 'llama-3.3-70b-versatile' },
  huggingface: { enabled: false, apiKey: '', model: 'meta-llama/Llama-3.1-8B-Instruct:hf-inference' },
  openrouter: { enabled: false, apiKey: '', model: 'openai/gpt-4.1-mini', fallbackModels: [] },
};

const OPENROUTER_FREE_PRESET = {
  model: 'openrouter/free',
  fallbackModels: [
    'qwen/qwen3-coder:free',
    'deepseek/deepseek-r1-0528-qwen3-8b:free',
    'z-ai/glm-4.5-air:free',
  ],
};

function Field({ label, children, hint }) {
  return (
    <label className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#102a72]/40 focus:ring-2 focus:ring-[#102a72]/10"
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="min-h-[120px] w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#102a72]/40 focus:ring-2 focus:ring-[#102a72]/10"
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        checked
          ?'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-500'
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ?'bg-emerald-500' : 'bg-slate-300'}`} />
      {label}
    </button>
  );
}

function ProviderCard({ title, description, children, supported = false }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${
            supported ?'bg-blue-50 text-[#102a72]' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {supported ?'Em uso' : 'Preparado'}
        </span>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TestFeedback({ result }) {
  if (!result) return null;

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        result.ok
          ?'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      <p className="font-semibold">{result.message}</p>
      {result.meta?.detail && <p className="mt-1 text-xs opacity-90">{result.meta.detail}</p>}
      {result.meta?.responsePreview && <p className="mt-1 text-xs opacity-90">Resposta: {result.meta.responsePreview}</p>}
    </div>
  );
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [testResults, setTestResults] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [storedSettings, runtimeSummary] = await Promise.all([getAiSettings(), getAiRuntimeSummary()]);
        if (!active) return;
        setSettings({ ...EMPTY_SETTINGS, ...storedSettings });
        setRuntime(runtimeSummary);
      } catch (loadError) {
        if (!active) return;
        setError(loadError.response?.data?.message || loadError.message || 'Não foi poss?vel carregar as configurações de IA.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const providerSummary = useMemo(() => {
    if (!runtime) return [];
    return [
      { label: 'Preferencia ativa', value: runtime.provider || '-' },
      { label: 'Ordem', value: runtime.providerOrder?.length ?runtime.providerOrder.join(' -> ') : 'Sem ordem definida' },
      { label: 'Fallback local', value: runtime.localFallbackDisabled ?'Desligado' : 'Disponivel' },
      { label: 'Policy', value: runtime.policyVersion || 'v1' },
      { label: 'Prompt', value: runtime.promptVersion || 'v1' },
      { label: 'Release', value: runtime.platformVersion || '1.0.0' },
      { label: 'Gemini', value: runtime.hasGeminiKey ?'Configurado' : 'Sem chave' },
      { label: 'DeepSeek', value: runtime.hasDeepSeekKey ?runtime.deepSeekModel || 'Configurado' : 'Sem chave' },
      { label: 'NVIDIA', value: runtime.hasNvidiaKey ?runtime.nvidiaModel || 'Configurado' : 'Sem chave' },
      { label: 'Ollama', value: runtime.ollamaHost ?`${runtime.ollamaModel} @ ${runtime.ollamaHost}` : 'Não configurado' },
      {
        label: 'OpenRouter',
        value: runtime.openRouterModel
          ?`${runtime.openRouterModel}${runtime.openRouterFallbackModels?.length ?` +${runtime.openRouterFallbackModels.length} fallback(s)` : ''}`
          : 'Não configurado',
      },
    ];
  }, [runtime]);

  const openRouterFallbackText = useMemo(
    () => (settings.openrouter?.fallbackModels || []).join('\n'),
    [settings.openrouter?.fallbackModels]
  );

  function patchProvider(key, field, value) {
    setSettings((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...(field === 'apiKey' ? { clearApiKey: false } : {}),
        [field]: value,
      },
    }));
  }

  function clearProviderApiKey(key) {
    setSettings((current) => ({
      ...current,
      [key]: {
        ...current[key],
        apiKey: '',
        clearApiKey: true,
        apiKeyConfigured: false,
        apiKeyPreview: null,
      },
    }));
    setSuccess('');
    setError('');
  }

  function renderStoredKeyState(key) {
    const provider = settings[key] || {};
    if (!provider.apiKeyConfigured) {
      return (
        <p className="text-xs text-slate-500">
          Nenhuma chave protegida salva ainda. Ao salvar, a credencial fica mascarada na interface.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
        <p>
          Chave protegida salva {provider.apiKeyPreview ? `(${provider.apiKeyPreview})` : ''}. Deixe o campo em branco
          para manter a atual ou remova abaixo.
        </p>
        <button
          type="button"
          onClick={() => clearProviderApiKey(key)}
          className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          Remover chave salva
        </button>
      </div>
    );
  }

  function applyOpenRouterFreePreset() {
    setSettings((current) => ({
      ...current,
      providerPreference: current.providerPreference === 'auto' ?current.providerPreference : 'openrouter',
      openrouter: {
        ...current.openrouter,
        enabled: true,
        model: OPENROUTER_FREE_PRESET.model,
        fallbackModels: OPENROUTER_FREE_PRESET.fallbackModels,
      },
    }));
    setSuccess('Preset de modelos gratis do OpenRouter aplicado. Informe sua API key e teste a configuracao.');
    setError('');
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const saved = await updateAiSettings(settings);
      const runtimeSummary = await getAiRuntimeSummary();
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      setRuntime(runtimeSummary);
      setSuccess('Configura??es salvas. Os pr?ximos agentes usar?o essas credenciais.');
    } catch (saveError) {
      setError(saveError.response?.data?.message || saveError.message || 'Não foi poss?vel salvar as configurações de IA.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestProvider(provider) {
    setTestingProvider(provider);
    setError('');
    setSuccess('');
    setTestResults((current) => ({ ...current, [provider]: null }));

    try {
      const result = await testAiProvider({ provider, settings });
      let nextSettings = settings;

      if (result.ok && provider !== 'auto') {
        nextSettings = {
          ...settings,
          [provider]: {
            ...settings[provider],
            enabled: true,
          },
        };

        const saved = await updateAiSettings(nextSettings);
        const runtimeSummary = await getAiRuntimeSummary();
        setSettings({ ...EMPTY_SETTINGS, ...saved });
        setRuntime(runtimeSummary);
        const providerLabel = provider === 'ollama' ?'Ollama' : provider === 'deepseek' ?'DeepSeek' : provider;
        setSuccess(`${providerLabel} validado e ativado com sucesso.`);
      }

      setTestResults((current) => ({ ...current, [provider]: result }));
    } catch (testError) {
      setTestResults((current) => ({
        ...current,
        [provider]: {
          ok: false,
          message: testError.response?.data?.message || `Não foi poss?vel testar ${provider}.`,
          meta: {
            detail: testError.response?.data?.detail || testError.response?.data?.meta?.detail || testError.message,
          },
        },
      }));
    } finally {
      setTestingProvider('');
    }
  }

  return (
    <AppShell
      eyebrow="Governanca"
      title="Governanca de IA"
      description="Configure providers, ordem de fallback, policy de runtime e credenciais usadas pela fabrica."
    >
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#102a72]">Runtime atual</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Policy, fallback e ordem de execução</h2>
              <p className="mt-1 text-sm text-slate-500">
                Esta area controla como a plataforma escolhe providers, como reage a falhas e quais versoes de policy estao em vigor.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {providerSummary.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <form className="space-y-6" onSubmit={handleSave}>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
            <Field label="Provider preferencial" hint="Automatico usa a policy configurada e a ordem disponivel para decidir o melhor provider.">
              <select
                value={settings.providerPreference}
                onChange={(event) => setSettings((current) => ({ ...current, providerPreference: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#102a72]/40 focus:ring-2 focus:ring-[#102a72]/10"
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#102a72]">Agentes</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Apelidos exibidos na interface</h2>
              <p className="mt-1 text-sm text-slate-500">
                Personalize como cada agente aparece no board, no detalhe da task e em outras areas operacionais.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Project Manager">
                <TextInput
                  value={settings.agentAliases?.project_manager || ''}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    agentAliases: { ...current.agentAliases, project_manager: event.target.value },
                  }))}
                  placeholder="PM Agent"
                />
              </Field>
              <Field label="Requirements Analyst">
                <TextInput
                  value={settings.agentAliases?.requirements_analyst || ''}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    agentAliases: { ...current.agentAliases, requirements_analyst: event.target.value },
                  }))}
                  placeholder="Requirements Agent"
                />
              </Field>
              <Field label="QA Engineer">
                <TextInput
                  value={settings.agentAliases?.qa_engineer || ''}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    agentAliases: { ...current.agentAliases, qa_engineer: event.target.value },
                  }))}
                  placeholder="QA Agent"
                />
              </Field>
            </div>
          </section>

          <ProviderCard title="Ollama local" description="Use um modelo rodando na sua maquina ou em outro host Ollama." supported>
            <Toggle
              checked={Boolean(settings.ollama?.enabled)}
              onChange={(value) => patchProvider('ollama', 'enabled', value)}
              label={settings.ollama?.enabled ?'Ativo' : 'Inativo'}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Host do Ollama">
                <TextInput
                  value={settings.ollama?.host || ''}
                  onChange={(event) => patchProvider('ollama', 'host', event.target.value)}
                  placeholder="http://127.0.0.1:11434"
                />
              </Field>
              <Field label="Modelo padrao">
                <TextInput
                  value={settings.ollama?.model || ''}
                  onChange={(event) => patchProvider('ollama', 'model', event.target.value)}
                  placeholder="gemma3:4b"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('ollama')}
                disabled={testingProvider === 'ollama'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'ollama' ?'Testando...' : 'Testar conexao'}
              </button>
            </div>
            <TestFeedback result={testResults.ollama} />
          </ProviderCard>

          <ProviderCard title="Google Gemini" description="Chave usada quando o fluxo precisar recorrer ao Gemini." supported>
            <Toggle
              checked={Boolean(settings.gemini?.enabled)}
              onChange={(value) => patchProvider('gemini', 'enabled', value)}
              label={settings.gemini?.enabled ?'Ativo' : 'Inativo'}
            />
            {renderStoredKeyState('gemini')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput
                  type="password"
                  value={settings.gemini?.apiKey || ''}
                  onChange={(event) => patchProvider('gemini', 'apiKey', event.target.value)}
                  placeholder="AIza..."
                />
              </Field>
              <Field label="Modelo padrao">
                <TextInput
                  value={settings.gemini?.model || ''}
                  onChange={(event) => patchProvider('gemini', 'model', event.target.value)}
                  placeholder="gemini-3.6-flash"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('gemini')}
                disabled={testingProvider === 'gemini'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'gemini' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.gemini} />
          </ProviderCard>

          <ProviderCard title="OpenAI" description="Area pronta para cadastrar chave e modelo da OpenAI.">
            <Toggle checked={Boolean(settings.openai?.enabled)} onChange={(value) => patchProvider('openai', 'enabled', value)} label={settings.openai?.enabled ?'Ativo' : 'Inativo'} />
            {renderStoredKeyState('openai')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.openai?.apiKey || ''} onChange={(event) => patchProvider('openai', 'apiKey', event.target.value)} placeholder="sk-..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.openai?.model || ''} onChange={(event) => patchProvider('openai', 'model', event.target.value)} placeholder="gpt-4.1-mini" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('openai')}
                disabled={testingProvider === 'openai'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'openai' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.openai} />
          </ProviderCard>

          <ProviderCard title="DeepSeek" description="Use a API oficial da DeepSeek em modo compativel com chat completions.">
            <Toggle checked={Boolean(settings.deepseek?.enabled)} onChange={(value) => patchProvider('deepseek', 'enabled', value)} label={settings.deepseek?.enabled ?'Ativo' : 'Inativo'} />
            {renderStoredKeyState('deepseek')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.deepseek?.apiKey || ''} onChange={(event) => patchProvider('deepseek', 'apiKey', event.target.value)} placeholder="sk-..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.deepseek?.model || ''} onChange={(event) => patchProvider('deepseek', 'model', event.target.value)} placeholder="deepseek-chat" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('deepseek')}
                disabled={testingProvider === 'deepseek'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'deepseek' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.deepseek} />
          </ProviderCard>

          <ProviderCard title="NVIDIA NIM" description="Use a API da NVIDIA com modelos servidos pelo endpoint integrate chat completions.">
            <Toggle checked={Boolean(settings.nvidia?.enabled)} onChange={(value) => patchProvider('nvidia', 'enabled', value)} label={settings.nvidia?.enabled ?'Ativo' : 'Inativo'} />
            {renderStoredKeyState('nvidia')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.nvidia?.apiKey || ''} onChange={(event) => patchProvider('nvidia', 'apiKey', event.target.value)} placeholder="nvapi-..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.nvidia?.model || ''} onChange={(event) => patchProvider('nvidia', 'model', event.target.value)} placeholder="deepseek-ai/deepseek-v4-flash-0731" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('nvidia')}
                disabled={testingProvider === 'nvidia'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'nvidia' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.nvidia} />
          </ProviderCard>

          <ProviderCard title="Anthropic" description="Area pronta para cadastrar chave e modelo da Anthropic.">
            <Toggle checked={Boolean(settings.anthropic?.enabled)} onChange={(value) => patchProvider('anthropic', 'enabled', value)} label={settings.anthropic?.enabled ?'Ativo' : 'Inativo'} />
            {renderStoredKeyState('anthropic')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.anthropic?.apiKey || ''} onChange={(event) => patchProvider('anthropic', 'apiKey', event.target.value)} placeholder="sk-ant-..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.anthropic?.model || ''} onChange={(event) => patchProvider('anthropic', 'model', event.target.value)} placeholder="claude-3-5-sonnet-latest" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('anthropic')}
                disabled={testingProvider === 'anthropic'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'anthropic' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.anthropic} />
          </ProviderCard>

          <ProviderCard title="Groq" description="Area pronta para cadastrar chave e modelo do Groq.">
            <Toggle checked={Boolean(settings.groq?.enabled)} onChange={(value) => patchProvider('groq', 'enabled', value)} label={settings.groq?.enabled ?'Ativo' : 'Inativo'} />
            {renderStoredKeyState('groq')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.groq?.apiKey || ''} onChange={(event) => patchProvider('groq', 'apiKey', event.target.value)} placeholder="gsk_..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.groq?.model || ''} onChange={(event) => patchProvider('groq', 'model', event.target.value)} placeholder="llama-3.3-70b-versatile" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('groq')}
                disabled={testingProvider === 'groq'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'groq' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.groq} />
          </ProviderCard>

          <ProviderCard title="Hugging Face Inference" description="Use uma HF_TOKEN para rotear modelos por provedores como Cerebras e Groq.">
            <Toggle checked={Boolean(settings.huggingface?.enabled)} onChange={(value) => patchProvider('huggingface', 'enabled', value)} label={settings.huggingface?.enabled ? 'Ativo' : 'Inativo'} />
            {renderStoredKeyState('huggingface')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key (HF_TOKEN)">
                <TextInput type="password" value={settings.huggingface?.apiKey || ''} onChange={(event) => patchProvider('huggingface', 'apiKey', event.target.value)} placeholder="hf_..." />
              </Field>
              <Field label="Modelo padrao" hint="Opcionalmente fixe o provedor com :cerebras ou :groq.">
                <TextInput value={settings.huggingface?.model || ''} onChange={(event) => patchProvider('huggingface', 'model', event.target.value)} placeholder="meta-llama/Llama-3.1-8B-Instruct:hf-inference" />
              </Field>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('huggingface')}
                disabled={testingProvider === 'huggingface'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'huggingface' ? 'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.huggingface} />
          </ProviderCard>

          <ProviderCard title="OpenRouter" description="Area pronta para cadastrar chave e modelo do OpenRouter.">
            <Toggle checked={Boolean(settings.openrouter?.enabled)} onChange={(value) => patchProvider('openrouter', 'enabled', value)} label={settings.openrouter?.enabled ?'Ativo' : 'Inativo'} />
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-sky-900">Usar modelos free</p>
                <p className="text-xs text-sky-700">Preenche automaticamente o router gratis e tres fallbacks gratuitos para coding.</p>
              </div>
              <button
                type="button"
                onClick={applyOpenRouterFreePreset}
                className="rounded-2xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                Aplicar preset free
              </button>
            </div>
            {renderStoredKeyState('openrouter')}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="API Key">
                <TextInput type="password" value={settings.openrouter?.apiKey || ''} onChange={(event) => patchProvider('openrouter', 'apiKey', event.target.value)} placeholder="sk-or-..." />
              </Field>
              <Field label="Modelo padrao">
                <TextInput value={settings.openrouter?.model || ''} onChange={(event) => patchProvider('openrouter', 'model', event.target.value)} placeholder="openai/gpt-4.1-mini" />
              </Field>
            </div>
            <Field label="Modelos de fallback" hint="Use um modelo por linha. Se o principal atingir limite de tokens, contexto ou capacidade, a plataforma tenta os pr?ximos com a mesma API key.">
              <TextArea
                value={openRouterFallbackText}
                onChange={(event) =>
                  patchProvider(
                    'openrouter',
                    'fallbackModels',
                    event.target.value
                      .split(/\r?\n|,|;/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                  )
                }
                placeholder={'openai/gpt-4.1-mini\nanthropic/claude-3.5-sonnet\nmeta-llama/llama-3.3-70b-instruct'}
              />
            </Field>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleTestProvider('openrouter')}
                disabled={testingProvider === 'openrouter'}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testingProvider === 'openrouter' ?'Testando...' : 'Testar chave'}
              </button>
            </div>
            <TestFeedback result={testResults.openrouter} />
          </ProviderCard>

          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={loading || saving}
              className="rounded-2xl bg-[#102a72] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[#102a72]/20 transition hover:bg-[#0c2058] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ?'Salvando...' : 'Salvar configuracoes'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
