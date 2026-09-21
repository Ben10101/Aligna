# Model Router

O Model Router adiciona seleção por tarefa e capability sobre a infraestrutura existente em `agents/developer/llm_service.py`. Ele não armazena credenciais e não substitui os executores de provider.

## Fluxo

`task -> capabilities -> model -> provider -> execution -> fallback`

As tasks disponíveis são `requirements_analysis`, `requirements_challenge`, `requirements_judge`, `text_extraction`, `visual_analysis`, `classification`, `code_generation` e `qa_generation`. A task padrão de compatibilidade é `general_text`.

As capabilities suportadas são `text`, `reasoning`, `vision`, `structured_output`, `long_context` e `code`.

Uso programático:

```python
router.select({
    "task": "requirements_analysis",
    "requirements": {
        "reasoning": True,
        "structured_output": True,
        "vision": False,
    },
})
```

## Registry

Sem configuração extra, o registry é criado a partir de `GEMINI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `DEEPSEEK_MODEL`, `NVIDIA_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL` e `OLLAMA_MODEL`. As chaves de API continuam exclusivamente no mecanismo atual de providers.

Para registrar modelos específicos, configure `MODEL_ROUTER_REGISTRY_JSON` com uma lista, ou com `{"models": [...]}`. Cada entrada requer `id`, `provider`, `model`, `capabilities` e pode configurar `context_limit`, `enabled`, `priority`, `temperature`, `max_tokens` e `estimated_cost_usd_per_1k_tokens`.

`MODEL_ROUTER_DISABLED_MODELS` aceita uma lista CSV de ids para desativação temporária.

## Fallback e observabilidade

O router tenta modelos compatíveis na ordem dos providers de `AI_PROVIDER_ORDER` e, dentro do mesmo provider, por `priority`. Em seguida preserva o fallback interno do provider, inclusive a troca de modelo do OpenRouter. Cada tentativa registra `task`, `provider`, `model`, `latency_ms`, `success`, `failure`, `retry` e `fallback`; logs não contêm prompt, resposta ou credenciais.

`generate_text_from_llm()` continua compatível. O argumento adicional opcional `task` permite que agentes novos informem a intenção sem alterar os legados. Requirements, QA e a análise semântica já a fornecem.
