# -*- coding: utf-8 -*-
import json

from agents.developer.llm_service import generate_text_from_llm
from agents.developer.model_router import get_last_execution_metadata


class RequirementJudge:
    """Returns a review candidate; the backend owns the final decision."""

    def process(self, payload):
        data = payload or {}
        requirement = str(data.get("idea") or "").strip()
        model = data.get("requirement_model")
        challenge = data.get("challenge_report")
        if not requirement or not isinstance(model, dict) or not isinstance(challenge, dict):
            raise ValueError("Requisito, requirement_model e challenge_report são obrigatórios para o Judge.")
        prompt = f'''Você é o Requirement Judge. Valide consistência, alucinação, escopo, ambiguidades, lacunas, regras de negócio, critérios de aceite, testabilidade, contradições e falsos positivos do Challenger.
Não gere nem complete o requisito. Retorne APENAS JSON válido: {{"decision":"PASS|REVISE|BLOCK","findings":[],"challenger_false_positives":[],"feedback_for_analyzer":[]}}.
Cada finding precisa conter id, dimension, message, evidence literal da entrada, severity e feedback opcional. Se não houver problema, use listas vazias.

Requisito original:
{requirement}

Modelo do Analyst:
{json.dumps(model, ensure_ascii=False)}

Relatório do Challenger:
{json.dumps(challenge, ensure_ascii=False)}
'''
        raw = generate_text_from_llm(prompt, options_override={"temperature": 0.0, "num_predict": 1000}, use_cache=False, task="requirements_judge")
        value = str(raw or "").strip()
        start, end = value.find("{"), value.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Resposta do Judge sem JSON válido.")
        return {"judge_candidate": json.loads(value[start:end + 1]), "model_execution": get_last_execution_metadata()}
