# -*- coding: utf-8 -*-
import base64
import json
import os
import urllib.request


class VisualRequirementAnalyst:
    """Extracts only visible UI evidence from an image; it never infers hidden behavior."""

    def process(self, payload):
        data = payload or {}
        image = str(data.get("image_base64") or "").strip()
        mime_type = str(data.get("mime_type") or "image/png").strip()
        if not image or not mime_type.startswith("image/"):
            raise ValueError("Imagem válida é obrigatória para o Visual Requirement Analyst.")
        prompt = '''Você é o Visual Requirement Analyst. Extraia SOMENTE elementos observáveis na imagem: campos, botões, labels, tabelas, menus, navegação, estados e mensagens. Não deduza APIs, regras, permissões, persistência, transições ou comportamentos invisíveis. "observed_behaviors" deve descrever apenas affordances aparentes (ex.: "botão Salvar visível"), não comportamento confirmado.
Retorne APENAS JSON válido: {"visual_requirement_model":{"visual_elements":[{"id":"VE-01","type":"field|button|label|table|menu|navigation|message|state|container","label":"texto observável","evidence":"texto ou elemento observável","location":"opcional"}],"observed_behaviors":[],"visual_ambiguities":[]}}.'''
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Visual analysis requer OPENAI_API_KEY e um modelo com visão configurado.")
        model = os.getenv("OPENAI_VISION_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        payload = {"model": model, "temperature": 0, "max_tokens": 1600, "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image}"}}]}]}
        request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Resposta visual sem JSON válido.")
        return json.loads(content[start:end + 1])
