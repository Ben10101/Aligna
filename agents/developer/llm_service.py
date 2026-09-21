# -*- coding: utf-8 -*-
import json
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import urllib.error
import urllib.request

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

google_genai = None
google_genai_types = None

try:
    # Import the submodule directly. Some environments expose ``google`` as a
    # namespace package without re-exporting ``genai``, making
    # ``from google import genai`` fail even when google-genai is installed.
    import google.genai as google_genai
    from google.genai import types as google_genai_types
except ImportError:
    # The router must stay available to the other providers when the process
    # is launched with an interpreter whose Gemini SDK has not been installed.
    # The Gemini executor reports a provider-local error and the router can
    # continue to the next configured provider.
    pass

from dotenv import load_dotenv

try:
    from .ollama_service import generate_with_ollama

    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

    def generate_with_ollama(*args, **kwargs):
        raise RuntimeError("Ollama nao esta instalado. Use pip install ollama")

try:
    from .cache_service import get_cache

    CACHE = get_cache()
    CACHE_ENABLED = True
except Exception as e:
    print(f"[LLM Service] Cache nao disponivel: {e}", file=sys.stderr)
    CACHE = None
    CACHE_ENABLED = False

# Do not read repository secrets while importing the module. Unit tests and
# deterministic agents import validation helpers without provider settings.
# Runtime defaults are loaded only when an LLM request is actually made.
_repository_env_loaded = False
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


def ensure_repository_env_loaded():
    global _repository_env_loaded, GEMINI_API_KEY
    if _repository_env_loaded:
        return
    _repository_env_loaded = True
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"), override=False)
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
_gemini_client = None

SUPPORTED_PROVIDERS = ("gemini", "openai", "deepseek", "nvidia", "anthropic", "groq", "huggingface", "openrouter", "ollama")


