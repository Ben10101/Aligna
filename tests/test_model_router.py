# -*- coding: utf-8 -*-
import json
import os
import sys
import unittest
import importlib.util
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "agents" / "developer" / "model_router.py"
MODULE_SPEC = importlib.util.spec_from_file_location("model_router_under_test", MODULE_PATH)
model_router = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC and MODULE_SPEC.loader
sys.modules[MODULE_SPEC.name] = model_router
MODULE_SPEC.loader.exec_module(model_router)

ModelRouter = model_router.ModelRouter
ModelRouterConfigurationError = model_router.ModelRouterConfigurationError
ModelRouterSelectionError = model_router.ModelRouterSelectionError
load_model_registry = model_router.load_model_registry
normalize_model_definition = model_router.normalize_model_definition
build_default_registry = model_router.build_default_registry


def model(model_id, provider="openai", capabilities=None, enabled=True, priority=10):
    return normalize_model_definition({
        "id": model_id,
        "provider": provider,
        "model": model_id.split(":", 1)[-1],
        "capabilities": capabilities or ["text", "reasoning", "structured_output"],
        "context_limit": 32000,
        "enabled": enabled,
        "priority": priority,
        "temperature": 0.1,
        "max_tokens": 1000,
        "estimated_cost_usd_per_1k_tokens": 0.000001,
    })


