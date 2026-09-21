# -*- coding: utf-8 -*-
import json

from agents.developer.llm_service import generate_text_from_llm


class RequirementEngineAgent:
    """Returns candidate findings only; the backend owns requirement facts and validation."""

    TASK_BY_STAGE = {
        "requirements_analysis": "requirements_analysis",
        "requirements_challenge": "requirements_challenge",
        "requirements_judge": "requirements_judge",
    }

    def process(self, payload):
        stage = str((payload or {}).get("stage") or "requirements_analysis")
        idea = str((payload or {}).get("idea") or "").strip()
        feedback = (payload or {}).get("feedback_for_analyzer") or []
        visual_model = (payload or {}).get("visual_requirement_model")
        if stage not in self.TASK_BY_STAGE or not idea:
            raise ValueError("Stage ou ideia inválidos para o Requirement Engine.")

        prompt = f'''Você executa a etapa {stage} de um motor de requisitos.
Não invente atores, valores, permissões, regras, estados, integrações ou comportamentos de erro.
Retorne APENAS JSON válido: {{"semantic_context":{{"domain":"","intent":"","actors":[],"entities":[],"goals":[],"actions":[],"states":[],"ambiguities":[]}},"findings":[...]}}.
O semantic_context deve ser extraído somente da entrada. Cada item semântico
deve ter text, evidence literal da entrada e confidence entre 0 e 1. Use listas
vazias quando não houver evidência; não invente classificações.
Cada finding tem category (missing_information, ambiguity, assumption ou contradiction), severity (low, medium ou high), evidence, message, recommendation, clarification_question e answer_hint.
Quando a lacuna precisar de resposta humana, clarification_question deve ser uma unica pergunta direta, com contexto suficiente, terminando em "?" e pedindo apenas uma decisao. answer_hint deve dizer em uma frase curta qual informacao a pessoa precisa fornecer. Nao use perguntas vagas como "Pode detalhar?" ou "Defina melhor". Se a lacuna nao precisar de resposta, use null nesses dois campos.
Para ambiguity e contradiction, evidence deve ser trecho literal da entrada. Uma assumption deve declarar que é hipótese. Não gere requisito, regra, fluxo, critério de aceite, score ou decisão final.

Entrada:
{idea}

Feedback do Judge para a revisão (não complete lacunas nem invente fatos):
{json.dumps(feedback, ensure_ascii=False)}

Modelo visual (somente evidência observável; não presuma comportamento invisível):
{json.dumps(visual_model, ensure_ascii=False)}
'''
        raw = generate_text_from_llm(
            prompt,
            options_override={
                "temperature": 0.1,
                "num_predict": 900,
                "json_mode": True,
                "min_response_chars": 20,
                "require_json_object": True,
            },
            use_cache=False,
            task=self.TASK_BY_STAGE[stage],
        )
        text = str(raw or "").strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Resposta sem JSON válido.")
        data = json.loads(text[start:end + 1])
        findings = data.get("findings", []) if isinstance(data, dict) else []
        if not isinstance(findings, list):
            raise ValueError("Resposta sem lista de findings.")
        semantic_context = data.get("semantic_context", {}) if isinstance(data, dict) else {}
        if not isinstance(semantic_context, dict):
            raise ValueError("Resposta sem semantic_context valido.")
        for key in ("actors", "entities", "goals", "actions", "states", "ambiguities"):
            values = semantic_context.get(key, [])
            if not isinstance(values, list):
                raise ValueError(f"semantic_context.{key} precisa ser lista.")
            normalized_values = []
            for item in values:
                if not isinstance(item, dict):
                    continue
                text_value = str(item.get("text") or "").strip()
                evidence = str(item.get("evidence") or "").strip()
                # Recover only when the claimed text is literally present in
                # the source briefing. Otherwise discard the candidate rather
                # than allowing an unsupported semantic fact downstream.
                if text_value and not evidence and text_value.lower() in idea.lower():
                    item = {**item, "evidence": text_value}
                    evidence = text_value
                if not text_value or not evidence or evidence.lower() not in idea.lower():
                    continue
                try:
                    confidence = float(item.get("confidence", 0))
                except (TypeError, ValueError) as error:
                    raise ValueError(f"semantic_context.{key} possui confidence invalida.") from error
                if not 0 <= confidence <= 1:
                    raise ValueError(f"semantic_context.{key} possui confidence invalida.")
                normalized_values.append(item)
            semantic_context[key] = normalized_values
        return {"semantic_context": semantic_context, "findings": findings}