class ProviderRateLimitError(RuntimeError):
    """A transient 429 response, optionally carrying the Retry-After delay."""

    def __init__(self, message, retry_after_seconds=None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


def is_error_text_response(result: str) -> bool:
    if not isinstance(result, str):
        return False

    normalized = result.strip().lower()
    return (
        normalized.startswith("erro:")
        or normalized.startswith("❌ erro:")
        or normalized.startswith("⚠️ erro:")
        or "falha ao comunicar com o ollama" in normalized
        or normalized.startswith("modelo nao disponivel")
        or normalized.startswith("modelo não disponível")
    )


def validate_structured_response(result: str, options_override: dict | None = None) -> str | None:
    """Return a provider-quality error when a structured response is unusable.

    This quality gate runs *inside* the model router.  A provider that returns
    a tiny refusal or non-JSON text no longer counts as a successful attempt,
    allowing the router to try the next configured model.
    """
    options = options_override or {}
    text = str(result or "").strip()
    try:
        minimum_length = max(0, int(options.get("min_response_chars", 0) or 0))
    except (TypeError, ValueError):
        minimum_length = 0
    if minimum_length and len(text) < minimum_length:
        return f"Resposta curta para contrato estruturado ({len(text)} caracteres; minimo {minimum_length})."
    if not options.get("require_json_object"):
        return None

    # Accept an object framed by prose or a code fence, but only when the
    # *first* JSON value is complete. Searching for any later ``{`` used to
    # accept a complete nested release/story from a truncated root contract;
    # the PM would then report a misleading missing-section error.
    decoder = json.JSONDecoder()
    first_json_index = next((index for index, char in enumerate(text.lstrip("\ufeff")) if char in "[{"), -1)
    if first_json_index < 0:
        return "Resposta sem objeto JSON completo."
    try:
        candidate, _ = decoder.raw_decode(text.lstrip("\ufeff")[first_json_index:])
    except json.JSONDecodeError:
        return "Resposta JSON incompleta ou invalida."
    if isinstance(candidate, dict):
        return None
    return "Resposta sem objeto JSON completo."


def get_provider_order():
    agent_name = str(os.getenv("AI_AGENT_NAME", "") or "").strip().lower()
    agent_suffix = agent_name.upper().replace("-", "_") if agent_name else ""

    disable_ollama_value = (
        os.getenv(f"AI_DISABLE_OLLAMA_FALLBACK_{agent_suffix}") if agent_suffix else None
    ) or os.getenv("AI_DISABLE_OLLAMA_FALLBACK", "1")
    disable_ollama_fallback = str(disable_ollama_value).lower() in ("1", "true", "yes")

    configured_order_value = (
        os.getenv(f"AI_PROVIDER_ORDER_{agent_suffix}") if agent_suffix else None
    ) or os.getenv("AI_PROVIDER_ORDER", "")
    configured_order = [
        item.strip().lower()
        for item in configured_order_value.split(",")
        if item.strip()
    ]

    if configured_order:
        seen = set()
        ordered = []
        for provider in configured_order:
            if provider in SUPPORTED_PROVIDERS and provider not in seen:
                if disable_ollama_fallback and provider == "ollama":
                    continue
                seen.add(provider)
                ordered.append(provider)
        if ordered:
            # A ordem configurada define prioridade, mas não deve transformar
            # uma falha temporária de um único provider em indisponibilidade
            # total. Complementamos a cadeia com os defaults, a menos que a
            # instalação peça explicitamente modo estrito.
            # A configured order is an explicit cost/latency policy. Keep it
            # strict by default; callers can opt into the broad provider chain.
            append_defaults = str(os.getenv("AI_PROVIDER_ORDER_APPEND_DEFAULTS", "0")).lower() in ("1", "true", "yes")
            if append_defaults:
                for provider in ("gemini", "openai", "deepseek", "nvidia", "anthropic", "groq", "huggingface", "openrouter", "ollama"):
                    if provider not in seen and not (disable_ollama_fallback and provider == "ollama"):
                        ordered.append(provider)
            return ordered

    llm_provider = os.getenv("LLM_PROVIDER", "auto").lower()
    if llm_provider in SUPPORTED_PROVIDERS and llm_provider != "auto":
        others = [
            provider
            for provider in SUPPORTED_PROVIDERS
            if provider not in (llm_provider, "ollama") and (not disable_ollama_fallback or provider != "ollama")
        ]
        if llm_provider == "ollama":
            if disable_ollama_fallback:
                return [provider for provider in SUPPORTED_PROVIDERS if provider != "ollama"]
            return ["ollama"]
        return [llm_provider, *others] if disable_ollama_fallback else [llm_provider, *others, "ollama"]

    fallback_order = ["gemini", "huggingface", "groq", "openai", "deepseek", "nvidia", "anthropic", "openrouter", "ollama"]
    return [provider for provider in fallback_order if not (disable_ollama_fallback and provider == "ollama")]


def get_cache_provider_key():
    return ",".join(get_provider_order())


def http_post_json(url, payload, headers=None, timeout=120):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else {}, dict(response.headers.items())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {"raw": body}
        return error.code, parsed, dict(error.headers.items()) if error.headers else {}


def http_get_json(url, headers=None, timeout=15):
    request = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else {}, dict(response.headers.items())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {"raw": body}
        return error.code, parsed, dict(error.headers.items()) if error.headers else {}


def is_retired_nvidia_model_error(error):
    message = str(error or "").lower()
    return "410" in message and ("end of life" in message or "no longer available" in message)


def select_nvidia_runtime_fallback(model_ids, excluded_model):
    """Prefer current hosted text models returned for this exact NVIDIA key."""
    available = [str(item).strip() for item in model_ids if str(item).strip()]
    excluded = str(excluded_model or "").strip().lower()
    preferred = (
        "deepseek-ai/deepseek-v4-flash-0731",
        "deepseek-ai/deepseek-v4-flash",
        "deepseek-ai/deepseek-v4-pro-0813",
        "deepseek-ai/deepseek-v4-pro",
    )
    by_normalized_id = {item.lower(): item for item in available}
    for candidate in preferred:
        if candidate != excluded and candidate in by_normalized_id:
            return by_normalized_id[candidate]
    return None


def discover_nvidia_runtime_fallback(api_key, excluded_model):
    """Read NVIDIA's model catalog only after a model-retirement response."""
    try:
        status, data, _headers = http_get_json(
            "https://integrate.api.nvidia.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if status >= 400:
            return None
        entries = data.get("data") if isinstance(data, dict) else []
        model_ids = [item.get("id") for item in entries if isinstance(item, dict) and item.get("id")]
        return select_nvidia_runtime_fallback(model_ids, excluded_model)
    except Exception:
        # Discovery is recovery-only; an unavailable catalog must not replace
        # the original provider error or leak credentials in diagnostics.
        return None


def get_retry_after_seconds(headers):
    value = next((value for key, value in (headers or {}).items() if key.lower() == "retry-after"), None)
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(str(value))
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, IndexError):
            return None


def raise_for_rate_limit(status, data, headers):
    if status == 429:
        raise ProviderRateLimitError(
            extract_error_message(data) or "Too Many Requests",
            get_retry_after_seconds(headers),
        )


def extract_error_message(data):
    if not isinstance(data, dict):
        return str(data)

    metadata_raw = data.get("error", {}).get("metadata", {}).get("raw")
    if isinstance(metadata_raw, str):
        try:
            parsed = json.loads(metadata_raw)
            return parsed.get("error", {}).get("message") or metadata_raw
        except Exception:
            return metadata_raw

    return (
        data.get("error", {}).get("message")
        or data.get("message")
        or data.get("raw")
        or json.dumps(data)
    )


def generate_attributes_fallback(idea: str, error_message: str = "") -> list:
    if error_message:
        print(f"[LLM Service Fallback] Motivo do fallback: {error_message}", file=sys.stderr)

    attributes = [
        {"name": "title", "type": "string", "sql_type": "VARCHAR(255) NOT NULL"},
        {"name": "description", "type": "text", "sql_type": "TEXT"},
    ]

    idea_lower = idea.lower()
    patterns = {
        "name": {"name": "name", "type": "string", "sql_type": "VARCHAR(255)"},
        "email": {"name": "email", "type": "string", "sql_type": "VARCHAR(255) UNIQUE"},
        "phone|telefone": {"name": "phone", "type": "string", "sql_type": "VARCHAR(20)"},
        "price|preco|preço|valor": {"name": "price", "type": "number", "sql_type": "DECIMAL(10, 2)"},
        "quantity|quantidade|estoque": {"name": "quantity", "type": "number", "sql_type": "INTEGER"},
        "status": {"name": "status", "type": "string", "sql_type": "VARCHAR(50) DEFAULT 'active'"},
        "priority|prioridade": {"name": "priority", "type": "string", "sql_type": "VARCHAR(50) DEFAULT 'medium'"},
        "date|data": {"name": "date", "type": "date", "sql_type": "DATE"},
        "time|hora": {"name": "time", "type": "string", "sql_type": "TIME"},
        "category|categoria": {"name": "category", "type": "string", "sql_type": "VARCHAR(100)"},
        "tags": {"name": "tags", "type": "string", "sql_type": "VARCHAR(500)"},
        "rating|avaliacao|avaliação|nota": {"name": "rating", "type": "number", "sql_type": "DECIMAL(3, 1)"},
    }

    import re

    for pattern, attr in patterns.items():
        if re.search(pattern, idea_lower):
            if not any(a["name"] == attr["name"] for a in attributes):
                attributes.append(attr)

    print(f"[LLM Service Fallback] Gerados {len(attributes)} atributos a partir da analise de texto", file=sys.stderr)
    return attributes


def generate_text_with_gemini(prompt, model, options_override=None):
    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY nao configurada.")
    if google_genai is None or google_genai_types is None:
        raise RuntimeError(
            "SDK Google GenAI indisponivel neste interpretador Python. "
            "Instale google-genai com o mesmo PYTHON_CMD usado pelo backend."
        )

    options = options_override or {}
    generation_config = {"temperature": options.get("temperature", 0.7)}
    # Gemini supports a native JSON MIME type.  Prefer it whenever an agent is
    # producing a contract, instead of relying solely on prompt compliance.
    if options.get("json_mode"):
        generation_config["response_mime_type"] = "application/json"

    global _gemini_client
    if _gemini_client is None:
        _gemini_client = google_genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    timeout_ms = int(get_provider_timeout_seconds("gemini", 120, options_override) * 1000)
    generation_config["http_options"] = google_genai_types.HttpOptions(timeout=timeout_ms)
    response = _gemini_client.models.generate_content(
        model=model,
        contents=prompt,
        config=google_genai_types.GenerateContentConfig(**generation_config),
    )
    text = getattr(response, "text", None)
    if text and str(text).strip():
        return str(text).strip()

    raise RuntimeError("Resposta vazia do Gemini.")


def compact_prompt(prompt, ratio):
    text = str(prompt or "").strip()
    if ratio >= 0.98 or len(text) < 400:
        return text

    target_length = max(240, int(len(text) * max(0.35, min(ratio, 0.95))))
    head_length = int(target_length * 0.72)
    tail_length = max(80, target_length - head_length)
    if head_length + tail_length >= len(text):
        return text
    return f"{text[:head_length].rstrip()}\n\n[...conteudo resumido automaticamente...]\n\n{text[-tail_length:].lstrip()}"


def extract_text_from_openai_like(data):
    """Extract text without assuming providers always return message.content.

    Some OpenAI-compatible providers return ``content: null`` for an interrupted,
    filtered or otherwise empty completion.  Treat it as an empty response so the
    router can retry another candidate instead of crashing with ``None.strip()``.
    """
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice, dict) else {}
    content = message.get("content") if isinstance(message, dict) else None
    return content.strip() if isinstance(content, str) else ""


