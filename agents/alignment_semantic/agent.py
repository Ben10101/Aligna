# -*- coding: utf-8 -*-
import json

from agents.developer.llm_service import generate_text_from_llm


class AlignmentSemanticAgent:
    """Produces hypotheses only; the Node layer validates and owns the final analysis."""

    def process(self, idea):
        prompt = f'''Você analisa linguagem natural de requisitos. Não invente fatos nem regras.
Retorne APENAS JSON válido com {{"findings":[...]}}. Cada finding tem category (missing_information, ambiguity, assumption ou contradiction), severity (low, medium ou high), evidence, message e recommendation.
Para ambiguity e contradiction, evidence deve ser um trecho literal da entrada. Para assumption, deixe claro que é hipótese. Não gere critérios de aceite, regras de negócio, scores ou decisões finais.

Entrada:
{idea}
'''
        raw = generate_text_from_llm(
            prompt,
            options_override={"temperature": 0.1, "num_predict": 900},
            use_cache=False,
            task="requirements_challenge",
        )
        data = self._parse_json(raw)
        findings = data.get("findings", []) if isinstance(data, dict) else []
        if not isinstance(findings, list):
            raise ValueError("Resposta sem lista de findings.")
        return {"findings": findings}

    @staticmethod
    def _parse_json(raw):
        text = str(raw or "").strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Resposta sem JSON válido.")
        return json.loads(text[start:end + 1])
