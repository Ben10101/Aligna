import json
import os
import re
import sys
import unicodedata

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response
from agents.developer.response_validation import validate_qa_output


class QAEngineer:
    """Prepares validation cases for an approved story, without inventing scope."""

    def __init__(self, project_id):
        self.project_id = project_id

    @staticmethod
    def _parse_spec(value):
        if isinstance(value, dict):
            return value
        if not value:
            return {}
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}

    @staticmethod
    def _clean(value):
        return re.sub(r"\s+", " ", str(value or "")).strip(" -:\t")

    @classmethod
    def _criteria(cls, requirement_spec, requirement_summary=""):
        spec = cls._parse_spec(requirement_spec)
        raw = spec.get("acceptanceCriteria") or spec.get("acceptance_criteria") or []
        criteria = []
        for index, item in enumerate(raw, start=1):
            if isinstance(item, dict):
                criterion_id = cls._clean(item.get("id") or item.get("criterionId") or item.get("criterion_id"))
                text = cls._clean(item.get("text") or item.get("description") or item.get("criterion"))
            else:
                criterion_id, text = "", cls._clean(item)
            if text:
                criteria.append({"id": criterion_id or f"CA-{index:02d}", "text": text})
        if criteria:
            return criteria

        section = re.search(
            r"##+\s+(?:criterios de aceite|cenarios de aceite)(.*?)(?=\n##+\s+|\Z)",
            requirement_summary or "", re.IGNORECASE | re.DOTALL,
        )
        for line in (section.group(1) if section else "").splitlines():
            text = cls._clean(re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line))
            if text and re.search(r"\b(?:dado|quando|entao|então)\b", text, re.IGNORECASE):
                criteria.append({"id": f"CA-{len(criteria) + 1:02d}", "text": text})
        return criteria

    @classmethod
    def _extract_lacunas(cls, requirement_spec):
        spec = cls._parse_spec(requirement_spec)
        raw = spec.get("assumptions") or spec.get("openQuestions") or spec.get("open_questions") or []
        if not isinstance(raw, list):
            raw = [raw]
        return [cls._clean(item) for item in raw if cls._clean(item)][:5]

    @classmethod
    def _critical_rule_gaps(cls, requirement_spec, criteria):
        """Flag confirmed privacy rules that lack a verifiable BDD criterion.

        The QA agent must not invent tests for an unmodeled product rule. It
        must instead keep the preparation decision in review until RA adds the
        missing criterion.
        """
        spec = cls._parse_spec(requirement_spec)
        rules = spec.get("businessRules") or spec.get("business_rules") or []
        if not isinstance(rules, list):
            rules = [rules]
        normalized_rules = " ".join(cls._clean(rule).lower() for rule in rules)
        normalized_criteria = " ".join(cls._clean(item.get("text")) for item in criteria).lower()
        gaps = []

        if any(term in normalized_rules for term in ("retenc", "anonimiz", "descarte seguro")) and not any(
            term in normalized_criteria for term in ("retenc", "anonimiz", "exclu", "descarte", "prazo legal")
        ):
            gaps.append("Regra confirmada de retenção, anonimização/exclusão ou descarte sem critério BDD verificável.")
        if ("dados de cartão" in normalized_rules or "dados de cartao" in normalized_rules) and not any(
            term in normalized_criteria for term in ("cartão", "cartao", "dados financeiros")
        ):
            gaps.append("Regra confirmada de não armazenamento de dados de cartão sem critério BDD verificável.")
        if "tentativa de acesso negado" in normalized_rules and not (
            "acesso negado" in normalized_criteria and "log" in normalized_criteria
        ):
            gaps.append("Tentativa de acesso negado deve ser auditada, mas não possui critério BDD que comprove esse registro.")
        if ("imut" in normalized_rules or ("logs de auditoria" in normalized_rules and "alter" in normalized_rules)) and not any(
            term in normalized_criteria for term in ("imut", "sem possibilidade de alteração", "sem possibilidade de alteracao")
        ):
            gaps.append("Imutabilidade dos logs de auditoria sem critério BDD verificável.")
        if ("suporte" in normalized_rules and "tempor" in normalized_rules) and not (
            "suporte" in normalized_criteria and "tempor" in normalized_criteria
        ):
            gaps.append("Acesso temporário e mínimo do suporte sem critério BDD verificável.")
        return list(dict.fromkeys(gaps))

    @classmethod
    def _ticketing_risk_gaps(cls, requirement_spec, criteria, requirement_summary=""):
        """Expose, but never invent, ticketing safeguards absent from BDD."""
        spec = cls._parse_spec(requirement_spec)
        rules = spec.get("businessRules") or spec.get("business_rules") or []
        if not isinstance(rules, list):
            rules = [rules]
        source = " ".join([requirement_summary, " ".join(cls._clean(item.get("text")) for item in criteria if isinstance(item, dict)), " ".join(cls._clean(item) for item in rules)])
        normalized = unicodedata.normalize("NFD", source).encode("ascii", "ignore").decode("ascii").lower()
        gaps = []
        if any(term in normalized for term in ("assento", "setor", "capacidade", "reserva")) and not any(term in normalized for term in ("concorr", "duplic", "bloque", "expir", "libera")):
            gaps.append("Disponibilidade/reserva de ingressos sem comportamento verificavel para disputa concorrente, expiracao ou liberacao.")
        if any(term in normalized for term in ("pagamento", "checkout", "cobranca")) and not any(term in normalized for term in ("idempot", "retent", "duplic", "confirm")):
            gaps.append("Pagamento/checkout sem criterio verificavel de idempotencia, retentativa ou confirmacao unica.")
        if any(term in normalized for term in ("qr code", "portaria", "entrada")) and not any(term in normalized for term in ("reutil", "duplic", "offline", "conex", "sincron")):
            gaps.append("Validacao de entrada por QR Code sem criterio de reutilizacao, indisponibilidade de conexao ou reconciliacao.")
        return gaps

    @staticmethod
    def _is_unusable_response(value):
        return not value or is_error_text_response(value) or str(value).strip().lower().startswith("# documentacao gerada")

    @classmethod
    def _has_complete_case_contract(cls, value):
        """Match the backend persistence contract before returning LLM text.

        Providers sometimes render a field label without a value (or replace it
        with a prose paragraph).  A syntactically plausible Markdown response
        must not reach the backend unless every CT is independently complete.
        """
        text = str(value or "")
        blocks = re.findall(
            r"^###\s*CT[-\s]*\d+\b([\s\S]*?)(?=^###\s*CT[-\s]*\d+\b|^##\s+|\Z)",
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        if not blocks:
            return False
        fields = (
            "criterio relacionado", "pre-condicao", "dados", "acao",
            "resultado esperado", "tipo", "status", "evidencia",
        )
        for block in blocks:
            normalized = unicodedata.normalize("NFD", block).encode("ascii", "ignore").decode("ascii")
            for field in fields:
                if not re.search(rf"^\s*{re.escape(field)}\s*:\s*\S+", normalized, re.IGNORECASE | re.MULTILINE):
                    return False
        return True

    @classmethod
    def _canonicalize_case_document(cls, value, criteria, lacunas):
        """Emit the validated LLM draft in the exact persistence format.

        Providers vary Markdown spacing and heading decoration.  The agent may
        understand a valid case while a downstream parser reads a different
        boundary.  Once fields were validated, serialize them canonically so
        both layers consume the identical contract.
        """
        text = str(value or "")
        pattern = re.compile(
            r"^###\s*(CT[-\s]*\d+)\b\s*(.*)$([\s\S]*?)(?=^###\s*CT[-\s]*\d+\b|^##\s+|\Z)",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = list(pattern.finditer(text))
        if not matches:
            return ""

        def field_value(body, name):
            match = re.search(
                rf"^\s*{re.escape(name)}\s*:\s*(\S.*)$",
                body,
                re.IGNORECASE | re.MULTILINE,
            )
            return cls._clean(match.group(1)) if match else ""

        normalized_cases = []
        for match in matches:
            case_id = re.sub(r"\s+", "", match.group(1)).upper()
            title = re.sub(r"^(?:[-–—]\s*)+", "", cls._clean(match.group(2))) or f"Validar {case_id}"
            body = match.group(3)
            fields = {name: field_value(body, name) for name in (
                "criterio relacionado", "pre-condicao", "dados", "acao",
                "resultado esperado", "tipo", "status", "evidencia",
            )}
            for key in fields:
                fields[key] = re.sub(r"#{1,6}\s+", "", fields[key])
            title = re.sub(r"#{1,6}\s+", "", title)

            if not all(fields.values()):
                return ""
            # QA prepares cases; it never records an executed result or real
            # evidence during generation. Keep those display values localized.
            fields["status"] = "não executado"
            fields["evidencia"] = "não disponível"
            if not fields["dados"].lower().startswith("massa de teste"):
                fields["dados"] = f"Massa de teste ilustrativa: {fields['dados']}"
            normalized_cases.append((case_id, title, fields))

        expected = {item["id"].upper() for item in criteria}
        referenced = {
            re.sub(r"\s+", "", item[2]["criterio relacionado"]).upper()
            for item in normalized_cases
        }
        if referenced != expected:
            return ""

        lines = ["# Casos de Validação", "", "## Cobertura dos critérios de aceite"]
        lines.extend(
            f"- {case[2]['criterio relacionado']} -> {case[0]}"
            for case in normalized_cases
        )
        lines.extend(["", "## Casos de validação"])
        labels = (
            ("Critério relacionado", "criterio relacionado"),
            ("Pré-condição", "pre-condicao"),
            ("Dados", "dados"),
            ("Ação", "acao"),
            ("Resultado esperado", "resultado esperado"),
            ("Tipo", "tipo"),
            ("Status", "status"),
            ("Evidência", "evidencia"),
        )
        for case_id, title, fields in normalized_cases:
            lines.extend(["", f"### {case_id} - {title}"])
            lines.extend(f"{label}: {fields[key]}" for label, key in labels)

        generated_gaps = cls._extract_section(text, "Lacunas de qualidade")
        gaps = list(dict.fromkeys(
            [cls._clean(item) for item in generated_gaps.splitlines() if cls._clean(item)]
            + [cls._clean(item) for item in lacunas if cls._clean(item)]
        ))
        lines.extend(["", "## Lacunas de qualidade"])
        if gaps:
            lines.extend(f"- {item.lstrip('- ').strip()}" for item in gaps)
        else:
            lines.append("- Nenhuma lacuna bloqueante identificada a partir dos requisitos aprovados.")

        decision = cls._extract_section(text, "Decisao de preparacao")
        decision = re.sub(r"(?im)^\s*fim_dos_casos_de_valida(?:c|\u00e7)(?:ao|\u00e3o)\s*$", "", decision).strip()
        decision = re.sub(r"(?im)^\s*status\s*:\s*pronto para implementacao\s*$", "Status: pronto para implementação", decision)
        decision = re.sub(r"(?im)^\s*status\s*:\s*precisa de revisao\s*$", "Status: precisa de revisão", decision)
        lines.extend(["", "## Decisão de preparação"])
        if lacunas:
            lines.extend([
                "Status: precisa de revisÃ£o",
                "Justificativa: existem regras confirmadas sem critério BDD verificável; o requisito deve ser complementado antes da preparação final de QA.",
            ])
        elif decision:
            lines.extend(decision.splitlines())
        else:
            lines.extend([
                "Status: precisa de revisão",
                "Justificativa: a decisão de preparação não foi retornada de forma estruturada.",
            ])
        lines.extend(["", "FIM_DOS_CASOS_DE_VALIDAÇÃO"])
        return "\n".join(lines)

    @staticmethod
    def _extract_section(text, title):
        match = re.search(
            rf"^##\s*{re.escape(title)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
            str(text or ""),
            re.IGNORECASE | re.MULTILINE,
        )
        return match.group(1).strip() if match else ""

    @classmethod
    def _fallback_action(cls, criterion):
        """Extract an executable interaction from a BDD-style criterion."""
        original = cls._clean(criterion)
        normalized = unicodedata.normalize("NFD", original)
        normalized = normalized.encode("ascii", "ignore").decode("ascii")
        match = re.search(r"\bquando\s+(.+?)\s+ent(?:a|\u00e3)o\b", original, re.IGNORECASE)
        action = cls._clean(match.group(1) if match else "")
        generic_markers = (
            "dados relacionados",
            "aplicar a regra",
            "executar o comportamento",
            "selecionar dados",
        )
        if not action or any(marker in action.lower() for marker in generic_markers):
            return None
        return action

    @classmethod
    def _parse_bdd_criterion(cls, criterion):
        match = re.search(r"\bdado\s+(.+?)\s+quando\s+(.+?)\s+ent(?:a|\u00e3)o\s+(.+)$", cls._clean(criterion), re.IGNORECASE)
        return tuple(cls._clean(part) for part in match.groups()) if match else ("", "", cls._clean(criterion))

    @classmethod
    def _case_type(cls, action, expected):
        text = unicodedata.normalize("NFD", f"{action} {expected}").encode("ascii", "ignore").decode("ascii").lower()
        return "excecao" if re.search(r"\b(impedir|erro|inval|duplic|sem preench|nao permit|recusar|bloque\w*)\b", text) else "funcional"

    @classmethod
    def _selection_rule_cases(cls, criterion_id, given, expected):
        """Derive atomic cases from an explicit fixed-list selection rule."""
        normalized = unicodedata.normalize("NFD", expected).encode("ascii", "ignore").decode("ascii").lower()
        if not ("lista" in normalized and "selecao" in normalized):
            return []
        cases = [{"criterion": criterion_id, "title": "Validar seleção em lista pré-definida", "precondition": given, "data": "Duas ou mais opções disponíveis na lista pré-definida.", "action": "Selecionar mais de uma opção da lista pré-definida e salvar.", "expected": "As opções selecionadas são aceitas conforme a regra confirmada.", "type": "funcional"}]
        if "opcional" in normalized:
            cases.append({"criterion": criterion_id, "title": "Validar ausência de seleção opcional", "precondition": given, "data": "Nenhuma opção selecionada.", "action": "Salvar sem selecionar uma opção na lista pré-definida.", "expected": "O fluxo permite concluir o salvamento sem seleção, pois o campo é opcional.", "type": "funcional"})
        if "nao permite texto livre" in normalized:
            cases.append({"criterion": criterion_id, "title": "Validar bloqueio de texto livre", "precondition": given, "data": "Um valor que não pertence à lista pré-definida.", "action": "Tentar informar um valor fora das opções da lista pré-definida.", "expected": "A interface não aceita texto livre para esse campo.", "type": "excecao"})
        return cases

    @classmethod
    def _required_field_cases(cls, criterion_id, given, when, expected):
        normalized = unicodedata.normalize("NFD", when).encode("ascii", "ignore").decode("ascii")
        match = re.search(r"sem preencher (?:os )?campos obrigatorios(?: de)?\s+(.+)$", normalized, re.IGNORECASE)
        if not match:
            return []
        fields = [cls._clean(field) for field in re.split(r"\s+e\s+|\s*,\s*", match.group(1)) if cls._clean(field)]
        if len(fields) < 2:
            return []
        return [{
            "criterion": criterion_id,
            "title": f"Validar obrigatoriedade de {field}",
            "precondition": given,
            "data": f"{field}: não preenchido.",
            "action": f"Tentar salvar sem preencher {field}.",
            "expected": expected,
            "type": "excecao",
        } for field in fields]

    @classmethod
    def _has_required_field_case_coverage(cls, document, criteria):
        """Require one focused negative case for every explicit required field."""
        blocks = re.findall(
            r"^###\s*CT[-\s]*\d+\b([\s\S]*?)(?=^###\s*CT[-\s]*\d+\b|^##\s+|\Z)",
            str(document or ""),
            re.IGNORECASE | re.MULTILINE,
        )
        normalized_blocks = [
            unicodedata.normalize("NFD", block).encode("ascii", "ignore").decode("ascii").lower()
            for block in blocks
        ]
        for criterion in criteria:
            _given, when, expected = cls._parse_bdd_criterion(criterion["text"])
            required = cls._required_field_cases(criterion["id"], "", when, expected)
            if not required:
                continue
            for case in required:
                field = unicodedata.normalize("NFD", case["data"].split(":", 1)[0]).encode("ascii", "ignore").decode("ascii").lower()
                if not any(
                    f"criterio relacionado: {criterion['id'].lower()}" in block
                    and field in block
                    and re.search(r"acao\s*:\s*.*\b(sem|ausente|vazio|deixar)\b", block)
                    for block in normalized_blocks
                ):
                    return False
        return True

    @classmethod
    def _data_from_action(cls, when):
        normalized = unicodedata.normalize("NFD", when).encode("ascii", "ignore").decode("ascii").lower()
        if "nome que ja existe" in normalized:
            return "Um nome já cadastrado, usando a variação de maiúsculas, minúsculas ou espaços prevista no critério."
        fill_match = re.search(r"(?:eu\s+)?preencher\s+(.+?)(?:\s+e\s+salvar)?$", when, re.IGNORECASE)
        if fill_match:
            return f"Campos a preencher: {cls._clean(fill_match.group(1))}."
        return f"Condição de entrada descrita no critério: {when}."

    @classmethod
    def _derive_fallback_cases(cls, criterion):
        given, when, then = cls._parse_bdd_criterion(criterion["text"])
        required_field_cases = cls._required_field_cases(criterion["id"], given, when, then)
        if required_field_cases:
            return required_field_cases
        selection_cases = cls._selection_rule_cases(criterion["id"], given, then)
        if selection_cases:
            return selection_cases
        action = cls._fallback_action(criterion["text"])
        if not action:
            return []
        return [{"criterion": criterion["id"], "title": f"Validar {criterion['id']}", "precondition": given or "O contexto descrito no critério de aceite está disponível.", "data": cls._data_from_action(when or action), "action": action, "expected": then or criterion["text"], "type": cls._case_type(action, then)}]

    @classmethod
    def _fallback(cls, criteria, lacunas):
        fallback_lacunas = list(lacunas)
        cases = []
        for criterion in criteria:
            derived = cls._derive_fallback_cases(criterion)
            if not derived:
                fallback_lacunas.append(
                    f"{criterion['id']}: a interação observável precisa ser detalhada antes da execução do caso."
                )
                continue
            cases.extend(derived)
        lines = ["# Casos de Validação", "", "## Cobertura dos critérios de aceite"]
        lines.extend(
            f"- {criterion['id']} -> " + ", ".join(
                f"CT-{index:02d}" for index, case in enumerate(cases, start=1) if case["criterion"] == criterion["id"]
            )
            for criterion in criteria
        )
        lines.extend(["", "## Casos de validação"])
        for index, item in enumerate(cases, start=1):
            item["id"] = item["criterion"]
            precondition = re.sub(r"#{1,6}\s+", "", str(item['precondition']))
            data = re.sub(r"#{1,6}\s+", "", str(item['data']))
            action = re.sub(r"#{1,6}\s+", "", str(item['action']))
            expected = re.sub(r"#{1,6}\s+", "", str(item['expected']))
            lines.extend([
                "", f"### CT-{index:02d} — Validar {item['id']}", f"Critério relacionado: {item['id']}",
                f"Pré-condição: {precondition}", f"Dados: {data}",
                f"Ação: {action}",
                f"Resultado esperado: {expected}", f"Tipo: {item['type']}", "Status: não executado", "Evidência: não disponível",
            ])
        lines.extend(["", "## Lacunas de qualidade"])
        if fallback_lacunas:
            lines.extend(f"- {item}" for item in dict.fromkeys(fallback_lacunas))
        else:
            lines.append("- Nenhuma lacuna bloqueante identificada a partir dos requisitos aprovados.")
        decision = "precisa de revisão" if fallback_lacunas else "pronto para implementação"
        justification = (
            "Existem lacunas que impedem a execução objetiva de todos os casos."
            if fallback_lacunas else
            "Todos os casos foram derivados exclusivamente de critérios e regras confirmados."
        )
        lines.extend(["", "## Decisão de preparação", f"Status: {decision}", f"Justificativa: {justification}", "", "FIM_DOS_CASOS_DE_VALIDAÇÃO"])
        return "\n".join(lines)

    @classmethod
    def _prompt(cls, idea, requirement_summary, requirement_spec, criteria, lacunas):
        return f"""
Voce prepara Casos de Validacao para uma unica story. Nao execute testes e nao afirme que a feature foi validada.

Story:
{idea}

Requirement Spec (fonte de verdade):
{json.dumps(cls._parse_spec(requirement_spec), ensure_ascii=False)}

Resumo auxiliar:
{requirement_summary}

Criterios de aceite autorizados:
{json.dumps(criteria, ensure_ascii=False)}

Lacunas registradas:
{json.dumps(lacunas, ensure_ascii=False)}

Retorne somente Markdown no formato abaixo:
# Casos de Validacao
## Cobertura dos criterios de aceite
- CA-xx -> CT-xx
## Casos de validacao
### CT-xx — titulo objetivo
Criterio relacionado: CA-xx
Pre-condicao:
Dados:
Acao:
Resultado esperado:
Tipo: funcional | excecao | integracao | regressao
Status: nao executado
Evidencia: nao disponivel
## Lacunas de qualidade
- somente lacunas vindas da fonte; use "Nenhuma lacuna bloqueante identificada..." se nao houver.
## Decisao de preparacao
Status: pronto para implementacao | precisa de revisao
Justificativa:
FIM_DOS_CASOS_DE_VALIDACAO

Regras obrigatorias:
- Gere pelo menos um caso para cada CA, e nenhum caso para CA inexistente. Um CA pode ter mais de um CT quando possuir verificacoes observaveis independentes.
- Cada CT deve validar um unico resultado observavel principal. Separe comportamentos unidos por "e", "ou", "opcional", "nao permitir" ou regras independentes quando nao puderem falhar pelo mesmo motivo.
- Escreva Acao e Resultado esperado com os termos concretos do CA; nunca use expressoes vagas como "executar o comportamento", "selecionar dados", "dados relacionados" ou "aplicar a regra".
- Pre-condicao deve reaproveitar o contexto do DADO; Dados deve nomear valores ou estados usados no caso. Nao use textos genericos como "ambiente disponivel" ou "dados validos".
- Quando a fonte nao definir valores concretos, descreva-os como massa de teste ilustrativa; nao transforme exemplos de teste em regra do produto.
- Para cada campo explicitamente obrigatorio, gere um CT negativo dedicado em que somente aquele campo esteja ausente.
- Para uma regra com lista pre-definida, selecao multipla, opcionalidade ou bloqueio de texto livre, gere CTs separados para cada comportamento confirmado.
- Nao invente endpoints, autenticacao, auditoria, persistencia, limites, falhas de backend, integracoes ou requisitos nao confirmados.
- Cenario de excecao, limite ou integracao so pode existir quando o CA ou uma regra confirmada o sustentar.
- Resultado esperado deve repetir ou parafrasear somente o comportamento comprovavel no CA.
- Se houver lacuna registrada, nao invente um CT para supri-la. Registre a lacuna e use "Status: precisa de revisao" na decisao de preparacao.
""".strip()

    @classmethod
    def _review_prompt(cls, idea, criteria, cases):
        return f"""
Voce revisa casos de validacao de uma unica story. Avalie somente o que esta comprovado nos criterios autorizados.

Story: {idea}
Criterios autorizados: {json.dumps(criteria, ensure_ascii=False)}
Casos propostos:\n{cases}

Retorne somente JSON: {{"decision":"PASS|REVISE","findings":["..."]}}.
Marque REVISE somente se houver: CT com mais de um comportamento observavel independente; Acao ou Resultado esperado generico; cobertura ausente; ou comportamento nao sustentado pelo CA. Nao invente regras e nao critique estilo sem impacto de teste.
""".strip()

    @staticmethod
    def _review_findings(raw):
        try:
            start = str(raw or "").find("{")
            review = json.loads(str(raw)[start:]) if start >= 0 else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
        if str(review.get("decision") or "").upper() != "REVISE":
            return []
        return [str(item).strip() for item in review.get("findings", []) if str(item).strip()]

    @classmethod
    def _repair_prompt(cls, base_prompt, draft, findings):
        return f"""{base_prompt}

Revise o rascunho abaixo conforme os achados. Retorne o documento Markdown completo no mesmo formato, sem incluir comentarios de revisao.
Achados: {json.dumps(findings, ensure_ascii=False)}
Rascunho:\n{draft}
""".strip()

    def process(self, idea, code_structure, requirement_spec=None):
        requirement_summary = str(code_structure or "").strip()
        criteria = self._criteria(requirement_spec, requirement_summary)
        if not criteria:
            raise RuntimeError("O QA nao pode preparar casos de validacao sem criterios de aceite aprovados.")
        lacunas = list(dict.fromkeys(
            self._extract_lacunas(requirement_spec)
            + self._critical_rule_gaps(requirement_spec, criteria)
            + self._ticketing_risk_gaps(requirement_spec, criteria, requirement_summary)
        ))
        model = os.getenv("QA_OLLAMA_MODEL") or os.getenv("OLLAMA_MODEL", "gemma3:4b")
        previous_timeout = os.environ.get("OLLAMA_REQUEST_TIMEOUT_SECONDS")
        os.environ["OLLAMA_REQUEST_TIMEOUT_SECONDS"] = os.getenv("QA_OLLAMA_TIMEOUT_SECONDS", previous_timeout or "45")
        try:
            base_prompt = self._prompt(idea, requirement_summary, requirement_spec, criteria, lacunas)
            result = generate_text_from_llm(
                base_prompt, model=model,
                options_override={"temperature": 0.1, "num_predict": int(os.getenv("QA_CASES_NUM_PREDICT", "1400")), "transient_retries": 0},
                use_cache=False, task="qa_generation",
            )
        except Exception as error:
            print(f"[QA Engineer] generation_failed: {error}", file=sys.stderr)
            result = ""
        finally:
            if previous_timeout is None:
                os.environ.pop("OLLAMA_REQUEST_TIMEOUT_SECONDS", None)
            else:
                os.environ["OLLAMA_REQUEST_TIMEOUT_SECONDS"] = previous_timeout

        expected_ids = [item["id"] for item in criteria]
        valid, _reason = validate_qa_output(result, expected_criteria_ids=expected_ids) if not self._is_unusable_response(result) else (False, "empty")
        if valid and self._has_complete_case_contract(result):
            canonical = self._canonicalize_case_document(result, criteria, lacunas)
            if not canonical:
                valid = False
            else:
                result = canonical
                valid, _reason = validate_qa_output(result, expected_criteria_ids=expected_ids)
                if valid and not self._has_required_field_case_coverage(result, criteria):
                    valid = False
        if valid and self._has_complete_case_contract(result):
            try:
                review = generate_text_from_llm(
                    self._review_prompt(idea, criteria, result), model=model,
                    options_override={"temperature": 0.0, "num_predict": 500, "json_mode": True, "require_json_object": True, "transient_retries": 0},
                    use_cache=False, task="qa_generation",
                )
                findings = self._review_findings(review)
                if findings:
                    result = generate_text_from_llm(
                        self._repair_prompt(base_prompt, result, findings), model=model,
                        options_override={"temperature": 0.0, "num_predict": int(os.getenv("QA_CASES_NUM_PREDICT", "1400")), "transient_retries": 0},
                        use_cache=False, task="qa_generation",
                    )
                    valid, _reason = validate_qa_output(result, expected_criteria_ids=expected_ids)
                    if not valid or not self._has_complete_case_contract(result):
                        raise RuntimeError("A revisao de QA nao produziu casos de validacao completos.")
                    result = self._canonicalize_case_document(result, criteria, lacunas)
                    valid, _reason = validate_qa_output(result, expected_criteria_ids=expected_ids)
                    if valid and not self._has_required_field_case_coverage(result, criteria):
                        valid = False
                    if not valid or not result:
                        raise RuntimeError("A revisao de QA nao produziu casos no formato de persistencia.")
            except RuntimeError as error:
                print(f"[QA Engineer] repair_failed: {error}", file=sys.stderr)
                valid = False
            except Exception as error:
                print(f"[QA Engineer] semantic_review_unavailable: {error}", file=sys.stderr)
            
            if valid:
                return result.strip()
        fallback = self._fallback(criteria, lacunas)
        valid, reason = validate_qa_output(fallback, expected_criteria_ids=expected_ids)
        if not valid:
            raise RuntimeError(f"Fallback de casos de validacao invalido: {reason}")
        return fallback