def parse_model_list(value):
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        items = value
    else:
        items = re.split(r"[\n,;]+", str(value))
    return [str(item).strip() for item in items if str(item).strip()]


def get_provider_timeout_seconds(provider, default_timeout=120, options_override=None):
    requested_timeout = (options_override or {}).get("request_timeout_seconds")
    if requested_timeout is not None:
        try:
            return max(30, int(requested_timeout))
        except (TypeError, ValueError):
            pass
    specific_key = f"{str(provider or '').upper()}_REQUEST_TIMEOUT_SECONDS"
    candidate = os.getenv(specific_key) or os.getenv("LLM_REQUEST_TIMEOUT_SECONDS")
    try:
        timeout = int(candidate) if candidate else int(default_timeout)
    except Exception:
        timeout = int(default_timeout)
    return max(30, timeout)


def get_openrouter_model_candidates(primary_model):
    candidates = []
    for candidate in [primary_model, *parse_model_list(os.getenv("OPENROUTER_MODEL_FALLBACKS", ""))]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    if not candidates:
        candidates.append("openrouter/free")
    # The aggregate free route can occasionally return a terse refusal while
    # another free endpoint is available. Keep a small built-in chain for
    # this case so the application works before the UI fallback list is saved.
    if str(primary_model or "").strip().lower() == "openrouter/free" and len(candidates) == 1:
        candidates.extend([
            "qwen/qwen3-coder:free",
            "deepseek/deepseek-r1-0528-qwen3-8b:free",
            "z-ai/glm-4.5-air:free",
        ])
    return candidates


