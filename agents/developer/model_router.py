# -*- coding: utf-8 -*-
"""Capability-aware model selection built on the existing provider executors.

The router does not hold credentials and does not call providers directly. It only
selects candidates; ``llm_service`` remains the single execution integration.
"""
from __future__ import annotations

import json
import os
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Callable


TASK_CAPABILITIES = {
    "requirements_analysis": {"text", "reasoning", "structured_output"},
    "requirements_challenge": {"text", "reasoning"},
    "requirements_judge": {"text", "reasoning", "structured_output"},
    "text_extraction": {"text", "long_context"},
    "visual_analysis": {"text", "vision"},
    "classification": {"text", "structured_output"},
    "code_generation": {"text", "reasoning", "code"},
    "qa_generation": {"text", "reasoning", "structured_output"},
    # Reparo direcionado usado somente na tela de revisão.  O agente devolve
    # um patch JSON pequeno, portanto precisa de saída estruturada, mas não
    # deve herdar as exigências de geração completa de requisitos/QA.
    "artifact_repair": {"text", "reasoning", "structured_output"},
    "general_text": {"text"},
}

DEFAULT_PROVIDER_CAPABILITIES = {
    "gemini": {"text", "reasoning", "vision", "structured_output", "long_context", "code"},
    "openai": {"text", "reasoning", "vision", "structured_output", "long_context", "code"},
    "anthropic": {"text", "reasoning", "vision", "structured_output", "long_context", "code"},
    "deepseek": {"text", "reasoning", "structured_output", "long_context", "code"},
    "nvidia": {"text", "reasoning", "structured_output", "long_context", "code"},
    "groq": {"text", "reasoning", "structured_output", "code"},
    "huggingface": {"text", "reasoning", "vision", "structured_output", "long_context", "code"},
    "openrouter": {"text", "reasoning", "vision", "structured_output", "long_context", "code"},
    "ollama": {"text", "reasoning", "structured_output", "code"},
}

DEFAULT_PROVIDER_MODELS = {
    "gemini": ("GEMINI_MODEL", "gemini-3.6-flash"),
    "openai": ("OPENAI_MODEL", "gpt-4.1-mini"),
    "anthropic": ("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"),
    "deepseek": ("DEEPSEEK_MODEL", "deepseek-chat"),
    "nvidia": ("NVIDIA_MODEL", "deepseek-ai/deepseek-v4-flash-0731"),
    "groq": ("GROQ_MODEL", "openai/gpt-oss-120b"),
    "huggingface": ("HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct:hf-inference"),
    "openrouter": ("OPENROUTER_MODEL", "openrouter/free"),
    "ollama": ("OLLAMA_MODEL", "gemma3:4b"),
}

# A fallback stays within the provider selected by the user and can be
# overridden per deployment. NVIDIA's default model is deliberately a distinct
# fallback for users that select Nemotron; a read timeout from one hosted model
# must not leave a single-provider installation with only a same-model retry.
DEFAULT_PROVIDER_MODEL_FALLBACKS = {
    "gemini": ("GEMINI_MODEL_FALLBACK", "gemini-3.6-flash"),
    "nvidia": ("NVIDIA_MODEL_FALLBACK", "deepseek-ai/deepseek-v4-flash-0731"),
}

_LAST_EXECUTION_METADATA = None


class ModelRouterConfigurationError(ValueError):
    pass


class ModelRouterSelectionError(RuntimeError):
    pass


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _transient_retry_delay(error: Exception, retry_number: int, *, allow_timeout_retry: bool = False) -> float | None:
    """Return a bounded delay for a provider failure that may recover shortly."""
    message = str(error or "").lower()
    # ``urllib`` surfaces a socket read timeout as ``TimeoutError``. It can be
    # a short upstream connection stall, so use the bounded retry policy only
    # when there is no alternative candidate. With a fallback model/provider,
    # move to it immediately instead of doubling the request latency.
    if isinstance(error, TimeoutError) and not allow_timeout_retry:
        return None

    is_transient = (
        isinstance(error, TimeoutError)
        or
        getattr(error, "retry_after_seconds", None) is not None
        or bool(re.search(
            r"\b429\b|\b5(?:00|02|03|04)\b|too many requests|rate.?limit|"
            r"temporarily unavailable|\bunavailable\b|high demand|"
            r"timeout|timed out|deadline\s*exceeded|deadlineexceeded|connection reset|"
            r"server overload|service overloaded|temporarily overloaded",
            message,
        ))
        or bool(re.search(
            r"resposta curta para contrato estruturado|resposta vazia ou inv[aá]lida",
            message,
        ))
    )
    if not is_transient:
        return None

    max_delay = float(_positive_int_env("MODEL_ROUTER_MAX_RETRY_DELAY_SECONDS", 15))
    retry_after = getattr(error, "retry_after_seconds", None)
    if retry_after is not None:
        try:
            return min(max_delay, max(0.0, float(retry_after)))
        except (TypeError, ValueError):
            pass
    base_delay = min(max_delay, float(2 ** max(0, retry_number - 1)))
    return min(max_delay, base_delay + random.uniform(0, min(0.5, base_delay / 2)))


