# -*- coding: utf-8 -*-
"""Deterministic, read-only quality review for generated backlog contracts."""
import re
import unicodedata


class BacklogChallenger:
    """Reports concrete backlog defects without generating replacement stories."""

    # These are not a catalogue of mandatory features. They become relevant
    # only when the briefing explicitly describes a ticketing journey.
    TICKETING_SIGNALS = ("ingresso", "ingressos", "ticket", "tickets", "qr code", "portaria")
    TICKETING_GUARDRAILS = (
        ("inventory_concurrency", ("assento", "setor", "disponibil", "capacidade", "reserva"), ("duplic", "concorr", "bloque", "expir", "libera"), "Quando duas compras disputarem a mesma disponibilidade, qual e a regra de bloqueio, expiracao e liberacao?"),
        ("payment_idempotency", ("pagamento", "checkout", "cobranca", "emitir ingresso"), ("idempot", "retent", "duplic", "webhook", "confirm"), "Como a confirmacao ou retentativa de pagamento evita cobranca ou emissao duplicada?"),
        ("offline_entry_reconciliation", ("qr code", "portaria", "entrada", "validar ingresso"), ("offline", "sem conex", "sincron", "conflito"), "A portaria pode operar sem conexao? Se puder, como validacoes concorrentes sao sincronizadas e resolvidas?"),
        ("personal_data_lifecycle", ("dados pessoais", "privacidade", "lgpd", "comprador"), ("retenc", "anonim", "exclus", "auditoria", "acesso"), "Qual e a politica verificavel de acesso, retencao e eliminacao/anonimizacao dos dados do comprador?"),
    )

    @staticmethod
    def _normalize(value):
        text = unicodedata.normalize("NFKD", str(value or ""))
        return "".join(char for char in text if not unicodedata.combining(char)).lower()

    @classmethod
    def _ticketing_guardrail_questions(cls, evidence_text, backlog_text):
        combined = f"{evidence_text} {backlog_text}"
        if not any(signal in combined for signal in cls.TICKETING_SIGNALS):
            return []
        questions = []
        for code, triggers, safeguards, question in cls.TICKETING_GUARDRAILS:
            if any(trigger in combined for trigger in triggers) and not any(safeguard in combined for safeguard in safeguards):
                questions.append({"code": code, "question": question, "requires_confirmation": True,
                                  "reason": "Invariante operacional de ticketing sem decisao rastreavel; nao foi inferida pelo agente."})
        return questions

    def process(self, contract, evidence_contract=None):
        stories = contract.get("stories", []) if isinstance(contract, dict) else []
        findings = []
        proposals = []
        questions = []
        known_ids = {str(story.get("id") or "").upper() for story in stories if isinstance(story, dict)}

        for story in stories:
            if not isinstance(story, dict):
                continue
            story_id = str(story.get("id") or "").upper()
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            raw_story = " ".join(str(story.get(field) or "") for field in ("actor", "goal", "description"))
            if re.search(r"</?think>|```|^\s*##\s*(?:historias|user\s+stories)\b", raw_story, re.IGNORECASE | re.MULTILINE):
                findings.append({
                    "story_id": story_id,
                    "code": "contaminated_story_content",
                    "reason": "A historia contem marcadores internos ou secoes vazadas da resposta do modelo.",
                    "severity": "high",
                })
            actor = self._normalize(story.get("actor"))
            if not actor or actor in {"usuario autorizado", "usuario", "user", "persona"}:
                findings.append({
                    "story_id": story_id,
                    "code": "generic_actor",
                    "reason": "A historia precisa de uma persona de negocio especifica.",
                    "severity": "high",
                })
            if re.search(r"^\s*como\s+.+?\b(?:eu\s+quero|quero)\b", str(story.get("goal") or ""), re.IGNORECASE):
                findings.append({
                    "story_id": story_id,
                    "code": "malformed_story_goal",
                    "reason": "O goal contem a frase completa da user story em vez da acao principal.",
                    "severity": "high",
                })
            if not context.get("acceptance_criteria"):
                findings.append({
                    "story_id": story_id,
                    "code": "missing_acceptance_criteria",
                    "reason": "A historia nao possui criterios de aceite verificaveis.",
                    "severity": "high",
                })
            question_collections = (story.get("open_questions") or [], context.get("open_questions") or [])
            has_duplicates = any(
                len(normalized) != len(set(normalized))
                for questions in question_collections
                for normalized in [[self._normalize(question) for question in questions if str(question).strip()]]
            )
            # The same questions are intentionally mirrored in both fields by
            # the contract. Only duplicates *within* one collection are a
            # repairable defect.
            if has_duplicates:
                findings.append({
                    "story_id": story_id,
                    "code": "duplicate_open_questions",
                    "reason": "A historia repete perguntas de refinamento equivalentes.",
                    "severity": "low",
                })
            for dependency in context.get("dependencies", []) if isinstance(context.get("dependencies"), list) else []:
                if str(dependency).upper() not in known_ids:
                    findings.append({
                        "story_id": story_id,
                        "code": "unknown_dependency",
                        "reason": f"Depende de {dependency}, que nao existe no contrato.",
                        "severity": "high",
                    })
            text = self._normalize(f"{story.get('goal', '')} {story.get('description', '')}")
            action_count = len(re.findall(r"\b(criar|configurar|definir|aprovar|rejeitar|executar|acompanhar|encerrar|analisar|editar|enviar)\b", text))
            if action_count >= 3:
                findings.append({
                    "story_id": story_id,
                    "code": "needs_split_or_scope",
                    "reason": "A historia combina varias acoes de produto e deve ser dividida em entregas atomicas.",
                    "severity": "medium",
                })
            if re.search(r"\b(monitorar|acompanhar)\b.{0,100}\b(operacao|geral)\b", text) and not re.search(r"\b(indicador|metrica|fila|relatorio|decisao)\b", text):
                findings.append({
                    "story_id": story_id,
                    "code": "unobservable_management_scope",
                    "reason": "A historia de gestao nao declara indicador, decisao ou controle observavel.",
                    "severity": "medium",
                })

        evidence_text = " ".join(
            self._normalize(fact.get("text"))
            for fact in (evidence_contract or {}).get("facts", [])
            if isinstance(fact, dict)
        )
        backlog_text = " ".join(
            self._normalize(f"{story.get('goal', '')} {story.get('description', '')}")
            for story in stories if isinstance(story, dict)
        )

        ticketing_questions = self._ticketing_guardrail_questions(evidence_text, backlog_text)
        questions.extend(ticketing_questions)
        proposals.extend({"type": "domain_decision", "status": "proposed", "requires_confirmation": True,
                          "code": item["code"], "reason": item["reason"]} for item in ticketing_questions)

        # Domain coverage is derived from the current contract, never from a
        # fixed catalogue of product types. A capability is covered only when
        # at least one story carries most of its meaningful terms; otherwise it
        # becomes an explicit proposal for human confirmation.
        capabilities = []
        for source in (contract, evidence_contract or {}):
            values = source.get("capabilities") if isinstance(source, dict) else None
            if isinstance(values, list):
                capabilities.extend(values)
        stopwords = {"para", "com", "dos", "das", "uma", "um", "por", "de", "do", "da", "e", "ou", "ao", "na", "no"}
        seen_capabilities = set()
        for capability in capabilities:
            if isinstance(capability, dict):
                capability_id = str(capability.get("id") or "").strip()
                capability_name = str(capability.get("name") or capability.get("text") or "").strip()
            else:
                capability_id = ""
                capability_name = str(capability or "").strip()
            key = self._normalize(capability_name)
            if not capability_name or key in seen_capabilities:
                continue
            seen_capabilities.add(key)
            terms = [term for term in re.findall(r"[a-z0-9]{4,}", key) if term not in stopwords]
            if not terms:
                continue
            # The PM has already linked every generated story to a planned
            # capability. That explicit trace is stronger than a loose
            # word-overlap heuristic ("Gestao de Infraestrutura" versus
            # "Cadastrar sala") and avoids false uncovered-capability flags.
            explicitly_covered = bool(capability_id) and any(
                capability_id.lower() in {
                    str(story_capability_id).strip().lower()
                    for story_capability_id in (story.get("capability_ids") or [])
                }
                for story in stories if isinstance(story, dict)
            )
            covered = any(
                sum(1 for term in terms if term in self._normalize(f"{story.get('goal', '')} {story.get('description', '')}"))
                >= max(1, (len(terms) + 1) // 2)
                for story in stories if isinstance(story, dict)
            )
            covered = explicitly_covered or covered
            if not covered:
                proposals.append({
                    "type": "story",
                    "capability_id": capability_id or None,
                    "capability": capability_name,
                    "status": "proposed",
                    "reason": "Capacidade declarada no briefing/backlog nao possui story rastreavel.",
                    "requires_confirmation": True,
                })
                questions.append({
                    "code": "missing_capability_decision",
                    "question": f"O produto deve incluir explicitamente a capacidade '{capability_name}' no MVP?",
                    "requires_confirmation": True,
                })

        # Coverage is traceable to the capabilities of the current project.
        # Do not inject assumptions or questions tied to a fixed domain.
        domain = "contextual"
        critical = sum(1 for item in findings if item.get("severity") == "critical")
        high = sum(1 for item in findings if item.get("severity") == "high")
        medium = sum(1 for item in findings if item.get("severity") == "medium")
        dimensions = {
            "domain_coverage": 25 if not proposals else max(0, 25 - len(proposals) * 6),
            "traceability": 20 if all(story.get("source_ids") for story in stories if isinstance(story, dict)) else 0,
            "absence_of_invention": 25 if not any(item.get("code") == "unconfirmed_context" for item in findings) else 0,
            "testability": 15 if all((story.get("refinement_context") or {}).get("acceptance_criteria") for story in stories if isinstance(story, dict)) else 0,
            "coherence": 15 if not any(item.get("code") in {"needs_split_or_scope", "release_dependency_conflict"} for item in findings) else 0,
        }
        score = max(0, sum(dimensions.values()) - critical * 30 - high * 15 - medium * 8 - len(proposals) * 5)
        decision = "BLOCK" if critical else ("REVISE" if findings or proposals or questions or score < 80 else "PASS")
        return {
            "decision": decision,
            "domain": domain,
            "findings": findings,
            "proposals": proposals,
            "questions": questions,
            "score": score,
            "threshold": 80,
            "dimensions": dimensions,
        }