def should_fallback_openrouter_model(error_message):
    normalized = str(error_message or "").strip().lower()
    if not normalized:
        return False

    patterns = (
        r"prompt tokens limit exceeded",
        r"context length",
        r"context window",
        r"maximum context length",
        r"input.*too long",
        r"token limit",
        r"max tokens",
        r"can only afford",
        r"capacity",
        r"temporarily unavailable",
        r"no endpoints found",
        r"resposta vazia ou invalida",
        r"resposta curta para contrato estruturado",
        r"resposta sem objeto json completo",
    )
    return any(re.search(pattern, normalized, re.I) for pattern in patterns)


def generate_text_with_openrouter_model(prompt, model, api_key, options_override=None):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": os.getenv("OPENROUTER_APP_URL") or os.getenv("VITE_FRONTEND_URL") or "http://localhost:5173",
        "X-Title": os.getenv("OPENROUTER_APP_TITLE") or "Factory OS",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": (options_override or {}).get("temperature", 0.7),
        "max_tokens": max(64, int((options_override or {}).get("num_predict", 800))),
    }
    if (options_override or {}).get("json_mode"):
        payload["response_format"] = {"type": "json_object"}

    attempts = [payload]
    tried_prompt_compaction = False

    while attempts:
        current_payload = attempts.pop(0)
        status, data, response_headers = http_post_json(
            "https://openrouter.ai/api/v1/chat/completions",
            current_payload,
            headers=headers,
            timeout=get_provider_timeout_seconds("openrouter", 180, options_override),
        )
        if status < 400:
            result = extract_text_from_openai_like(data)
            if result:
                structured_error = validate_structured_response(result, options_override)
                if structured_error:
                    raise RuntimeError(structured_error)
                return result
            raise RuntimeError("Resposta vazia ou invalida.")

        raise_for_rate_limit(status, data, response_headers)

        error_message = extract_error_message(data)
        if current_payload.get("response_format") and re.search(r"response_format|json.?mode|unsupported", error_message or "", re.I):
            attempts.insert(0, {key: value for key, value in current_payload.items() if key != "response_format"})
            continue
        affordable_match = re.search(r"can only afford\s+(\d+)", error_message or "", re.I)
        if affordable_match:
            affordable_tokens = int(affordable_match.group(1))
            if affordable_tokens >= 64 and affordable_tokens < current_payload["max_tokens"]:
                attempts.append({
                    **current_payload,
                    "max_tokens": max(64, affordable_tokens - 16),
                })
                continue

        prompt_limit_match = re.search(r"Prompt tokens limit exceeded:\s*(\d+)\s*>\s*(\d+)", error_message or "", re.I)
        if prompt_limit_match and not tried_prompt_compaction:
            requested_tokens = max(1, int(prompt_limit_match.group(1)))
            limit_tokens = max(1, int(prompt_limit_match.group(2)))
            ratio = min(0.9, limit_tokens / requested_tokens)
            attempts.append({
                **current_payload,
                "messages": [{
                    "role": "user",
                    "content": compact_prompt(prompt, ratio),
                }],
            })
            tried_prompt_compaction = True
            continue

        raise RuntimeError(error_message)

    raise RuntimeError("Falha inesperada ao gerar texto com OpenRouter.")