@dataclass(frozen=True)
class ModelDefinition:
    id: str
    provider: str
    model: str
    capabilities: frozenset[str]
    context_limit: int
    enabled: bool
    priority: int
    temperature: float | None
    max_tokens: int | None
    estimated_cost_usd_per_1k_tokens: float | None


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_positive_int(value: Any, field: str, default: int | None = None) -> int | None:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ModelRouterConfigurationError(f"{field} precisa ser um inteiro positivo.") from error
    if parsed <= 0:
        raise ModelRouterConfigurationError(f"{field} precisa ser um inteiro positivo.")
    return parsed


def _as_int(value: Any, field: str, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ModelRouterConfigurationError(f"{field} precisa ser um inteiro.") from error


def _as_number(value: Any, field: str, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ModelRouterConfigurationError(f"{field} precisa ser numérico.") from error


def normalize_model_definition(raw: dict[str, Any]) -> ModelDefinition:
    if not isinstance(raw, dict):
        raise ModelRouterConfigurationError("Cada modelo do registry precisa ser um objeto.")
    model_id = str(raw.get("id") or "").strip()
    provider = str(raw.get("provider") or "").strip().lower()
    model = str(raw.get("model") or raw.get("name") or "").strip()
    capabilities = raw.get("capabilities")
    if not model_id or not provider or not model:
        raise ModelRouterConfigurationError("Modelo requer id, provider e model.")
    if provider not in DEFAULT_PROVIDER_CAPABILITIES:
        raise ModelRouterConfigurationError(f"Provider não suportado no registry: {provider}.")
    if not isinstance(capabilities, (list, tuple, set)) or not capabilities:
        raise ModelRouterConfigurationError(f"Modelo {model_id} requer capabilities não vazias.")
    normalized_capabilities = frozenset(str(item).strip().lower() for item in capabilities if str(item).strip())
    unknown = normalized_capabilities.difference({"text", "reasoning", "vision", "structured_output", "long_context", "code"})
    if unknown:
        raise ModelRouterConfigurationError(f"Modelo {model_id} possui capabilities inválidas: {', '.join(sorted(unknown))}.")
    return ModelDefinition(
        id=model_id,
        provider=provider,
        model=model,
        capabilities=normalized_capabilities,
        context_limit=_as_positive_int(raw.get("context_limit"), "context_limit", 32768) or 32768,
        enabled=_as_bool(raw.get("enabled"), True),
        priority=_as_int(raw.get("priority"), "priority", 100),
        temperature=_as_number(raw.get("temperature"), "temperature"),
        max_tokens=_as_positive_int(raw.get("max_tokens"), "max_tokens"),
        estimated_cost_usd_per_1k_tokens=_as_number(raw.get("estimated_cost_usd_per_1k_tokens"), "estimated_cost_usd_per_1k_tokens"),
    )


def build_default_registry(env: dict[str, str] | None = None) -> list[ModelDefinition]:
    source = env if env is not None else os.environ
    disabled = {item.strip() for item in str(source.get("MODEL_ROUTER_DISABLED_MODELS", "")).split(",") if item.strip()}
    models = []
    for priority, (provider, (env_key, fallback_model)) in enumerate(DEFAULT_PROVIDER_MODELS.items()):
        model = str(source.get(env_key) or fallback_model).strip()
        # Keep retired model slugs from poisoning the whole fallback chain.
        # Valid OpenRouter free routes must pass through unchanged so the
        # provider can select an available zero-cost model.
        invalid_models = {
            # Gemini 2.0 Flash was retired by Google; transparently recover
            # when an older .env still pins it.
            "gemini": {"gemini-2.0-flash", "models/gemini-2.0-flash"},
            "groq": {"qwen/qwen3.6-27b"},
            # NVIDIA retired this Qwen route on 2026-07-20. Keep an old
            # environment variable or user setting from poisoning the router.
            "nvidia": {
                "qwen/qwen3.5-122b-a10b",
                "meta/llama-3.3-70b-instruct",
            },
        }
        if model.lower() in {item.lower() for item in invalid_models.get(provider, set())}:
            model = fallback_model
        candidate_models = [model]
        fallback_config = DEFAULT_PROVIDER_MODEL_FALLBACKS.get(provider)
        if fallback_config:
            fallback_env_key, fallback_default = fallback_config
            fallback_model = str(source.get(fallback_env_key) or fallback_default).strip()
            if fallback_model.lower() in {item.lower() for item in invalid_models.get(provider, set())}:
                fallback_model = fallback_default
            if fallback_model and fallback_model.lower() != model.lower():
                candidate_models.append(fallback_model)

        for model_offset, candidate_model in enumerate(candidate_models):
            models.append(normalize_model_definition({
                "id": f"{provider}:{candidate_model}", "provider": provider, "model": candidate_model,
                "capabilities": sorted(DEFAULT_PROVIDER_CAPABILITIES[provider]), "context_limit": 32768,
                "enabled": f"{provider}:{candidate_model}" not in disabled,
                "priority": priority + model_offset,
            }))
    return models


def load_model_registry(env: dict[str, str] | None = None) -> list[ModelDefinition]:
    source = env if env is not None else os.environ
    raw = str(source.get("MODEL_ROUTER_REGISTRY_JSON") or "").strip()
    if not raw:
        return build_default_registry(source)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ModelRouterConfigurationError("MODEL_ROUTER_REGISTRY_JSON não contém JSON válido.") from error
    entries = parsed.get("models") if isinstance(parsed, dict) else parsed
    if not isinstance(entries, list):
        raise ModelRouterConfigurationError("MODEL_ROUTER_REGISTRY_JSON precisa ser uma lista ou conter models.")
    registry = [normalize_model_definition(item) for item in entries]
    if not registry:
        raise ModelRouterConfigurationError("O registry de modelos não pode ser vazio.")
    if len({item.id for item in registry}) != len(registry):
        raise ModelRouterConfigurationError("O registry de modelos contém ids duplicados.")
    return registry


def required_capabilities(request: dict[str, Any]) -> set[str]:
    task = str((request or {}).get("task") or "general_text").strip().lower()
    if task not in TASK_CAPABILITIES:
        raise ModelRouterConfigurationError(f"Task não suportada: {task}.")
    supplied = (request or {}).get("requirements") or {}
    if not isinstance(supplied, dict):
        raise ModelRouterConfigurationError("requirements precisa ser um objeto.")
    required = set(TASK_CAPABILITIES[task])
    for capability, enabled in supplied.items():
        if capability not in {"text", "reasoning", "vision", "structured_output", "long_context", "code"}:
            raise ModelRouterConfigurationError(f"Capability não suportada: {capability}.")
        if enabled:
            required.add(capability)
    return required


class ModelRouter:
    def __init__(self, registry: list[ModelDefinition], provider_order: list[str] | None = None, transient_retries: int | None = None):
        self.registry = list(registry)
        self.provider_order = [str(item).strip().lower() for item in (provider_order or []) if str(item).strip()]
        # A 503 from managed providers is commonly a short demand spike. One
        # bounded retry leaves room for a configured model fallback instead of
        # keeping the request on an overloaded endpoint for too long.
        self.transient_retries = _positive_int_env("MODEL_ROUTER_TRANSIENT_RETRIES", 1) if transient_retries is None else max(0, transient_retries)
        # Background recovery is deliberately a single, bounded provider call.
        # Retrying a provider inside the same job obscures cost and can turn one
        # recoverable failure into several expensive calls before the queue has
        # a chance to apply its backoff/rotation policy.
        if str(os.getenv("MODEL_ROUTER_SINGLE_ATTEMPT", "")).lower() in {"1", "true", "yes"}:
            self.transient_retries = 0

    def select_candidates(self, request: dict[str, Any]) -> list[ModelDefinition]:
        required = required_capabilities(request)
        provider_rank = {provider: index for index, provider in enumerate(self.provider_order)}
        available = [model for model in self.registry if model.enabled and (not self.provider_order or model.provider in provider_rank)]
        compatible = [model for model in available if required.issubset(model.capabilities)]
        if not compatible:
            if not available:
                raise ModelRouterSelectionError("Nenhum provider disponível para o Model Router.")
            raise ModelRouterSelectionError(f"Nenhum modelo disponível atende às capabilities: {', '.join(sorted(required))}.")
        selected = sorted(compatible, key=lambda model: (provider_rank.get(model.provider, len(provider_rank)), model.priority, model.id))
        # Normally every compatible model is a useful fallback. A queued
        # recovery can opt into one candidate so a single execution remains a
        # single provider/model attempt; the next queued execution rotates the
        # provider instead of fanning out within one run.
        max_candidates = _positive_int_env("MODEL_ROUTER_MAX_CANDIDATES", 0)
        return selected[:max_candidates] if max_candidates else selected

    def select(self, request: dict[str, Any]) -> ModelDefinition:
        return self.select_candidates(request)[0]

    def execute(self, request: dict[str, Any], executor: Callable[[ModelDefinition], str]) -> tuple[str, dict[str, Any]]:
        failures = []
        candidates = self.select_candidates(request)
        task = str(request.get("task") or "general_text")
        for index, candidate in enumerate(candidates):
            has_alternative_candidate = index < len(candidates) - 1
            provider_retry = 0
            while True:
                started_at = time.perf_counter()
                try:
                    result = executor(candidate)
                    if not result:
                        raise RuntimeError("Resposta vazia ou inválida.")
                    metadata = {
                        "task": task, "provider": candidate.provider, "model": candidate.model,
                        "latency_ms": round((time.perf_counter() - started_at) * 1000), "success": True,
                        "failure": None, "retry": index, "provider_retry": provider_retry, "fallback": index > 0,
                    }
                    _log_event(metadata)
                    return result, metadata
                except Exception as error:
                    delay = _transient_retry_delay(
                        error,
                        provider_retry + 1,
                        allow_timeout_retry=not has_alternative_candidate,
                    )
                    can_retry = delay is not None and provider_retry < self.transient_retries
                    failure = {
                        "task": task, "provider": candidate.provider, "model": candidate.model,
                        "latency_ms": round((time.perf_counter() - started_at) * 1000), "success": False,
                        "failure": type(error).__name__, "retry": index, "provider_retry": provider_retry,
                        "fallback": index > 0, "will_retry": can_retry,
                    }
                    _log_event(failure)
                    if can_retry:
                        provider_retry += 1
                        print("[Model Router] " + json.dumps({
                            "event": "provider_transient_retry", "task": task,
                            "provider": candidate.provider, "model": candidate.model,
                            "provider_retry": provider_retry, "delay_seconds": round(delay, 3),
                        }, ensure_ascii=False), file=os.sys.stderr)
                        time.sleep(delay)
                        continue
                    failures.append(f"{candidate.provider}/{candidate.model}: {error}")
                    break
        raise RuntimeError("Nenhum modelo do router concluiu a solicitação. Tentativas: " + " | ".join(failures[:5]))


def _log_event(metadata: dict[str, Any]) -> None:
    # Deliberately excludes prompt, completion and credentials.
    print("[Model Router] " + json.dumps(metadata, ensure_ascii=False), file=os.sys.stderr)


def get_last_execution_metadata() -> dict[str, Any] | None:
    return dict(_LAST_EXECUTION_METADATA) if isinstance(_LAST_EXECUTION_METADATA, dict) else None


def execute_routed_text(prompt: str, *, task: str | None, options_override: dict | None, provider_order: list[str], provider_executor: Callable[[str, str, dict | None], str], registry: list[ModelDefinition] | None = None) -> tuple[str, dict[str, Any]]:
    global _LAST_EXECUTION_METADATA
    router = ModelRouter(
        registry or load_model_registry(),
        provider_order,
        transient_retries=(options_override or {}).get("transient_retries"),
    )
    request = {"task": task or os.getenv("AI_ROUTER_TASK", "general_text"), "requirements": {}}

    def execute_candidate(candidate: ModelDefinition) -> str:
        options = dict(options_override or {})
        if candidate.temperature is not None and "temperature" not in options:
            options["temperature"] = candidate.temperature
        if candidate.max_tokens is not None and "num_predict" not in options:
            options["num_predict"] = candidate.max_tokens
        return provider_executor(candidate.provider, candidate.model, options)

    result, metadata = router.execute(request, execute_candidate)
    _LAST_EXECUTION_METADATA = metadata
    return result, metadata