class ModelRouterTests(unittest.TestCase):
    def test_selects_capability_compatible_model(self):
        router = ModelRouter([
            model("openai:text", capabilities=["text"], priority=1),
            model("gemini:vision", provider="gemini", capabilities=["text", "vision", "reasoning"], priority=20),
        ], provider_order=["openai", "gemini"])

        selected = router.select({"task": "visual_analysis", "requirements": {"vision": True}})
        self.assertEqual(selected.id, "gemini:vision")

    def test_falls_back_to_next_compatible_model(self):
        router = ModelRouter([
            model("openai:preferred", priority=1),
            model("groq:fallback", provider="groq", priority=2),
        ], provider_order=["openai", "groq"], transient_retries=0)
        attempts = []

        def executor(candidate):
            attempts.append(candidate.id)
            if candidate.id == "openai:preferred":
                raise RuntimeError("provider unavailable")
            return "ok"

        result, metadata = router.execute({"task": "requirements_analysis"}, executor)
        self.assertEqual(result, "ok")
        self.assertEqual(attempts, ["openai:preferred", "groq:fallback"])
        self.assertEqual(metadata["provider"], "groq")
        self.assertTrue(metadata["fallback"])
        self.assertEqual(metadata["retry"], 1)

    def test_falls_back_when_preferred_model_returns_empty_response(self):
        router = ModelRouter([
            model("openai:preferred", priority=1),
            model("groq:fallback", provider="groq", priority=2),
        ], provider_order=["openai", "groq"], transient_retries=0)
        attempts = []

        def executor(candidate):
            attempts.append(candidate.id)
            if candidate.id == "openai:preferred":
                return ""
            return "requisito gerado"

        result, metadata = router.execute({"task": "requirements_analysis"}, executor)
        self.assertEqual(result, "requisito gerado")
        self.assertEqual(attempts, ["openai:preferred", "groq:fallback"])
        self.assertEqual(metadata["provider"], "groq")

    @patch.object(model_router.time, "sleep")
    def test_retries_a_rate_limited_provider_before_fallback(self, mocked_sleep):
        router = ModelRouter(
            [model("nvidia:preferred", provider="nvidia")],
            provider_order=["nvidia"],
            transient_retries=1,
        )
        attempts = []

        class RateLimitError(RuntimeError):
            retry_after_seconds = 2

        def executor(candidate):
            attempts.append(candidate.id)
            if len(attempts) == 1:
                raise RateLimitError("Too Many Requests")
            return "ok"

        result, metadata = router.execute({"task": "requirements_analysis"}, executor)
        self.assertEqual("ok", result)
        self.assertEqual(["nvidia:preferred", "nvidia:preferred"], attempts)
        self.assertEqual(1, metadata["provider_retry"])
        mocked_sleep.assert_called_once_with(2)

    @patch.object(model_router.random, "uniform", return_value=0)
    @patch.object(model_router.time, "sleep")
    def test_retries_a_read_timeout_once_when_it_is_the_only_candidate(self, mocked_sleep, _mocked_jitter):
        router = ModelRouter(
            [model("nvidia:preferred", provider="nvidia")],
            provider_order=["nvidia"],
            transient_retries=1,
        )
        attempts = []

        def executor(candidate):
            attempts.append(candidate.id)
            if len(attempts) == 1:
                raise TimeoutError("The read operation timed out")
            return "ok"

        result, metadata = router.execute({"task": "requirements_analysis"}, executor)
        self.assertEqual("ok", result)
        self.assertEqual(["nvidia:preferred", "nvidia:preferred"], attempts)
        self.assertEqual(1, metadata["provider_retry"])
        mocked_sleep.assert_called_once_with(1.0)

    def test_nvidia_custom_model_gets_a_distinct_default_fallback(self):
        registry = build_default_registry({
            "NVIDIA_MODEL": "nvidia/nemotron-3.5-lightning-30b-a3b",
        })
        nvidia_models = [item.model for item in registry if item.provider == "nvidia"]

        self.assertEqual(
            ["nvidia/nemotron-3.5-lightning-30b-a3b", "deepseek-ai/deepseek-v4-flash-0731"],
            nvidia_models,
        )

    def test_retired_nvidia_model_is_replaced_in_primary_and_fallback_settings(self):
        registry = build_default_registry({
            "NVIDIA_MODEL": "qwen/qwen3.5-122b-a10b",
            "NVIDIA_MODEL_FALLBACK": "qwen/qwen3.5-122b-a10b",
        })
        nvidia_models = [item.model for item in registry if item.provider == "nvidia"]

        self.assertEqual(["deepseek-ai/deepseek-v4-flash-0731"], nvidia_models)

    def test_timeout_moves_to_distinct_fallback_model_without_a_repeat(self):
        router = ModelRouter(
            [
                model("nvidia:nemotron", provider="nvidia", priority=1),
                model("nvidia:qwen", provider="nvidia", priority=2),
            ],
            provider_order=["nvidia"],
            transient_retries=1,
        )
        attempts = []

        def executor(candidate):
            attempts.append(candidate.id)
            if candidate.id == "nvidia:nemotron":
                raise TimeoutError("The read operation timed out")
            return "ok"

        result, metadata = router.execute({"task": "requirements_analysis"}, executor)
        self.assertEqual("ok", result)
        self.assertEqual(["nvidia:nemotron", "nvidia:qwen"], attempts)
        self.assertTrue(metadata["fallback"])

    def test_rejects_unavailable_model(self):
        router = ModelRouter([model("openai:disabled", enabled=False)], provider_order=["openai"])
        with self.assertRaisesRegex(ModelRouterSelectionError, "Nenhum provider disponível"):
            router.select({"task": "requirements_analysis"})

    def test_rejects_incompatible_capability(self):
        router = ModelRouter([model("openai:text", capabilities=["text", "reasoning"])], provider_order=["openai"])
        with self.assertRaisesRegex(ModelRouterSelectionError, "capabilities"):
            router.select({"task": "visual_analysis"})

    def test_rejects_when_provider_is_not_available_in_order(self):
        router = ModelRouter([model("openai:only")], provider_order=["groq"])
        with self.assertRaisesRegex(ModelRouterSelectionError, "Nenhum provider disponível"):
            router.select({"task": "requirements_analysis"})

    def test_rejects_invalid_registry_configuration(self):
        previous = os.environ.get("MODEL_ROUTER_REGISTRY_JSON")
        try:
            os.environ["MODEL_ROUTER_REGISTRY_JSON"] = json.dumps({"models": [{"id": "bad"}]})
            with self.assertRaises(ModelRouterConfigurationError):
                load_model_registry()
        finally:
            if previous is None:
                os.environ.pop("MODEL_ROUTER_REGISTRY_JSON", None)
            else:
                os.environ["MODEL_ROUTER_REGISTRY_JSON"] = previous


if __name__ == "__main__":
    unittest.main()