def generate_text_with_openai_compatible(provider, prompt, model, api_key, options_override=None):
    base_urls = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "deepseek": "https://api.deepseek.com/chat/completions",
        "nvidia": "https://integrate.api.nvidia.com/v1/chat/completions",
        "groq": "https://api.groq.com/openai/v1/chat/completions",
        "openrouter": "https://openrouter.ai/api/v1/chat/completions",
        "huggingface": "https://router.huggingface.co/v1/chat/completions",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
    }
    if provider == "openrouter":
        candidates = get_openrouter_model_candidates(model)
        openrouter_errors = []
        for index, candidate_model in enumerate(candidates):
            try:
                print(f"[LLM Service] OpenRouter tentando modelo: {candidate_model}", file=sys.stderr)
                return generate_text_with_openrouter_model(prompt, candidate_model, api_key, options_override)
            except Exception as error:
                if isinstance(error, ProviderRateLimitError):
                    raise
                error_message = str(error)
                openrouter_errors.append(f"{candidate_model}: {error_message}")
                if should_fallback_openrouter_model(error_message) and index < len(candidates) - 1:
                    print(f"[LLM Service] OpenRouter trocando para fallback apos falha em {candidate_model}: {error_message}", file=sys.stderr)
                    continue
                raise RuntimeError(" | ".join(openrouter_errors))

    max_tokens = max(64, int((options_override or {}).get("num_predict", 800)))
    is_groq_gpt_oss = provider == "groq" and str(model).lower().startswith("openai/gpt-oss")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": (options_override or {}).get("temperature", 1 if is_groq_gpt_oss else 0.7),
    }
    if is_groq_gpt_oss:
        payload["max_completion_tokens"] = max_tokens
        payload["reasoning_effort"] = (options_override or {}).get("reasoning_effort", "medium")
        payload["top_p"] = (options_override or {}).get("top_p", 1)
    else:
        payload["max_tokens"] = max_tokens
    # Nemotron reasoning models can consume the completion budget in an
    # internal trace and leave an empty or incomplete final JSON object.
    # Backlog generation needs the contract itself, not a hidden chain of
    # thought. Keep thinking disabled for the models configured as PM routes.
    nvidia_models_with_optional_thinking = {
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "nvidia/nemotron-3-super-120b-a12b",
    }
    if provider == "nvidia" and str(model or "").strip().lower() in nvidia_models_with_optional_thinking:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    # NVIDIA accepts OpenAI-style chat requests, but its endpoint can return
    # prose instead of the requested JSON when response_format=json_object is
    # used without a schema. The agent prompt plus the router's JSON gate keep
    # the contract, while omitting the incompatible transport hint.
    if (options_override or {}).get("json_mode") and provider != "nvidia":
        payload["response_format"] = {"type": "json_object"}

    status, data, response_headers = http_post_json(
        base_urls[provider],
        payload,
        headers=headers,
        timeout=get_provider_timeout_seconds(provider, 180 if provider == "nvidia" else 120, options_override),
    )
    if status < 400:
        return extract_text_from_openai_like(data)

    raise_for_rate_limit(status, data, response_headers)
    raise RuntimeError(extract_error_message(data))


