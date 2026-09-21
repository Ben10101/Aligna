function okResult(message, meta = {}) {
  return { ok: true, message, meta };
}

function failResult(message, meta = {}) {
  return { ok: false, message, meta };
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractProviderDetail(data) {
  const raw = data?.error?.metadata?.raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed?.error?.message || raw;
    } catch {
      return raw;
    }
  }

  return data?.error?.message || data?.message || data?.raw || 'Sem detalhes.';
}

function parseModelList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getOpenRouterCandidateModels(settings) {
  const primaryModel = settings?.openrouter?.model || 'openai/gpt-4.1-mini';
  const fallbackModels = parseModelList(settings?.openrouter?.fallbackModels);
  return [primaryModel, ...fallbackModels].filter((model, index, list) => model && list.indexOf(model) === index);
}

async function requestOpenRouterModel({ apiKey, model, referer, title }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': referer,
      'X-Title': title,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 16,
      temperature: 0,
    }),
  });

  const data = await readJsonSafe(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: extractProviderDetail(data),
    };
  }

  return {
    ok: true,
    responsePreview: data?.choices?.[0]?.message?.content?.trim() || 'Sem texto.',
  };
}

export async function testOllamaConnection(settings) {
  const host = settings?.ollama?.host || 'http://127.0.0.1:11434';
  const model = settings?.ollama?.model || 'gemma3:4b';

  try {
    const response = await fetch(`${host.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'Responda apenas com OK.',
        stream: false,
        options: { num_predict: 10, temperature: 0 },
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao conectar no Ollama.', {
        status: response.status,
        detail: data?.error || data?.raw || 'Sem detalhes.',
      });
    }

    const content = typeof data?.response === 'string' ? data.response.trim() : '';
    return okResult(`Ollama respondeu com sucesso usando ${model}.`, { responsePreview: content || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel conectar ao Ollama.', { detail: error.message });
  }
}

export async function testGeminiConnection(settings) {
  const apiKey = settings?.gemini?.apiKey;
  const model = settings?.gemini?.model || 'gemini-3.6-flash';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key do Gemini para testar.');
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responda apenas com OK.' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave do Gemini.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim();
    return okResult(`Gemini respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave do Gemini.', { detail: error.message });
  }
}

export async function testOpenAiConnection(settings) {
  const apiKey = settings?.openai?.apiKey;
  const model = settings?.openai?.model || 'gpt-4.1-mini';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da OpenAI para testar.');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave da OpenAI.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    return okResult(`OpenAI respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da OpenAI.', { detail: error.message });
  }
}

export async function testDeepSeekConnection(settings) {
  const apiKey = settings?.deepseek?.apiKey;
  const model = settings?.deepseek?.model || 'deepseek-chat';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da DeepSeek para testar.');
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave da DeepSeek.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    return okResult(`DeepSeek respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da DeepSeek.', { detail: error.message });
  }
}

export async function testNvidiaConnection(settings) {
  const apiKey = settings?.nvidia?.apiKey;
  const model = settings?.nvidia?.model || 'deepseek-ai/deepseek-v4-flash-0731';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da NVIDIA para testar.');
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 16,
        temperature: 0,
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave da NVIDIA.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    return okResult(`NVIDIA respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da NVIDIA.', { detail: error.message });
  }
}

export async function testAnthropicConnection(settings) {
  const apiKey = settings?.anthropic?.apiKey;
  const model = settings?.anthropic?.model || 'claude-3-5-sonnet-latest';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da Anthropic para testar.');
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave da Anthropic.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.content?.map((item) => item.text || '').join(' ').trim();
    return okResult(`Anthropic respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da Anthropic.', { detail: error.message });
  }
}

export async function testGroqConnection(settings) {
  const apiKey = settings?.groq?.apiKey;
  const model = settings?.groq?.model || 'llama-3.3-70b-versatile';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da Groq para testar.');
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      return failResult('Falha ao validar a chave da Groq.', {
        status: response.status,
        detail: data?.error?.message || data?.raw || 'Sem detalhes.',
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    return okResult(`Groq respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da Groq.', { detail: error.message });
  }
}

export async function testHuggingFaceConnection(settings) {
  const apiKey = settings?.huggingface?.apiKey;
  const model = settings?.huggingface?.model || 'meta-llama/Llama-3.1-8B-Instruct:hf-inference';
  if (!apiKey?.trim()) return failResult('Informe uma API key do Hugging Face para testar.');
  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK only.' }], max_tokens: 10, temperature: 0.2 }),
    });
    const data = await readJsonSafe(response);
    if (!response.ok) return failResult('Falha ao validar a chave do Hugging Face.', { status: response.status, detail: data?.error?.message || data?.raw || 'Sem detalhes.' });
    const text = data?.choices?.[0]?.message?.content?.trim();
    return okResult(`Hugging Face respondeu com sucesso usando ${model}.`, { responsePreview: text || 'Sem texto.' });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave do Hugging Face.', { detail: error.message });
  }
}

export async function testOpenRouterConnection(settings) {
  const apiKey = settings?.openrouter?.apiKey;
  const models = getOpenRouterCandidateModels(settings);
  const referer = process.env.OPENROUTER_APP_URL || process.env.VITE_FRONTEND_URL || 'http://localhost:5173';
  const title = process.env.OPENROUTER_APP_TITLE || 'Aligna';

  if (!apiKey?.trim()) {
    return failResult('Informe uma API key da OpenRouter para testar.');
  }

  try {
    const successes = [];
    const failures = [];

    for (const model of models) {
      const result = await requestOpenRouterModel({ apiKey, model, referer, title });
      if (result.ok) {
        successes.push({
          model,
          responsePreview: result.responsePreview,
        });
      } else {
        failures.push({
          model,
          status: result.status,
          detail: result.detail,
        });
      }
    }

    if (successes.length) {
      return okResult(
        successes.length === 1
          ? `OpenRouter respondeu com sucesso usando ${successes[0].model}.`
          : `OpenRouter validou ${successes.length} modelo(s) com sucesso.`,
        {
          responsePreview: successes[0].responsePreview,
          testedModels: models,
          successfulModels: successes.map((item) => item.model),
          failedModels: failures.map((item) => ({
            model: item.model,
            status: item.status,
            detail: item.detail,
          })),
          detail: failures.length
            ? failures.map((item) => `${item.model}: ${item.detail}`).join(' | ')
            : undefined,
        }
      );
    }

    return failResult('Falha ao validar os modelos da OpenRouter.', {
      testedModels: models,
      detail: failures.map((item) => `${item.model}: ${item.detail}`).join(' | ') || 'Sem detalhes.',
    });
  } catch (error) {
    return failResult('Nao foi possivel testar a chave da OpenRouter.', { detail: error.message });
  }
}

export async function testAiProviderConnection(provider, settings) {
  switch (provider) {
    case 'ollama':
      return testOllamaConnection(settings);
    case 'gemini':
      return testGeminiConnection(settings);
    case 'openai':
      return testOpenAiConnection(settings);
    case 'deepseek':
      return testDeepSeekConnection(settings);
    case 'nvidia':
      return testNvidiaConnection(settings);
    case 'anthropic':
      return testAnthropicConnection(settings);
    case 'groq':
      return testGroqConnection(settings);
    case 'huggingface':
      return testHuggingFaceConnection(settings);
    case 'openrouter':
      return testOpenRouterConnection(settings);
    default:
      return failResult('Provedor de IA nao suportado para teste.');
  }
}
