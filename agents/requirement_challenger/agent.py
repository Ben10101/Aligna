# -*- coding: utf-8 -*-
import json

from agents.developer.llm_service import generate_text_from_llm
from agents.developer.model_router import get_last_execution_metadata


class RequirementChallenger:
    """Finds requirement risks only; it never edits or completes the requirement."""

    def process(self, payload):
        data = payload or {}
        requirement = str(data.get("idea") or "").strip()
        requirement_model = data.get("requirement_model")
        context = data.get("context") or ""
        if not requirement or not isinstance(requirement_model, dict):
            raise ValueError("Requisito e requirement_model são obrigatórios para o Challenger.")

        prompt = f'''Você é o Requirements Challenger. Seu trabalho é encontrar problemas reais, não melhorar ou completar o requisito.
Analise exclusivamente: AMBIGUITY, MISSING_INFORMATION, CONTRADICTION, UNTESTABLE, SCOPE_RISK, ASSUMPTION, BUSINESS_RULE_GAP e EDGE_CASE.
Não invente atores, valores, permissões, regras, estados, integrações ou comportamento de erro. Não produza Markdown.
Retorne APENAS JSON válido no formato {{"problems":[{{"type":"...","evidence":"trecho literal da entrada","explanation":"...","impact":"...","severity":"low|medium|high","clarification_question":"... ou null"}}]}}.
Cada problema precisa ter evidência literal, explicação, impacto e severidade. Não crie problema se a entrada e o modelo já o resolvem.

Requisito original:
{requirement}

Modelo estruturado:
{json.dumps(requirement_model, ensure_ascii=False)}

Contexto:
{context}
'''
        raw = generate_text_from_llm(
            prompt,
            options_override={"temperature": 0.1, "num_predict": 1000},
            use_cache=False,
            task="requirements_challenge",
        )
        text = str(raw or "").strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Resposta do Challenger sem JSON válido.")
        parsed = json.loads(text[start:end + 1])
        problems = parsed.get("problems", []) if isinstance(parsed, dict) else []
        if not isinstance(problems, list):
            raise ValueError("Resposta do Challenger sem lista de problemas.")
        return {"problems": problems, "model_execution": get_last_execution_metadata()}