def extract_text_from_anthropic(data):
    return " ".join(
        item.get("text", "").strip()
        for item in data.get("content", [])
        if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
    ).strip()


def generate_text_with_anthropic(prompt, model, api_key, options_override=None):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": (options_override or {}).get("temperature", 0.7),
        "max_tokens": max(64, int((options_override or {}).get("num_predict", 800))),
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    status, data, response_headers = http_post_json(
        "https://api.anthropic.com/v1/messages",
        payload,
        headers=headers,
        timeout=get_provider_timeout_seconds("anthropic", 180),
    )
    if status >= 400:
        raise_for_rate_limit(status, data, response_headers)
        raise RuntimeError(extract_error_message(data))

    return extract_text_from_anthropic(data)


def generate_text_from_provider(provider, prompt, options_override=None, model_override=None):
    if provider == "ollama":
        if not OLLAMA_AVAILABLE:
            raise RuntimeError("Ollama nao esta disponivel.")
        return generate_with_ollama(
            prompt,
            model=model_override or os.getenv("OLLAMA_MODEL", "gemma3:4b"),
            is_json=False,
            options_override=options_override,
        )

    if provider == "gemini":
        configured_model = model_override or os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
        return generate_text_with_gemini(
            prompt,
            configured_model,
            options_override,
        )

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY nao configurada.")
        return generate_text_with_openai_compatible("openai", prompt, model_override or os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), api_key, options_override)

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY nao configurada.")
        return generate_text_with_anthropic(prompt, model_override or os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"), api_key, options_override)

    if provider == "deepseek":
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPSEEK_API_KEY nao configurada.")
        return generate_text_with_openai_compatible("deepseek", prompt, model_override or os.getenv("DEEPSEEK_MODEL", "deepseek-chat"), api_key, options_override)

    if provider == "nvidia":
        api_key = os.getenv("NVIDIA_API_KEY")
        if not api_key:
            raise RuntimeError("NVIDIA_API_KEY nao configurada.")
        model = model_override or os.getenv("NVIDIA_MODEL", "deepseek-ai/deepseek-v4-flash-0731")
        try:
            return generate_text_with_openai_compatible("nvidia", prompt, model, api_key, options_override)
        except Exception as error:
            if not is_retired_nvidia_model_error(error):
                raise
            discovered_model = discover_nvidia_runtime_fallback(api_key, model)
            if not discovered_model:
                raise
            print(
                f"[LLM Service] NVIDIA trocando modelo aposentado por catalogo: {model} -> {discovered_model}",
                file=sys.stderr,
            )
            return generate_text_with_openai_compatible("nvidia", prompt, discovered_model, api_key, options_override)

    if provider == "groq":
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY nao configurada.")
        model = model_override or os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        if str(model).strip().lower() in {"llama-3.3-70b-versatile", "qwen/qwen3.6-27b"}:
            model = os.getenv("GROQ_MODEL_FALLBACK", "openai/gpt-oss-120b") if str(model).strip().lower().startswith("llama") else model
        try:
            return generate_text_with_openai_compatible("groq", prompt, model, api_key, options_override)
        except ProviderRateLimitError:
            raise
        except Exception as error:
            # Groq may expose a model in the account UI before it is enabled
            # for a specific key (error 1010). Try the other current production
            # model once, but never loop on quota/rate-limit responses.
            message = str(error).lower()
            alternate = "qwen/qwen3.6-27b" if str(model).strip().lower() != "qwen/qwen3.6-27b" else "openai/gpt-oss-120b"
            if "1010" not in message and "model" not in message:
                raise
            return generate_text_with_openai_compatible("groq", prompt, alternate, api_key, options_override)

    if provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY nao configurada.")
        model = model_override or os.getenv("OPENROUTER_MODEL", "openrouter/free")
        return generate_text_with_openai_compatible("openrouter", prompt, model, api_key, options_override)

    if provider == "huggingface":
        api_key = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_API_KEY")
        if not api_key:
            raise RuntimeError("HF_TOKEN nao configurada.")
        model = model_override or os.getenv("HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct:hf-inference")
        return generate_text_with_openai_compatible("huggingface", prompt, model, api_key, options_override)

    raise RuntimeError(f"Provider nao suportado: {provider}")


def extract_json_from_text(content):
    if isinstance(content, list):
        return {"attributes": content}
    if isinstance(content, dict):
        return content

    text = str(content).strip()
    start = text.find("{")
    end = text.rfind("}")
    candidate = text[start:end + 1] if start != -1 and end != -1 and end > start else text
    return json.loads(candidate)


def generate_attributes_with_provider(provider, prompt):
    if provider == "ollama":
        if not OLLAMA_AVAILABLE:
            raise RuntimeError("Ollama nao esta disponivel.")
        return generate_with_ollama(prompt, model=os.getenv("OLLAMA_MODEL", "gemma3:4b"), is_json=True)

    content = generate_text_from_provider(
        provider,
        prompt + "\n\nResponda APENAS com JSON valido no formato {\"attributes\": [...]}",
        options_override={"temperature": 0.2, "num_predict": 600},
    )
    data = extract_json_from_text(content)
    attributes = data.get("attributes", [])
    if not isinstance(attributes, list) or not attributes:
        raise RuntimeError("Resposta JSON sem lista de atributos.")
    return attributes


def get_attributes_from_llm(idea: str) -> list:
    provider_key = get_cache_provider_key()
    prompt = f"""
    Voce e um engenheiro de software senior especialista em modelagem de dados.
    Sua tarefa e analisar a ideia de um projeto de software e extrair os atributos da entidade de negocio principal.

    Ideia do Projeto: "{idea}"

    Instrucoes:
    1. Identifique a entidade principal.
    2. Extraia os atributos relevantes.
    3. Para cada atributo, determine um tipo JavaScript e um tipo SQL.
    4. Nao inclua id, user_id, created_at e updated_at.
    5. Responda APENAS com JSON valido no formato {{"attributes":[...]}}.
    """

    if CACHE_ENABLED:
        try:
            cached_response = CACHE.get(prompt, model=provider_key, provider="provider-chain")
            if cached_response:
                print("[LLM Service] CACHE HIT para atributos.", file=sys.stderr)
                return json.loads(cached_response)
        except Exception as e:
            print(f"[LLM Service] Erro ao acessar cache: {e}", file=sys.stderr)

    errors = []
    for provider in get_provider_order():
        try:
            print(f"[LLM Service] Tentando atributos com {provider}...", file=sys.stderr)
            result = generate_attributes_with_provider(provider, prompt)
            if result:
                if CACHE_ENABLED:
                    try:
                        CACHE.set(prompt, json.dumps(result), model=provider_key, provider="provider-chain", is_json=True)
                    except Exception as e:
                        print(f"[LLM Service] Erro ao guardar cache: {e}", file=sys.stderr)
                return result
        except Exception as e:
            errors.append(f"{provider}: {e}")
            print(f"[LLM Service] Falha em atributos com {provider}: {e}", file=sys.stderr)

    print("[LLM Service] Nenhum modelo de IA funcionou para atributos. Usando fallback analitico.", file=sys.stderr)
    return generate_attributes_fallback(idea, " | ".join(errors[:5]))


def generate_text_from_llm(prompt: str, model: str = None, options_override: dict | None = None, use_cache: bool = True, task: str = None) -> str:
    ensure_repository_env_loaded()
    provider_key = get_cache_provider_key()

    if CACHE_ENABLED and use_cache:
        try:
            cached_response = CACHE.get(prompt, model=provider_key, provider="provider-chain")
            if cached_response:
                print("[LLM Service] CACHE HIT para texto.", file=sys.stderr)
                return cached_response
        except Exception as e:
            print(f"[LLM Service] Erro ao acessar cache: {e}", file=sys.stderr)

    provider_order = get_provider_order()
    print(json.dumps({
        "event": "provider_order_resolved",
        "task": task or "text_generation",
        "agent": str(os.getenv("AI_AGENT_NAME", "") or "").strip() or None,
        "provider_order": provider_order,
        "ollama_included": "ollama" in provider_order,
    }, ensure_ascii=False), file=sys.stderr)

    from .model_router import execute_routed_text

    def execute_provider(provider, selected_model, selected_options):
        print(f"[LLM Service] Tentando gerar texto com {provider}...", file=sys.stderr)
        result = generate_text_from_provider(
            provider,
            prompt,
            options_override=selected_options,
            # O parametro model legado sempre foi exclusivo do Ollama. Mantemos esse
            # contrato e permitimos que o router escolha os demais modelos.
            model_override=model if provider == "ollama" and model else selected_model,
        )
        if not result or is_error_text_response(result):
            raise RuntimeError("Resposta vazia ou invalida.")
        structured_error = validate_structured_response(result, selected_options)
        if structured_error:
            raise RuntimeError(structured_error)
        return result

    result, _metadata = execute_routed_text(
        prompt,
        task=task,
        options_override=options_override,
        provider_order=provider_order,
        provider_executor=execute_provider,
    )
    if CACHE_ENABLED and use_cache:
        try:
            CACHE.set(prompt, result, model=provider_key, provider="provider-chain", is_json=False)
        except Exception as e:
            print(f"[LLM Service] Erro ao guardar cache: {e}", file=sys.stderr)
    return result
