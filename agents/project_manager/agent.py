# -*- coding: utf-8 -*-
import json
import os
import re
import sys
import unicodedata
import hashlib
from datetime import datetime, timezone

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

"""
Project Manager Agent
Responsavel por transformar o briefing do projeto em backlog inicial coerente
"""

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response
from agents.developer.response_validation import validate_backlog_output
from agents.backlog_challenger.agent import BacklogChallenger
from agents.backlog_judge.agent import BacklogJudge
from agents.requirement_engine.agent import RequirementEngineAgent


class BacklogGenerationError(RuntimeError):
    def __init__(self, message, rejected_draft=None):
        super().__init__(message)
        self.rejected_draft = rejected_draft


class ProjectManager:
    # A backlog is complete when it covers the confirmed journeys, not when it
    # reaches an arbitrary number.  The range only protects the initial
    # generation from being too shallow or unmanageably broad.
    # A complete initial backlog needs enough coverage for the primary flow,
    # administration, exceptions and governance. It is emitted in small
    # batches, never as one oversized provider response.
    STORY_RANGE = (15, 24)
    INCREMENTAL_STORIES_PER_BATCH = 4
    INCREMENTAL_MIN_BATCHES = STORY_RANGE[0] // INCREMENTAL_STORIES_PER_BATCH
    INCREMENTAL_MAX_BATCHES = STORY_RANGE[1] // INCREMENTAL_STORIES_PER_BATCH
    # This is a transport contract between product discovery and refinement.
    # Its entries point to briefing facts; it is deliberately not a catalog of
    # inferred business rules.
    PM_HANDOFF_VERSION = "pm-handoff/v1"
    PLANNING_LANES = [
        ("fundacao", "fundacao do produto", "cadastro inicial, configuracao basica, entidade principal e primeiro fluxo utilizavel"),
        ("operacao", "operacao principal", "acompanhamento, execucao, atualizacao de status, filas e trabalho do dia a dia"),
        ("gestao", "gestao e visibilidade", "consultas gerenciais, relatorios, dashboards e leitura consolidada"),
        ("governanca", "governanca e controle", "aprovacoes, permissoes, auditoria, compliance e controle de mudancas"),
    ]
    FOUNDATION_SIGNAL_PROMPTS = [
        {
            "key": "criar",
            "pattern": r"\b(criar|cadastrar|registrar|abrir)\b",
            "label": "criacao e cadastro inicial",
            "instruction": "Cubra a criacao da entidade principal, o cadastro inicial e o primeiro registro necessario para colocar o produto em uso.",
        },
        {
            "key": "configurar",
            "pattern": r"\b(configurar|definir|planejar|organizar)\b",
            "label": "configuracao e planejamento",
            "instruction": "Cubra configuracao inicial, definicao de parametros operacionais e planejamento basico do fluxo principal.",
        },
        {
            "key": "visualizar",
            "pattern": r"\b(visualizar|consultar|listar|buscar)\b",
            "label": "consulta e visibilidade",
            "instruction": "Cubra consulta, listagem, busca e visibilidade do estado atual do produto para o papel principal.",
        },
        {
            "key": "acompanhar",
            "pattern": r"\b(acompanhar|monitorar|atualizar|gerenciar)\b",
            "label": "operacao e acompanhamento",
            "instruction": "Cubra acompanhamento operacional, atualizacao do trabalho em andamento e monitoramento do fluxo do dia a dia.",
        },
        {
            "key": "aprovar",
            "pattern": r"\b(aprovar|validar|autorizar|revisar)\b",
            "label": "decisao e governanca",
            "instruction": "Cubra decisao, aprovacao, validacao ou governanca minima para que o fluxo principal fique controlado.",
        },
    ]
    PERSONA_NORMALIZATION = {
        "colaborador do setor administrativo": "colaborador",
        "colaborador da operacao": "colaborador",
        "colaborador da operação": "colaborador",
        "analista de suporte": "atendente",
        "gestor de ti": "gestor",
        "gestor de suporte": "gestor",
        "administrador do sistema": "administrador",
        "operador": "atendente",
    }
    ADVANCED_STORY_PATTERNS = [
        r"\bwebhook\b",
        r"\bintegrac",
        r"\bexportar\b",
        r"\bcsv\b",
        r"\bsap\b",
        r"\berp\b",
        r"\bcrm\b",
        r"\bmarketplace\b",
        r"\bblockchain\b",
        r"\bwearables?\b",
        r"\bwhite-?label\b",
        r"\bgamifica",
        r"\bpegada de carbono\b",
        r"\besg\b",
        r"\broi\b",
        r"\bia\b",
        r"\bpredit",
        r"\bbenchmark",
    ]
    TECHNICAL_STORY_PATTERNS = [
        r"\bentidade\b",
        r"\bnumero sequencial\b",
        r"\bidentificador unico\b",
        r"\bchave primaria\b",
        r"\btabela\b",
        r"\bapi\b",
        r"\bendpoint\b",
        r"\bschema\b",
        r"\bmodelo de dados\b",
        r"\bcrud\b",
    ]
    FOUNDATION_FRONTLOAD_RULES = [
        ("criar", r"\b(criar|cadastrar|registrar|abrir)\b"),
        ("configurar", r"\b(configurar|definir|planejar|organizar|montar)\b"),
        ("visualizar", r"\b(visualizar|consultar|listar|buscar|resumo|painel)\b"),
        ("acompanhar", r"\b(acompanhar|monitorar|atualizar|gerenciar|status)\b"),
        ("aprovar", r"\b(aprovar|validar|autorizar|revisar)\b"),
    ]
    CORE_PACK_REQUIREMENTS = [
        ("criar_evento", "Criar a entidade principal do produto"),
        ("definir_escopo", "Definir escopo, configuracao ou planejamento inicial"),
        ("registrar_orcamento", "Registrar orcamento ou informacao operacional central"),
        ("cadastrar_fornecedor", "Cadastrar fornecedor, recurso ou parceiro essencial"),
        ("cadastrar_convidado", "Cadastrar convidado, participante ou publico principal"),
        ("aprovar_fluxo", "Aprovar ou validar o fluxo basico"),
        ("visualizar_resumo", "Visualizar resumo ou painel inicial do trabalho"),
        ("acompanhar_status", "Acompanhar status ou atualizacao operacional"),
    ]
    CORE_PACK_SLOTS = [
        ("criar_evento", "criar o evento principal com campos basicos"),
        ("definir_escopo", "definir escopo ou planejamento inicial do evento"),
        ("registrar_orcamento", "registrar orcamento inicial ou categorias de custo"),
        ("cadastrar_fornecedor", "cadastrar fornecedor ou recurso essencial"),
        ("cadastrar_convidado", "cadastrar convidado, participante ou lista inicial"),
        ("aprovar_fluxo", "aprovar ou validar o fluxo basico do evento"),
        ("visualizar_resumo", "visualizar resumo inicial ou painel do evento"),
        ("acompanhar_status", "acompanhar ou atualizar status/andamento do trabalho"),
    ]

    def __init__(self, project_id):
        self.project_id = project_id
        self._clarifications_answered = False
        self._requirements_contract = None
        self._elicitation_state = None
        self._incremental_checkpoint = None

    @staticmethod
    def _normalize_elicitation_answers(answers):
        """Accept API/UI answer formats without turning missing input into facts."""
        normalized = {}
        if isinstance(answers, dict):
            source = answers.items()
        elif isinstance(answers, list):
            source = ((item.get("id") or item.get("question"), item.get("answer")) for item in answers if isinstance(item, dict))
        else:
            source = []
        for key, value in source:
            answer = str(value or "").strip()
            if key and answer:
                normalized[str(key)] = answer
        return normalized

    def _build_elicitation_state(self, contract, previous_state=None, answers=None):
        """Create a traceable discovery state from analysed requirement gaps."""
        previous_state = previous_state if isinstance(previous_state, dict) else {}
        previous_questions = previous_state.get("questions", []) if isinstance(previous_state.get("questions", []), list) else []
        known_answers = self._normalize_elicitation_answers(previous_state.get("answers"))
        known_answers.update(self._normalize_elicitation_answers(answers))
        candidates_by_id = {
            str(item.get("id")): item for item in previous_questions
            if isinstance(item, dict) and item.get("id")
        }
        previous_by_question = {
            re.sub(r"\s+", " ", str(item.get("question") or "").strip().lower()): item
            for item in previous_questions if isinstance(item, dict) and item.get("question")
        }
        for item in contract.get("questions", []) if isinstance(contract, dict) else []:
            if isinstance(item, dict) and item.get("id"):
                question_key = re.sub(r"\s+", " ", str(item.get("question") or "").strip().lower())
                if question_key in previous_by_question:
                    item = {**item, "id": previous_by_question[question_key].get("id")}
                candidates_by_id[str(item["id"])] = item
        questions = []
        for item in candidates_by_id.values():
            if not isinstance(item, dict):
                continue
            question_id = str(item.get("id") or "").strip()
            question = str(item.get("question") or "").strip()
            if not question_id or not question:
                continue
            answer = known_answers.get(question_id) or known_answers.get(question)
            questions.append({
                "id": question_id, "question": question,
                "reason": str(item.get("reason") or "").strip(),
                "answer_hint": str(item.get("answer_hint") or "").strip(),
                "impact": "HIGH" if item.get("blocking", True) else "MEDIUM",
                "blocking": bool(item.get("blocking", True)),
                "status": "answered" if answer else "open", "answer": answer or None,
                "finding_id": item.get("finding_id"),
            })
        blocking_open = [item for item in questions if item["blocking"] and item["status"] != "answered"]
        rounds = list(previous_state.get("rounds", [])) if isinstance(previous_state.get("rounds", []), list) else []
        if answers:
            rounds.append({"number": len(rounds) + 1, "answered_question_ids": sorted(self._normalize_elicitation_answers(answers).keys()), "answered_at": datetime.now(timezone.utc).isoformat()})
        confirmed = [{"question_id": item["id"], "decision": item["answer"], "source": "user"} for item in questions if item["answer"]]
        facts = contract.get("requirements", []) if isinstance(contract, dict) else []
        confidence = min(0.95, max(0.15, 0.35 + min(len(facts), 6) * 0.05 + min(len(confirmed), 6) * 0.08 - len(blocking_open) * 0.16))
        now = datetime.now(timezone.utc).isoformat()
        started_at = previous_state.get("started_at") or now
        evidence = list(contract.get("evidence", {}).get("facts", [])) if isinstance(contract, dict) and isinstance(contract.get("evidence"), dict) else []
        evidence.extend({"id": f"ANS-{item['id']}", "type": "user_answer", "question_id": item["id"], "text": item["answer"]} for item in questions if item["answer"])
        return {
            "version": 1,
            "status": "ELICITATION" if blocking_open else "READY_FOR_REVIEW",
            "phase_history": [{"phase": "DISCOVERY", "status": "completed"}, {"phase": "ELICITATION", "status": "active" if blocking_open else "completed"}, {"phase": "READINESS_EVALUATION", "status": "pending" if blocking_open else "completed"}],
            "known_facts": facts,
            "confirmed_decisions": confirmed,
            "assumptions": contract.get("assumptions", []) if isinstance(contract, dict) else [],
            "open_questions": blocking_open,
            "missing_information": [item.get("reason") for item in blocking_open if item.get("reason")],
            "question_candidates": questions,
            "questions": [item for item in questions if item["blocking"]],
            "questions_asked": [item for item in questions if item["blocking"]],
            "answers": known_answers, "evidence": evidence, "rounds": rounds,
            "started_at": started_at, "updated_at": now, "confidence": round(confidence, 2),
            "metrics": {"questions_asked": len([item for item in questions if item["blocking"]]), "questions_answered": len(confirmed), "blocking_questions": len(blocking_open), "rounds": len(rounds), "elicitation_time_seconds": max(0, int((datetime.now(timezone.utc) - datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds()))},
            "readiness": {"ready": not blocking_open, "decision": "NEED_INPUT" if blocking_open else "READY", "blocking_questions": len(blocking_open), "blocking_question_details": blocking_open},
        }

    def _story_block_format_rules(self):
        return """
- Cada story deve vir em um bloco de 2 linhas.
- A primeira linha deve ser a user story no formato "US-XX | Como ..., eu quero ..., para ...".
- Use literalmente o conector "para" no titulo; nao substitua por "garantindo", "evitando" ou explicacoes fora do formato.
- A segunda linha deve ser uma descricao curta e util, com contexto, regra, excecao ou expectativa importante.
- A descricao nao deve repetir o titulo; ela deve acrescentar informacao nova para produto, arquitetura ou QA.
- Mantenha a descricao objetiva, com 1 ou 2 frases.
- A historia precisa apontar uma acao de produto real, nao uma frase abstrata sobre processo interno.
- Quando houver campo, estado, permissão ou excecao, mencione isso na descricao.
""".strip()

    def _compose_story_block(self, index, title, description):
        cleaned_title = re.sub(r"\s+", " ", (title or "")).strip()
        cleaned_description = re.sub(r"\s+", " ", (description or "")).strip()
        lines = [f"- US-{index:02d} | {cleaned_title}"]
        if cleaned_description:
            lines.append(f"  Descricao: {cleaned_description}")
        return "\n".join(lines).strip()

    def _normalize_text(self, value):
        text = (value or "").strip()
        normalized = unicodedata.normalize("NFD", text.lower())
        normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
        return text, normalized

    def _compact_briefing(self, idea):
        text = re.sub(r"\n{3,}", "\n\n", (idea or "").strip())
        text = re.sub(r"[ \t]+", " ", text)
        if len(text) <= 1800:
            return text
        return text[:1800].rsplit(" ", 1)[0] + "..."

    def _infer_core_pack_terms(self, base_context):
        semantic_source = (base_context or "").strip()
        briefing_match = re.search(
            r"\bBRIEFING\b\s*(.*?)(?=\n(?:REGRAS GERAIS|EXPECTATIVA|PLANO ESTRUTURAL DO BACKLOG|## )\b|$)",
            semantic_source,
            re.IGNORECASE | re.DOTALL,
        )
        if briefing_match and briefing_match.group(1).strip():
            semantic_source = briefing_match.group(1).strip()

        _, normalized = self._normalize_text(semantic_source)

        entity_label = "item principal"
        entity_article = "o"
        if re.search(r"\bevento|credenci|convidad\b", normalized):
            entity_label = "evento"
            entity_article = "o"
        elif re.search(r"\bvisita|visitante|portaria\b", normalized):
            entity_label = "visita"
            entity_article = "a"
        elif re.search(r"\bchamad|ticket|incidente|suporte\b", normalized):
            entity_label = "chamado"
            entity_article = "o"
        elif re.search(r"\breembolso|despesa|prestacao de contas\b", normalized):
            entity_label = "reembolso"
            entity_article = "o"
        elif re.search(r"\bcurso|matricula|aluno|ead\b", normalized):
            entity_label = "curso"
            entity_article = "o"
        elif re.search(r"\bcredito|emprestimo|financiamento|score|bureau\b", normalized):
            entity_label = "solicitacao de credito"
            entity_article = "a"
        elif re.search(r"\bcontrato|fornecedor|compra\b", normalized):
            entity_label = "contrato"
            entity_article = "o"

        participant_label = "participante"
        if re.search(r"\bconvidad\b", normalized):
            participant_label = "convidado"
        elif re.search(r"\bcredenci\b", normalized):
            participant_label = "participante"
        elif re.search(r"\bvisitante|visita\b", normalized):
            participant_label = "visitante"
        elif re.search(r"\baluno|matricula\b", normalized):
            participant_label = "aluno"
        elif re.search(r"\bcolaborador|usuario interno\b", normalized):
            participant_label = "colaborador"

        supplier_label = "recurso essencial"
        if re.search(r"\bfornecedor|prestador|parceiro|buffet|espaco|servico\b", normalized):
            supplier_label = "fornecedor"
        elif re.search(r"\bequipe|responsavel|area interna\b", normalized):
            supplier_label = "responsavel operacional"

        baseline_label = "registro operacional inicial"
        baseline_article = "o"
        if re.search(r"\borcamento|custo|verba|despesa|financeir\b", normalized):
            baseline_label = "orcamento"
            baseline_article = "o"
        elif entity_label == "visita":
            baseline_label = "dados iniciais de autorizacao"
            baseline_article = "os"
        elif entity_label == "chamado":
            baseline_label = "classificacao inicial"
            baseline_article = "a"
        elif entity_label == "curso":
            baseline_label = "configuracao inicial"
            baseline_article = "a"

        summary_label = f"resumo do {entity_label}"
        if entity_label in {"visita", "chamado", "reembolso", "curso", "contrato"}:
            summary_label = f"resumo da {entity_label}" if entity_label in {"visita"} else f"resumo do {entity_label}"

        owner_persona = "Mariana, coordenadora operacional"
        finance_persona = "Carlos, analista financeiro"
        support_persona = "Felipe, assistente operacional"
        approver_persona = "Roberto, gestor responsavel"

        if entity_label == "evento":
            owner_persona = "Mariana, coordenadora de eventos"
            finance_persona = "Carlos, analista financeiro"
            support_persona = "Felipe, assistente de eventos"
            approver_persona = "Roberto, diretor financeiro"
        elif entity_label == "visita":
            owner_persona = "Patricia, supervisora de recepcao"
            finance_persona = "Luciana, analista administrativa"
            support_persona = "Bruno, assistente de recepcao"
            approver_persona = "Rafael, gestor da unidade"
        elif entity_label == "chamado":
            owner_persona = "Mariana, coordenadora de suporte"
            finance_persona = "Carlos, analista operacional"
            support_persona = "Felipe, atendente"
            approver_persona = "Roberto, gestor de suporte"
        elif entity_label == "solicitacao de credito":
            owner_persona = "Ana, cliente solicitante"
            finance_persona = "Carlos, analista de credito"
            support_persona = "Fernanda, analista de cadastro"
            approver_persona = "Roberto, gestor de credito"

        return {
            "entity_label": entity_label,
            "entity_article": entity_article,
            "participant_label": participant_label,
            "supplier_label": supplier_label,
            "baseline_label": baseline_label,
            "baseline_article": baseline_article,
            "summary_label": summary_label,
            "owner_persona": owner_persona,
            "finance_persona": finance_persona,
            "support_persona": support_persona,
            "approver_persona": approver_persona,
        }

    def _article_for_term(self, term):
        _, normalized = self._normalize_text(term)
        if re.search(r"\bdados\b", normalized):
            return "os"
        if normalized.endswith("a") or normalized.endswith("cao") or normalized.endswith("sao"):
            return "a"
        return "o"

    def _prep_article_for_entity(self, article):
        return "da" if article == "a" else "do"

    def _article_for_summary(self, summary_label):
        return "o"

    def _infer_domain_guardrails(self, base_context):
        inferred = self._infer_core_pack_terms(base_context)
        _, normalized = self._normalize_text(base_context)
        entity_label = inferred["entity_label"]
        finance_explicit = bool(re.search(r"\b(orcamento|custo|verba|despesa|financeir|refeic|estacionamento)\b", normalized))
        forbidden = []

        if entity_label == "visita":
            forbidden.extend(
                [
                    r"\bevento\b",
                    r"\bbuffet\b",
                    r"\bauditorio\b",
                    r"\bpalestr",
                    r"\bconvidad",
                    r"\bcredenciamento\b",
                ]
            )
            if not finance_explicit:
                forbidden.extend(
                    [
                        r"\borcamento\b",
                        r"\bcusto\b",
                        r"\bverba\b",
                        r"\bdespesa\b",
                        r"\brefeic",
                        r"\bestacionamento\b",
                    ]
                )
        elif entity_label == "chamado":
            forbidden.extend([r"\bevento\b", r"\bvisit", r"\bfornecedor de buffet\b"])
        elif entity_label == "evento":
            forbidden.extend([r"\bvisitante corporativo\b", r"\bportaria\b"])

        return {
            "entity_label": entity_label,
            "finance_explicit": finance_explicit,
            "forbidden_patterns": forbidden,
        }

    def _is_unusable_llm_response(self, result):
        if not result or is_error_text_response(result):
            return True
        normalized = result.strip().lower()
        return normalized.startswith("# documentacao gerada") or normalized.startswith("# documentacao gerada por ia")

    def _extract_section(self, content, title):
        text, normalized_content = self._normalize_text(content)
        _, normalized_title = self._normalize_text(title)
        pattern = re.compile(
            # Providers do not consistently preserve the requested H2 syntax:
            # some return H1/H3 headings, bold headings, or a trailing colon.
            # Treat those as the same Markdown section while still stopping at
            # the next heading, so content from adjacent sections never leaks.
            rf"^\s*#{{1,6}}\s*(?:\*\*)?{re.escape(normalized_title)}(?:\*\*)?\s*:?[ \t]*$([\s\S]*?)(?=^\s*#{{1,6}}\s+|\Z)",
            re.IGNORECASE | re.MULTILINE,
        )
        match = pattern.search(normalized_content)
        if not match:
            return ""

        # Parse using normalized headings, but return the original body so the
        # generated backlog retains accents and all user-facing wording.
        original_sections = re.split(r"(?=^\s*#{1,6}\s+)", text, flags=re.MULTILINE)
        for section in original_sections:
            lines = section.splitlines()
            if not lines:
                continue
            _, normalized_heading = self._normalize_text(lines[0])
            normalized_heading = re.sub(r"^\s*#{1,6}\s+", "", normalized_heading)
            normalized_heading = re.sub(r"^(?:\*\*)?", "", normalized_heading)
            normalized_heading = re.sub(r"(?:\*\*)?\s*:\s*$", "", normalized_heading).strip()
            if normalized_heading == normalized_title:
                return "\n".join(lines[1:]).strip()

        return match.group(1).strip()

    def _extract_story_count(self, content):
        return len(
            [
                line.strip()
                for line in (content or "").splitlines()
                if re.search(r"^(?:[-*]\s*)?(?:US-\d+\s*\|\s*)?Como\b", line.strip(), re.IGNORECASE)
            ]
        )

    def _is_story_start_line(self, line):
        candidate = (line or "").strip()
        return bool(
            re.search(
                # Accept common Markdown variants returned by routed models:
                # headings, bold IDs and ':' are formatting only, not part of
                # the story contract.
                r"^(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?(?:(?:US|STORY)[-_ ]?\d+(?:\*\*)?\s*(?:\||:)\s*|\d+[\.\)]\s*)?Como\b",
                candidate,
                re.IGNORECASE,
            )
        )

    @staticmethod
    def _normalize_story_start_line(line):
        candidate = (line or "").strip()
        candidate = re.sub(r"^(?:[-*]\s*)?(?:#{1,6}\s*)?", "", candidate)
        candidate = candidate.replace("**", "")
        candidate = re.sub(r"^(?:(?:US|STORY)[-_ ]?\d+\s*(?:\||:)\s*|\d+[\.\)]\s*)", "", candidate, flags=re.IGNORECASE)
        return candidate.strip()

    def _extract_story_lines(self, content):
        stories = []
        current = []

        for raw_line in (content or "").splitlines():
            line = raw_line.rstrip()
            if self._is_story_start_line(line):
                if current:
                    stories.append("\n".join(current).strip())
                current = [self._normalize_story_start_line(line)]
                continue

            if current:
                current.append(line.strip())

        if current:
            stories.append("\n".join(current).strip())

        return [item for item in stories if item]

    def _normalize_persona_in_story(self, story_block):
        lines = (story_block or "").splitlines()
        if not lines:
            return ""

        first_line = lines[0]
        match = re.search(r"(\bComo\s+)([^,|]+)", first_line, re.IGNORECASE)
        if not match:
            return story_block.strip()

        persona_raw = match.group(2).strip()
        _, normalized_persona = self._normalize_text(persona_raw)
        replacement = self.PERSONA_NORMALIZATION.get(normalized_persona)
        if not replacement:
            return story_block.strip()

        replaced_first_line = first_line[: match.start(2)] + replacement + first_line[match.end(2) :]
        return "\n".join([replaced_first_line, *lines[1:]]).strip()

    def _looks_truncated_story(self, story_block):
        lines = [line.strip() for line in (story_block or "").splitlines() if line.strip()]
        if not lines:
            return True

        title_line = lines[0]
        if not re.search(r"^\s*Como\b.+\beu quero\b.+", title_line, re.IGNORECASE):
            return True

        short_fragments = {
            "como",
            "como atendente",
            "como gestor",
            "como colaborador",
            "eu quero",
        }
        normalized_title = re.sub(r"\s+", " ", title_line).strip().lower()
        if normalized_title in short_fragments:
            return True

        if len(re.sub(r"\s+", " ", title_line).strip()) < 20:
            return True

        return False

    def _story_similarity_key(self, story_block):
        first_line = (story_block or "").splitlines()[0] if story_block else ""
        normalized = re.sub(
            r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
            "",
            first_line,
            flags=re.IGNORECASE,
        ).strip()
        _, normalized = self._normalize_text(normalized)
        normalized = re.sub(r"\b(como|eu quero|para|um|uma|o|a|de|do|da|dos|das)\b", " ", normalized)
        normalized = re.sub(r"[^a-z0-9 ]+", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return " ".join(normalized.split()[:10])

    def _story_seed_title(self, story_block):
        first_line = (story_block or "").splitlines()[0] if story_block else ""
        return re.sub(
            r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
            "",
            first_line,
            flags=re.IGNORECASE,
        ).strip()

    def _story_has_strong_structure(self, story_block):
        if self._looks_truncated_story(story_block):
            return False

        lines = [line.strip() for line in (story_block or "").splitlines() if line.strip()]
        title_line = lines[0] if lines else ""
        if not re.search(r"^\s*Como\b.+\beu quero\b.+", title_line, re.IGNORECASE):
            return False

        return True

    def _is_advanced_story(self, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)
        return any(re.search(pattern, normalized, re.IGNORECASE) for pattern in self.ADVANCED_STORY_PATTERNS)

    def _is_technical_story(self, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)
        return any(re.search(pattern, normalized, re.IGNORECASE) for pattern in self.TECHNICAL_STORY_PATTERNS)

    def _is_domain_drift_story(self, base_context, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)
        guardrails = self._infer_domain_guardrails(base_context)
        return any(re.search(pattern, normalized, re.IGNORECASE) for pattern in guardrails["forbidden_patterns"])

    def _story_intent_bucket(self, base_context, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)
        entity_label = self._infer_core_pack_terms(base_context)["entity_label"]
        entity_pattern = re.escape(entity_label)

        if re.search(r"\b(cadastrar|registrar|listar|consultar)\b", normalized) and re.search(r"\b(visitante|convidad|participante|lista inicial)\b", normalized):
            return "core:participant"
        if re.search(r"\b(cadastrar|registrar|vincular|definir)\b", normalized) and re.search(r"\b(responsavel|fornecedor|recurso|anfitri|unidade)\b", normalized):
            return "core:resource"
        if re.search(r"\b(registrar|definir|informar|classificar)\b", normalized) and re.search(r"\b(autoriz|classific|orcamento|dados iniciais|base operacional)\b", normalized):
            return "core:baseline"
        if re.search(r"\b(definir|configurar|planejar|montar|organizar)\b", normalized) and re.search(r"\b(escopo|parametr|planejamento|contexto|volume|unidade)\b", normalized):
            return "core:define_scope"
        if re.search(r"\b(aprovar|reprovar|recusar|validar|autorizar|revisar)\b", normalized):
            return "core:approval"
        if re.search(r"\b(visualizar|consultar|listar)\b", normalized) and re.search(r"\b(resumo|painel|status|dia)\b", normalized):
            return "core:summary"
        if re.search(r"\b(atualizar|alterar|acompanhar|monitorar|marcar)\b", normalized) and re.search(r"\b(status|andamento|rascunho|aprovacao|finalizada|atendimento)\b", normalized):
            return "core:status"
        if (
            re.search(r"\b(criar|abrir)\b", normalized)
            and re.search(rf"\b{entity_pattern}\b", normalized)
            and not re.search(r"\b(visitante|convidad|participante|responsavel|fornecedor|recurso|anfitri|autoriz|classific|status|resumo)\b", normalized)
        ):
            return "core:create_entity"
        if re.search(r"\b(check-?in|entrada)\b", normalized):
            return "ops:checkin"
        if re.search(r"\b(check-?out|saida)\b", normalized):
            return "ops:checkout"
        return ""

    def _story_priority_score(self, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)

        score = 0
        if re.search(r"\b(criar|cadastrar|registrar|abrir)\b", normalized):
            score += 5
        if re.search(r"\b(configurar|definir|planejar|montar|organizar)\b", normalized):
            score += 4
        if re.search(r"\b(aprovar|validar|autorizar|revisar)\b", normalized):
            score += 4
        if re.search(r"\b(visualizar|consultar|listar|resumo|painel)\b", normalized):
            score += 3
        if re.search(r"\b(acompanhar|monitorar|atualizar|gerenciar|status)\b", normalized):
            score += 3
        if re.search(r"\b(fornecedor|orcamento|cronograma|convidad|credenciamento|evento)\b", normalized):
            score += 2
        if self._is_advanced_story(story_block):
            score -= 6
        return score

    def _story_stage_rank(self, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)

        if re.search(r"\b(criar|cadastrar|registrar|abrir)\b", normalized) and re.search(r"\b(evento|visita|chamado|curso|contrato|reembolso)\b", normalized):
            return 1
        if re.search(r"\b(definir|configurar|planejar|montar|organizar)\b", normalized) and re.search(r"\b(escopo|evento|visita|chamado|workspace|conta|categoria|cronograma|unidade)\b", normalized):
            return 2
        if re.search(r"\b(cadastrar|registrar|definir|inserir)\b", normalized) and re.search(r"\b(orcamento|custo|verba|despesa|autorizacao|classificacao)\b", normalized):
            return 3
        if re.search(r"\b(cadastrar|registrar|vincular|gerenciar|definir)\b", normalized) and re.search(r"\b(fornecedor|parceiro|prestador|responsavel|anfitri|unidade)\b", normalized):
            return 4
        if re.search(r"\b(cadastrar|registrar|confirmar|gerar)\b", normalized) and re.search(r"\b(convidad|participante|credencial|check-?in|visitante)\b", normalized):
            return 5
        if re.search(r"\b(aprovar|validar|autorizar|revisar)\b", normalized):
            return 6
        if re.search(r"\b(visualizar|consultar|listar)\b", normalized) and re.search(r"\b(resumo|painel|evento|visita|status|orcamento)\b", normalized):
            return 7
        if re.search(r"\b(acompanhar|monitorar|atualizar|gerenciar|alterar|marcar)\b", normalized) and re.search(r"\b(status|andamento|evento|visita|tarefa|execucao|atendimento)\b", normalized):
            return 8
        if self._is_advanced_story(story_block):
            return 20
        return 12

    def _prioritize_story_blocks(self, story_blocks):
        prioritized = sorted(
            story_blocks,
            key=lambda block: (
                self._story_priority_score(block),
                -len(self._story_seed_title(block)),
            ),
            reverse=True,
        )
        return prioritized

    def _sequence_story_blocks_for_mvp(self, story_blocks, *, window=8):
        head = list(story_blocks[:window])
        tail = list(story_blocks[window:])
        head = sorted(
            head,
            key=lambda block: (
                self._story_stage_rank(block),
                -self._story_priority_score(block),
                self._story_seed_title(block),
            ),
        )
        tail = sorted(
            tail,
            key=lambda block: (
                self._story_stage_rank(block),
                -self._story_priority_score(block),
                self._story_seed_title(block),
            ),
        )
        return head + tail

    def _frontload_foundation_coverage(self, story_blocks, window=8):
        selected = story_blocks[:window]
        covered = set()
        for block in selected:
            title = self._story_seed_title(block)
            _, normalized = self._normalize_text(title)
            for key, pattern in self.FOUNDATION_FRONTLOAD_RULES:
                if re.search(pattern, normalized, re.IGNORECASE):
                    covered.add(key)
        return covered

    def _core_pack_coverage(self, story_blocks, window=8):
        selected = story_blocks[:window]
        coverage = set()

        for block in selected:
            title = self._story_seed_title(block)
            _, normalized = self._normalize_text(title)
            if re.search(r"\b(criar|cadastrar|registrar|abrir)\b", normalized) and re.search(r"\bevento\b", normalized):
                coverage.add("criar_evento")
            if re.search(r"\b(definir|configurar|planejar|montar|organizar)\b", normalized):
                coverage.add("definir_escopo")
            if re.search(r"\b(orcamento|custo|verba)\b", normalized) and re.search(r"\b(registrar|definir|visualizar|controlar)\b", normalized):
                coverage.add("registrar_orcamento")
            if re.search(r"\bfornecedor|parceiro|prestador\b", normalized) and re.search(r"\b(criar|cadastrar|registrar|vincular|gerenciar)\b", normalized):
                coverage.add("cadastrar_fornecedor")
            if re.search(r"\b(convidad|participante|publico)\b", normalized) and re.search(r"\b(criar|cadastrar|registrar|confirmar|gerenciar)\b", normalized):
                coverage.add("cadastrar_convidado")
            if re.search(r"\b(aprovar|validar|autorizar|revisar)\b", normalized):
                coverage.add("aprovar_fluxo")
            if re.search(r"\b(visualizar|consultar|listar)\b", normalized) and re.search(r"\b(resumo|painel|evento|orcamento|status)\b", normalized):
                coverage.add("visualizar_resumo")
            if re.search(r"\b(acompanhar|monitorar|atualizar|gerenciar)\b", normalized) and re.search(r"\b(status|evento|execucao|andamento)\b", normalized):
                coverage.add("acompanhar_status")

        return coverage

    def _dedupe_and_polish_stories(self, story_blocks, base_context=None):
        cleaned = []
        seen = set()
        seen_buckets = set()

        for block in story_blocks:
            normalized_block = self._normalize_persona_in_story(block)
            if self._looks_truncated_story(normalized_block):
                continue
            if self._is_technical_story(normalized_block):
                continue
            if base_context and self._is_domain_drift_story(base_context, normalized_block):
                continue

            similarity_key = self._story_similarity_key(normalized_block)
            if not similarity_key or similarity_key in seen:
                continue

            bucket = self._story_intent_bucket(base_context, normalized_block) if base_context else ""
            if bucket and bucket.startswith("core:") and bucket in seen_buckets:
                continue

            seen.add(similarity_key)
            if bucket:
                seen_buckets.add(bucket)
            cleaned.append(normalized_block.strip())

        return cleaned

    def _validate_story_batch_quality(self, story_blocks, *, min_stories):
        if len(story_blocks) < min_stories:
            raise RuntimeError(
                f"Lote final com poucas historias confiaveis ({len(story_blocks)}). Minimo esperado: {min_stories}."
            )

        invalid_blocks = [block for block in story_blocks if not self._story_has_strong_structure(block)]
        if invalid_blocks:
            raise RuntimeError("Curadoria final deixou historia com estrutura incompleta.")

        technical_blocks = [block for block in story_blocks if self._is_technical_story(block)]
        if technical_blocks:
            raise RuntimeError("Curadoria final ainda deixou historia tecnica demais para backlog de usuario.")

        keys = [self._story_similarity_key(block) for block in story_blocks]
        if len(keys) != len(set(keys)):
            raise RuntimeError("Curadoria final ainda deixou historias muito parecidas.")

    def _renumber_stories(self, story_blocks):
        normalized_blocks = []
        for index, story in enumerate(story_blocks, start=1):
            lines = story.splitlines()
            if not lines:
                continue

            title_line = re.sub(
                r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
                "",
                lines[0],
                flags=re.IGNORECASE,
            ).strip()
            rebuilt = [f"- US-{index:02d} | {title_line}"]
            rebuilt.extend([line.rstrip() for line in lines[1:]])
            normalized_blocks.append("\n".join(rebuilt).strip())

        return normalized_blocks

    def _build_full_backlog(self, overview, story_blocks):
        return self._build_full_backlog_with_structure(
            overview=overview,
            capabilities=[],
            epics=[],
            release_slices=[],
            story_blocks=story_blocks,
        )

    def _build_full_backlog_with_structure(self, overview, capabilities, epics, release_slices, story_blocks):
        cleaned_overview = (overview or "").strip()
        capabilities_body = "\n".join(f"- {item}" for item in (capabilities or []) if item).strip()
        epics_body = "\n".join(f"- {item}" for item in (epics or []) if item).strip()
        release_body = "\n".join(f"- {item}" for item in (release_slices or []) if item).strip()
        stories = self._renumber_stories(story_blocks)
        stories_body = "\n\n".join(stories).strip()

        sections = [
            "# BACKLOG DO PROJETO",
            "## Visao Geral",
            cleaned_overview or "Backlog inicial gerado a partir do briefing informado.",
            "## Capacidades do Produto",
            capabilities_body or "- Capacidade principal ainda nao consolidada.",
            "## Epicos Recomendados",
            epics_body or "- Epic 1: Fundacao operacional do produto.",
            "## Fatias de Release",
            release_body or "- MVP: fluxo principal e governanca minima.",
            "## Historias de Usuario",
            stories_body or "- US-01 | Como colaborador, eu quero registrar uma demanda, para iniciar o backlog.",
            "FIM_DO_BACKLOG",
        ]

        return "\n\n".join(sections).strip()

    def _build_stories_section(self, story_blocks):
        stories = self._renumber_stories(story_blocks)
        return "## Historias de Usuario\n\n" + "\n\n".join(stories).strip()

    def _get_foundation_signal_matches(self, story_blocks):
        normalized_titles = [self._story_seed_title(block) for block in story_blocks if block]
        matches = {}
        for signal in self.FOUNDATION_SIGNAL_PROMPTS:
            matches[signal["key"]] = any(
                re.search(signal["pattern"], title, re.IGNORECASE) for title in normalized_titles
            )
        return matches

    def _get_missing_foundation_signals(self, story_blocks):
        matches = self._get_foundation_signal_matches(story_blocks)
        return [signal for signal in self.FOUNDATION_SIGNAL_PROMPTS if not matches.get(signal["key"])]

    def _extract_bullet_lines(self, content):
        return [
            re.sub(r"^\s*(?:[-*]\s*|\d+[\.\)]\s*)", "", line).strip().strip("*").strip()
            for line in (content or "").splitlines()
            if re.match(r"^\s*(?:[-*]\s+|\d+[\.\)]\s+).+", line.strip())
        ]

    def _extract_release_slices(self, content):
        bullet_lines = self._extract_bullet_lines(content)
        if len(bullet_lines) >= 3:
            return self._normalize_release_slices(bullet_lines)

        slices = []
        current_title = ""
        current_lines = []

        def flush_current():
            if not current_title:
                return
            body = " ".join(line.strip(" -*") for line in current_lines if line.strip()).strip()
            if body:
                slices.append(f"{current_title}: {body}")
            else:
                slices.append(current_title)

        for raw_line in (content or "").splitlines():
            line = raw_line.strip()
            heading_match = re.match(r"^#{1,6}\s*(MVP|Fase\s+2|Fase\s+3)\b[:\-\s]*", line, re.IGNORECASE)
            if heading_match:
                flush_current()
                current_title = re.sub(r"\s+", " ", heading_match.group(1)).strip()
                current_lines = []
                continue

            # Some providers return a compact release plan without Markdown
            # headings or bullets, for example "MVP: ...". It is still a
            # valid response to the release-planning prompt and should not be
            # rejected solely for its presentation format.
            inline_match = re.match(
                r"^(?:[-*]\s*)?(?:\*\*)?(MVP|Fase\s+2|Fase\s+3)(?:\*\*)?\s*[:\-]\s*(.*)$",
                line,
                re.IGNORECASE,
            )
            if inline_match:
                flush_current()
                current_title = re.sub(r"\s+", " ", inline_match.group(1)).strip()
                inline_body = inline_match.group(2).strip()
                current_lines = [inline_body] if inline_body else []
                continue

            if current_title and line:
                current_lines.append(line)

        flush_current()
        return self._normalize_release_slices(slices)

    def _normalize_release_slices(self, release_slices):
        normalized = [item.strip() for item in (release_slices or []) if item and item.strip()]
        adjusted = []
        for item in normalized:
            lowered = item.lower()
            if "mvp" in lowered and not re.search(r"\b(fundacao|espinha|fluxo principal|primeira versao|base)\b", lowered, re.IGNORECASE):
                if ":" in item:
                    head, tail = item.split(":", 1)
                    item = f"{head}: foco na espinha dorsal do produto, {tail.strip()}"
                else:
                    item = f"{item} com foco na espinha dorsal do produto"
            adjusted.append(item)
        return adjusted

    def _build_default_release_slices(self, overview, capabilities, epics):
        capability_preview = ", ".join(item.split("**")[0].strip(" -*") for item in capabilities[:3] if item).strip()
        epic_preview = ", ".join(item.split("**")[0].strip(" -*") for item in epics[:3] if item).strip()
        mvp_focus = capability_preview or "criacao da entidade principal, fluxo basico e operacao inicial"
        phase2_focus = epic_preview or "expansao operacional, controles e visibilidade gerencial"
        return [
            f"MVP: foco na espinha dorsal do produto, priorizando {mvp_focus}. O que fica para depois: automacoes sofisticadas, integracoes avancadas e analytics profundo.",
            f"Fase 2: foco em ampliar a operacao com {phase2_focus}. O que fica para depois: inteligencia avancada, ecossistema aberto e features premium.",
            "Fase 3: foco em inteligencia, automacao avancada e expansao do produto. O que fica para depois: iniciativas experimentais e especializacoes de nicho.",
        ]

    def _build_briefing_blueprint_defaults(self, base_context):
        """Return a minimal plan only when the briefing explicitly identifies it.

        This keeps a malformed provider response from aborting the flow while
        avoiding a generic template for unrelated product domains.
        """
        _, normalized = self._normalize_text(base_context)
        if not (re.search(r"\bsalas?\b", normalized) and re.search(r"\bagend", normalized)):
            return [], []

        return [
            "Cadastrar e manter salas de aula com suas informacoes de uso.",
            "Consultar a disponibilidade das salas por data, horario e periodo.",
            "Agendar, alterar e cancelar reservas de salas de aula.",
            "Controlar conflitos de horario e acompanhar o status das reservas.",
        ], [
            "Cadastro e configuracao de salas de aula.",
            "Consulta de disponibilidade e agenda.",
            "Solicitacao e gerenciamento de reservas.",
            "Controle de conflitos e acompanhamento operacional.",
        ]

    def _build_planning_context(self, overview, capabilities, epics, release_slices):
        capabilities_text = "\n".join(f"- {item}" for item in capabilities if item).strip() or "- Sem capacidades consolidadas."
        epics_text = "\n".join(f"- {item}" for item in epics if item).strip() or "- Sem epicos consolidados."
        releases_text = "\n".join(f"- {item}" for item in release_slices if item).strip() or "- MVP: espinha dorsal do produto."
        return (
            "PLANO ESTRUTURAL DO BACKLOG\n"
            f"## Visao Geral\n{(overview or '').strip()}\n\n"
            f"## Capacidades do Produto\n{capabilities_text}\n\n"
            f"## Epicos Recomendados\n{epics_text}\n\n"
            f"## Fatias de Release\n{releases_text}"
        ).strip()

    def _generate_backlog_blueprint(self, base_context, fallback_overview=""):
        lane_text = "\n".join(
            f"- {label}: {guidance}" for _, label, guidance in self.PLANNING_LANES
        )
        prompt = f"""
{base_context}

TAREFA
Gere APENAS as secoes abaixo em Markdown:

## Visao Geral
## Capacidades do Produto
## Epicos Recomendados
## Fatias de Release

REGRAS
- A visao geral deve resumir problema, objetivo e primeira versao do produto em no maximo 5 linhas.
- Gere entre 4 e 6 capacidades do produto, todas com verbo de acao, objeto e efeito de negocio claros.
- Gere entre 4 e 6 epicos recomendados, todos concretos e ligados a partes reais do produto.
- Gere exatamente 3 fatias de release: MVP, Fase 2 e Fase 3.
- O MVP deve cobrir a espinha dorsal do produto e mostrar o primeiro fluxo utilizavel.
- Cada fatia deve explicitar foco, o que entra agora e o que fica para depois.
- Em cada fatia, use pelo menos 1 item que deixe claro o diferimento de funcionalidade mais sofisticada.
- Distribua capacidades e epicos cobrindo estes eixos:
{lane_text}
- Nao escreva user stories nesta resposta.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLUEPRINT_NUM_PREDICT", "900"),
        )
        def extract_first_section(*titles):
            for section_title in titles:
                section = self._extract_section(result, section_title)
                if section:
                    return section
            return ""

        overview = extract_first_section("Visao Geral", "Visao do Produto", "Resumo do Produto", "Resumo")
        capabilities = self._extract_bullet_lines(extract_first_section(
            "Capacidades do Produto", "Capacidades", "Funcionalidades Principais", "Funcionalidades"
        ))
        epics = self._extract_bullet_lines(extract_first_section(
            "Epicos Recomendados", "Epicos", "Epicos do Produto", "Temas"
        ))
        release_slices = self._extract_release_slices(extract_first_section(
            "Fatias de Release", "Plano de Releases", "Releases", "Roadmap"
        ))

        if not overview:
            # This is a safe degradation: the fallback is the user's own
            # briefing, not scope synthesized by the agent.
            overview = self._compact_briefing(fallback_overview)
            if overview:
                print(json.dumps({
                    "event": "project_manager_blueprint_overview_fallback",
                    "reason": "section_missing",
                }, ensure_ascii=False), file=sys.stderr)
            else:
                raise RuntimeError("Planner do PM nao gerou visao geral.")
        briefing_capabilities, briefing_epics = self._build_briefing_blueprint_defaults(base_context)
        if len(capabilities) < 4 and briefing_capabilities:
            capabilities = briefing_capabilities
            print(json.dumps({
                "event": "project_manager_blueprint_capabilities_fallback",
                "reason": "section_missing",
                "count": len(capabilities),
            }, ensure_ascii=False), file=sys.stderr)
        if len(epics) < 4 and briefing_epics:
            epics = briefing_epics
            print(json.dumps({
                "event": "project_manager_blueprint_epics_fallback",
                "reason": "section_missing",
                "count": len(epics),
            }, ensure_ascii=False), file=sys.stderr)
        if len(capabilities) < 4:
            raise RuntimeError("Planner do PM gerou poucas capacidades.")
        if len(epics) < 4:
            raise RuntimeError("Planner do PM gerou poucos epicos.")
        normalized_release_text = " ".join(release_slices).lower()
        release_plan_is_valid = len(release_slices) >= 3 and all(
            marker in normalized_release_text for marker in ("mvp", "fase 2", "fase 3")
        )
        if not release_plan_is_valid and briefing_capabilities:
            release_slices = self._build_default_release_slices(overview, capabilities, epics)
            normalized_release_text = " ".join(release_slices).lower()
            release_plan_is_valid = True
            print(json.dumps({
                "event": "project_manager_blueprint_releases_fallback",
                "reason": "section_missing",
                "count": len(release_slices),
            }, ensure_ascii=False), file=sys.stderr)
        if not release_plan_is_valid:
            release_slices = self._generate_simple_bullet_section(
                base_context,
                section_title="Fatias de Release",
                task_label="releases",
                rules="- Liste exatamente 3 fatias de release: MVP, Fase 2 e Fase 3.\n- Em cada item, diga o foco da fatia e o que fica para depois.\n- O MVP deve citar explicitamente a espinha dorsal, fundacao ou fluxo principal.\n- Nao escreva user stories.",
                num_predict=os.getenv("PROJECT_MANAGER_BLOCK_RELEASES_NUM_PREDICT", "420"),
            )
            normalized_release_text = " ".join(release_slices).lower()

        if len(release_slices) < 3 or "mvp" not in normalized_release_text or "fase 2" not in normalized_release_text or "fase 3" not in normalized_release_text:
            release_slices = self._build_default_release_slices(overview, capabilities, epics)
            normalized_release_text = " ".join(release_slices).lower()

        if len(release_slices) < 3:
            raise RuntimeError("Planner do PM gerou poucas fatias de release.")
        if "mvp" not in normalized_release_text or "fase 2" not in normalized_release_text or "fase 3" not in normalized_release_text:
            raise RuntimeError("Planner do PM nao marcou MVP, Fase 2 e Fase 3 explicitamente.")

        return overview.strip(), capabilities[:6], epics[:6], release_slices[:3]

    def _estimate_story_lane(self, story_block):
        title = self._story_seed_title(story_block)
        _, normalized = self._normalize_text(title)
        lane_patterns = {
            "fundacao": r"\b(criar|cadastrar|registrar|abrir|definir|configurar|planejar)\b",
            "operacao": r"\b(atualizar|acompanhar|executar|monitorar|registrar ocorrencia|fila|status)\b",
            "gestao": r"\b(visualizar|consultar|relatorio|dashboard|painel|resumo)\b",
            "governanca": r"\b(aprovar|validar|autorizar|auditar|permiss|governanca|controle)\b",
        }
        for lane, pattern in lane_patterns.items():
            if re.search(pattern, normalized, re.IGNORECASE):
                return lane
        return "operacao"

    def _ensure_lane_story_coverage(self, base_context, story_blocks, *, min_stories, max_stories):
        consolidated = list(story_blocks)
        covered = {self._estimate_story_lane(block) for block in consolidated}
        missing_lanes = [lane for lane, _, _ in self.PLANNING_LANES if lane not in covered]
        if not missing_lanes:
            return consolidated[:max_stories]

        focus_lines = []
        for lane, label, guidance in self.PLANNING_LANES:
            if lane in missing_lanes:
                focus_lines.append(f"- {label}: {guidance}")

        existing_titles = "\n".join(f"- {self._story_seed_title(block)}" for block in consolidated[:30]) or "- Nenhuma historia consolidada."
        prompt = f"""
{base_context}

HISTORIAS JA CONSOLIDADAS
{existing_titles}

EIXOS QUE AINDA FALTAM NO BACKLOG
{chr(10).join(focus_lines)}

TAREFA
Gere APENAS esta secao em Markdown:

## Historias de Usuario

REGRAS
- Gere entre {len(missing_lanes)} e {len(missing_lanes) + 2} historias.
- Cubra SOMENTE os eixos ausentes.
- Nao repita nem reformule historias ja consolidadas.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_LANE_COVERAGE_NUM_PREDICT", "850"),
        )
        extra_section = self._extract_section(result, "Historias de Usuario")
        extra_blocks = self._extract_story_lines(extra_section)
        if extra_blocks:
            consolidated = self._dedupe_and_polish_stories(consolidated + extra_blocks, base_context)
            consolidated = self._ensure_minimum_story_count(
                base_context,
                consolidated,
                min_stories=min_stories,
                max_stories=max_stories,
            )
        return consolidated[:max_stories]

    def _generate_mvp_frontload_stories(self, base_context, existing_story_blocks):
        existing_titles = [
            self._story_seed_title(block)
            for block in existing_story_blocks
            if block and self._story_seed_title(block)
        ]
        existing_titles_text = "\n".join(f"- {title}" for title in existing_titles[:30]) or "- Nenhuma historia consolidada."

        prompt = f"""
{base_context}

HISTORIAS JA CONSOLIDADAS
{existing_titles_text}

TAREFA
Gere APENAS a secao abaixo em Markdown:

## Historias de Usuario

REGRAS
- Gere entre 6 e 8 historias fundadoras para abrir o backlog.
- Priorize estas coberturas no comeco do produto:
  - criar a entidade principal
  - definir escopo, configuracao ou planejamento inicial
  - cadastrar recursos ou fornecedores essenciais
  - registrar orcamento ou informacao operacional central
  - aprovar ou validar o fluxo basico
  - visualizar resumo inicial do trabalho
  - acompanhar atualizacao de status
- Evite integrações, webhooks, exportacoes, IA, ESG, ROI, marketplace, analytics avancado e automacoes sofisticadas.
- Nao repita nem reformule historias ja consolidadas.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_FRONTLOAD_NUM_PREDICT", "900"),
        )
        frontload_section = self._extract_section(result, "Historias de Usuario")
        if not frontload_section:
            return []
        return self._extract_story_lines(frontload_section)

    def _generate_core_pack_stories(self, base_context, existing_story_blocks, missing_requirements):
        if not missing_requirements:
            return []

        existing_titles = [
            self._story_seed_title(block)
            for block in existing_story_blocks
            if block and self._story_seed_title(block)
        ]
        existing_titles_text = "\n".join(f"- {title}" for title in existing_titles[:30]) or "- Nenhuma historia consolidada."
        requirement_lines = "\n".join(f"- {label}" for _key, label in missing_requirements)

        prompt = f"""
{base_context}

HISTORIAS JA CONSOLIDADAS
{existing_titles_text}

CORE PACK OBRIGATORIO AINDA FALTANTE
{requirement_lines}

TAREFA
Gere APENAS a secao abaixo em Markdown:

## Historias de Usuario

REGRAS
- Gere entre {len(missing_requirements)} e {len(missing_requirements) + 1} historias.
- Cubra SOMENTE os itens faltantes do core pack.
- Escreva historias claramente fundadoras, de MVP, e evite qualquer sofisticacao desnecessaria.
- Nao use integracoes, webhooks, exportacoes, IA, ESG, ROI, marketplace, analytics avancado, templates complexos ou automacoes sofisticadas.
- Nao repita nem reformule historias ja consolidadas.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_CORE_PACK_NUM_PREDICT", "950"),
        )
        section = self._extract_section(result, "Historias de Usuario")
        if not section:
            return []
        return self._extract_story_lines(section)

    def _generate_fixed_core_pack_stories(self, base_context):
        inferred = self._infer_core_pack_terms(base_context)
        if inferred["entity_label"] == "solicitacao de credito":
            return self._generate_credit_core_pack_stories()

        # Do not inject a catalogue of stories from another product shape.
        # Generic packs (event, supplier, guest, budget) were previously used
        # as a deterministic head for every non-credit domain, producing filler
        # stories and corrupting domain coverage. For new domains the LLM and
        # the challenger must derive the foundation from the actual briefing.
        return []

        entity_label = inferred["entity_label"]
        entity_article = inferred["entity_article"]
        participant_label = inferred["participant_label"]
        supplier_label = inferred["supplier_label"]
        baseline_label = inferred["baseline_label"]
        baseline_article = inferred["baseline_article"]
        summary_label = inferred["summary_label"]
        owner_persona = inferred["owner_persona"]
        finance_persona = inferred["finance_persona"]
        support_persona = inferred["support_persona"]
        approver_persona = inferred["approver_persona"]
        supplier_article = self._article_for_term(supplier_label)
        summary_article = self._article_for_summary(summary_label)
        entity_prep = self._prep_article_for_entity(entity_article)
        stories = [
            self._compose_story_block(
                1,
                f"Como {owner_persona}, eu quero criar {entity_article} {entity_label} informando nome, objetivo, data e contexto inicial, para iniciar o fluxo principal de forma estruturada.",
                f"Descricao: permite registrar o {entity_label} com os dados essenciais para abrir a operacao e evitar um inicio solto ou incompleto.",
            ),
            self._compose_story_block(
                2,
                f"Como {owner_persona}, eu quero definir o escopo basico {entity_prep} {entity_label} com volume estimado, formato e parametros principais, para dimensionar os recursos iniciais corretamente.",
                f"Descricao: deixa claro o tamanho do trabalho e os parametros de partida, ajudando a organizar a primeira versao do fluxo.",
            ),
            self._compose_story_block(
                3,
                f"Como {finance_persona}, eu quero registrar {baseline_article} {baseline_label} {entity_prep} {entity_label}, para ter uma referencia operacional antes da aprovacao.",
                f"Descricao: cria a base para validar planejamento, custos ou dados operacionais antes de liberar a execucao.",
            ),
            self._compose_story_block(
                4,
                f"Como {support_persona}, eu quero cadastrar {supplier_article} {supplier_label} com nome, contato e tipo de suporte, para vincular os recursos essenciais {entity_prep} {entity_label}.",
                f"Descricao: garante que os recursos centrais fiquem identificados e prontos para uso na operacao inicial.",
            ),
            self._compose_story_block(
                5,
                f"Como {support_persona}, eu quero cadastrar a lista inicial de {participant_label}s {entity_prep} {entity_label}, para preparar a operacao sem depender de planilhas.",
                f"Descricao: organiza a entrada de participantes ou envolvidos no processo e evita controles paralelos fora do sistema.",
            ),
            self._compose_story_block(
                6,
                f"Como {approver_persona}, eu quero aprovar ou reprovar {baseline_article} {baseline_label} {entity_prep} {entity_label} com justificativa, para liberar a execucao com controle minimo.",
                f"Descricao: registra a decisao de governanca e a justificativa, mantendo rastreabilidade da liberacao.",
            ),
            self._compose_story_block(
                7,
                f"Como {owner_persona}, eu quero visualizar {summary_article} {summary_label}, com escopo, base operacional e status atual, para confirmar se o planejamento inicial esta completo.",
                f"Descricao: consolida a leitura executiva da primeira versao e permite conferir se faltou algum detalhe importante.",
            ),
            self._compose_story_block(
                8,
                f"Como {support_persona}, eu quero atualizar o status {entity_prep} {entity_label} entre rascunho, em planejamento, em aprovacao e aprovado, para acompanhar o andamento operacional do trabalho.",
                f"Descricao: permite acompanhar a evolucao do trabalho sem perder o contexto do estado atual.",
            ),
        ]
        return stories

    def _generate_credit_core_pack_stories(self):
        """Return a domain-safe MVP backbone when the briefing is about credit."""
        return [
            self._compose_story_block(1,
                "Como Ana, cliente solicitante, eu quero simular valor, prazo e parcela do credito, para avaliar uma opcao antes de iniciar a proposta.",
                "Descricao: a simulacao deve informar que o resultado e uma estimativa e nao representa aprovacao automatica."),
            self._compose_story_block(2,
                "Como Ana, cliente solicitante, eu quero iniciar uma solicitacao de credito a partir da simulacao, para registrar a proposta com o valor e prazo escolhidos.",
                "Descricao: o sistema deve salvar a proposta como rascunho e permitir sua retomada antes do envio."),
            self._compose_story_block(3,
                "Como Ana, cliente solicitante, eu quero informar meus dados pessoais e de contato, para que a instituicao identifique corretamente quem solicita o credito.",
                "Descricao: os campos obrigatorios e as validacoes devem ser apresentados de forma clara antes do envio."),
            self._compose_story_block(4,
                "Como Ana, cliente solicitante, eu quero informar renda, vinculo e demais dados financeiros solicitados, para que minha capacidade de pagamento possa ser analisada.",
                "Descricao: a proposta nao pode seguir para analise enquanto os dados obrigatorios estiverem incompletos."),
            self._compose_story_block(5,
                "Como Ana, cliente solicitante, eu quero enviar os documentos obrigatorios da proposta, para comprovar as informacoes declaradas.",
                "Descricao: o sistema deve indicar tipos de documento aceitos, pendencias e o resultado basico da validacao do envio."),
            self._compose_story_block(6,
                "Como Ana, cliente solicitante, eu quero registrar meu consentimento para o tratamento de dados e consultas necessarias, para enviar a proposta em conformidade com a LGPD.",
                "Descricao: o consentimento deve ser explicito, versionado e associado a proposta enviada."),
            self._compose_story_block(7,
                "Como Fernanda, analista de cadastro, eu quero validar dados e documentos recebidos, para encaminhar somente propostas completas para analise de credito.",
                "Descricao: quando houver divergencia ou ausencia, a proposta deve ficar com status de pendencia e motivo compreensivel para o cliente."),
            self._compose_story_block(8,
                "Como Carlos, analista de credito, eu quero consultar a proposta com dados, documentos e resultado das validacoes, para avaliar a elegibilidade conforme as politicas de credito.",
                "Descricao: a analise deve registrar as informacoes utilizadas e preservar a rastreabilidade da decisao."),
        ]

    def _generate_deterministic_support_stories(self, base_context):
        inferred = self._infer_core_pack_terms(base_context)
        if inferred["entity_label"] == "solicitacao de credito":
            return self._generate_credit_support_stories()

        entity_label = inferred["entity_label"]
        entity_article = inferred["entity_article"]
        entity_prep = self._prep_article_for_entity(entity_article)
        participant_label = inferred["participant_label"]
        owner_persona = inferred["owner_persona"]
        finance_persona = inferred["finance_persona"]
        support_persona = inferred["support_persona"]
        approver_persona = inferred["approver_persona"]

        return [
            self._compose_story_block(
                9,
                f"Como {owner_persona}, eu quero listar {entity_article} {entity_label}s em uma visao consolidada, para acompanhar o volume de trabalho sem perder contexto.",
                f"Descricao: oferece uma leitura rapida dos registros de {entity_label} e ajuda a priorizar a operacao do dia.",
            ),
            self._compose_story_block(
                10,
                f"Como {support_persona}, eu quero consultar os detalhes de cada {entity_label}, para revisar informacoes antes de executar a proxima etapa.",
                f"Descricao: facilita a conferencia dos dados ja informados e reduz erros durante a continuidade do fluxo.",
            ),
            self._compose_story_block(
                11,
                f"Como {support_persona}, eu quero atualizar as informacoes principais {entity_prep} {entity_label}, para manter o cadastro coerente com a operacao real.",
                f"Descricao: permite corrigir dados que mudaram ao longo do processo sem recriar o registro.",
            ),
            self._compose_story_block(
                12,
                f"Como {approver_persona}, eu quero revisar os itens pendentes {entity_prep} {entity_label}, para decidir com mais clareza antes de liberar a execucao.",
                f"Descricao: concentra os pontos que aguardam validacao e reduz retrabalho na governanca.",
            ),
            self._compose_story_block(
                13,
                f"Como {owner_persona}, eu quero acompanhar o historico de mudancas {entity_prep} {entity_label}, para entender quem alterou o que e quando.",
                f"Descricao: reforca rastreabilidade e ajuda na analise de inconsistencias do fluxo.",
            ),
            self._compose_story_block(
                14,
                f"Como {support_persona}, eu quero pesquisar {entity_article} {entity_label}s por termo ou referencia, para localizar registros sem depender de planilhas paralelas.",
                f"Descricao: agiliza a recuperacao de informacoes e melhora a operacao diaria da equipe.",
            ),
            self._compose_story_block(
                15,
                f"Como {finance_persona}, eu quero registrar observacoes de acompanhamento {entity_prep} {entity_label}, para apoiar a leitura operacional e a tomada de decisao.",
                f"Descricao: organiza notas de contexto que ajudam a explicar prioridades, riscos ou pendencias.",
            ),
            self._compose_story_block(
                16,
                f"Como {owner_persona}, eu quero encerrar o fluxo {entity_prep} {entity_label} quando tudo estiver concluido, para manter o backlog limpo e rastreavel.",
                f"Descricao: indica que a etapa terminou e evita que o registro fique aberto sem necessidade.",
            ),
        ]

    def _generate_credit_support_stories(self):
        return [
            self._compose_story_block(9,
                "Como Carlos, analista de credito, eu quero registrar uma decisao de aprovar, reprovar ou solicitar complementos, para concluir a analise com uma justificativa rastreavel.",
                "Descricao: a decisao deve respeitar os estados permitidos da proposta e registrar data, responsavel e motivo."),
            self._compose_story_block(10,
                "Como Ana, cliente solicitante, eu quero acompanhar o status da minha proposta, para saber se ela esta em rascunho, enviada, em analise, com pendencia, aprovada ou reprovada.",
                "Descricao: o status deve explicar a proxima acao esperada sem expor informacoes internas de risco."),
            self._compose_story_block(11,
                "Como Ana, cliente solicitante, eu quero receber e atender uma solicitacao de complemento, para corrigir pendencias sem criar uma nova proposta.",
                "Descricao: a pendencia deve informar quais dados ou documentos precisam de ajuste e permitir novo envio."),
            self._compose_story_block(12,
                "Como Ana, cliente solicitante, eu quero visualizar a decisao da minha proposta de forma clara, para entender o resultado e os proximos passos aplicaveis.",
                "Descricao: a comunicacao deve evitar promessas de aprovacao antes da decisao registrada pelo analista."),
            self._compose_story_block(13,
                "Como Roberto, gestor de credito, eu quero consultar uma fila de propostas por status e prioridade, para distribuir a analise e acompanhar os prazos operacionais.",
                "Descricao: a fila deve destacar propostas com pendencias ou que aguardam analise por mais tempo."),
            self._compose_story_block(14,
                "Como Roberto, gestor de credito, eu quero revisar o historico de alteracoes e decisoes de cada proposta, para auditar o processo de concessao.",
                "Descricao: o historico deve identificar a acao, o responsavel e o momento em que ocorreu."),
            self._compose_story_block(15,
                "Como Fernanda, analista de cadastro, eu quero registrar o resultado de verificacoes de identidade e fraude, para sinalizar propostas que exigem revisao adicional.",
                "Descricao: a sinalizacao nao deve decidir automaticamente a proposta e precisa ficar visivel ao analista responsavel."),
            self._compose_story_block(16,
                "Como Roberto, gestor de credito, eu quero configurar limites e politicas de elegibilidade aplicaveis ao produto, para que a analise siga regras operacionais vigentes.",
                "Descricao: alteracoes de politica devem manter historico e ser aplicadas apenas a novas analises ou conforme regra definida."),
        ]

    def _build_deterministic_backlog(self, idea):
        # A deterministic backlog is intentionally opt-in. Publishing a
        # template-shaped backlog when the provider is unavailable violates
        # evidence governance and makes new domains look complete when they
        # are not. Keep this hook only for controlled local fixtures.
        if os.getenv("PROJECT_MANAGER_ALLOW_DETERMINISTIC_FALLBACK", "0") != "1":
            return None
        compact_briefing = self._compact_briefing(idea)
        inferred = self._infer_core_pack_terms(compact_briefing)
        entity_label = inferred["entity_label"]
        summary_label = inferred["summary_label"]

        if entity_label == "solicitacao de credito":
            overview = (
                "Backlog inicial para uma jornada digital de solicitacao de credito, da simulacao e envio da proposta "
                "ate a analise, decisao e acompanhamento pelo cliente, com controles de seguranca e rastreabilidade."
            )
            capabilities = [
                "Simular condicoes de credito e iniciar propostas digitais.",
                "Coletar dados, documentos e consentimentos obrigatorios.",
                "Validar pendencias e encaminhar propostas para analise de credito.",
                "Decidir propostas e comunicar status de forma clara ao cliente.",
                "Manter controles de fraude, politicas e auditoria da operacao.",
            ]
            epics = [
                "Epic 1: Simulacao, cadastro e envio da proposta de credito.",
                "Epic 2: Documentos, consentimento e validacao cadastral.",
                "Epic 3: Analise de credito, pendencias e decisao da proposta.",
                "Epic 4: Acompanhamento do cliente, governanca e prevencao a fraude.",
            ]
            release_slices = [
                "MVP: foco na espinha dorsal do fluxo principal, com simulacao, proposta, documentos, analise manual e decisao; integracoes externas ficam para depois.",
                "Fase 2: foco em ampliar a operacao com fila, notificacoes, regras configuraveis e verificacoes adicionais; automacao avancada fica para fase seguinte.",
                "Fase 3: foco em evolucao com integracoes a bureaus, monitoramento de fraude e refinamento de politicas; somente apos a estabilizacao do MVP.",
            ]
        else:
            overview = (
                f"Backlog inicial estruturado para organizar o produto em torno de {entity_label}, "
                f"com foco na primeira versao operacional e na rastreabilidade entre briefing, execucao e governanca."
            )
            capabilities = [
                f"Definir a base operacional de {entity_label}.",
                "Registrar e consultar informacoes essenciais do fluxo.",
                "Acompanhar status, pendencias e validacoes do trabalho.",
                f"Consolidar leitura de {summary_label} para decisao rapida.",
                "Manter governanca e rastreabilidade das mudancas principais.",
            ]
            epics = [
                "Epic 1: Fundacao operacional do produto.",
                "Epic 2: Operacao principal e acompanhamento do fluxo.",
                "Epic 3: Gestao e visibilidade do trabalho.",
                "Epic 4: Governanca, validacao e rastreabilidade.",
            ]
            release_slices = [
                "MVP: foco na espinha dorsal do produto, priorizando cadastro inicial, consulta basica e governanca minima.",
                "Fase 2: foco em ampliar operacao e visibilidade com apoio de filtros, acompanhamento e edicao controlada.",
                "Fase 3: foco em evolucao, auditoriabilidade e refinamento da experiencia sem perder estabilidade.",
            ]

        story_blocks = [
            *self._generate_fixed_core_pack_stories(compact_briefing),
            *self._generate_deterministic_support_stories(compact_briefing),
        ][: self.STORY_RANGE[1]]

        if len(story_blocks) < self.STORY_RANGE[0]:
            return None

        backlog = self._build_full_backlog_with_structure(
            overview=overview,
            capabilities=capabilities,
            epics=epics,
            release_slices=release_slices,
            story_blocks=story_blocks,
        )
        is_complete, _ = validate_backlog_output(backlog)
        return backlog if is_complete else None

    def _ensure_core_pack_frontload(self, base_context, story_blocks, *, min_stories, max_stories):
        consolidated = self._dedupe_and_polish_stories(story_blocks, base_context)
        consolidated = self._prioritize_story_blocks(consolidated)

        # The project context and the LLM define the product scope. Never
        # prepend a deterministic story template from another domain.

        front = [block for block in consolidated if not self._is_advanced_story(block)]
        tail = [block for block in consolidated if self._is_advanced_story(block)]
        consolidated = (front + tail)[:max_stories]
        consolidated = self._sequence_story_blocks_for_mvp(consolidated, window=min(8, len(consolidated)))
        consolidated = self._ensure_minimum_story_count(
            base_context,
            consolidated,
            min_stories=min_stories,
            max_stories=max_stories,
        )
        return consolidated[:max_stories]

    def _rebalance_story_batch_for_mvp(self, base_context, story_blocks, *, min_stories, max_stories):
        consolidated = self._dedupe_and_polish_stories(story_blocks, base_context)
        consolidated = self._prioritize_story_blocks(consolidated)

        frontload_coverage = self._frontload_foundation_coverage(consolidated)
        if len(frontload_coverage) < 5:
            frontload_blocks = self._generate_mvp_frontload_stories(base_context, consolidated)
            if frontload_blocks:
                consolidated = self._dedupe_and_polish_stories(frontload_blocks + consolidated, base_context)
                consolidated = self._prioritize_story_blocks(consolidated)

        # If the top of the backlog is still too advanced, push advanced items down.
        front = [block for block in consolidated if not self._is_advanced_story(block)]
        tail = [block for block in consolidated if self._is_advanced_story(block)]
        consolidated = (front + tail)[:max_stories]
        consolidated = self._ensure_core_pack_frontload(
            base_context,
            consolidated,
            min_stories=min_stories,
            max_stories=max_stories,
        )
        consolidated = self._ensure_minimum_story_count(
            base_context,
            consolidated,
            min_stories=min_stories,
            max_stories=max_stories,
        )
        return consolidated[:max_stories]

    def _generate_simple_bullet_section(self, base_context, *, section_title, task_label, rules, num_predict):
        prompt = f"""
{base_context}

TAREFA
Gere APENAS esta secao em Markdown:

## {section_title}

REGRAS
{rules}
"""
        result = self._generate_block(prompt, num_predict=num_predict)
        section = self._extract_section(result, section_title)
        if not section and section_title.strip().lower() == "fatias de release":
            # The release prompt asks for a single section. Accept a direct
            # MVP/Fase 2/Fase 3 plan even when the model omits the optional
            # Markdown heading; no content is synthesized here.
            direct_slices = self._extract_release_slices(result)
            if direct_slices:
                return direct_slices
        if not section:
            raise RuntimeError(f"Secao {section_title} vazia.")
        if section_title.strip().lower() == "fatias de release":
            bullets = self._extract_release_slices(section)
        else:
            bullets = self._extract_bullet_lines(section)
        if not bullets:
            raise RuntimeError(f"Secao {section_title} sem itens.")
        return bullets

    def _repair_backlog_output(self, base_context, full_backlog, overview, story_blocks, reason, *, min_stories, max_stories):
        repaired_overview = (overview or "").strip()
        extracted_overview = self._extract_section(full_backlog, "Visao Geral")
        extracted_capabilities = self._extract_bullet_lines(self._extract_section(full_backlog, "Capacidades do Produto"))
        extracted_epics = self._extract_bullet_lines(self._extract_section(full_backlog, "Epicos Recomendados"))
        extracted_releases = self._extract_release_slices(self._extract_section(full_backlog, "Fatias de Release"))
        if not repaired_overview and extracted_overview:
            repaired_overview = extracted_overview.strip()

        consolidated_blocks = self._dedupe_and_polish_stories(
            list(story_blocks) + self._extract_story_lines(self._extract_section(full_backlog, "Historias de Usuario"))
        , base_context)

        if not repaired_overview:
            overview_prompt = f"""
{base_context}

TAREFA
Gere APENAS esta secao em Markdown:

## Visao Geral
- Resuma o problema, o objetivo e a primeira versao do produto em no maximo 5 linhas.
"""
            overview_result = self._generate_block(
                overview_prompt,
                num_predict=os.getenv("PROJECT_MANAGER_BLOCK_OVERVIEW_NUM_PREDICT", "240"),
            )
            repaired_overview = self._extract_section(overview_result, "Visao Geral") or repaired_overview

        capabilities = extracted_capabilities
        if len(capabilities) < 3:
            capabilities = self._generate_simple_bullet_section(
                base_context,
                section_title="Capacidades do Produto",
                task_label="capacidades",
                rules="- Liste entre 4 e 6 capacidades do produto.\n- Foque em capacidades de negocio e operacao.\n- Nao escreva user stories.\n- Cada item deve ser um bullet curto.",
                num_predict=os.getenv("PROJECT_MANAGER_BLOCK_CAPABILITIES_NUM_PREDICT", "320"),
            )

        epics = extracted_epics
        if len(epics) < 3:
            epics = self._generate_simple_bullet_section(
                base_context,
                section_title="Epicos Recomendados",
                task_label="epicos",
                rules="- Liste entre 4 e 6 epicos recomendados.\n- Cada item deve agrupar um conjunto coerente de historias.\n- Nomeie o epic e descreva o foco em uma linha.\n- Nao escreva user stories.",
                num_predict=os.getenv("PROJECT_MANAGER_BLOCK_EPICS_NUM_PREDICT", "360"),
            )

        release_slices = extracted_releases
        if len(release_slices) < 2:
            release_slices = self._generate_simple_bullet_section(
                base_context,
                section_title="Fatias de Release",
                task_label="releases",
                rules="- Liste 3 fatias de release: MVP, Fase 2 e Fase 3.\n- Em cada item, diga o foco da fatia e o que fica de fora.\n- Nao escreva user stories completas.",
                num_predict=os.getenv("PROJECT_MANAGER_BLOCK_RELEASES_NUM_PREDICT", "320"),
            )

        if len(consolidated_blocks) < min_stories or "trunc" in (reason or "").lower():
            consolidated_blocks = self._ensure_minimum_story_count(
                base_context,
                consolidated_blocks,
                min_stories=min_stories,
                max_stories=max_stories,
            )

        consolidated_blocks = self._ensure_foundation_story_coverage(
            base_context,
            consolidated_blocks,
            min_stories=min_stories,
            max_stories=max_stories,
        )
        consolidated_blocks = self._rebalance_story_batch_for_mvp(
            base_context,
            consolidated_blocks,
            min_stories=min_stories,
            max_stories=max_stories,
        )

        if len(consolidated_blocks) < min_stories:
            fallback_blocks = self._generate_missing_stories_fallback(
                base_context,
                consolidated_blocks,
                needed_count=min_stories - len(consolidated_blocks),
            )
            if fallback_blocks:
                consolidated_blocks = self._dedupe_and_polish_stories(consolidated_blocks + fallback_blocks, base_context)

        if len(consolidated_blocks) >= min_stories:
            curated_section = self._curate_story_batch(
                base_context,
                consolidated_blocks,
                min_stories=min_stories,
                max_stories=max_stories,
            )
            consolidated_blocks = self._dedupe_and_polish_stories(self._extract_story_lines(curated_section), base_context)

        consolidated_blocks = self._ensure_minimum_story_count(
            base_context,
            consolidated_blocks,
            min_stories=min_stories,
            max_stories=max_stories,
        )[:max_stories]
        consolidated_blocks = self._ensure_foundation_story_coverage(
            base_context,
            consolidated_blocks,
            min_stories=min_stories,
            max_stories=max_stories,
        )[:max_stories]
        consolidated_blocks = self._rebalance_story_batch_for_mvp(
            base_context,
            consolidated_blocks,
            min_stories=min_stories,
            max_stories=max_stories,
        )[:max_stories]

        self._validate_story_batch_quality(consolidated_blocks, min_stories=min_stories)
        return self._build_full_backlog_with_structure(
            overview=repaired_overview,
            capabilities=capabilities,
            epics=epics,
            release_slices=release_slices,
            story_blocks=consolidated_blocks,
        )

    def _generate_block(self, prompt, *, num_predict, min_response_chars=0):
        # Epic blocks must not inherit the provider's broad 180-second default.
        # NVIDIA can legitimately need more than the 45-second single-pass
        # budget, so use a dedicated bounded timeout that keeps successful
        # batches viable while releasing a stalled run promptly.
        try:
            request_timeout = int(os.getenv("PROJECT_MANAGER_EPIC_BLOCK_REQUEST_TIMEOUT_SECONDS", "120"))
        except (TypeError, ValueError):
            request_timeout = 120
        request_timeout = max(45, min(request_timeout, 150))
        options = {
            "temperature": 0.1,
            "num_predict": int(num_predict),
            "request_timeout_seconds": request_timeout,
            # Retry once when the provider sends an empty/tiny completion.
            # Timeouts still never retry in the router, so a stalled request
            # cannot double the batch latency.
            "transient_retries": 1,
        }
        if min_response_chars:
            options["min_response_chars"] = int(min_response_chars)
        result = generate_text_from_llm(
            prompt,
            options_override=options,
            use_cache=False,
        )

        if self._is_unusable_llm_response(result):
            raise RuntimeError("Resposta vazia ou invalida.")

        return result

    def _extract_json_object(self, response):
        """Extract the most likely backlog object without requiring perfect framing.

        JSON mode is a provider hint, not a guarantee.  Free and routed models
        commonly wrap valid JSON in prose or a code fence; selecting a decoded
        object is safe because semantic validation remains mandatory afterwards.
        """
        text = str(response or "").lstrip("\ufeff").strip()
        decoder = json.JSONDecoder()
        candidates = []

        def add_parsed_candidate(value):
            if isinstance(value, dict):
                candidates.append(value)
                return
            if not isinstance(value, list):
                return
            objects = [item for item in value if isinstance(item, dict)]
            if not objects:
                return
            candidates.extend(objects)
            # A common free-model deviation is a top-level array containing
            # the requested user stories. Keep it as a contract fragment so
            # later validation can derive its capability map correctly.
            if all({"id", "goal"}.issubset(item) for item in objects):
                candidates.append({"stories": objects})
                return
            # Some models emit one object per contract section in an array.
            # Merge only those section objects; semantic validation still
            # verifies the assembled result afterwards.
            merged = {}
            for item in objects:
                merged.update(item)
            if merged:
                candidates.append(merged)

        try:
            parsed = json.loads(text)
            add_parsed_candidate(parsed)
        except json.JSONDecodeError:
            pass

        # Decode only the first JSON frame. Looking for later opening braces
        # can turn a nested release or story inside a truncated root contract
        # into a false "complete" backlog.
        first_json_index = next((index for index, char in enumerate(text) if char in "[{"), -1)
        if first_json_index >= 0:
            try:
                parsed, _ = decoder.raw_decode(text[first_json_index:])
                add_parsed_candidate(parsed)
            except json.JSONDecodeError:
                pass

        # A few routed/free models emit a sequence of standalone story JSON
        # objects rather than a single array or enclosing contract. Aggregate
        # those fragments before choosing a candidate; otherwise max() below
        # can only return one story and the capability derivation never runs.
        story_fragments = []
        seen_story_ids = set()
        required_story_fields = {"id", "actor", "goal", "benefit", "description", "lane"}
        for candidate in candidates:
            if not required_story_fields.issubset(candidate):
                continue
            story_id = str(candidate.get("id") or "").strip().upper()
            if not story_id or story_id in seen_story_ids:
                continue
            seen_story_ids.add(story_id)
            story_fragments.append(candidate)
        if story_fragments:
            candidates.append({"stories": story_fragments})

        expanded = []
        envelope_keys = (
            "backlog_contract", "contract", "backlog", "project_backlog",
            "data", "result", "resultado", "output",
        )
        for candidate in candidates:
            expanded.append(candidate)
            for key in envelope_keys:
                nested = candidate.get(key)
                if isinstance(nested, dict):
                    expanded.append(nested)
                elif isinstance(nested, str):
                    try:
                        decoded_nested = json.loads(nested)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(decoded_nested, dict):
                        expanded.append(decoded_nested)

        if not expanded:
            raise ValueError(f"A IA deve responder um objeto JSON valido (resposta com {len(text)} caracteres).")

        backlog_key_groups = (
            {"overview", "summary", "resumo", "visao_geral", "visão_geral"},
            {
                "capabilities", "product_capabilities", "productCapabilities",
                "capacidades", "capacidades_do_produto", "features",
                "functionalities", "funcionalidades", "functional_requirements",
                "requisitos_funcionais", "modules", "modulos",
            },
            {"epics", "recommended_epics", "epicos", "épicos", "epicos_recomendados"},
            {"releases", "release_slices", "releaseSlices", "fatias_de_release", "fatias_release"},
            {"stories", "user_stories", "userStories", "historias", "histórias", "backlog_items", "items"},
            {"coverage"},
        )

        # raw_decode also finds nested capabilities and stories. They are valid
        # JSON objects, but never a complete backlog contract. Prefer a
        # recognized contract; when provider field names are unfamiliar, use
        # the largest non-leaf object rather than an inner CAP/US record.
        leaf_keys = {
            "id", "name", "title", "label", "text", "description",
            "source_ids", "story_ids", "capability_ids", "feature",
            "functionality", "goal", "actor", "benefit",
        }

        def candidate_score(item):
            keys = set(item.keys())
            recognized_groups = sum(bool(group.intersection(keys)) for group in backlog_key_groups)
            is_leaf = bool(keys) and keys.issubset(leaf_keys) and bool(keys.intersection({"id", "name", "title", "goal"}))
            try:
                serialized_size = len(json.dumps(item, ensure_ascii=False))
            except (TypeError, ValueError):
                serialized_size = 0
            return recognized_groups, 0 if is_leaf else 1, serialized_size

        return max(expanded, key=candidate_score)

    def _build_evidence_contract(self, idea):
        # Project DNA guides product coherence and UI choices; it is not proof
        # that a business capability, policy or workflow was requested.
        business_briefing = re.split(r"(?:^|\n)\s*Project DNA\s*:", str(idea or ""), maxsplit=1, flags=re.IGNORECASE)[0]
        facts = []
        for index, line in enumerate(re.split(r"[\n.;]+", business_briefing)):
            text = re.sub(r"\s+", " ", line).strip(" -")
            # Section labels are context delimiters, never business evidence.
            if len(text) >= 12 and not re.fullmatch(r"(?:respostas[- ]?chave|briefing|contexto)\s*:?", text, re.IGNORECASE):
                facts.append({"id": f"briefing.{index + 1}", "text": text, "type": "briefing"})
        return {"facts": facts[:30]}

    def _analyze_requirements_contract(self, idea):
        """Build the pre-backlog contract; it never turns a gap into a fact."""
        evidence = self._build_evidence_contract(idea)
        # The separate LLM preflight is advisory. On a single overloaded
        # provider it can spend several minutes before the incremental PM has
        # even attempted its compact planning call. Evidence remains the
        # canonical input, so skip that optional call unless explicitly
        # enabled for installations that have reliable provider redundancy.
        preflight_enabled = str(os.getenv("PROJECT_MANAGER_REQUIREMENTS_PREFLIGHT_ENABLED", "0")).lower() in ("1", "true", "yes")
        if not preflight_enabled:
            print(json.dumps({
                "event": "project_manager_requirements_analysis_skipped",
                "reason": "advisory_preflight_disabled",
            }, ensure_ascii=False), file=sys.stderr)
            return {
                "version": 1, "evidence": evidence,
                "requirements": [
                    {"id": fact["id"].replace("briefing.", "REQ-"), "text": fact["text"], "source_ids": [fact["id"]]}
                    for fact in evidence["facts"]
                ],
                "assumptions": [], "questions": [], "blocking_questions": [], "findings": [],
                "analysis_status": "skipped", "semantic_context": {}, "decision": "READY",
            }
        analysis_status = "completed"
        try:
            report = RequirementEngineAgent().process({"stage": "requirements_analysis", "idea": idea})
        except json.JSONDecodeError as error:
            # Providers may return almost-valid JSON (for example a missing
            # comma). The requirements preflight is advisory; continue with
            # deterministic evidence instead of aborting backlog generation.
            analysis_status = "degraded"
            report = {"findings": []}
            print(json.dumps({
                "event": "project_manager_requirements_analysis_degraded",
                "reason": str(error),
            }, ensure_ascii=False), file=sys.stderr)
        except ValueError as error:
            # The preflight is advisory input to a stricter downstream gate.
            # A fallback provider can return prose despite JSON mode; do not
            # convert that transport-format failure into an HTTP 500.
            if "json" not in str(error).lower():
                raise
            analysis_status = "degraded"
            report = {"findings": []}
            print(json.dumps({
                "event": "project_manager_requirements_analysis_degraded",
                "reason": str(error),
            }, ensure_ascii=False), file=sys.stderr)
        except RuntimeError as error:
            # Requirement analysis is a preflight signal, not the source of
            # truth for the backlog. A transient router/provider failure must
            # not prevent the incremental PM stages from working from the
            # briefing evidence already collected above.
            message = str(error)
            transient_markers = (
                "nenhum modelo do router", "provider", "resposta json",
                "resposta vazia", "timed out", "overloaded",
            )
            if not any(marker in message.lower() for marker in transient_markers):
                raise
            analysis_status = "degraded"
            report = {"findings": []}
            print(json.dumps({
                "event": "project_manager_requirements_analysis_degraded",
                "reason": message,
            }, ensure_ascii=False), file=sys.stderr)
        # Providers may serialize an empty optional array as JSON null. The
        # preflight is advisory, so treat it as no findings rather than
        # failing the entire backlog before planning starts.
        raw_findings = report.get("findings") if isinstance(report, dict) else []
        raw_findings = raw_findings if isinstance(raw_findings, list) else []
        semantic_context = report.get("semantic_context", {}) if isinstance(report, dict) and isinstance(report.get("semantic_context", {}), dict) else {}
        findings, assumptions, questions = [], [], []
        valid_categories = {"missing_information", "ambiguity", "assumption", "contradiction"}
        for index, item in enumerate(raw_findings, start=1):
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "").strip().lower()
            severity = str(item.get("severity") or "medium").strip().lower()
            message = str(item.get("message") or "").strip()
            if category not in valid_categories or severity not in {"low", "medium", "high"} or not message:
                continue
            finding = {
                "id": f"RF-{index:02d}", "category": category, "severity": severity,
                "message": message, "evidence": str(item.get("evidence") or "").strip(),
                "recommendation": str(item.get("recommendation") or "").strip(),
                "clarification_question": str(item.get("clarification_question") or "").strip(),
                "answer_hint": str(item.get("answer_hint") or "").strip(),
            }
            findings.append(finding)
            if category == "assumption":
                assumptions.append({"id": f"ASM-{len(assumptions) + 1:02d}", "text": message, "source": "requirements_analyzer"})
            if category in {"missing_information", "ambiguity", "contradiction"} and severity in {"medium", "high"}:
                question_text = finding["clarification_question"] or finding["recommendation"]
                if not question_text.endswith("?"):
                    question_text = f"Qual decisao de produto deve ser tomada sobre: {message.rstrip('.')}?"
                stable_question_key = hashlib.sha1(question_text.strip().lower().encode("utf-8")).hexdigest()[:10].upper()
                questions.append({
                    "id": f"CQ-{stable_question_key}",
                    "question": question_text,
                    "reason": message,
                    "answer_hint": finding["answer_hint"] or "Informe a decisao e, se aplicavel, a regra, limite ou criterio que deve ser usado.",
                    "blocking": severity == "high", "finding_id": finding["id"],
                })
        # Questions must be grounded in LLM findings for this briefing. If the
        # requirements analysis degrades, do not inject a domain-specific
        # template: that would leak unrelated product language into the
        # project. The caller can continue with the available evidence or
        # retry once an AI provider is available.
        if analysis_status == "degraded" and not questions:
            print(json.dumps({
                "event": "project_manager_elicitation_skipped_after_degraded_analysis",
                "reason": "No LLM-grounded clarification questions were available.",
            }, ensure_ascii=False), file=sys.stderr)
        blocking_questions = [question for question in questions if question["blocking"]]
        return {
            "version": 1, "evidence": evidence,
            "requirements": [
                {"id": fact["id"].replace("briefing.", "REQ-"), "text": fact["text"], "source_ids": [fact["id"]]}
                for fact in evidence["facts"]
            ],
            "assumptions": assumptions, "questions": questions,
            "blocking_questions": blocking_questions, "findings": findings,
            "analysis_status": analysis_status,
            "semantic_context": semantic_context,
            "decision": "BLOCK" if blocking_questions else "READY",
        }

    @staticmethod
    def _semantic_terms(value):
        normalized = unicodedata.normalize("NFKD", str(value or ""))
        normalized = "".join(char for char in normalized if not unicodedata.combining(char)).lower()
        ignored = {
            "como", "eu", "quero", "para", "uma", "um", "uns", "umas", "de", "da", "do", "das", "dos",
            "e", "ou", "a", "o", "as", "os", "na", "no", "nas", "nos", "em", "com", "por", "sem",
            "que", "sua", "seu", "suas", "seus", "ao", "aos", "cliente", "analista", "gestor", "operacao",
            "sistema", "plataforma", "forma", "sobre", "antes", "depois", "mais", "menos", "para",
        }
        return {
            token[:6]
            for token in re.findall(r"[a-z0-9]{3,}", normalized)
            if token not in ignored
        }

    def _has_direct_business_evidence(self, story, evidence_by_id):
        source_ids = story.get("source_ids") if isinstance(story, dict) else []
        source_text = " ".join(evidence_by_id[source_id] for source_id in source_ids if source_id in evidence_by_id) if isinstance(source_ids, list) else ""
        story_text = " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
        return len(self._semantic_terms(source_text) & self._semantic_terms(story_text)) >= 2

    @staticmethod
    def _unsupported_product_details(story, evidence_by_id):
        """Detect concrete product behaviour added beyond the cited evidence.

        Broad terms such as "consultar" or "ingresso" are insufficient proof
        for a specific filter, category or post-purchase communication. These
        details alter scope and must be reviewable instead of silently being
        published as confirmed requirements.
        """
        source_ids = story.get("source_ids") if isinstance(story, dict) else []
        source_text = " ".join(evidence_by_id[source_id] for source_id in source_ids if source_id in evidence_by_id) if isinstance(source_ids, list) else ""
        text = " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
        normalized_story = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
        normalized_source = unicodedata.normalize("NFKD", source_text).encode("ascii", "ignore").decode("ascii").lower()
        details = {
            "filtros": (r"\bfiltro", r"\bfiltro"),
            "categoria": (r"\bcategoria", r"\bcategoria"),
            "comunicacao_pos_compra": (r"\bcomunicacao\s+(?:pos|apos)[- ]?compra", r"\bcomunicacao\s+(?:pos|apos)[- ]?compra"),
            "lote_com_preco_diferenciado": (r"\blotes?.{0,70}\bpre[cç]", r"\blotes?.{0,70}\bpre[cç]"),
        }
        return [
            label for label, (story_pattern, evidence_pattern) in details.items()
            if re.search(story_pattern, normalized_story) and not re.search(evidence_pattern, normalized_source)
        ]

    @staticmethod
    def _excluded_scope_terms(story, evidence_by_id):
        """Return explicitly excluded product terms reintroduced by a story."""
        story_text = unicodedata.normalize(
            "NFKD", " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
        ).encode("ascii", "ignore").decode("ascii").lower()
        excluded_text = " ".join(
            unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
            for value in evidence_by_id.values()
            if re.search(r"\bfora do escopo|nao faz parte do escopo|nao sera incluido\b", str(value or ""), re.IGNORECASE)
        )
        terms = ("cancelamento", "reembolso", "estorno", "transferencia")
        return [term for term in terms if term in excluded_text and re.search(rf"\b{term}\w*\b", story_text)]

    @staticmethod
    def _has_project_business_outcome_evidence(evidence_by_id):
        """Return whether the briefing already states the product-level outcome.

        A story still needs direct evidence for its detailed behaviour, but a
        project objective such as reducing conflicts or improving visibility
        is sufficient to answer the generic "why does this product exist?"
        question. Do not ask that same question once per story.
        """
        for value in evidence_by_id.values():
            normalized = unicodedata.normalize("NFKD", str(value or "")) \
                .encode("ascii", "ignore").decode("ascii").lower().strip()
            if not normalized:
                continue
            is_objective = bool(re.match(r"^(?:objective|objetivo|vision|visao|resultado esperado)\s*:", normalized))
            has_outcome = bool(re.search(
                r"\b(reduz|diminui|aument|melhor|centraliz|visibil|evit|agiliz|otimiz|control|autonom|eficien|conflit|retrabalh)\w*\b",
                normalized,
            ))
            if is_objective and len(ProjectManager._semantic_terms(normalized)) >= 3:
                return True
            if has_outcome and len(ProjectManager._semantic_terms(normalized)) >= 5:
                return True
        return False

    @staticmethod
    def _unsupported_sensitive_details(story, evidence_by_id):
        source_ids = story.get("source_ids") if isinstance(story, dict) else []
        source_text = " ".join(evidence_by_id[source_id] for source_id in source_ids if source_id in evidence_by_id) if isinstance(source_ids, list) else ""
        normalized_source = unicodedata.normalize("NFKD", source_text).encode("ascii", "ignore").decode("ascii").lower()
        normalized_story = unicodedata.normalize(
            "NFKD", " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
        ).encode("ascii", "ignore").decode("ascii").lower()
        # Only explicit business policies block synthesis. Domain actions
        # (cancel a reservation), technical qualities (real-time) and ordinary
        # audit/history language must not be mistaken for retention, SLA or a
        # regulated audit policy.
        sensitive_details = {
            "configuracao_de_politica": (r"\b(parametr|configur).{0,35}\b(regra|politic|criter|limite|marg)", None),
            # A usage/occupancy rate is an operational indicator. Treat only
            # rates explicitly tied to a financial concept as a financial
            # policy that needs prior confirmation.
            "calculo_financeiro": (r"\b(?:calcul|formula|cet|tarifa|parcela|taxa\s+(?:de\s+)?(?:juros|financeira|administrativa))\b", None),
            "limite_ou_prazo": (r"\b(?:limite\s+(?:de\s+)?(?:valor|credito|operacao)|prazo\s+de\s+(?:pagamento|contrato|vigencia)|margem)\b", None),
            # "Em tempo real" describes expected responsiveness. It is not a
            # delivery commitment on its own; only an explicit SLA needs a
            # business policy before it can be treated as confirmed.
            "compromisso_de_tempo": (r"\b(?:sla|slo)\b", None),
            "consentimento": (r"\bconsent", None),
            "auditoria_regulatoria": (r"\b(?:auditoria\s+(?:legal|regulatoria)|logs?\s+imutaveis?)\b", None),
            "solucao_de_seguranca": (r"\b(criptograf|controle de acesso|autentica|autorizacao)\b", r"\b(?:autentic\w*|autoriz\w*|controle\s+de\s+acesso|acesso)\b"),
            "retencao_ou_exclusao": (r"\b(expurg|exclus(?:ao|oes)?\s+de\s+dados|anonimiz|retenc)", None),
            # Do not match ordinary words such as "integralmente". Only an
            # explicit integration concept needs external-scope evidence.
            "integracao_externa": (r"\b(?:integracao|integracoes|integrar|integrado|bureau|score|provedor)\b", None),
        }
        # Evidence can express the same business concept with different
        # wording. Two meaningful shared terms are enough to keep a proposed
        # detail reviewable without escalating it to a blocking policy gap.
        contextual_overlap = len(
            ProjectManager._semantic_terms(normalized_story)
            & ProjectManager._semantic_terms(normalized_source)
        )
        unsupported = []
        for label, (story_pattern, evidence_pattern) in sensitive_details.items():
            if not re.search(story_pattern, normalized_story):
                continue
            evidence_pattern = evidence_pattern or story_pattern
            if contextual_overlap < 2 and not re.search(evidence_pattern, normalized_source):
                unsupported.append(label)
        return unsupported

    @staticmethod
    def _is_high_impact_statement(value):
        return bool(re.search(
            r"\b(calcul|pre[cç]o|tarifa|taxa|limite|prazo|elegibil|aprova|autoriza|permiss|dados pessoais|reten[cç]|auditori|integra[cç]|sla|notifica[cç])\b",
            str(value or ""), re.IGNORECASE,
        ))

    @staticmethod
    def _append_unique(items, value):
        value = str(value or "").strip()
        if value and value not in items:
            items.append(value)

    @staticmethod
    def _story_priority_for_lane(lane):
        return {
            "foundation": "high",
            "operation": "high",
            "visibility": "medium",
            "governance": "medium",
        }.get(str(lane or "").strip().lower(), "medium")

    @staticmethod
    def _story_release_for_lane(lane):
        return {
            "foundation": "MVP",
            "operation": "Fase 2",
            "visibility": "Fase 2",
            "governance": "Fase 3",
        }.get(str(lane or "").strip().lower(), "Fase 2")

    @staticmethod
    def _compound_story_actions(goal):
        normalized = unicodedata.normalize("NFKD", str(goal or "")).encode("ascii", "ignore").decode("ascii").lower()
        actions = re.findall(
            r"\b(acessar|visualizar|selecionar|simular|iniciar|preencher|enviar|informar|processar|realizar|concluir|emitir|confirmar|validar|registrar|revisar|aprovar|reprovar|solicitar|acompanhar|receber|gerenciar|administrar|consultar|decidir|cancelar|cadastrar|criar|editar|alterar|bloquear|arquivar|exportar|gerar)\b",
            normalized,
        )
        return sorted(set(actions))

    @staticmethod
    def _story_journey_kind(story):
        """Return a narrow business-journey key for duplicate detection."""
        raw = " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
        text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii").lower()
        patterns = (
            ("reservation_expiration", r"\breserv\w*\b.{0,90}\bexpir\w*\b"),
            ("temporary_reservation", r"\breserv\w*\b.{0,90}\bingress"),
            ("ticket_selection", r"\bselecion\w*\b.{0,90}\b(?:setor|ingress|assento)"),
            ("payment", r"\bpagament\w*\b"),
            ("ticket_access", r"\b(?:acess|visualiz)\w*\b.{0,90}\b(?:ingresso|qr\s*code)"),
            ("ticket_issuance", r"\b(?:emit|receb)\w*\b.{0,90}\b(?:ingresso|qr\s*code)"),
            ("ticket_reuse_prevention", r"\b(?:reutiliz|uso unico|uma unica vez)\w*\b"),
            ("qr_validation", r"\bvalid\w*\b.{0,90}\b(?:qr\s*code|ingresso)"),
        )
        return next((name for name, pattern in patterns if re.search(pattern, text)), "")

    @staticmethod
    def _primary_journey_action(story):
        """Return the business action used to distinguish steps in one journey.

        A reservation flow may legitimately contain selection, temporary
        reservation, payment and confirmation.  Its journey label alone is
        therefore not enough to declare two stories duplicates.
        """
        raw = str(story.get("goal") or "")
        text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii").lower()
        action_patterns = (
            ("expire", r"\bexpir\w*\b"),
            ("select", r"\bselecion\w*\b"),
            ("view_ticket", r"\b(?:acess|visualiz)\w*\b"),
            ("reserve", r"\breserv\w*\b"),
            ("create", r"\bcria\w*\b"),
            ("pay", r"\bpag\w*\b"),
            ("issue", r"\bemit\w*\b"),
            ("receive", r"\breceb\w*\b"),
            ("validate", r"\bvalid\w*\b"),
            ("prevent_reuse", r"\b(?:imped|bloque|reutiliz)\w*\b"),
        )
        return next((action for action, pattern in action_patterns if re.search(pattern, text)), "")

    @staticmethod
    def _canonical_story_actor(actor):
        """Normalize common provider spelling variants without changing personas."""
        value = unicodedata.normalize("NFKD", str(actor or "")).encode("ascii", "ignore").decode("ascii").lower().strip()
        aliases = {
            "profesor": "professor",
            "professora": "professor",
            "admin": "administrador",
            "administrator": "administrador",
        }
        return aliases.get(value, value)

    @staticmethod
    def _story_duplicate_signature(story):
        """Return a conservative comparison key for near-identical stories."""
        raw = " ".join([
            ProjectManager._canonical_story_actor(story.get("actor")),
            str(story.get("goal") or ""),
        ])
        normalized = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii").lower()
        # Keep the business action and object, while ignoring wording that
        # commonly turns the same journey into an apparent new story. The
        # terms below are delivery details for an already described action;
        # they do not make "bloquear sala para manutencao" a distinct journey.
        normalized = re.sub(
            r"\b(como|eu quero|para|que|o|a|os|as|um|uma|e|de|do|da|dos|das|com|"
            r"registro|obrigatorio|obrigatoria|programada|programado|"
            r"definindo|periodo|inicio|fim|mesmo|ja|esta|existente)\b",
            " ",
            normalized,
        )
        return " ".join(re.findall(r"[a-z0-9]+", normalized))

    @staticmethod
    def _parse_story_title(title):
        """Parse supported user-story connectors without accepting arbitrary prose."""
        value = str(title or "").strip()
        primary = re.match(
            r"^Como\s+(.+?),\s*eu quero\s+(.+?),\s*para\s+(.+?)[.]?$",
            value,
            re.IGNORECASE,
        )
        if primary:
            return tuple(part.strip() for part in primary.groups())
        alternate = re.match(
            r"^Como\s+(.+?),\s*eu quero\s+(.+?),\s*(?:a\s+fim\s+de|"
            r"garantindo|evitando|com\s+o\s+objetivo\s+de)\s+(.+?)[.]?$",
            value,
            re.IGNORECASE,
        )
        return tuple(part.strip() for part in alternate.groups()) if alternate else None

    def _deduplicate_epic_story_blocks(self, story_blocks):
        """Remove duplicate epic blocks before they become backlog stories.

        The epic-block strategy receives multiple independent model responses.
        It must apply the same duplicate rule as the JSON-contract strategy,
        otherwise a repeated journey can bypass the final contract lint.
        """
        kept, removed, seen_signatures = [], [], {}
        for block in story_blocks:
            title = self._story_seed_title(block)
            parsed = self._parse_story_title(title)
            actor, goal = parsed[:2] if parsed else ("", title)
            signature = self._story_duplicate_signature({"actor": actor, "goal": goal})
            canonical_index = seen_signatures.get(signature)
            if signature and canonical_index is not None:
                removed.append({"duplicate_index": len(kept) + len(removed) + 1, "canonical_index": canonical_index + 1})
                continue
            if signature:
                seen_signatures[signature] = len(kept)
            kept.append(block)
        return kept, removed

    def _canonicalize_decision_outcomes(self, story):
        """Keep alternative outcomes of one proposal decision as one action.

        Approve, reject and request-complement are outcomes of recording the
        analyst's decision; they are not three independently deliverable
        journeys. This normalization preserves the original wording in the
        description so the confirmed flow remains traceable.
        """
        goal = str(story.get("goal") or "")
        normalized = unicodedata.normalize("NFKD", goal).encode("ascii", "ignore").decode("ascii").lower()
        actions = set(self._compound_story_actions(goal))
        decision_actions = {"aprovar", "reprovar", "solicitar", "decidir"}
        proposal_context = bool(re.search(r"\b(proposta|solicitacao|analise)\b", normalized))
        if proposal_context and len(actions) > 1 and actions.issubset(decision_actions):
            description = str(story.get("description") or "").strip()
            story["goal"] = "registrar a decisao da proposta"
            outcome_note = f"Resultados possiveis da decisao: {goal}."
            if outcome_note not in description:
                story["description"] = " ".join(part for part in (description, outcome_note) if part)
        return story

    def _normalize_release_dependencies(self, stories):
        """Move a dependent story to its prerequisite's release when needed."""
        by_id = {str(story.get("id") or "").upper(): story for story in stories if isinstance(story, dict)}
        for story in stories:
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            for dependency in context.get("dependencies", []) if isinstance(context.get("dependencies"), list) else []:
                prerequisite = by_id.get(str(dependency).upper())
                if prerequisite and self._release_rank(story.get("release")) < self._release_rank(prerequisite.get("release")):
                    story["release"] = prerequisite.get("release")
        return stories

    def _enforce_mvp_scope(self, stories, evidence_contract):
        """Keep the first release focused on one usable purchase journey.

        A provider often marks every useful idea as MVP.  Reporting,
        configuration, ticket-lot administration and broad monitoring are
        valuable, but do not belong in the first customer transaction unless
        they implement an explicit safety constraint.  This deterministic
        pass moves only those auxiliary stories; dependencies are normalized
        immediately afterwards by the caller.
        """
        explicit_ids = {str(fact.get("id") or "") for fact in self._explicit_constraint_facts(evidence_contract)}
        by_id = {str(story.get("id") or "").upper(): story for story in stories if isinstance(story, dict)}
        dependency_targets = {
            str(dependency).upper()
            for story in stories if isinstance(story, dict) and str(story.get("release") or "").strip().lower() == "mvp"
            for dependency in ((story.get("refinement_context") or {}).get("dependencies") or [])
            if str(dependency).upper() in by_id
        }
        auxiliary_pattern = re.compile(
            r"\b(?:monitor\w*|painel|relatorio|indicador|alerta|historico|auditoria|lotes?|configur\w*|catalogo|filtros?)\b",
            re.IGNORECASE,
        )
        critical_pattern = re.compile(
            r"\b(?:pagament\w*|reserv\w*|emit\w*|qr\s*code|valid\w*|privacidade|dados? pessoais|autoriz\w*)\b",
            re.IGNORECASE,
        )
        moved = []
        for story in stories:
            if not isinstance(story, dict) or str(story.get("release") or "").strip().lower() != "mvp":
                continue
            text = " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
            source_ids = {str(source_id) for source_id in story.get("source_ids", []) if str(source_id)}
            is_required_constraint = bool(source_ids & explicit_ids) and bool(critical_pattern.search(text))
            if auxiliary_pattern.search(text) and not is_required_constraint and str(story.get("id") or "").upper() not in dependency_targets:
                story["release"] = "Fase 2"
                if str(story.get("lane") or "").lower() == "foundation":
                    story["lane"] = "visibility"
                moved.append(str(story.get("id") or ""))
        if moved:
            print(json.dumps({
                "event": "project_manager_mvp_scope_enforced",
                "moved_to_phase_two": moved,
            }, ensure_ascii=False), file=sys.stderr)
        return stories

    def _merge_automatic_outcome_stories(self, stories):
        """Move automatic outcomes into the BDD of their business journey.

        Expiring a temporary reservation and recording a successful QR scan
        are observable consequences of reservation/validation. They are not
        independent actions performed by the buyer or gate staff.
        """
        by_id = {str(story.get("id") or "").upper(): story for story in stories if isinstance(story, dict)}
        reservation_story = next((story for story in stories if self._story_journey_kind(story) == "temporary_reservation"), None)
        validation_story = next((story for story in stories if self._story_journey_kind(story) == "qr_validation"), None)
        retained, merged = [], []
        for story in stories:
            kind = self._story_journey_kind(story)
            action = self._primary_journey_action(story)
            target = None
            if kind == "reservation_expiration" and reservation_story and story is not reservation_story:
                target = reservation_story
            elif kind == "ticket_reuse_prevention" and action != "validate" and validation_story and story is not validation_story:
                target = validation_story
            if not target:
                retained.append(story)
                continue
            target_context = target.setdefault("refinement_context", {})
            target_criteria = target_context.setdefault("acceptance_criteria", [])
            source_context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            source_criteria = source_context.get("acceptance_criteria") if isinstance(source_context.get("acceptance_criteria"), list) else []
            for criterion in source_criteria:
                if not isinstance(criterion, dict):
                    continue
                given, when, then = (str(criterion.get(key) or "").strip() for key in ("given", "when", "then"))
                if not (given and when and then):
                    continue
                signature = (given.lower(), when.lower(), then.lower())
                if any(
                    signature == (str(item.get("given") or "").strip().lower(), str(item.get("when") or "").strip().lower(), str(item.get("then") or "").strip().lower())
                    for item in target_criteria if isinstance(item, dict)
                ):
                    continue
                target_criteria.append({
                    **criterion,
                    "id": f"{target.get('id')}-CA-{len(target_criteria) + 1:02d}",
                })
            target["source_ids"] = sorted(set([
                *(target.get("source_ids") or []), *(story.get("source_ids") or []),
            ]))
            merged.append({"source": story.get("id"), "target": target.get("id")})
        if merged:
            print(json.dumps({
                "event": "project_manager_automatic_outcomes_merged",
                "merged": merged,
            }, ensure_ascii=False), file=sys.stderr)
        return retained

    def _apply_story_quality_guardrails(self, story, tags, questions, refinement_context):
        """Expose missing product decisions without manufacturing their answer.

        These guardrails do not generate a replacement story.  They preserve
        the AI proposal and make its unresolved, high-impact parts explicit
        for the requirements analyst and product review.
        """
        goal = str(story.get("goal") or "")
        description = str(story.get("description") or "")
        actor = str(story.get("actor") or "")
        text = f"{goal} {description}"
        normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
        actor_normalized = unicodedata.normalize("NFKD", actor).encode("ascii", "ignore").decode("ascii").lower()

        actions = self._compound_story_actions(goal)
        if len(actions) > 1:
            self._append_unique(tags, "REVIEW_SCOPE")

        # Qualificadores subjetivos não são critérios de aceite. Preserve a
        # proposta, mas force o produto a convertê-los em sinais observáveis.
        subjective_terms = re.findall(r"\b(simples|f[aá]cil|rápido|rapido|intuitivo|eficiente|seguro)\b", normalized, re.IGNORECASE)
        subjective_terms = subjective_terms or re.findall(r"\brapida\b", normalized, re.IGNORECASE)
        if subjective_terms:
            self._append_unique(tags, "REVIEW_TESTABILITY")

        automatic_actions = {"validar", "registrar"}
        goal_actions = set(self._compound_story_actions(goal))
        system_executes_goal = bool(re.search(
            r"\bsistema\b.{0,80}\b(valid(?:a|am|ou|ara|aria|ar)|registra(?:r|do)|registrou)\b",
            normalized,
        ))
        if (
            re.search(r"\b(operador|analista|gestor)\b", actor_normalized)
            and system_executes_goal
            and goal_actions.intersection(automatic_actions)
        ):
            self._append_unique(tags, "REVIEW_ROLE")
            self._append_unique(
                questions,
                "Confirmar o ator responsavel: a historia descreve um comportamento automatico do sistema, mas o ator informado e humano.",
            )

        if re.search(r"\b(acompanhar a operacao geral|assegurar a conformidade|garantir a conformidade)\b", normalized):
            self._append_unique(tags, "REVIEW_SCOPE")
            self._append_unique(
                questions,
                "Quais indicadores, decisoes ou controles concretos esta historia deve suportar?",
            )

        credit_domain = bool(re.search(r"\b(credit\w*|emprestimo\w*|financiamento\w*|score\w*|bureau\w*)", normalized))
        if credit_domain and re.search(r"\bsimul", normalized):
            self._append_unique(tags, "REVIEW_HIGH_IMPACT")
            for question in (
                "Qual politica ou taxa de precificacao deve ser aplicada na simulacao?",
                "Qual metodo de calculo deve ser utilizado e qual e a regra de arredondamento?",
                "Qual e a relacao entre prazo e numero de parcelas?",
                "Quais limites de valor e prazo se aplicam a simulacao?",
            ):
                self._append_unique(questions, question)

        if re.search(r"\bdocumentos? obrigator", normalized):
            self._append_unique(tags, "REVIEW_SCOPE")
            self._append_unique(
                questions,
                "Quais documentos sao obrigatorios e quais formatos, validacoes e criterios de aceite se aplicam?",
            )

        if re.search(r"\b(elegibilidade|limites|politicas? de credito)\b", normalized):
            self._append_unique(tags, "REVIEW_HIGH_IMPACT")
            self._append_unique(
                questions,
                "Quais regras de elegibilidade, limites e politicas sao aplicaveis e qual e sua fonte de configuracao?",
            )

        if re.search(r"\b(bureau\w*|score\w*|integrac\w*)", normalized):
            self._append_unique(tags, "REVIEW_HIGH_IMPACT")
            self._append_unique(
                questions,
                "A integracao com bureau, score ou sistema externo faz parte desta entrega? Se sim, qual servico e qual comportamento esperado?",
            )

        context_questions = refinement_context.setdefault("open_questions", [])
        for question in questions:
            self._append_unique(context_questions, question)
        return refinement_context

    @staticmethod
    def _release_rank(release):
        return {"mvp": 1, "fase 2": 2, "fase 3": 3}.get(str(release or "").strip().lower(), 99)

    @staticmethod
    def _explicit_constraint_facts(evidence_contract):
        """Return constraints explicitly supplied in the project briefing.

        A constraint is not an optional feature suggestion.  It must remain
        traceable to at least one story, even if the product still needs a
        human decision about its detailed implementation.  We intentionally
        extractor. Because that extractor splits list items into independent
        facts, continuation items are also recognized by their explicit
        obligation language (for example, "deve", "devem" or "apenas").
        """
        facts = evidence_contract.get("facts", []) if isinstance(evidence_contract, dict) else []
        return [
            fact for fact in facts
            if isinstance(fact, dict)
            and str(fact.get("id") or "").strip()
            and (
                re.match(r"^\s*constraints\s*:", str(fact.get("text") or ""), re.IGNORECASE)
                or re.search(
                    r"\b(?:deve|devem|precisa|precisam|somente|apenas|nao\s+deve|n[aã]o\s+devem)\b",
                    str(fact.get("text") or ""),
                    re.IGNORECASE,
                )
            )
        ]

    def _uncovered_explicit_constraints(self, contract, evidence_contract):
        """Find briefing constraints that disappeared from the story contract."""
        cited_sources = {
            str(source_id)
            for story in (contract.get("stories", []) if isinstance(contract, dict) else [])
            if isinstance(story, dict)
            for source_id in (story.get("source_ids") or [])
            if str(source_id).strip()
        }
        return [
            fact for fact in self._explicit_constraint_facts(evidence_contract)
            if str(fact.get("id")) not in cited_sources
        ]

    def _lint_backlog_contract(self, contract, evidence_by_id):
        """Return repairable findings; never fabricate a replacement story."""
        findings = []
        stories_by_id = {str(story.get("id") or "").upper(): story for story in contract.get("stories", [])}
        seen_signatures = {}
        seen_journeys = {}
        seen_operational_rules = {}
        for story in contract.get("stories", []):
            story_id = str(story.get("id") or "").upper()
            tags = set(story.get("review_tags") or [])
            goal = str(story.get("goal") or "")
            description = str(story.get("description") or "")
            raw_story = " ".join([str(story.get("actor") or ""), goal, description])
            if re.search(r"</?think>|```|^\s*##\s*(?:historias|user\s+stories)\b", raw_story, re.IGNORECASE | re.MULTILINE):
                findings.append({"story_id": story_id, "code": "contaminated_story_content", "reason": "A historia contem marcadores de raciocinio ou secoes de resposta do modelo."})
            actor = self._canonical_story_actor(story.get("actor"))
            if not actor or actor in {"usuario autorizado", "usuario", "user", "persona"}:
                findings.append({"story_id": story_id, "code": "generic_actor", "reason": "A historia precisa declarar uma persona de negocio especifica."})
            if re.search(r"^\s*como\s+.+?\b(?:eu\s+quero|quero)\b", goal, re.IGNORECASE):
                findings.append({"story_id": story_id, "code": "malformed_story_goal", "reason": "O goal contem a user story completa em vez de uma unica acao."})
            if len(self._compound_story_actions(goal)) > 1 or re.search(r"\b(acompanhar a operacao geral|assegurar a conformidade|garantir a conformidade)\b", f"{goal} {description}", re.IGNORECASE):
                findings.append({"story_id": story_id, "code": "needs_split_or_scope", "reason": "A historia contem escopo composto ou ainda nao observavel."})
            signature = self._story_duplicate_signature(story)
            original_story_id = seen_signatures.get(signature)
            if signature and original_story_id:
                findings.append({"story_id": story_id, "code": "duplicate_story", "reason": f"A historia repete a jornada de {original_story_id}; mantenha somente uma story canonica."})
            elif signature:
                seen_signatures[signature] = story_id
            journey_kind = self._story_journey_kind(story)
            journey_action = self._primary_journey_action(story)
            journey_key = (actor, journey_kind, journey_action)
            story_capabilities = {str(item).upper() for item in story.get("capability_ids", []) if str(item).strip()}
            global_journey_kinds = {"ticket_selection", "ticket_access", "qr_validation", "ticket_reuse_prevention"}
            canonical_journey_story_id = next(
                (
                    item["story_id"] for item in seen_journeys.get(journey_key, [])
                    if journey_kind in global_journey_kinds
                    or (story_capabilities and story_capabilities.intersection(item["capability_ids"]))
                ),
                None,
            )
            if journey_kind and journey_action and canonical_journey_story_id and canonical_journey_story_id != story_id:
                findings.append({"story_id": story_id, "code": "duplicate_business_journey", "reason": f"A historia repete a acao {journey_action} na jornada {journey_kind} de {canonical_journey_story_id}, dentro da mesma capacidade; consolide ou explicite uma fronteira distinta."})
            elif journey_kind and journey_action:
                seen_journeys.setdefault(journey_key, []).append({"story_id": story_id, "capability_ids": story_capabilities})
            unsupported_scope = self._unsupported_product_details(story, evidence_by_id)
            if unsupported_scope:
                findings.append({"story_id": story_id, "code": "unsupported_product_scope", "reason": "O comportamento detalhado nao esta na evidencia citada: " + ", ".join(unsupported_scope) + "."})
            excluded_scope = self._excluded_scope_terms(story, evidence_by_id)
            if excluded_scope:
                findings.append({"story_id": story_id, "code": "excluded_product_scope", "reason": "A historia reintroduz item explicitamente fora do escopo inicial: " + ", ".join(excluded_scope) + "."})
            rule_text = self._semantic_terms(f"{goal} {description}")
            is_maintenance_booking_guard = (
                bool({"manute", "reserv"}.issubset(rule_text))
                and bool(rule_text.intersection({"bloque", "impedi", "nega"}))
            )
            if is_maintenance_booking_guard:
                canonical_story_id = seen_operational_rules.get("maintenance_booking_guard")
                if canonical_story_id:
                    findings.append({
                        "story_id": story_id,
                        "code": "duplicate_operational_rule",
                        "reason": f"A regra de impedir reserva durante manutencao ja esta coberta por {canonical_story_id}; mantenha uma historia para registrar o bloqueio e outra somente se cobrir uma jornada distinta.",
                    })
                else:
                    seen_operational_rules["maintenance_booking_guard"] = story_id
            if "REVIEW_ROLE" in tags:
                findings.append({"story_id": story_id, "code": "role_conflict", "reason": "O ator declarado conflita com o comportamento automatico descrito."})
            actor_normalized = unicodedata.normalize("NFKD", str(story.get("actor") or "")).encode("ascii", "ignore").decode("ascii").lower()
            if re.fullmatch(r"(?:o )?sistema", actor_normalized.strip()):
                findings.append({"story_id": story_id, "code": "system_actor", "reason": "Sistema nao e uma persona de user story; mantenha a automacao como comportamento e use o ator de negocio beneficiado."})
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            selected_evidence = " ".join(evidence_by_id.get(source_id, "") for source_id in story.get("source_ids", []))
            for field in ("inputs", "outputs", "confirmed_rules", "dependencies"):
                for item in context.get(field, []) if isinstance(context.get(field), list) else []:
                    text = str(item)
                    if re.search(r"\b(bureau\w*|score\w*|integrac\w*)", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()) and not re.search(r"\b(bureau\w*|score\w*|integrac\w*)", unicodedata.normalize("NFKD", selected_evidence).encode("ascii", "ignore").decode("ascii").lower()):
                        findings.append({"story_id": story_id, "code": "unconfirmed_context", "reason": f"{field} contem integracao ou dado externo sem evidencia direta: {text}."})
                        break
            for dependency in context.get("dependencies", []) if isinstance(context.get("dependencies"), list) else []:
                target = stories_by_id.get(str(dependency).upper())
                if target and self._release_rank(story.get("release")) < self._release_rank(target.get("release")):
                    findings.append({"story_id": story_id, "code": "release_dependency_conflict", "reason": f"Depende de {dependency} em release posterior."})
        return findings

    @staticmethod
    def _deduplicate_texts(items):
        """Deduplicate user-facing text while treating accents as equivalent."""
        unique, seen = [], set()
        for item in items if isinstance(items, list) else []:
            value = str(item or "").strip()
            normalized = unicodedata.normalize("NFKD", value)
            normalized = "".join(char for char in normalized if not unicodedata.combining(char)).lower()
            if value and normalized not in seen:
                seen.add(normalized)
                unique.append(value)
        return unique

    def _review_backlog_contract(self, contract, evidence_contract, evidence_by_id):
        """Combine static contract rules with the read-only challenger and judge."""
        findings = self._lint_backlog_contract(contract, evidence_by_id)
        uncovered_constraints = self._uncovered_explicit_constraints(contract, evidence_contract)
        for fact in uncovered_constraints:
            findings.append({
                "story_id": None,
                "code": "missing_explicit_constraint_coverage",
                "reason": "Restricao explicita do briefing sem story rastreavel: " + str(fact.get("text") or "").strip(),
                "source_id": str(fact.get("id")),
            })
        challenger = BacklogChallenger().process(contract, evidence_contract)
        seen = {(item.get("story_id"), item.get("code")) for item in findings}
        for finding in challenger.get("findings", []):
            key = (finding.get("story_id"), finding.get("code"))
            if key not in seen:
                findings.append(finding)
                seen.add(key)
        judged = BacklogJudge().process(findings)
        # Questions remain advisory. A proposal for an uncovered declared
        # capability, however, is a real completeness gap and must prevent a
        # PASS until the backlog covers it or the capability is removed.
        judged["proposals"] = challenger.get("proposals", [])
        judged["questions"] = challenger.get("questions", [])
        judged["advisory_recommendations"] = bool(judged["proposals"] or judged["questions"])
        for key in ("domain", "score", "threshold", "dimensions"):
            judged[key] = challenger.get(key)
        # A score below the declared threshold or an uncovered declared
        # capability cannot be published as PASS. These are quality results,
        # not merely UI suggestions; keeping PASS here hid the real readiness
        # state from the backlog review screen.
        if (
            judged.get("decision") == "PASS"
            and (
                (judged.get("score") is not None and judged.get("score", 0) < judged.get("threshold", 80))
                or judged["proposals"]
            )
        ):
            judged["decision"] = "REVISE"
        pending_story_reviews = []
        for story in contract.get("stories", []) if isinstance(contract, dict) else []:
            if not isinstance(story, dict):
                continue
            tags = story.get("review_tags") if isinstance(story.get("review_tags"), list) else []
            blocking_tags = [
                str(tag) for tag in tags
                if str(tag).startswith("REVIEW_") or str(tag) == "PROPOSED_DEFAULT"
            ]
            if blocking_tags:
                pending_story_reviews.append({
                    "story_id": story.get("id"),
                    "code": "story_review_required",
                    "reason": "Story possui pendencias de escopo, evidencia ou testabilidade: " + ", ".join(sorted(set(blocking_tags))),
                })
        if pending_story_reviews:
            judged["findings"] = [*(judged.get("findings") or []), *pending_story_reviews]
            judged["decision"] = "REVISE"
        # The challenger score describes structural health only. A contract
        # can therefore score 100 and still be unpublishable because product
        # decisions or briefing constraints remain unresolved. Persist the two
        # states separately so consumers cannot mistake score for approval.
        judged["readiness"] = {
            "decision": judged.get("decision", "REVISE"),
            "structural_score": judged.get("score"),
            "pending_story_reviews": len(pending_story_reviews),
            "uncovered_explicit_constraints": [
                {"source_id": str(fact.get("id")), "text": str(fact.get("text") or "").strip()}
                for fact in uncovered_constraints
            ],
        }
        return judged

    @staticmethod
    def _policy_area_for_evidence(text):
        """Classify an explicit briefing constraint without changing its meaning.

        The PM must give downstream agents a way to find global constraints
        (for example payment consistency or privacy) without fabricating the
        concrete policy.  The original briefing sentence stays as the policy
        statement and is the only authority for the entry.
        """
        normalized = unicodedata.normalize("NFKD", str(text or ""))
        normalized = "".join(char for char in normalized if not unicodedata.combining(char)).lower()
        areas = (
            ("privacy_and_access", r"\b(?:lgpd|privacidade|dado(?:s)? pessoal|permiss|autentic|autoriz)\b"),
            ("audit_and_retention", r"\b(?:auditoria|rastreab|historico|log|retenc|arquiv)\b"),
            ("payment_and_financial", r"\b(?:pagamento|cobranc|reembolso|estorno|transac)\b"),
            ("availability_and_capacity", r"\b(?:disponib|capacidade|assento|estoque|reserva tempor|venda duplic)\b"),
            ("external_dependency", r"\b(?:integrac|provedor|gateway|extern)\b"),
            ("access_validation", r"\b(?:qr\s*code|qrcode|portaria|validar acesso|ingresso digital)\b"),
        )
        return [area for area, pattern in areas if re.search(pattern, normalized)]

    def _enrich_backlog_handoff(self, contract, evidence_contract):
        """Attach deterministic, evidence-backed PM context for RA and QA.

        This happens after the PM Quality Gate.  It cannot influence a story's
        approved scope, and it never asks the LLM to invent dependencies or
        policies merely to make the handoff look complete.
        """
        if not isinstance(contract, dict):
            return contract
        stories = [story for story in contract.get("stories", []) if isinstance(story, dict)]
        facts = [fact for fact in (evidence_contract or {}).get("facts", []) if isinstance(fact, dict)]
        evidence_by_id = {
            str(fact.get("id") or ""): str(fact.get("text") or "").strip()
            for fact in facts if str(fact.get("id") or "").strip() and str(fact.get("text") or "").strip()
        }

        policy_registry = []
        seen_policy_sources = set()
        for source_id, statement in evidence_by_id.items():
            areas = self._policy_area_for_evidence(statement)
            for area in areas:
                key = (source_id, area)
                if key in seen_policy_sources:
                    continue
                seen_policy_sources.add(key)
                policy_registry.append({
                    "id": f"POL-{len(policy_registry) + 1:02d}",
                    "area": area,
                    "statement": statement,
                    "source_ids": [source_id],
                    "status": "confirmed",
                    "applies_to_story_ids": [],
                })

        story_by_id = {str(story.get("id") or "").upper(): story for story in stories}
        related_by_id = {story_id: [] for story_id in story_by_id}
        for story_id, story in story_by_id.items():
            own_capabilities = {str(item).upper() for item in story.get("capability_ids", []) if str(item).strip()}
            own_sources = {str(item) for item in story.get("source_ids", []) if str(item).strip()}
            own_dependencies = {
                str(item).upper() for item in ((story.get("refinement_context") or {}).get("dependencies") or [])
                if str(item).strip()
            }
            for other_id, other in story_by_id.items():
                if story_id >= other_id:
                    continue
                other_capabilities = {str(item).upper() for item in other.get("capability_ids", []) if str(item).strip()}
                other_sources = {str(item) for item in other.get("source_ids", []) if str(item).strip()}
                other_dependencies = {
                    str(item).upper() for item in ((other.get("refinement_context") or {}).get("dependencies") or [])
                    if str(item).strip()
                }
                shared_capabilities = sorted(own_capabilities & other_capabilities)
                if other_id in own_dependencies or story_id in other_dependencies:
                    relation = "dependency"
                elif shared_capabilities:
                    relation = "same_capability"
                else:
                    # Sharing one broad briefing line is common and is not a
                    # dependency. Keep the handoff intentionally sparse.
                    continue
                shared_sources = sorted(own_sources & other_sources)
                left = {"story_id": other_id, "relation": relation, "shared_capability_ids": shared_capabilities, "shared_source_ids": shared_sources}
                right = {"story_id": story_id, "relation": relation, "shared_capability_ids": shared_capabilities, "shared_source_ids": shared_sources}
                related_by_id[story_id].append(left)
                related_by_id[other_id].append(right)

        for policy in policy_registry:
            policy_terms = self._semantic_terms(policy["statement"])
            policy_sources = set(policy["source_ids"])
            for story_id, story in story_by_id.items():
                story_sources = {str(item) for item in story.get("source_ids", []) if str(item).strip()}
                story_text = " ".join([str(story.get("goal") or ""), str(story.get("description") or "")])
                shared_terms = policy_terms & self._semantic_terms(story_text)
                if (policy_sources & story_sources and shared_terms) or len(shared_terms) >= 3:
                    policy["applies_to_story_ids"].append(story_id)

        for story_id, story in story_by_id.items():
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            story_sources = {str(item) for item in story.get("source_ids", []) if str(item).strip()}
            policy_refs = [
                policy["id"] for policy in policy_registry
                if story_id in policy["applies_to_story_ids"]
            ]
            context["pm_handoff"] = {
                "version": self.PM_HANDOFF_VERSION,
                "source_ids": sorted(story_sources),
                "capability_ids": sorted({str(item).upper() for item in story.get("capability_ids", []) if str(item).strip()}),
                "policy_refs": policy_refs,
                "related_stories": sorted(related_by_id.get(story_id, []), key=lambda item: item["story_id"]),
                "scope_boundary": "Use somente esta jornada; historias relacionadas servem para evitar sobreposicao, nao para absorver comportamento delas.",
            }
            story["refinement_context"] = context

        contract["policy_registry"] = policy_registry
        contract["handoff"] = {
            "version": self.PM_HANDOFF_VERSION,
            "policy_registry_version": 1,
            "story_count": len(stories),
            "evidence_only": True,
        }
        return contract

    @staticmethod
    def _clarification_metadata(question, story_context):
        """Give each clarification a reason and example that match its gap."""
        normalized = unicodedata.normalize("NFKD", str(question or "")) \
            .encode("ascii", "ignore").decode("ascii").lower()
        first_story = story_context[0] if story_context else {}

        if "separar as acoes independentes" in normalized:
            goal = str(first_story.get("goal") or "esta funcionalidade").strip()
            return {
                "reason": "Esta story reúne ações que podem ser planejadas, testadas e aceitas separadamente.",
                "answer_hint": f"Informe se \"{goal}\" deve continuar como uma única entrega ou quais ações devem virar stories separadas.",
            }
        if "resultado de negocio" in normalized:
            benefit = str(first_story.get("benefit") or "o resultado esperado pelo produto").strip()
            return {
                "reason": "O briefing ainda não informa qual resultado de negócio esta entrega deve produzir.",
                "answer_hint": f"Ex.: Esta entrega deve contribuir para {benefit}.",
            }
        if "escopo e a politica" in normalized:
            return {
                "reason": "A story menciona uma regra de alto impacto sem política confirmada no briefing.",
                "answer_hint": "Informe o escopo, quem define a regra e o critério que a valida.",
            }
        return {
            "reason": "A informação é necessária para definir esta story sem assumir uma regra de produto.",
            "answer_hint": "Informe a decisão, regra, limite ou critério que deve ser usado.",
        }

    @staticmethod
    def _is_nonblocking_product_default_question(question):
        """Keep optional scope and presentation choices out of the PM gate."""
        normalized = unicodedata.normalize("NFKD", str(question or "")) \
            .encode("ascii", "ignore").decode("ascii").lower()
        # The model can explicitly label a safe proposal while still placing
        # it in open_questions. That marker is authoritative: it is never a
        # missing decision that should stop backlog generation.
        if re.search(r"proposed[\\s_-]*default", normalized):
            return True
        patterns = (
            r"(?:tipos?|catalogo).{0,45}recursos?",
            r"recursos?.{0,45}(?:projetor|ar condicionado|tecnic)",
            r"capacidade inferior.{0,45}(?:solicit|informad)",
            r"reservas? recorrentes?",
            r"(?:formato|modo).{0,45}(?:lista|calendario)",
            r"(?:lista|calendario).{0,45}(?:visualiz|exib)",
            # Presentation and reporting detail are safe defaults. They can
            # be reviewed later without preventing a coherent first backlog.
            r"(?:lista|calendario|agenda|mapa de calor).{0,45}(?:visualiz|exib|formato)",
            r"(?:visualiz|exib).{0,45}(?:lista|calendario|agenda|mapa de calor)",
            r"(?:formato|modo).{0,45}(?:agenda|lista|calendario|mapa de calor)",
            r"(?:nivel de detalhe|detalhamento).{0,60}(?:registro|historico|alterac|log|auditoria)",
            r"(?:historico|registro|log|auditoria).{0,60}(?:nivel de detalhe|detalhamento|data|autor|campos)",
            # Optional operational policies must remain proposals unless the
            # briefing explicitly establishes one. Do not turn them into a
            # blocking discovery round.
            r"(?:prazo|minimo|antecedencia).{0,55}cancelamento",
            r"(?:cancelamento).{0,55}(?:prazo|minimo|antecedencia)",
            r"(?:alteracao|mudanca).{0,55}(?:sala|horario).{0,55}(?:apenas|ou)",
            r"(?:justificativa).{0,55}(?:obrigator|alterac|administr)",
            r"bloqueio.{0,55}reservas? futuras?",
        )
        return any(re.search(pattern, normalized) for pattern in patterns)

    def _collect_backlog_clarifications(self, contract):
        """Return product questions with the story and evidence needed to answer them."""
        # Backlog synthesis must be able to finish with explicitly labelled
        # proposals. A model-generated open question is not evidence that a
        # human decision blocks delivery; the requirements preflight owns the
        # rare, explicit blocking-question flow. Keep the old collector behind
        # an opt-in for installations that intentionally want that workflow.
        blocking_questions_enabled = str(
            os.getenv("PROJECT_MANAGER_BACKLOG_BLOCKING_CLARIFICATIONS_ENABLED", "0")
        ).strip().lower() in {"1", "true", "yes"}
        if not blocking_questions_enabled:
            return []
        questions_by_text = {}
        evidence_facts = contract.get("evidence", {}).get("facts", []) if isinstance(contract.get("evidence"), dict) else []
        if not evidence_facts:
            evidence_facts = ((self._requirements_contract or {}).get("evidence", {}) or {}).get("facts", [])
        evidence_by_id = {
            str(item.get("id") or ""): str(item.get("text") or "").strip()
            for item in evidence_facts
            if isinstance(item, dict)
        }
        for story in contract.get("stories", []):
            if not isinstance(story, dict):
                continue
            story_id = str(story.get("id") or "").upper()
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            context_evidence = [
                evidence_by_id.get(str(source_id), "")
                for source_id in story.get("source_ids", [])
                if evidence_by_id.get(str(source_id), "")
            ][:2]
            if not context_evidence:
                story_terms = self._semantic_terms(" ".join([str(story.get("goal") or ""), str(story.get("description") or "")]))
                context_evidence = [
                    text for _source_id, text in sorted(
                        evidence_by_id.items(),
                        key=lambda item: len(story_terms & self._semantic_terms(item[1])),
                        reverse=True,
                    )
                    if story_terms & self._semantic_terms(text)
                ][:2]
            story_context = {
                "story_id": story_id,
                "goal": str(story.get("goal") or "").strip(),
                "benefit": str(story.get("benefit") or "").strip(),
                "summary": "Como {actor}, quero {goal}, para {benefit}.".format(
                    actor=str(story.get("actor") or "o usuário").strip(),
                    goal=str(story.get("goal") or "realizar esta ação").strip(),
                    benefit=str(story.get("benefit") or "alcançar o resultado esperado").strip(),
                ),
                "description": str(story.get("description") or "").strip() or None,
                "evidence": context_evidence,
            }
            for question in [*(story.get("open_questions") or []), *(context.get("open_questions") or [])]:
                value = str(question or "").strip()
                normalized = unicodedata.normalize("NFKD", value)
                normalized = "".join(char for char in normalized if not unicodedata.combining(char)).lower()
                if value and not self._is_nonblocking_product_default_question(value):
                    entry = questions_by_text.setdefault(normalized, {"question": value, "story_ids": [], "story_context": []})
                    entry["story_ids"].append(story_id)
                    if not any(context.get("story_id") == story_id for context in entry["story_context"]):
                        entry["story_context"].append(story_context)
        return [
            {
                "id": f"CQ-{index:02d}",
                "question": item["question"],
                "story_ids": sorted(set(item["story_ids"])),
                "story_context": item["story_context"],
                **self._clarification_metadata(item["question"], item["story_context"]),
            }
            for index, item in enumerate(questions_by_text.values(), start=1)
        ][:8]

    def _build_story_repair_prompt(self, contract, evidence_contract, findings, reserved_evidence=None):
        affected_ids = sorted({item["story_id"] for item in findings if item.get("story_id")})
        affected = [story for story in contract.get("stories", []) if str(story.get("id") or "").upper() in affected_ids]
        role_conflict = any(item.get("code") == "role_conflict" for item in findings)
        # A single broken story may need to become multiple atomic stories.
        # Therefore the response envelope must always support a 1-to-N
        # replacement, including when only one story is currently affected.
        response_format = '{"replacements":[{"replace_ids":["US-01"],"stories":[{"id":"US-01","actor":"persona","goal":"acao unica verificavel","benefit":"efeito de negocio","description":"contexto","lane":"foundation|operation|visibility|governance","priority":"high|medium|low","release":"MVP|Fase 2|Fase 3","source_ids":["briefing.1"],"status":"confirmed|proposed|question","review_tags":[],"open_questions":[],"refinement_context":{"inputs":[],"outputs":[],"confirmed_rules":[],"constraints":[],"dependencies":[],"open_questions":[],"acceptance_hints":[],"acceptance_criteria":[{"id":"US-01-CA-01","given":"precondicao","when":"acao","then":"resultado","source_ids":["briefing.1"],"status":"confirmed|proposed"}]}}]}]}'
        return f"""
Voce e um Product Manager senior e deve reparar SOMENTE historias problemáticas de um contrato de backlog.
Nao invente regras, integracoes, limites, calculos ou politicas. Use apenas as evidencias.

EVIDENCIAS: {json.dumps(evidence_contract, ensure_ascii=False)}
ACHADOS: {json.dumps(findings, ensure_ascii=False)}
HISTORIAS A SUBSTITUIR: {json.dumps(affected, ensure_ascii=False)}
EVIDENCIA RESERVADA PARA A SUBSTITUICAO: {json.dumps(reserved_evidence or [], ensure_ascii=False)}

Para cada historia composta, gere historias atomicas separadas. Se "aprovar ou reprovar" forem apenas resultados da mesma acao, reescreva o goal como "registrar a decisao da proposta" e deixe os resultados como cenarios/descricao; nao mantenha os dois verbos no goal. Para conflito de ator, ator generico (usuario, usuario autorizado, persona) ou ator "Sistema", use uma persona de negocio nomeada nas evidencias, como professor ou equipe administrativa, e descreva o comportamento automatico na descricao/regras. Nesse caso, nao use "validar" ou "registrar" como goal de um ator humano quando a descricao disser que o sistema executa essa acao; o goal deve representar consulta, acompanhamento ou decisao efetivamente feita pela persona. Para dependencia de release, ajuste a release ou remova a dependencia nao confirmada. Dados de bureau/score/integracao sem evidencia devem sair de inputs e virar open_questions.
Se o achado for duplicate_story, duplicate_business_journey ou duplicate_operational_rule, substitua somente a story duplicada por uma jornada atomica diferente. A evidencia reservada acima foi selecionada deterministicamente por ainda nao estar coberta pelas outras historias; ela deve ser a fonte principal da substituicao e constar em source_ids. Mantenha o mesmo ID e preserve a story canonica indicada no achado. Nao retorne stories: [] para uma substituicao duplicada quando houver evidencia reservada. Se o achado indicar fluxo confirmado ausente, substitua a historia relacionada por historias atomicas que cubram tambem esse fluxo, sem inventar regras. Remova dependencias inexistentes. Elimine perguntas duplicadas, inclusive quando a diferenca for apenas de acentuacao.
Se uma integracao confirmada estiver sem planejamento, crie uma historia proposta para seu planejamento e deixe em open_questions o servico, os dados trocados, erros e criterio de aceite ainda nao confirmados; nao invente esses detalhes.
{"Este reparo trata conflito de ator: nao devolva REVIEW_ROLE em review_tags; deixe review_tags como [] e descreva apenas o apoio do sistema, nao o sistema executando a acao do ator." if role_conflict else ""}
Mantenha IDs unicos no formato US-XX. Cada historia deve ter todos os campos do contrato, incluindo priority, release, source_ids, status, review_tags, open_questions e refinement_context.
Responda SOMENTE JSON, exatamente neste formato: {response_format}
""".strip()

    def _build_isolated_story_repair_prompt(self, story, evidence_contract, findings, reserved_evidence=None):
        """Build the smallest possible provider request for a story repair.

        Repair responses used to carry a list of replacements.  A provider
        occasionally returned the whole backlog inside every list item, which
        made a local defect capable of duplicating or renumbering unrelated
        stories.  The repair protocol is deliberately a one-story patch.
        """
        story_id = str(story.get("id") or "").strip().upper()
        response_format = (
            '{"replace_id":"US-XX","story":{'
            '"id":"US-XX","actor":"persona","goal":"acao unica verificavel",'
            '"benefit":"efeito de negocio","description":"contexto",'
            '"lane":"foundation|operation|visibility|governance",'
            '"priority":"high|medium|low","release":"MVP|Fase 2|Fase 3",'
            '"source_ids":["briefing.1"],"capability_ids":[],'
            '"status":"confirmed|proposed|question","review_tags":[],"open_questions":[],'
            '"refinement_context":{"inputs":[],"outputs":[],"confirmed_rules":[],'
            '"constraints":[],"dependencies":[],"open_questions":[],"acceptance_hints":[],'
            '"acceptance_criteria":[{"id":"US-XX-CA-01","given":"precondicao",'
            '"when":"acao","then":"resultado verificavel",'
            '"source_ids":["briefing.1"],"status":"confirmed|proposed"}]}}}'
        )
        return f"""
Voce e um Product Manager senior. Repare EXCLUSIVAMENTE a historia {story_id}.
Nao crie, remova, renumere ou altere qualquer outra historia. Nao invente regras,
integracoes, limites, calculos ou politicas: use somente as evidencias recebidas.

HISTORIA-ALVO: {json.dumps(story, ensure_ascii=False)}
ACHADOS DA HISTORIA-ALVO: {json.dumps(findings, ensure_ascii=False)}
EVIDENCIAS DO PROJETO: {json.dumps(evidence_contract, ensure_ascii=False)}
EVIDENCIA RESERVADA (quando houver): {json.dumps(reserved_evidence or [], ensure_ascii=False)}

Corrija somente o achado. Para duplicate_business_journey, produza uma jornada
atomica diferente, baseada na evidencia reservada; preserve a historia canonica.
Para ator generico ou Sistema, use uma persona humana/organizacional confirmada
nas evidencias; comportamento automatico fica na descricao ou no BDD. Cada goal
deve representar uma unica acao verificavel. Preserve campos e dependencias que
continuem validos; remova apenas dependencias sem fundamento.
Se o achado for needs_split_or_scope, REESCREVA a historia como UMA unica
jornada: escolha apenas uma acao principal sustentada pelas evidencias e use um
goal curto com um unico verbo de negocio. Nao una acoes por "e", "ou", virgula,
barra ou enumeracao no goal. Nao use goals como "cadastrar e aprovar", "buscar,
doar e acompanhar" ou "gerenciar campanhas". Resultados automaticos e contexto
podem ficar na descricao ou no criterio BDD, mas nao introduza uma segunda acao
independente. Mantenha o mesmo ID; nao tente resolver esse achado criando uma
segunda story neste protocolo de patch isolado.
Para unsupported_product_scope ou excluded_product_scope, remova do goal, descricao, regras e BDD o detalhe
que nao esta presente nas evidencias citadas (por exemplo filtro, categoria,
comunicacao pos-compra ou lote com preco diferenciado). Mantenha somente a
jornada de negocio que as evidencias confirmam; nao tente justificar o detalhe
com uma tag de revisao.

Responda SOMENTE JSON valido, exatamente neste formato: {response_format}
""".strip()

    def _apply_isolated_story_repair(self, contract, repair, target_story_id):
        """Merge one validated patch without ever touching unrelated stories."""
        target_id = str(target_story_id or "").strip().upper()
        if not re.fullmatch(r"US-\d{2}", target_id):
            raise ValueError("Reparo isolado sem ID de historia valido.")
        if not isinstance(repair, dict) or not isinstance(repair.get("story"), dict):
            raise ValueError("Reparo isolado deve conter replace_id e story.")

        requested_id = str(repair.get("replace_id") or "").strip().upper()
        if requested_id and requested_id != target_id:
            print(json.dumps({
                "event": "project_manager_isolated_repair_id_overridden",
                "requested_id": requested_id,
                "target_id": target_id,
            }, ensure_ascii=False), file=sys.stderr)

        candidate = dict(repair["story"])
        # The target comes from the Quality Gate, never from a provider. This
        # prevents an accidental or malicious response from replacing another
        # story or triggering a global renumbering.
        candidate["id"] = target_id
        candidate = self._normalize_backlog_contract_aliases({"stories": [candidate]}).get("stories", [candidate])[0]
        candidate["id"] = target_id

        required = ("actor", "goal", "benefit", "description", "lane", "priority", "release", "source_ids", "refinement_context")
        missing = [field for field in required if not candidate.get(field)]
        context = candidate.get("refinement_context")
        criteria = context.get("acceptance_criteria") if isinstance(context, dict) else []
        has_bdd = any(
            isinstance(item, dict)
            and str(item.get("given") or "").strip()
            and str(item.get("when") or "").strip()
            and str(item.get("then") or "").strip()
            for item in (criteria if isinstance(criteria, list) else [])
        )
        if missing or not has_bdd:
            details = ", ".join(missing + ([] if has_bdd else ["acceptance_criteria BDD"]))
            raise ValueError(f"Patch isolado incompleto para {target_id}: {details}.")

        stories = list(contract.get("stories") or [])
        target_indexes = [
            index for index, item in enumerate(stories)
            if isinstance(item, dict) and str(item.get("id") or "").strip().upper() == target_id
        ]
        if len(target_indexes) != 1:
            raise ValueError(f"Patch isolado nao encontrou uma unica historia {target_id}.")
        stories[target_indexes[0]] = candidate
        patched = dict(contract)
        patched["stories"] = stories
        patched["coverage"] = None
        return patched

    def _apply_story_repairs(self, contract, repair, affected_story_ids=None):
        def story_lists(value):
            candidates = []
            if isinstance(value, dict):
                for key, child in value.items():
                    if isinstance(child, list) and child and all(isinstance(item, dict) for item in child):
                        if sum(bool((item.get("goal") or item.get("title")) and item.get("actor")) for item in child) >= max(1, len(child) // 2):
                            candidates.append(child)
                    candidates.extend(story_lists(child))
            elif isinstance(value, list):
                for child in value:
                    candidates.extend(story_lists(child))
            return candidates

        def story_objects(value):
            candidates = []
            if isinstance(value, dict):
                if value.get("actor") and (value.get("goal") or value.get("title")):
                    candidates.append(value)
                for child in value.values():
                    candidates.extend(story_objects(child))
            elif isinstance(value, list):
                for child in value:
                    candidates.extend(story_objects(child))
            return candidates

        def replacement_groups(value):
            groups = []
            if isinstance(value, dict):
                if isinstance(value.get("replace_ids"), list) and isinstance(value.get("stories"), list):
                    groups.append(value)
                for child in value.values():
                    groups.extend(replacement_groups(child))
            elif isinstance(value, list):
                for child in value:
                    groups.extend(replacement_groups(child))
            return groups

        scoped_ids = {str(story_id).upper() for story_id in (affected_story_ids or []) if str(story_id).strip()}
        used_scoped_partial = False
        replacements = repair.get("replacements") if isinstance(repair, dict) else None
        if not isinstance(replacements, list):
            # Models commonly wrap the prescribed envelope in `result`,
            # `data` or a singular `replacement` key. Preserve the explicit
            # replace_ids whenever it exists instead of guessing from IDs.
            nested_groups = replacement_groups(repair)
            if nested_groups:
                replacements = nested_groups
        if isinstance(replacements, list):
            replacement_by_id = {}
            has_explicit_replacement = False
            for replacement in replacements:
                if not isinstance(replacement, dict):
                    continue
                ids = {str(value).upper() for value in replacement.get("replace_ids", [])}
                stories = replacement.get("stories") if isinstance(replacement.get("stories"), list) else []
                if scoped_ids:
                    ids &= scoped_ids
                if ids:
                    # Some providers put a full corrected contract inside
                    # every replacement group. Applying that list once per
                    # target replicates stories, eventually producing IDs
                    # beyond US-99. Prefer entries explicitly addressed to
                    # this group; a one-story fallback keeps the repair
                    # bounded when the provider ignored the envelope.
                    if len(stories) > max(1, len(ids)):
                        addressed = [
                            story for story in stories
                            if isinstance(story, dict) and str(story.get("id") or "").upper() in ids
                        ]
                        stories = addressed or stories[:1]
                        print(json.dumps({
                            "event": "project_manager_repair_group_trimmed",
                            "replace_ids": sorted(ids),
                            "received_stories": len(replacement.get("stories") or []),
                            "retained_stories": len(stories),
                        }, ensure_ascii=False), file=sys.stderr)
                    has_explicit_replacement = True
                    replacement_by_id.update({story_id: stories for story_id in ids})
            if not has_explicit_replacement:
                raise ValueError("Reparo da IA sem substituicoes utilizaveis.")
            repaired = []
            for story in contract.get("stories", []):
                story_id = str(story.get("id") or "").upper()
                if story_id in replacement_by_id:
                    repaired.extend(replacement_by_id[story_id])
                else:
                    repaired.append(story)
        else:
            # Several providers ignore the narrow repair envelope and return a
            # complete corrected contract. Accept it only when it is genuinely
            # a full replacement, then run the same semantic validation below.
            candidates = sorted(story_lists(repair), key=len, reverse=True)
            repaired = candidates[0] if candidates else None
            if not repaired:
                # Some models emit {"replacement": {"id": "US-04", ...}}
                # instead of wrapping the repaired story in an array.
                repaired = story_objects(repair)
            if isinstance(repaired, list) and len(repaired) < len(contract.get("stories", [])):
                # A partial response is safe only when each returned story
                # identifies an original story to replace; a single scoped
                # repair may also safely split that one story into 1-to-N.
                if len(scoped_ids) == 1:
                    target_id = next(iter(scoped_ids))
                    repaired = [
                        replacement_story
                        for story in contract.get("stories", [])
                        for replacement_story in (repaired if str(story.get("id") or "").upper() == target_id else [story])
                    ]
                    used_scoped_partial = True
                else:
                    existing = {str(story.get("id") or "").upper(): story for story in contract.get("stories", [])}
                    returned_ids = {str(story.get("id") or "").upper() for story in repaired}
                    if returned_ids and returned_ids.issubset(existing) and all(returned_ids):
                        existing.update({str(story.get("id") or "").upper(): story for story in repaired})
                        repaired = list(existing.values())
            if not isinstance(repaired, list) or len(repaired) < len(contract.get("stories", [])):
                raise ValueError("Reparo da IA sem replacements ou contrato completo de historias.")
        # Some providers ignore the narrow repair prompt and send the whole
        # contract.  Do not let unrelated returned stories undo a replacement
        # that has already been validated in an earlier repair pass.
        if scoped_ids and not isinstance(replacements, list) and not used_scoped_partial:
            replacement_by_id = {
                str(story.get("id") or "").upper(): story
                for story in repaired
                if str(story.get("id") or "").upper() in scoped_ids
            }
            if not replacement_by_id:
                raise ValueError("Reparo da IA nao incluiu a historia solicitada.")
            repaired = [
                replacement_by_id.get(str(story.get("id") or "").upper(), story)
                for story in contract.get("stories", [])
            ]
        aliases = {}
        for index, story in enumerate(repaired, start=1):
            if not str(story.get("goal") or "").strip() and str(story.get("title") or "").strip():
                match = re.match(
                    r"\s*como\s+(.+?),\s*eu\s+quero\s+(.+?)(?:,\s*para\s+(.+?))?\.?\s*$",
                    str(story["title"]),
                    re.IGNORECASE,
                )
                if match:
                    story["actor"] = story.get("actor") or match.group(1).strip()
                    story["goal"] = match.group(2).strip()
                    story["benefit"] = story.get("benefit") or (match.group(3) or "resultado de negocio").strip()
            old_id = str(story.get("id") or "").upper()
            new_id = f"US-{index:02d}"
            aliases.setdefault(old_id, new_id)
            story["id"] = new_id
        for story in repaired:
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            if isinstance(context.get("dependencies"), list):
                context["dependencies"] = [aliases.get(str(item).upper(), str(item)) for item in context["dependencies"]]
        valid_ids = {str(story.get("id") or "").upper() for story in repaired}
        for story in repaired:
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            if isinstance(context.get("dependencies"), list):
                own_id = str(story.get("id") or "").upper()
                context["dependencies"] = self._deduplicate_texts([
                    dependency for dependency in context["dependencies"]
                    if str(dependency).upper() in valid_ids and str(dependency).upper() != own_id
                ])
        contract["stories"] = repaired
        # The AI repair can split a story, invalidating positional coverage.
        # Rebuild it from the repaired source_ids during validation.
        contract["coverage"] = None
        return contract

    def _derive_capabilities_from_stories(self, stories):
        """Build a traceable capability map from an otherwise valid story set.

        This is deliberately a structural recovery only: every capability name
        is an existing story goal and every link comes from the story payload.
        """
        if not isinstance(stories, list):
            return []

        grouped = {}
        next_index = 1
        for raw_story in stories:
            if not isinstance(raw_story, dict):
                continue
            story_id = str(raw_story.get("id") or raw_story.get("story_id") or "").strip().upper()
            name = str(
                raw_story.get("goal")
                or raw_story.get("name")
                or raw_story.get("title")
                or raw_story.get("description")
                or ""
            ).strip()
            if not story_id or not name:
                continue
            source_ids = [str(item).strip() for item in raw_story.get("source_ids", []) if str(item).strip()]
            capability_ids = [
                str(item).strip().upper()
                for item in raw_story.get("capability_ids", [])
                if str(item).strip()
            ]
            if not capability_ids:
                while f"CAP-{next_index:02d}" in grouped:
                    next_index += 1
                capability_ids = [f"CAP-{next_index:02d}"]
                next_index += 1
            for capability_id in capability_ids:
                capability = grouped.setdefault(capability_id, {
                    "id": capability_id,
                    "name": name,
                    "source_ids": [],
                    "story_ids": [],
                })
                capability["source_ids"] = list(dict.fromkeys([*capability["source_ids"], *source_ids]))
                capability["story_ids"] = list(dict.fromkeys([*capability["story_ids"], story_id]))

        return list(grouped.values())[:6]

    def _derive_capabilities_from_epics(self, epics):
        """Recover capabilities from a provider's own epic list.

        Some providers return epics and stories but omit the duplicated
        capability section.  This preserves their supplied scope instead of
        introducing a new product decision or requesting another generation.
        """
        if not isinstance(epics, list):
            return []

        capabilities = []
        for index, raw_epic in enumerate(epics, start=1):
            if isinstance(raw_epic, dict):
                name = str(
                    raw_epic.get("name")
                    or raw_epic.get("title")
                    or raw_epic.get("description")
                    or ""
                ).strip()
                source_ids = [
                    str(item).strip()
                    for item in raw_epic.get("source_ids", [])
                    if str(item).strip()
                ]
                story_ids = [
                    str(item).strip().upper()
                    for item in raw_epic.get("story_ids", [])
                    if str(item).strip()
                ]
            else:
                name = str(raw_epic or "").strip()
                source_ids = []
                story_ids = []
            if not name:
                continue
            capabilities.append({
                "id": f"CAP-{index:02d}",
                "name": name,
                "source_ids": source_ids,
                "story_ids": story_ids,
            })
        return capabilities[:6]

    def _derive_epics_from_capabilities(self, capabilities):
        """Recover the structural epic section from explicit capabilities.

        Epics organize scope; they must not introduce a new requirement. When
        a provider supplied the capability map and stories but skipped the
        redundant epic list, retain each capability's own wording as its epic
        instead of rejecting an otherwise traceable contract or making a
        second provider call.
        """
        if not isinstance(capabilities, list):
            return []

        epics = []
        seen = set()
        for raw_capability in capabilities:
            if isinstance(raw_capability, dict):
                name = str(
                    raw_capability.get("name")
                    or raw_capability.get("title")
                    or raw_capability.get("description")
                    or ""
                ).strip()
            else:
                name = str(raw_capability or "").strip()
            normalized_name = re.sub(r"\s+", " ", name).lower()
            if not name or normalized_name in seen:
                continue
            seen.add(normalized_name)
            epics.append(name)
        return epics[:6]

    def _derive_missing_mvp_slice(self, contract):
        """Restore only the planning envelope when completed stories lack MVP.

        Incremental generation has already validated every story and BDD
        criterion before this point. A missing release label is therefore a
        structural omission, not a reason to regenerate the completed batches.
        The first planned journeys are the only safe deterministic source for
        the initial usable flow; no capability, rule or integration is added.
        """
        releases = contract.get("releases") if isinstance(contract.get("releases"), list) else []
        stories = contract.get("stories") if isinstance(contract.get("stories"), list) else []
        if not stories:
            return False
        release_names = {
            str(item.get("name") or "").strip().lower()
            for item in releases if isinstance(item, dict)
        }
        if "mvp" in release_names:
            return False

        mvp_stories = [
            story for story in stories
            if isinstance(story, dict) and str(story.get("release") or "").strip().lower() == "mvp"
        ]
        if not mvp_stories:
            # Coverage batches are ordered by the approved capability plan.
            # Prefer its foundation/high-priority journeys, preserving their
            # original order, then take the smallest usable prefix.
            indexed = [(index, story) for index, story in enumerate(stories) if isinstance(story, dict)]
            ranked = sorted(
                indexed,
                key=lambda item: (
                    0 if str(item[1].get("lane") or "").strip().lower() == "foundation" else 1,
                    0 if str(item[1].get("priority") or "").strip().lower() in {"high", "urgent"} else 1,
                    item[0],
                ),
            )
            selected_ids = {
                str(story.get("id") or "").upper()
                for _, story in ranked[:min(4, len(ranked))]
            }
            mvp_stories = [
                story for story in stories
                if isinstance(story, dict) and str(story.get("id") or "").upper() in selected_ids
            ]
            for story in mvp_stories:
                story["release"] = "MVP"

        goals = [str(story.get("goal") or "").strip() for story in mvp_stories if str(story.get("goal") or "").strip()]
        contract["releases"] = [
            *releases,
            {
                "name": "MVP",
                "focus": "Primeiro fluxo utilizavel composto por: " + "; ".join(goals[:3]),
                "deferred": "As demais historias validadas permanecem para fases posteriores do plano.",
            },
        ]
        print(json.dumps({
            "event": "project_manager_mvp_slice_derived",
            "story_ids": [str(story.get("id") or "") for story in mvp_stories],
        }, ensure_ascii=False), file=sys.stderr)
        return True

    @staticmethod
    def _infer_contract_lane(story):
        """Map an unsupported model label using the story's observable action."""
        text = " ".join(str(story.get(key) or "") for key in ("goal", "description")).lower()
        if re.search(r"\b(aprovar|reprovar|validar|autorizar|bloquear|auditar|permiss)", text):
            return "governance"
        if re.search(r"\b(consultar|visualizar|listar|buscar|acompanhar|agenda|relatorio|painel)", text):
            return "visibility"
        if re.search(r"\b(criar|cadastrar|configurar|definir|registrar.*sala|registrar.*recurso)", text):
            return "foundation"
        return "operation"

    def _normalize_backlog_contract_aliases(self, contract):
        """Canonicalize known provider field aliases before strict validation."""
        normalized = dict(contract)
        def normalize_key(value):
            return re.sub(
                r"[^a-z0-9]+", "_",
                unicodedata.normalize("NFKD", str(value or ""))
                .encode("ascii", "ignore").decode("ascii").lower(),
            ).strip("_")

        containers = (
            "backlog", "backlog_contract", "project_backlog",
            "backlog_do_projeto", "resultado_do_backlog", "resultado", "result",
        )
        canonical_fields = {
            "overview": ("summary", "resumo", "visao_geral", "visão_geral"),
            "capabilities": (
                "product_capabilities", "productCapabilities", "capacidades",
                "capacidades_do_produto", "features", "functionalities",
                "funcionalidades", "functional_requirements",
                "requisitos_funcionais", "modules", "modulos",
            ),
            "epics": ("recommended_epics", "epicos", "épicos", "epicos_recomendados"),
            "releases": ("release_slices", "releaseSlices", "fatias_de_release", "fatias_release"),
            "stories": ("user_stories", "userStories", "historias", "histórias", "backlog_items", "items"),
        }

        # A few models wrap an otherwise valid contract in a result object.
        # Prefer that object only when it supplies recognized contract fields.
        normalized_key_lookup = {normalize_key(key): key for key in normalized}
        for container_name in containers:
            nested = normalized.get(normalized_key_lookup.get(normalize_key(container_name)))
            if not isinstance(nested, dict):
                continue
            nested_matches = sum(
                field in nested or any(alias in nested for alias in aliases)
                for field, aliases in canonical_fields.items()
            )
            root_matches = sum(
                field in normalized or any(alias in normalized for alias in aliases)
                for field, aliases in canonical_fields.items()
            )
            if nested_matches > root_matches:
                normalized.update(nested)

        normalized_key_lookup = {normalize_key(key): key for key in normalized}
        aliases_applied = []
        for field, aliases in canonical_fields.items():
            current = normalized.get(field)
            if current not in (None, "", []):
                continue
            for alias in aliases:
                value = normalized.get(normalized_key_lookup.get(normalize_key(alias)))
                if value not in (None, "", []):
                    normalized[field] = value
                    aliases_applied.append(f"{alias}->{field}")
                    break
        # OpenRouter models sometimes model capabilities as an object keyed by
        # identifier (or as a single text value) instead of an array.  The
        # content is still explicit, so normalize that presentation rather
        # than rejecting a complete backlog on this non-semantic difference.
        raw_capabilities = normalized.get("capabilities")
        if isinstance(raw_capabilities, dict):
            direct_fields = {"id", "name", "title", "label", "feature", "functionality", "text", "description"}
            if direct_fields.intersection(raw_capabilities):
                normalized["capabilities"] = [raw_capabilities]
            else:
                converted = []
                for capability_id, value in raw_capabilities.items():
                    if isinstance(value, dict):
                        converted.append({"id": capability_id, **value})
                    elif str(value or "").strip():
                        converted.append({"id": capability_id, "name": str(value).strip()})
                normalized["capabilities"] = converted
            aliases_applied.append("object->capabilities")
        elif isinstance(raw_capabilities, str) and raw_capabilities.strip():
            normalized["capabilities"] = [
                item.strip(" -•\t")
                for item in re.split(r"[\n;]+", raw_capabilities)
                if item.strip(" -•\t")
            ]
            aliases_applied.append("text->capabilities")
        # Some providers return the release allocation as a map, for example
        # {"MVP": ["CAP-01", "CAP-02"]}, instead of the verbose release
        # objects requested by the contract. The allocation is explicit
        # planning data, so preserve it and only supply the structural fields
        # needed by the renderer; do not ask another provider to restate it.
        raw_releases = normalized.get("releases")
        if isinstance(raw_releases, dict):
            converted_releases = []
            for release_name, value in raw_releases.items():
                name = str(release_name or "").strip()
                if not name:
                    continue
                if isinstance(value, dict):
                    converted_releases.append({"name": name, **value})
                    continue
                allocated = [str(item).strip() for item in value if str(item).strip()] if isinstance(value, list) else []
                focus = (
                    "Capacidades planejadas: " + ", ".join(allocated)
                    if allocated else str(value or "").strip()
                )
                if not focus:
                    focus = "Entregas planejadas nesta fase."
                converted_releases.append({
                    "name": name,
                    "focus": focus,
                    "deferred": "Fases posteriores nao foram definidas no plano.",
                })
            normalized["releases"] = converted_releases
            aliases_applied.append("object->releases")
        elif isinstance(raw_releases, str) and raw_releases.strip():
            normalized["releases"] = [{
                "name": "MVP",
                "focus": raw_releases.strip(),
                "deferred": "Fases posteriores nao foram definidas no plano.",
            }]
            aliases_applied.append("text->releases")
        # Structured plans often use a descriptive release title (for example
        # "MVP - Fluxo principal") and fields goal/scope. Canonicalize those
        # presentation aliases before the strict release gate; the plan is
        # explicit and no business scope is inferred here.
        if isinstance(normalized.get("releases"), list):
            canonical_releases = []
            for release in normalized["releases"]:
                if isinstance(release, str):
                    release = {"name": release}
                if not isinstance(release, dict):
                    continue
                item = dict(release)
                raw_name = str(item.get("name") or item.get("release") or item.get("phase") or item.get("title") or "").strip()
                normalized_name = normalize_key(raw_name).replace("_", " ")
                if normalized_name == "mvp" or normalized_name.startswith("mvp "):
                    item["name"] = "MVP"
                elif re.match(r"^fase\s*2\b", normalized_name):
                    item["name"] = "Fase 2"
                elif re.match(r"^fase\s*3\b", normalized_name):
                    item["name"] = "Fase 3"
                elif raw_name:
                    item["name"] = raw_name
                if not str(item.get("focus") or "").strip():
                    focus = str(item.get("goal") or "").strip()
                    if not focus and isinstance(item.get("scope"), list):
                        focus = "Inclui: " + "; ".join(str(value).strip() for value in item["scope"] if str(value).strip())
                    item["focus"] = focus or "Entregas planejadas nesta fase."
                if not str(item.get("deferred") or "").strip():
                    item["deferred"] = "Fases posteriores do plano permanecem fora desta fatia."
                canonical_releases.append(item)
            normalized["releases"] = canonical_releases
            if canonical_releases:
                aliases_applied.append("release-title-goal-scope->canonical")
        # Providers frequently use camelCase only inside stories. Normalize
        # those nested objects before validation so a valid acceptanceCriteria
        # list is not silently converted into an empty refinement context.
        for story in normalized.get("stories", []) if isinstance(normalized.get("stories"), list) else []:
            if not isinstance(story, dict):
                continue
            story_lookup = {normalize_key(key): key for key in story}
            for canonical, aliases in {
                "id": ("storyId", "story_id", "identifier"),
                "source_ids": ("sourceIds", "sources"),
                "capability_ids": ("capabilityIds", "capabilities"),
                "release": ("releaseName", "release_slice", "releaseSlice", "phase"),
                "review_tags": ("reviewTags",),
                "open_questions": ("openQuestions", "questions"),
                "refinement_context": ("refinementContext", "refinement", "contexto_refinamento"),
            }.items():
                if story.get(canonical) not in (None, "", []):
                    continue
                for alias in aliases:
                    value = story.get(story_lookup.get(normalize_key(alias)))
                    if value not in (None, "", []):
                        story[canonical] = value
                        aliases_applied.append(f"story.{alias}->{canonical}")
                        break

            raw_release = str(story.get("release") or "").strip()
            normalized_release = normalize_key(raw_release).replace("_", " ")
            if normalized_release == "mvp" or normalized_release.startswith("mvp "):
                story["release"] = "MVP"
                if raw_release != "MVP":
                    aliases_applied.append("story.release->MVP")
            elif re.match(r"^fase\s*2\b", normalized_release):
                story["release"] = "Fase 2"
                if raw_release != "Fase 2":
                    aliases_applied.append("story.release->Fase 2")
            elif re.match(r"^fase\s*3\b", normalized_release):
                story["release"] = "Fase 3"
                if raw_release != "Fase 3":
                    aliases_applied.append("story.release->Fase 3")

            context = story.get("refinement_context")
            if not isinstance(context, dict):
                continue
            context_lookup = {normalize_key(key): key for key in context}
            for canonical, aliases in {
                "acceptance_criteria": ("acceptanceCriteria", "criteria_aceitacao", "criterios_de_aceite"),
                "open_questions": ("openQuestions",),
                "confirmed_rules": ("confirmedRules",),
                "acceptance_hints": ("acceptanceHints",),
            }.items():
                if context.get(canonical) not in (None, "", []):
                    continue
                for alias in aliases:
                    value = context.get(context_lookup.get(normalize_key(alias)))
                    if value not in (None, "", []):
                        context[canonical] = value
                        aliases_applied.append(f"context.{alias}->{canonical}")
                        break
            for criterion in context.get("acceptance_criteria", []) if isinstance(context.get("acceptance_criteria"), list) else []:
                if not isinstance(criterion, dict):
                    continue
                criterion_lookup = {normalize_key(key): key for key in criterion}
                for canonical, aliases in {
                    "source_ids": ("sourceIds", "sources"),
                    "given": ("precondition",),
                    "when": ("action",),
                    "then": ("outcome", "result"),
                }.items():
                    if criterion.get(canonical) not in (None, "", []):
                        continue
                    for alias in aliases:
                        value = criterion.get(criterion_lookup.get(normalize_key(alias)))
                        if value not in (None, "", []):
                            criterion[canonical] = value
                            aliases_applied.append(f"criterion.{alias}->{canonical}")
                            break
        if aliases_applied:
            print(
                json.dumps({
                    "event": "project_manager_contract_aliases_normalized",
                    "aliases": aliases_applied,
                }, ensure_ascii=False),
                file=sys.stderr,
            )
        return normalized

    def _validate_backlog_contract(self, contract, evidence_contract=None):
        if not isinstance(contract, dict):
            raise ValueError("Contrato de backlog deve ser um objeto JSON.")
        contract = self._normalize_backlog_contract_aliases(contract)
        # Providers occasionally omit the descriptive overview while returning
        # an otherwise complete contract. Derive a concise, evidence-only
        # summary so a formatting omission does not consume the retry budget.
        # This is not a business fallback: it reuses the longest confirmed
        # briefing fact and never introduces a new capability or rule.
        if not str(contract.get("overview") or "").strip():
            facts = [
                str(item.get("text") or "").strip()
                for item in (evidence_contract or {}).get("facts", [])
                if isinstance(item, dict) and str(item.get("text") or "").strip()
            ]
            if facts:
                summary = max(facts, key=len)
                contract["overview"] = summary[:320].rstrip(" .,;:") + ("." if len(summary) <= 320 else "...")
        # Free/OpenRouter models occasionally return a complete story map but
        # omit the redundant capability section. Recover it deterministically
        # from the delivered stories instead of spending another generation.
        # Names, source links and story links are copied from model output;
        # this does not invent product scope.
        if not isinstance(contract.get("capabilities"), list) or not contract.get("capabilities"):
            derived_capabilities = self._derive_capabilities_from_stories(contract.get("stories"))
            if not derived_capabilities:
                derived_capabilities = self._derive_capabilities_from_epics(contract.get("epics"))
            if derived_capabilities:
                contract["capabilities"] = derived_capabilities
                print(
                    json.dumps({
                        "event": "project_manager_capabilities_derived",
                        "count": len(derived_capabilities),
                    }, ensure_ascii=False),
                    file=sys.stderr,
                )
        # A few models omit only the redundant epic section while providing a
        # complete capability map and stories. Reuse capability wording as the
        # thematic grouping; this is structural normalization, not scope
        # inference.
        if not isinstance(contract.get("epics"), list) or not contract.get("epics"):
            derived_epics = self._derive_epics_from_capabilities(contract.get("capabilities"))
            if derived_epics:
                contract["epics"] = derived_epics
                print(
                    json.dumps({
                        "event": "project_manager_epics_derived",
                        "count": len(derived_epics),
                    }, ensure_ascii=False),
                    file=sys.stderr,
                )
        # Do this before release filtering. A provider can return all planned
        # stories and later-phase labels while omitting only the MVP release
        # object; rebuilding it from those validated stories avoids throwing
        # away a complete incremental checkpoint.
        self._derive_missing_mvp_slice(contract)
        required_text = ("overview",)
        required_lists = ("capabilities", "epics", "releases", "stories")
        for key in required_text:
            if not isinstance(contract.get(key), str) or not contract[key].strip():
                raise ValueError(f"Contrato sem {key}.")
        for key in required_lists:
            if not isinstance(contract.get(key), list) or not contract[key]:
                raise ValueError(f"Contrato sem lista {key}.")
        raw_story_releases = {
            str(story.get("release") or "").strip().lower()
            for story in contract.get("stories", []) if isinstance(story, dict)
        }
        # A model may return its generic roadmap template even when no story
        # is assigned to a later phase. Remove those empty slices before
        # validating their descriptive fields; they are not product scope.
        contract["releases"] = [
            release for release in contract["releases"]
            if isinstance(release, dict)
            and (
                str(release.get("name") or "").strip().lower() == "mvp"
                or str(release.get("name") or "").strip().lower() in raw_story_releases
            )
        ]
        releases_by_name = {str(item.get("name") or "").strip().lower(): item for item in contract["releases"] if isinstance(item, dict)}
        if "mvp" not in releases_by_name:
            raise ValueError("Contrato sem fatia MVP.")
        unknown_releases = set(releases_by_name) - {"mvp", "fase 2", "fase 3"}
        if unknown_releases:
            raise ValueError("Contrato possui fatia de release desconhecida.")
        for release_name, release in releases_by_name.items():
            if not str(release.get("focus") or "").strip() or not str(release.get("deferred") or "").strip():
                raise ValueError(f"Contrato sem foco ou diferimento para {release_name.upper()}.")
        stories = contract["stories"]
        min_stories, max_stories = self.STORY_RANGE
        if not min_stories <= len(stories) <= max_stories:
            raise ValueError(f"Contrato possui {len(stories)} historias; esperado entre {min_stories} e {max_stories}.")
        seen_ids = set()
        evidence_by_id = {
            str(fact.get("id")): str(fact.get("text") or "")
            for fact in (evidence_contract or {}).get("facts", [])
            if isinstance(fact, dict) and fact.get("id")
        }
        evidence_ids = set(evidence_by_id)
        evidence_source_aliases = {}
        for source_id in evidence_ids:
            match = re.fullmatch(r"briefing\.(\d+)", source_id, re.IGNORECASE)
            if not match:
                continue
            number = int(match.group(1))
            evidence_source_aliases[f"REQ-{number}"] = source_id
            evidence_source_aliases[f"REQ-{number:02d}"] = source_id

        # Normalize capabilities into stable, traceable objects. Older
        # providers returned plain strings; keeping the normalization here
        # makes the contract backward compatible while giving the Challenger
        # deterministic IDs to validate.
        normalized_capabilities = []
        for index, raw_capability in enumerate(contract["capabilities"], start=1):
            if isinstance(raw_capability, dict):
                capability = dict(raw_capability)
                name = str(
                    capability.get("name")
                    or capability.get("title")
                    or capability.get("label")
                    or capability.get("feature")
                    or capability.get("functionality")
                    or capability.get("text")
                    or capability.get("description")
                    or ""
                ).strip()
            else:
                capability = {}
                name = str(raw_capability or "").strip()
            if not name:
                continue
            capability["id"] = str(capability.get("id") or f"CAP-{index:02d}").upper()
            capability["name"] = name
            raw_capability_sources = capability.get("source_ids")
            explicit_sources = [str(item).strip() for item in raw_capability_sources if str(item).strip()] if isinstance(raw_capability_sources, list) else []
            capability["source_ids"] = [item for item in explicit_sources if item in evidence_ids]
            raw_capability_story_ids = capability.get("story_ids")
            capability["story_ids"] = [str(item).strip().upper() for item in raw_capability_story_ids if str(item).strip()] if isinstance(raw_capability_story_ids, list) else []
            raw_prerequisites = capability.get("prerequisite_capability_ids")
            capability["prerequisite_capability_ids"] = [
                str(item).strip().upper() for item in raw_prerequisites if str(item).strip()
            ] if isinstance(raw_prerequisites, list) else []
            normalized_capabilities.append(capability)
        if not normalized_capabilities:
            raise ValueError("Contrato sem capacidades validas.")
        contract["capabilities"] = normalized_capabilities
        capability_ids = {item["id"] for item in normalized_capabilities}
        for capability in normalized_capabilities:
            # Prerequisites are planning relations generated with the product
            # plan, not business rules. Keep only known sibling capabilities.
            capability["prerequisite_capability_ids"] = sorted({
                item for item in capability["prerequisite_capability_ids"]
                if item in capability_ids and item != capability["id"]
            })

        for story in stories:
            if not isinstance(story, dict):
                raise ValueError("Historia do contrato deve ser um objeto.")
            missing = [key for key in ("id", "actor", "goal", "benefit", "description", "lane") if not str(story.get(key) or "").strip()]
            if missing:
                raise ValueError(f"Historia sem campos obrigatorios: {', '.join(missing)}.")
            story["actor"] = self._canonical_story_actor(story.get("actor"))
            # Providers sometimes localize lane names (fundação/operação etc.).
            # Canonicalize them before validating MVP foundation coverage.
            lane_key = unicodedata.normalize("NFKD", str(story.get("lane") or ""))\
                .encode("ascii", "ignore").decode("ascii").strip().lower().replace("_", "-")
            lane_aliases = {
                "fundacao": "foundation", "foundation": "foundation",
                "operacao": "operation", "operation": "operation",
                "gestao": "visibility", "visibilidade": "visibility", "visibility": "visibility",
                "executive-cockpit": "visibility", "executive cockpit": "visibility",
                "cockpit": "visibility", "dashboard": "visibility", "painel": "visibility",
                "governanca": "governance", "governance": "governance",
            }
            story["lane"] = lane_aliases.get(lane_key, lane_key)
            if story["lane"] not in {"foundation", "operation", "visibility", "governance"}:
                inferred_lane = self._infer_contract_lane(story)
                print(json.dumps({
                    "event": "project_manager_lane_inferred",
                    "story_id": str(story.get("id") or ""),
                    "provided_lane": story["lane"],
                    "inferred_lane": inferred_lane,
                }, ensure_ascii=False), file=sys.stderr)
                story["lane"] = inferred_lane
            story_id = str(story["id"]).strip().upper()
            if not re.fullmatch(r"US-\d{2}", story_id) or story_id in seen_ids:
                raise ValueError("IDs de historia devem ser unicos no formato US-XX.")
            seen_ids.add(story_id)
            story["capability_ids"] = [
                str(item).strip().upper()
                for item in (story.get("capability_ids") or [])
                if str(item).strip()
            ]
            story = self._canonicalize_decision_outcomes(story)
            raw_story_sources = story.get("source_ids")
            source_ids = [
                evidence_source_aliases.get(str(item).strip().upper(), str(item).strip())
                for item in raw_story_sources if str(item).strip()
            ] if isinstance(raw_story_sources, list) else []
            # Downstream evidence guards read the normalized story object.
            # Persist the safe list before invoking them so a provider's
            # `source_ids: null` cannot escape this validation boundary.
            story["source_ids"] = source_ids
            if any(source_id not in evidence_ids for source_id in source_ids):
                raise ValueError("Historia referencia evidencia inexistente.")
            status = str(story.get("status") or "").strip().lower()
            raw_review_tags = story.get("review_tags")
            tags = [
                str(item).strip()
                for item in raw_review_tags
                if str(item).strip() and str(item).strip() != "REVIEW_ROLE"
            ] if isinstance(raw_review_tags, list) else []
            questions = self._deduplicate_texts(story.get("open_questions", []))
            if status not in {"confirmed", "proposed", "question"}:
                status = "confirmed" if source_ids else "proposed"
            if status == "confirmed" and not source_ids:
                status = "proposed"
                tags.append("REVIEW_EVIDENCE")
            direct_evidence = self._has_direct_business_evidence(story, evidence_by_id) if source_ids else False
            unsupported_details = self._unsupported_sensitive_details(story, evidence_by_id) if source_ids else []
            unsupported_scope_details = self._unsupported_product_details(story, evidence_by_id) if source_ids else []
            if status == "confirmed" and source_ids and not direct_evidence:
                status = "proposed"
                tags.append("REVIEW_EVIDENCE")
                # The briefing can already establish the product outcome even
                # when this story's detailed behaviour is only proposed. In
                # that case, keep it reviewable but do not ask the user to
                # repeat a project-level decision for every story.
                if not questions and not self._has_project_business_outcome_evidence(evidence_by_id):
                    questions.append("Qual resultado de negocio esta historia precisa entregar?")
            if unsupported_details:
                status = "proposed"
                tags.extend(["REVIEW_SCOPE", "REVIEW_HIGH_IMPACT"])
                if not questions:
                    questions.append("Confirmar o escopo e a politica aplicavel para: " + ", ".join(unsupported_details) + ".")
            if unsupported_scope_details:
                status = "proposed"
                tags.extend(["REVIEW_EVIDENCE", "REVIEW_SCOPE"])
                if not questions:
                    questions.append("Confirmar se faz parte do escopo: " + ", ".join(unsupported_scope_details) + ".")
            if self._is_high_impact_statement(" ".join([story.get("goal", ""), story.get("description", "")])) and not source_ids:
                status = "proposed"
                tags.append("REVIEW_HIGH_IMPACT")
            refinement_context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            # Keep a stable hand-off shape even when the model has no evidence
            # for a field. Empty lists mean unknown, never an inferred rule.
            refinement_context = {
                "inputs": refinement_context.get("inputs") if isinstance(refinement_context.get("inputs"), list) else [],
                "outputs": refinement_context.get("outputs") if isinstance(refinement_context.get("outputs"), list) else [],
                "confirmed_rules": refinement_context.get("confirmed_rules") if isinstance(refinement_context.get("confirmed_rules"), list) else [],
                "constraints": refinement_context.get("constraints") if isinstance(refinement_context.get("constraints"), list) else [],
                "dependencies": refinement_context.get("dependencies") if isinstance(refinement_context.get("dependencies"), list) else [],
                "open_questions": refinement_context.get("open_questions") if isinstance(refinement_context.get("open_questions"), list) else [],
                "acceptance_hints": refinement_context.get("acceptance_hints") if isinstance(refinement_context.get("acceptance_hints"), list) else [],
                "acceptance_criteria": refinement_context.get("acceptance_criteria") if isinstance(refinement_context.get("acceptance_criteria"), list) else [],
            }
            if not refinement_context["acceptance_criteria"]:
                # Do not fabricate testability from the story sentence. The
                # model must supply an explicit, reviewable acceptance rule.
                tags.append("REVIEW_ACCEPTANCE_CRITERIA")
            refinement_context = self._apply_story_quality_guardrails(story, tags, questions, refinement_context)
            if "REVIEW_SCOPE" in tags:
                status = "proposed"
            default_questions = [
                question for question in [*questions, *(refinement_context.get("open_questions") or [])]
                if self._is_nonblocking_product_default_question(question)
            ]
            if default_questions:
                # Defaults such as a conventional screen layout, a configurable
                # resource catalog or an explicitly deferred capability are
                # proposals, not missing business decisions. Keep their status
                # visible to reviewers without forcing an elicitation round.
                tags.append("PROPOSED_DEFAULT")
                questions = [question for question in questions if not self._is_nonblocking_product_default_question(question)]
                refinement_context["open_questions"] = [
                    question for question in refinement_context.get("open_questions", [])
                    if not self._is_nonblocking_product_default_question(question)
                ]
            refinement_context["open_questions"] = self._deduplicate_texts(refinement_context.get("open_questions", []))
            # A model may conservatively label a fully evidenced story as a
            # proposal. Once its behavior is traceable and there is no open or
            # sensitive business decision, promote the delivery status rather
            # than forcing a human to approve an already confirmed fact.
            if (
                status == "proposed"
                and source_ids
                and direct_evidence
                and not unsupported_details
                and not unsupported_scope_details
                and "REVIEW_SCOPE" not in tags
                and not questions
                and not refinement_context["open_questions"]
            ):
                status = "confirmed"
            source_text = " ".join(evidence_by_id.get(source_id, "") for source_id in source_ids)
            normalized_source = unicodedata.normalize("NFKD", source_text).encode("ascii", "ignore").decode("ascii").lower()
            traceability = {}
            for field in ("inputs", "outputs", "confirmed_rules", "constraints", "dependencies", "acceptance_hints"):
                values = refinement_context.get(field, [])
                retained = []
                traceability[field] = []
                for value in values if isinstance(values, list) else []:
                    value_text = str(value).strip()
                    normalized_value = unicodedata.normalize("NFKD", value_text).encode("ascii", "ignore").decode("ascii").lower()
                    external_detail = bool(re.search(r"\b(bureau\w*|score\w*|integrac\w*)", normalized_value))
                    if external_detail and not re.search(r"\b(bureau\w*|score\w*|integrac\w*)", normalized_source):
                        self._append_unique(questions, f"Confirmar evidencia e escopo para: {value_text}.")
                        self._append_unique(refinement_context["open_questions"], f"Confirmar evidencia e escopo para: {value_text}.")
                        self._append_unique(tags, "REVIEW_EVIDENCE")
                        continue
                    retained.append(value)
                    direct_terms = self._semantic_terms(value_text) & self._semantic_terms(source_text)
                    traceability[field].append({
                        "text": value_text,
                        "source_ids": source_ids,
                        "status": "confirmed" if len(direct_terms) >= 2 else ("derived" if source_ids else "proposed"),
                    })
                refinement_context[field] = retained
            criteria = []
            raw_criteria = refinement_context.get("acceptance_criteria")
            for index, criterion in enumerate(raw_criteria if isinstance(raw_criteria, list) else [], start=1):
                if not isinstance(criterion, dict):
                    continue
                given = str(criterion.get("given") or "").strip()
                when = str(criterion.get("when") or "").strip()
                then = str(criterion.get("then") or "").strip()
                if not (given and when and then):
                    continue
                criteria.append({
                    "id": str(criterion.get("id") or f"{story_id}-CA-{index:02d}"),
                    "given": given,
                    "when": when,
                    "then": then,
                    "source_ids": [item for item in criterion.get("source_ids") if item in evidence_ids] if isinstance(criterion.get("source_ids"), list) else source_ids,
                    "status": str(criterion.get("status") or ("confirmed" if source_ids else "proposed")),
                })
            refinement_context["acceptance_criteria"] = criteria
            refinement_context["traceability"] = traceability
            review_required = (
                not criteria
                or any(str(tag).startswith("REVIEW_") or str(tag) == "PROPOSED_DEFAULT" for tag in tags)
            )
            if review_required:
                status = "proposed"
                self._append_unique(tags, "REVIEW_REQUIRED")
            if self._clarifications_answered:
                # Clarifications belong to the dialogue, never to a story
                # delivered to the board. The answered briefing remains the
                # evidence source; this only removes the review residue.
                questions = []
                refinement_context["open_questions"] = []
                tags = [tag for tag in tags if not str(tag).startswith("REVIEW_")]
            if status != "confirmed" and not tags and not self._clarifications_answered:
                tags.append("REVIEW_SCOPE")
            story["source_ids"] = source_ids
            story["status"] = status
            story["review_tags"] = sorted(set(tags))
            story["open_questions"] = self._deduplicate_texts(questions)
            story["priority"] = str(story.get("priority") or self._story_priority_for_lane(story.get("lane"))).lower()
            if story["priority"] not in {"low", "medium", "high", "urgent"}:
                story["priority"] = self._story_priority_for_lane(story.get("lane"))
            story["release"] = str(story.get("release") or self._story_release_for_lane(story.get("lane"))).strip()
            story["refinement_context"] = refinement_context
        # Automatic system outcomes belong to the BDD of the journey that
        # triggers them, not to a pseudo-story with a passive human actor.
        stories = self._merge_automatic_outcome_stories(stories)
        contract["stories"] = stories
        # Complete the capability matrix after story IDs are canonicalized.
        story_by_id = {str(story.get("id")).upper(): story for story in stories}
        for capability in contract["capabilities"]:
            cap_terms = self._semantic_terms(capability["name"])
            if not capability["source_ids"] and cap_terms:
                capability["source_ids"] = [
                    source_id for source_id, source_text in evidence_by_id.items()
                    if len(cap_terms & self._semantic_terms(source_text)) >= max(1, min(2, len(cap_terms)))
                ][:6]
            valid_cap_id = capability["id"]
            linked = [
                story_id for story_id, story in story_by_id.items()
                if valid_cap_id in story.get("capability_ids", [])
            ]
            if not linked and cap_terms:
                linked = [
                    story_id for story_id, story in story_by_id.items()
                    if len(cap_terms & self._semantic_terms(f"{story.get('goal', '')} {story.get('description', '')}"))
                    >= max(1, min(2, len(cap_terms)))
                ]
            capability["story_ids"] = sorted(set(linked))
            for story_id in linked:
                story_by_id[story_id].setdefault("capability_ids", [])
                if valid_cap_id not in story_by_id[story_id]["capability_ids"]:
                    story_by_id[story_id]["capability_ids"].append(valid_cap_id)
            capability["story_ids"] = sorted(set(capability["story_ids"]))
        capabilities_by_id = {capability["id"]: capability for capability in contract["capabilities"]}
        story_order = {str(story.get("id") or "").upper(): index for index, story in enumerate(stories)}
        for story in stories:
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            prerequisite_capabilities = {
                prerequisite
                for capability_id in story.get("capability_ids", [])
                for prerequisite in capabilities_by_id.get(capability_id, {}).get("prerequisite_capability_ids", [])
            }
            derived_dependencies = []
            for capability_id in sorted(prerequisite_capabilities):
                candidates = capabilities_by_id.get(capability_id, {}).get("story_ids", [])
                prerequisite_story = next((candidate for candidate in candidates if candidate != story["id"]), None)
                if prerequisite_story:
                    derived_dependencies.append(prerequisite_story)
            explicit_dependencies = [
                str(item).upper() for item in context.get("dependencies", [])
                if str(item).upper() in story_by_id
                and str(item).upper() != story["id"]
                and story_order.get(str(item).upper(), -1) < story_order.get(str(story.get("id") or "").upper(), 0)
            ]
            context["dependencies"] = sorted(set([*explicit_dependencies, *derived_dependencies]))
            if derived_dependencies:
                context["dependency_source"] = "capability_plan"
            story["refinement_context"] = context
        self._enforce_mvp_scope(stories, evidence_contract)
        self._normalize_release_dependencies(stories)
        # Release slices describe planned delivery, not aspirational roadmap
        # text. Drop a phase with no assigned story instead of publishing an
        # empty Fase 2/Fase 3 that looks like a commitment to future scope.
        story_releases = {str(story.get("release") or "").strip().lower() for story in stories}
        if "mvp" not in story_releases:
            raise ValueError("Contrato sem historias classificadas no MVP.")
        missing_release_descriptions = story_releases - set(releases_by_name)
        if missing_release_descriptions:
            defaults = {
                "fase 2": {
                    "name": "Fase 2",
                    "focus": "Capacidades auxiliares apos a validacao do fluxo principal.",
                    "deferred": "Otimizacoes e governanca adicional permanecem fora desta fase.",
                },
                "fase 3": {
                    "name": "Fase 3",
                    "focus": "Capacidades de governanca e evolucao posterior.",
                    "deferred": "Escopo posterior depende de novo planejamento.",
                },
            }
            for release_name in missing_release_descriptions:
                if release_name not in defaults:
                    raise ValueError("Historia referencia fatia de release sem plano correspondente.")
                releases_by_name[release_name] = defaults[release_name]
        release_order = ("mvp", "fase 2", "fase 3")
        contract["releases"] = [releases_by_name[name] for name in release_order if name in story_releases]
        if len(contract["releases"]) < len(releases_by_name):
            print(json.dumps({
                "event": "project_manager_empty_release_slices_removed",
                "removed": [name for name in release_order if name in releases_by_name and name not in story_releases],
            }, ensure_ascii=False), file=sys.stderr)
        foundation_count = sum(1 for story in stories if str(story.get("lane") or "").strip().lower() == "foundation")
        if foundation_count < 2:
            # A classificação de lane é um atributo de planejamento, não uma
            # regra de negócio. Se o modelo entregou o MVP sem marcar a base,
            # promova deterministicamente as primeiras histórias do MVP para
            # sustentar o primeiro fluxo utilizável.
            mvp_stories = [story for story in stories if str(story.get("release") or "").strip().lower() == "mvp"]
            for story in mvp_stories:
                if foundation_count >= 2:
                    break
                if str(story.get("lane") or "").strip().lower() != "foundation":
                    story["lane"] = "foundation"
                    story["priority"] = "high"
                    foundation_count += 1
            if foundation_count < 2:
                raise ValueError("Contrato sem historias suficientes de fundacao para sustentar o MVP.")
        # Coverage is derived traceability, not a business decision. Rebuild it
        # from the validated source_ids so an AI repair cannot retain obsolete
        # story IDs after splitting or renumbering stories.
        coverage = []
        for source_id in sorted({source_id for story in stories for source_id in story["source_ids"]}):
            coverage.append({
                "source_id": source_id,
                "story_ids": [story["id"] for story in stories if source_id in story["source_ids"]],
            })
        contract["coverage"] = coverage
        return contract

    def _render_backlog_contract(self, contract):
        def inline(value):
            # Model fields are data, not Markdown blocks. A newline inside a
            # description can make a continuation beginning with "Como" look
            # like a second malformed story to the renderer-level validator.
            return re.sub(r"\s+", " ", str(value or "")).strip()

        def bullets(items):
            lines = []
            for item in items:
                if isinstance(item, dict):
                    name = str(item.get("name") or item.get("text") or "").strip()
                    identifier = str(item.get("id") or "").strip()
                    if name:
                        lines.append(f"- {identifier}: {name}" if identifier else f"- {name}")
                elif str(item).strip():
                    lines.append(f"- {str(item).strip()}")
            return "\n".join(lines)

        release_lines = []
        for release in contract["releases"]:
            if isinstance(release, dict):
                name = str(release.get("name") or "").strip()
                focus = str(release.get("focus") or "").strip()
                deferred = str(release.get("deferred") or "").strip()
                if name and focus and deferred:
                    mvp_bridge = " Base do produto: historias iniciais do contrato." if name.lower() == "mvp" else ""
                    release_lines.append(f"- {name}: Foco: {focus}.{mvp_bridge} Depois: {deferred}.")
            elif str(release).strip():
                release_lines.append(f"- {str(release).strip()}")
        if not release_lines or not any(line.lower().startswith("- mvp:") for line in release_lines):
            raise ValueError("Contrato deve conter uma fatia MVP utilizavel.")

        story_lines = []
        for story in contract["stories"]:
            actor = re.sub(r"^como\s+", "", inline(story["actor"]), flags=re.IGNORECASE)
            goal = re.sub(r"^eu quero\s+", "", inline(story["goal"]), flags=re.IGNORECASE).rstrip(".")
            benefit = re.sub(r"^para\s+", "", inline(story["benefit"]), flags=re.IGNORECASE).rstrip(".")
            story_lines.extend([
                f"- {str(story['id']).strip().upper()} | Como {actor}, eu quero {goal}, para {benefit}.",
                f"  Descricao: {inline(story['description'])} [capacidades: {', '.join(story.get('capability_ids', [])) or 'pendente'}]",
            ])
            review_tags = [inline(tag) for tag in story.get("review_tags", []) if inline(tag)]
            open_questions = [inline(question) for question in story.get("open_questions", []) if inline(question)]
            if review_tags:
                story_lines.append(f"  Revisao: [{', '.join(sorted(set(review_tags)))}]")
            for question in open_questions:
                story_lines.append(f"  Ponto a validar: {question}")
        markdown = "\n".join([
            "# Backlog do Projeto",
            "", "## Visao Geral", contract["overview"].strip(),
            "", "## Capacidades do Produto", bullets(contract["capabilities"]),
            "", "## Epicos Recomendados", bullets(contract["epics"]),
            "", "## Fatias de Release", "\n".join(release_lines),
            "", "## Historias de Usuario", "\n".join(story_lines),
        ])
        valid, reason = validate_backlog_output(markdown)
        if not valid:
            raise ValueError(reason or "Markdown renderizado invalido.")
        return markdown

    def _build_single_pass_backlog_prompt(self, idea, evidence_contract, repair_reason=None):
        briefing = self._compact_briefing(idea)
        canonical_requirements = (
            self._requirements_contract.get("requirements", [])
            if isinstance(self._requirements_contract, dict) else []
        )
        repair_instruction = ""
        if repair_reason:
            repair_instruction = f"""
CORRECAO OBRIGATORIA DE FORMATO
A tentativa anterior foi rejeitada por: {repair_reason}
Comece a resposta diretamente com {{ e termine diretamente com }}. Nao use cercas ```json, texto introdutorio, explicacoes ou um segundo objeto JSON.
"""
        return f"""
Voce e um Product Manager senior. Gere um contrato JSON de backlog somente a partir do briefing fornecido.

BRIEFING DO PROJETO
{briefing}

EVIDENCIAS APROVADAS
{json.dumps(evidence_contract, ensure_ascii=False)}

CONTRATO CANONICO DE REQUISITOS
{json.dumps(canonical_requirements, ensure_ascii=False)}

REGRAS DE CONFIABILIDADE
- Use exclusivamente personas, capacidades, regras e restricoes presentes no contrato canonico ou nas evidencias aprovadas. Nao crie papéis, prazos, frequencias, formatos de exportacao, filtros, notificacoes, politicas ou dependencias.
- Nao crie dependencias entre stories. Declare uma dependencia somente quando a evidencia mencionar explicitamente o pre-requisito e cite-a em refinement_context.dependencies.
- Cada criterio de aceite deve ser explicitamente derivado de uma evidencia citada; nao preencha criterios genericos para aparentar testabilidade.
- Responda em portugues e nao invente integracoes, limites, politicas, formulas ou regras que nao estejam sustentadas pelo briefing.
- Quando uma decisao nao estiver definida, registre a necessidade na descricao sem apresentá-la como fato.
- Gere somente a quantidade de historias necessaria para cobrir as jornadas e restricoes confirmadas: no minimo 8 e no maximo 12. Nao adicione historias para atingir uma quantidade-alvo e nao fragmente uma jornada sem ganho de negocio.
- Distribua as historias entre os lanes foundation, operation, visibility e governance quando forem aplicaveis ao briefing.
- Gere 4 a 6 capacidades concretas, com verbo, objeto e efeito de negocio. Cada capacidade deve ter id CAP-XX e source_ids com evidencias usadas; gere 4 a 6 epicos concretos.
- Gere a fatia MVP e inclua Fase 2 ou Fase 3 SOMENTE quando houver ao menos uma story realmente planejada para cada fase. Cada fatia deve ter focus (o que entra) e deferred (o que fica para depois). Nao crie fase vazia nem use uma fase para sugerir escopo sem story correspondente.
- Toda evidencia de restricao explicita (marcada como `constraints:` ou contendo obrigacao como "deve", "devem", "somente" ou "apenas") deve ser citada por ao menos uma capacidade e uma story. Se os detalhes de implementacao nao estiverem definidos, mantenha a story como proposta com REVIEW_REQUIRED; nunca omita a restricao.
- Mantenha o contrato compacto: overview, nomes de capacidade/epico, focus, deferred, goal, benefit e description devem ter no maximo 160 caracteres. Gere exatamente um criterio de aceite por historia, com campos given, when e then de no maximo 120 caracteres cada. Nao repita evidencias em texto livre.
- Use pelo menos tres personas coerentes com o briefing e evite historias tecnicas internas.
- Cada historia deve ter um resultado de negocio observavel e independente. Separe etapas sequenciais quando puderem ser entregues, testadas ou revisadas separadamente; por exemplo, submeter uma solicitacao, o sistema validar/registrar e um analista decidir nao devem virar uma unica historia.
- Uma historia deve conter uma unica acao principal. Nao combine "simular e iniciar", nem "revisar, aprovar, reprovar ou solicitar complemento"; gere uma historia por capacidade ou registre REVIEW_SCOPE e uma pergunta objetiva quando a separacao depender de decisao de produto.
- Nao invente filtros, categorias, comunicacao pos-compra, lotes com preco diferenciado ou configuracoes administrativas quando esses comportamentos nao estiverem declarados na evidencia citada. Se forem apenas uma possibilidade, mantenha-os como proposta com REVIEW_EVIDENCE e uma pergunta objetiva.
- O MVP deve conter somente o caminho minimo utilizavel da compra: descoberta essencial, selecao, reserva/controle de disponibilidade, pagamento, emissao e validacao quando aplicavel. Relatorios, paineis, monitoramento, catalogos, filtros, configuracoes e administracao de lotes pertencem a Fase 2, salvo quando uma restricao explicita exigir esse comportamento para seguranca, privacidade ou consistencia da transacao.
- Respeite a responsabilidade declarada no briefing: se a evidencia disser que o sistema valida ou registra, nao reescreva isso como uma acao executada pelo analista. Descreva o efeito para o ator ou mantenha o comportamento do sistema como regra da historia.
- Para credito, uma historia de simulacao nao pode inferir taxa, CET, juros, parcela, politica de precificacao, limites, prazo, arredondamento ou relacao entre prazo e parcelas. Quando algum desses dados nao constar nas evidencias, mantenha a capacidade e registre a lacuna em open_questions e refinement_context.open_questions com REVIEW_HIGH_IMPACT.
- Para documentos obrigatorios, politicas de credito, elegibilidade, limites, score, bureau ou integracoes, nao trate os detalhes como definidos se a evidencia nao os especificar: registre perguntas sobre escopo, fonte da regra e criterio de aceite.
- Historias de governanca ou visibilidade devem declarar a decisao observavel que habilitam; "acompanhar a operacao geral" ou "assegurar conformidade" sem indicador, controle ou decisao deve receber REVIEW_SCOPE e uma open_question.
- Declare priority (low, medium, high ou urgent) e release (MVP, Fase 2 ou Fase 3) por historia. Use prioridade alta para a fundacao do primeiro fluxo utilizavel e nao atribua a mesma prioridade a todo o backlog sem justificativa.
- Cada descricao deve acrescentar contexto, regra, excecao, estado ou efeito observavel, sem escolher tecnologia, criptografia, painel, fila, filtro, API ou mecanismo de automacao se isso nao foi informado.
- Cada historia deve declarar source_ids com IDs da lista de evidencias, capability_ids com os IDs CAP-XX que ela entrega, status (confirmed, proposed ou question), review_tags e open_questions.
- Um source_id comprova somente o comportamento que ele menciona; ator, linguagem de dominio, familia de tela ou contexto geral nao comprovam fila, dashboard, configuracao, automacao, limite, calculo ou politica.
- Use confirmed somente quando o goal e a descricao estiverem diretamente sustentados pelas evidencias citadas. Ideias uteis sem evidencia devem ser proposed com REVIEW_SCOPE e uma open_question objetiva; decisoes de alto impacto sem evidencia tambem recebem REVIEW_HIGH_IMPACT.
- Declare coverage, relacionando cada evidencia efetivamente usada aos IDs das historias que a cobrem. Uma evidencia sem historia correspondente deve virar uma lacuna, nao uma historia inventada.

RESPONDA SOMENTE JSON VALIDO, sem markdown e sem comentarios, no formato:
{{
  "overview": "texto curto",
  "releases": [{{"name":"MVP","focus":"...","deferred":"..."}}],
  "capabilities": [{{"id":"CAP-01","name":"capacidade","source_ids":["briefing.1"],"story_ids":["US-01"]}}],
  "epics": ["epico"],
  "stories": [{{"id":"US-01","actor":"persona","goal":"acao verificavel","benefit":"efeito de negocio","description":"contexto adicional","lane":"foundation","priority":"high","release":"MVP","source_ids":["briefing.1"],"capability_ids":["CAP-01"],"status":"confirmed","review_tags":[],"open_questions":[],"refinement_context":{{"inputs":[],"outputs":[],"confirmed_rules":[],"constraints":[],"dependencies":[],"open_questions":[],"acceptance_hints":[],"acceptance_criteria":[{{"id":"US-01-CA-01","given":"precondicao","when":"acao","then":"resultado","source_ids":["briefing.1"],"status":"confirmed"}}]}}}}],
  "coverage": [{{"source_id":"briefing.1","story_ids":["US-01"]}}]
}}
{repair_instruction}
""".strip()

    def _build_missing_stories_prompt(self, contract, needed_count):
        existing_stories = contract.get("stories", [])
        existing_titles = [f"{story.get('id')}: {story.get('goal')}" for story in existing_stories]
        next_index = len(existing_stories) + 1
        return f"""
Complete um contrato de backlog. Preserve as historias existentes; gere SOMENTE {needed_count} historias novas.

Historias existentes:
{json.dumps(existing_titles, ensure_ascii=False)}

Sua resposta deve comecar exatamente por {{"stories":[ e terminar em ]}}. Nao inclua overview, releases, texto explicativo, markdown ou uma copia do contrato.
Responda SOMENTE JSON valido no formato {{"stories":[...]}}. Cada objeto exige id, actor, goal, benefit, description e lane.
Use IDs sequenciais de US-{next_index:02d} ate US-{next_index + needed_count - 1:02d}. Nao repita objetivo das historias existentes.
""".strip()

    def _build_release_repair_prompt(self, contract, reason):
        return f"""
Corrija SOMENTE as fatias de release deste contrato de backlog. Nao altere overview, capacidades, epicos ou historias.
Motivo da revisao: {reason}
Historias de fundacao disponiveis: {sum(1 for story in contract.get('stories', []) if str(story.get('lane') or '').lower() == 'foundation')}.
Responda SOMENTE JSON valido no formato:
{{"releases":[{{"name":"MVP","focus":"o primeiro fluxo utilizavel","deferred":"o que fica para depois"}},{{"name":"Fase 2","focus":"...","deferred":"..."}},{{"name":"Fase 3","focus":"...","deferred":"..."}}]}}
""".strip()

    def _build_overview_repair_prompt(self, contract, evidence_contract):
        return f"""
Corrija SOMENTE o campo overview do contrato de backlog abaixo.
O overview deve resumir o objetivo e a jornada confirmada do produto em uma ou duas frases.
Use exclusivamente as evidencias fornecidas. Nao invente funcionalidades, integracoes, politicas ou regras.

EVIDENCIAS:
{json.dumps(evidence_contract, ensure_ascii=False)}

CONTRATO PARCIAL:
{json.dumps(contract, ensure_ascii=False)}

Responda SOMENTE um objeto JSON valido exatamente neste formato:
{{"overview":"resumo objetivo baseado nas evidencias"}}
""".strip()

    def _build_incremental_coverage_plan(self, plan, evidence_contract):
        """Reserve one capability and its evidence for each four-story batch.

        The structural plan is deliberately limited to four through six
        capabilities.  This makes the backlog size follow the amount of
        confirmed product scope (16, 20 or 24 stories), instead of forcing a
        fixed number of batches for every project.
        """
        raw_facts = evidence_contract.get("facts") if isinstance(evidence_contract, dict) else []
        facts = [item for item in raw_facts if isinstance(item, dict) and item.get("id")] if isinstance(raw_facts, list) else []
        facts_by_id = {str(item["id"]): item for item in facts}
        raw_capabilities = plan.get("capabilities") if isinstance(plan, dict) else []
        capabilities = [item for item in raw_capabilities if isinstance(item, dict) and item.get("id")] if isinstance(raw_capabilities, list) else []
        if not capabilities:
            raise RuntimeError("Plano incremental sem capacidades utilizaveis para cobertura.")

        batch_count = max(self.INCREMENTAL_MIN_BATCHES, min(self.INCREMENTAL_MAX_BATCHES, len(capabilities)))
        # A malformed plan with fewer than four capabilities should not reduce
        # the promised minimum coverage. It is safer to reuse a capability in
        # a later batch than silently generate an undersized backlog.
        selected_capabilities = [capabilities[index % len(capabilities)] for index in range(batch_count)]
        coverage_plan = []
        for index, capability in enumerate(selected_capabilities):
            raw_source_ids = capability.get("source_ids")
            source_ids = [str(source_id) for source_id in raw_source_ids if str(source_id) in facts_by_id] if isinstance(raw_source_ids, list) else []
            if not source_ids and facts:
                source_ids = [str(facts[index % len(facts)]["id"])]
            first_id = index * self.INCREMENTAL_STORIES_PER_BATCH + 1
            coverage_plan.append({
                "batch_index": index + 1,
                "story_ids": [f"US-{number:02d}" for number in range(first_id, first_id + self.INCREMENTAL_STORIES_PER_BATCH)],
                "capability": {
                    "id": str(capability.get("id")),
                    "name": str(capability.get("name") or "capacidade confirmada"),
                },
                "evidence": [facts_by_id[source_id] for source_id in source_ids],
            })
        # Every structured briefing constraint is a mandatory coverage item.
        # Distribute them across bounded batches so the model sees the source
        # alongside a concrete capability rather than losing it in the long
        # global briefing. This adds evidence, never a fabricated rule.
        for index, fact in enumerate(self._explicit_constraint_facts(evidence_contract)):
            target = coverage_plan[index % len(coverage_plan)]
            if not any(str(item.get("id")) == str(fact.get("id")) for item in target["evidence"]):
                target["evidence"].append(fact)
        return coverage_plan

    @staticmethod
    def _select_duplicate_repair_evidence(contract, evidence_contract, duplicate_story_ids):
        """Pick the next uncovered fact before asking the model to repair.

        The model receives a concrete evidence reservation, so it cannot pick
        another free-form variation of the duplicate journey. If every fact is
        already cited, choose the least cited one deterministically.
        """
        duplicate_ids = {str(story_id).upper() for story_id in duplicate_story_ids}
        usage = {}
        raw_stories = contract.get("stories") if isinstance(contract, dict) else []
        for story in raw_stories if isinstance(raw_stories, list) else []:
            if not isinstance(story, dict) or str(story.get("id") or "").upper() in duplicate_ids:
                continue
            raw_source_ids = story.get("source_ids")
            for source_id in raw_source_ids if isinstance(raw_source_ids, list) else []:
                normalized_id = str(source_id)
                usage[normalized_id] = usage.get(normalized_id, 0) + 1
        raw_facts = evidence_contract.get("facts") if isinstance(evidence_contract, dict) else []
        facts = [item for item in raw_facts if isinstance(item, dict) and item.get("id")] if isinstance(raw_facts, list) else []
        if not facts:
            return []
        uncovered = [item for item in facts if usage.get(str(item["id"]), 0) == 0]
        candidates = uncovered or sorted(facts, key=lambda item: (usage.get(str(item["id"]), 0), str(item["id"])))
        return candidates[:max(1, min(len(duplicate_ids), 2))]

    def _incremental_checkpoint_fingerprint(self, idea):
        # The checkpoint is valid only for the exact business briefing. Project
        # DNA can be regenerated, but a changed briefing must never reuse old
        # stories or silently blend two backlog requests.
        source = self._compact_briefing(idea)
        return hashlib.sha256(source.encode("utf-8")).hexdigest()

    @staticmethod
    def _checkpoint_batch_is_complete(batch):
        """Accept only batches that can cross the final contract boundary."""
        if not isinstance(batch, list) or len(batch) != ProjectManager.INCREMENTAL_STORIES_PER_BATCH:
            return False
        for story in batch:
            if not isinstance(story, dict) or any(
                not str(story.get(key) or "").strip()
                for key in ("id", "actor", "goal", "benefit", "description", "lane")
            ):
                return False
            context = story.get("refinement_context") if isinstance(story, dict) else None
            criteria = context.get("acceptance_criteria") if isinstance(context, dict) else None
            if not isinstance(criteria, list) or not any(
                isinstance(item, dict)
                and str(item.get("given") or "").strip()
                and str(item.get("when") or "").strip()
                and str(item.get("then") or "").strip()
                for item in criteria
            ):
                return False
        return True

    @classmethod
    def _complete_checkpoint_prefix(cls, batches):
        """Keep the valid prefix; later batches cannot be resumed out of order."""
        complete = []
        for batch in batches if isinstance(batches, list) else []:
            if not cls._checkpoint_batch_is_complete(batch):
                break
            complete.append(batch)
        return complete

    def _load_incremental_checkpoint(self, idea):
        checkpoint = self._incremental_checkpoint
        if not isinstance(checkpoint, dict):
            return None
        if checkpoint.get("version") != 1 or checkpoint.get("briefing_fingerprint") != self._incremental_checkpoint_fingerprint(idea):
            print(json.dumps({"event": "project_manager_checkpoint_discarded", "reason": "briefing_changed_or_invalid"}, ensure_ascii=False), file=sys.stderr)
            return None
        plan = checkpoint.get("plan")
        coverage_plan = checkpoint.get("coverage_plan")
        batches = checkpoint.get("batches")
        if not isinstance(plan, dict) or not isinstance(coverage_plan, list) or not isinstance(batches, list):
            print(json.dumps({"event": "project_manager_checkpoint_discarded", "reason": "shape_invalid"}, ensure_ascii=False), file=sys.stderr)
            return None
        if len(batches) > len(coverage_plan):
            print(json.dumps({"event": "project_manager_checkpoint_discarded", "reason": "batch_count_invalid"}, ensure_ascii=False), file=sys.stderr)
            return None
        complete_batches = self._complete_checkpoint_prefix(batches)
        if len(complete_batches) != len(batches):
            print(json.dumps({
                "event": "project_manager_checkpoint_trimmed",
                "discarded_batches": len(batches) - len(complete_batches),
                "completed_batches": len(complete_batches),
            }, ensure_ascii=False), file=sys.stderr)
        normalized_checkpoint = {"plan": plan, "coverage_plan": coverage_plan, "batches": complete_batches}
        self._incremental_checkpoint = {
            "version": 1,
            "briefing_fingerprint": checkpoint["briefing_fingerprint"],
            **normalized_checkpoint,
        }
        return normalized_checkpoint

    def _save_incremental_checkpoint(self, idea, plan, coverage_plan, batches):
        checkpoint = {
            "version": 1,
            "briefing_fingerprint": self._incremental_checkpoint_fingerprint(idea),
            "plan": plan,
            "coverage_plan": coverage_plan,
            # Copy only complete, BDD-bearing batches. An interrupted repair
            # must be generated again instead of being treated as valid work.
            "batches": self._complete_checkpoint_prefix(batches),
        }
        self._incremental_checkpoint = checkpoint
        print(json.dumps({
            "event": "project_manager_incremental_checkpoint",
            "completed_batches": len(checkpoint["batches"]),
            "total_batches": len(coverage_plan),
        }, ensure_ascii=False), file=sys.stderr)
        return checkpoint

    def _generate_incremental_backlog(self, idea):
        """Generate the planning contract and story batches independently.

        Hosted endpoints regularly truncate a monolithic backlog JSON.  Each
        call below has one bounded responsibility and must return a complete
        JSON object before the next stage may begin.
        """
        evidence_contract = self._build_evidence_contract(idea)
        requirements = (self._requirements_contract or {}).get("requirements", [])
        timeout = max(30, min(90, int(os.getenv("PROJECT_MANAGER_LLM_REQUEST_TIMEOUT_SECONDS", "60"))))
        common = (
            f"BRIEFING:\n{self._compact_briefing(idea)}\n\n"
            f"EVIDENCIAS:\n{json.dumps(evidence_contract, ensure_ascii=False)}\n\n"
            f"REQUISITOS CANONICOS:\n{json.dumps(requirements, ensure_ascii=False)}"
        )
        checkpoint = self._load_incremental_checkpoint(idea)
        plan_prompt = f"""Voce e um Product Manager. Gere SOMENTE o plano estrutural do backlog, em portugues.
{common}
Nao crie escopo fora das evidencias. Responda somente JSON valido com overview, capabilities (4 a 6 objetos com id CAP-XX, name, source_ids e prerequisite_capability_ids), epics (4 a 6 textos) e releases (MVP obrigatoria; Fase 2 e Fase 3 somente se receberem historias). prerequisite_capability_ids deve conter somente capacidades do proprio plano que sejam pre-requisito evidente para a jornada; use [] quando nao houver. Cada evidencia de restricao explicita (marcada como `constraints:` ou contendo obrigacao como "deve", "devem", "somente" ou "apenas") deve constar em source_ids de uma capacidade: ela e obrigatoria e nao pode desaparecer do plano. O MVP deve conter somente o primeiro fluxo de valor utilizavel e seus pre-requisitos, deixando consulta gerencial, configuracoes avancadas, historicos e controles complementares para fases posteriores. Nao crie fases vazias. Nao inclua stories."""
        if checkpoint:
            plan = checkpoint["plan"]
            coverage_plan = checkpoint["coverage_plan"]
            batches = checkpoint["batches"]
            print(json.dumps({
                "event": "project_manager_incremental_resumed",
                "completed_batches": len(batches), "total_batches": len(coverage_plan),
            }, ensure_ascii=False), file=sys.stderr)
        else:
            print("[Project Manager] etapa=plano_incremental", file=sys.stderr)
            plan = self._extract_json_object(generate_text_from_llm(
                plan_prompt,
                options_override={"temperature": 0.1, "num_predict": 1200, "request_timeout_seconds": timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 180, "require_json_object": True},
                use_cache=False, task="requirements_analysis",
            ))
            plan = self._normalize_backlog_contract_aliases(plan)
            for key in ("overview", "capabilities", "epics", "releases"):
                if not plan.get(key):
                    raise RuntimeError(f"Plano incremental sem {key}.")
            coverage_plan = self._build_incremental_coverage_plan(plan, evidence_contract)
            batches = []
            self._save_incremental_checkpoint(idea, plan, coverage_plan, batches)

        generated_titles = [
            str(story.get("goal") or "")
            for batch in batches for story in batch if isinstance(story, dict)
        ]

        def missing_acceptance_ids(stories):
            missing = []
            for story in stories:
                if not isinstance(story, dict):
                    continue
                context = story.get("refinement_context")
                criteria = context.get("acceptance_criteria") if isinstance(context, dict) else None
                has_complete_criterion = any(
                    isinstance(criterion, dict)
                    and str(criterion.get("given") or "").strip()
                    and str(criterion.get("when") or "").strip()
                    and str(criterion.get("then") or "").strip()
                    for criterion in (criteria if isinstance(criteria, list) else [])
                )
                if not has_complete_criterion:
                    missing.append(str(story.get("id") or "").strip().upper())
            return missing

        def normalize_batch_story_ids(stories, first_id):
            """Recover omitted IDs from the fixed, ordered batch envelope.

            IDs are transport metadata, not product scope. The prompt fixes
            their exact order, so assigning an omitted ID by position is safe;
            a conflicting supplied ID remains a hard provider-contract error.
            """
            assigned = []
            for offset, story in enumerate(stories):
                if not isinstance(story, dict):
                    raise RuntimeError("Lote incremental contem historia que nao e objeto JSON.")
                expected_id = f"US-{first_id + offset:02d}"
                supplied_id = str(story.get("id") or "").strip().upper()
                if not supplied_id:
                    story["id"] = expected_id
                    assigned.append(expected_id)
                    continue
                match = re.fullmatch(r"US-(\d+)", supplied_id)
                canonical_id = f"US-{int(match.group(1)):02d}" if match else supplied_id
                if canonical_id != expected_id:
                    raise RuntimeError(f"Lote incremental com ID inesperado: esperado {expected_id}, recebido {supplied_id}.")
                story["id"] = canonical_id
            if assigned:
                print(json.dumps({
                    "event": "project_manager_incremental_ids_assigned",
                    "story_ids": assigned,
                }, ensure_ascii=False), file=sys.stderr)
            return stories

        def repair_missing_acceptance_criteria(stories, story_ids):
            requested_ids = [str(story_id).strip().upper() for story_id in story_ids if str(story_id).strip()]
            if not requested_ids:
                raise RuntimeError("Reparo incremental recebeu historias sem IDs.")
            affected = [
                story for story in stories
                if isinstance(story, dict) and str(story.get("id") or "").strip().upper() in requested_ids
            ]
            repair_prompt = f"""Voce e um Product Manager. Complete SOMENTE os criterios de aceite das historias informadas.
Use exclusivamente o briefing e as evidencias; nao altere actor, objetivo, escopo, prioridade, release ou fontes das historias.
{common}
HISTORIAS:
{json.dumps(affected, ensure_ascii=False)}
Responda somente JSON valido no formato {{\"stories\":[{{\"id\":\"US-XX\",\"refinement_context\":{{\"acceptance_criteria\":[{{\"id\":\"US-XX-CA-01\",\"given\":\"precondicao\",\"when\":\"acao\",\"then\":\"resultado verificavel\",\"source_ids\":[\"briefing.1\"],\"status\":\"confirmed|proposed\"}}]}}}}]}}. Inclua exatamente uma historia para cada ID solicitado e exatamente um criterio completo por historia."""
            print(json.dumps({"event": "project_manager_acceptance_criteria_repair", "story_ids": story_ids}, ensure_ascii=False), file=sys.stderr)
            repaired_payload = self._extract_json_object(generate_text_from_llm(
                repair_prompt,
                options_override={"temperature": 0.1, "num_predict": 1100, "request_timeout_seconds": timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 180, "require_json_object": True},
                use_cache=False, task="requirements_analysis",
            ))
            repaired_stories = repaired_payload.get("stories") if isinstance(repaired_payload, dict) else []
            repaired_stories = self._normalize_backlog_contract_aliases({"stories": repaired_stories}).get("stories", [])
            for index, repaired_story in enumerate(repaired_stories):
                if isinstance(repaired_story, dict) and not str(repaired_story.get("id") or "").strip() and index < len(requested_ids):
                    repaired_story["id"] = requested_ids[index]
            repairs_by_id = {
                str(story.get("id") or "").strip().upper(): story
                for story in repaired_stories if isinstance(story, dict)
            }
            for story in stories:
                story_id = str(story.get("id") or "").strip().upper() if isinstance(story, dict) else ""
                repair = repairs_by_id.get(story_id)
                repair_context = repair.get("refinement_context") if isinstance(repair, dict) else None
                if isinstance(repair_context, dict) and isinstance(repair_context.get("acceptance_criteria"), list):
                    if not isinstance(story.get("refinement_context"), dict):
                        story["refinement_context"] = {}
                    story["refinement_context"]["acceptance_criteria"] = repair_context["acceptance_criteria"]
            unresolved = missing_acceptance_ids(stories)
            if unresolved:
                raise RuntimeError("Reparo incremental sem criterios de aceite para: " + ", ".join(unresolved))
            return stories

        completed_batch_count = len(batches)
        try:
            for coverage in coverage_plan:
                batch_index = coverage["batch_index"]
                if batch_index <= completed_batch_count:
                    continue
                first_id = (batch_index - 1) * self.INCREMENTAL_STORIES_PER_BATCH + 1
                last_id = first_id + self.INCREMENTAL_STORIES_PER_BATCH - 1
                prior = ", ".join(generated_titles) or "nenhuma"
                story_prompt = f"""Voce e um Product Manager. Gere SOMENTE o lote {batch_index} de historias do backlog.
{common}
PLANO APROVADO:\n{json.dumps(plan, ensure_ascii=False)}
COBERTURA RESERVADA PARA ESTE LOTE:\n{json.dumps(coverage, ensure_ascii=False)}
Historias ja geradas: {prior}.
Use a capacidade reservada como foco central das quatro jornadas e cite sua evidencia reservada em source_ids. Cada evidencia de restricao explicita reservada precisa ser citada por ao menos uma story deste lote; quando faltar detalhe de implementacao, marque a story como proposta com REVIEW_REQUIRED, mas nao omita a restricao. As quatro historias precisam cobrir jornadas atomicas diferentes dessa capacidade; nao antecipe a capacidade reservada para outro lote e nao repita objetivos de historias ja geradas. Respeite prerequisite_capability_ids do plano: uma story de capacidade dependente deve declarar em refinement_context.dependencies a story pre-requisito ja gerada, sem criar dependencia que nao esteja no plano. O MVP deve conter apenas o primeiro fluxo utilizavel e seus pre-requisitos; controles, paineis, historicos e configuracoes nao essenciais devem ir para Fase 2 ou Fase 3. Nao classifique uma story em fase que nao tenha outras entregas planejadas no plano. Nao invente filtros, categorias, lotes com preco diferenciado ou comunicacao pos-compra: sem evidencia direta, mantenha a ideia como proposta com REVIEW_EVIDENCE e uma pergunta objetiva.
Responda somente JSON valido no formato {{"stories":[...]}} com exatamente quatro historias, IDs US-{first_id:02d} a US-{last_id:02d}. Cada historia deve ter actor, goal (uma unica acao), benefit, description curta, lane, priority, release, source_ids, capability_ids, status, review_tags, open_questions e refinement_context. O actor DEVE ser uma persona de negocio humana ou organizacional, como comprador, organizador ou equipe de portaria; nunca use "sistema", "automacao" ou servico tecnico como ator. Comportamentos automaticos pertencem ao objetivo ou criterio de aceite da persona beneficiada. Use status confirmed somente quando houver evidencia direta, criterio completo e nenhuma tag de revisao; use proposed com PROPOSED_DEFAULT ou REVIEW_REQUIRED quando houver default, hipotese, escopo fragil ou sobreposicao. refinement_context DEVE conter exatamente um acceptance_criteria no formato {{"id":"US-XX-CA-01","given":"precondicao","when":"acao","then":"resultado verificavel","source_ids":["briefing.1"],"status":"confirmed|proposed"}}. Nao omita acceptance_criteria. Nao invente regras, integracoes ou dependencias. Nao use open_questions para detalhes de apresentacao, formato de exportacao, filtros, historico, prazos, justificativas, ou para pedir que alguem separe acoes: marque esses pontos como PROPOSED_DEFAULT ou REVIEW_SCOPE e continue. Se uma funcionalidade nao tiver evidencia direta, mantenha-a como proposta com REVIEW_EVIDENCE, sem transformar a lacuna em pergunta bloqueante. Para cancelamento, nao invente motivo como imprevisto. Para historico, descreva a consulta das alteracoes sem escolher relatorio, log ou auditoria. Para bloqueio de manutencao, descreva que novas reservas ficam impedidas; reservas existentes permanecem sem cancelamento automatico, salvo evidencia contraria."""
                print(f"[Project Manager] etapa=historias_incrementais lote={batch_index}/{len(coverage_plan)} capability={coverage['capability']['id']}", file=sys.stderr)
                payload = self._extract_json_object(generate_text_from_llm(
                    story_prompt,
                    options_override={"temperature": 0.1, "num_predict": 2400, "request_timeout_seconds": timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 700, "require_json_object": True},
                    use_cache=False, task="requirements_analysis",
                ))
                stories = payload.get("stories") if isinstance(payload, dict) else None
                if not isinstance(stories, list) or len(stories) != self.INCREMENTAL_STORIES_PER_BATCH:
                    raise RuntimeError(f"Lote incremental {batch_index} sem {self.INCREMENTAL_STORIES_PER_BATCH} historias validas.")
                stories = self._normalize_backlog_contract_aliases({"stories": stories}).get("stories", [])
                stories = normalize_batch_story_ids(stories, first_id)
                missing_criteria = missing_acceptance_ids(stories)
                if missing_criteria:
                    stories = repair_missing_acceptance_criteria(stories, missing_criteria)
                if not self._checkpoint_batch_is_complete(stories):
                    raise RuntimeError(f"Lote incremental {batch_index} sem criterios BDD completos.")
                batches.append(stories)
                generated_titles.extend(str(story.get("goal") or "") for story in stories if isinstance(story, dict))
                self._save_incremental_checkpoint(idea, plan, coverage_plan, batches)
        except (RuntimeError, TimeoutError, json.JSONDecodeError) as error:
            checkpoint = self._incremental_checkpoint
            if checkpoint:
                raise BacklogGenerationError(
                    "Geracao incremental interrompida por falha recuperavel de provider; retome a partir do ultimo lote validado.",
                    rejected_draft={"backlog_checkpoint": checkpoint, "retryable": True, "cause": str(error)},
                ) from error
            raise

        completed_stories = [story for batch in batches for story in batch]
        try:
            contract = self._validate_backlog_contract({**plan, "stories": completed_stories}, evidence_contract)
        except (TypeError, ValueError) as error:
            # All batches may already be valid when a provider-shaped planning
            # field fails final assembly. Preserve that complete checkpoint so
            # a normalization fix or a retry never forces four new calls.
            raise BacklogGenerationError(
                "Contrato incremental completo, mas a montagem final falhou; retome usando os lotes preservados.",
                rejected_draft={"backlog_checkpoint": self._incremental_checkpoint, "retryable": True, "cause": str(error)},
            ) from error
        clarifications = self._collect_backlog_clarifications(contract)
        if clarifications and not self._clarifications_answered:
            return {"clarification_required": True, "clarifications": clarifications, "requirements_contract": self._requirements_contract}
        evidence_by_id = {str(item.get("id")): str(item.get("text") or "") for item in evidence_contract.get("facts", []) if isinstance(item, dict)}
        quality_review = self._review_backlog_contract(contract, evidence_contract, evidence_by_id)
        repair_attempts = 0
        repairable_codes = {
            "duplicate_story", "duplicate_business_journey", "duplicate_operational_rule", "generic_actor", "system_actor",
            "role_conflict", "malformed_story_goal", "needs_split_or_scope",
            "unconfirmed_context", "unsupported_product_scope", "excluded_product_scope", "release_dependency_conflict",
        }
        max_repair_attempts = max(1, min(2, int(os.getenv("PROJECT_MANAGER_INCREMENTAL_MAX_REPAIR_ATTEMPTS", "2"))))
        while repair_attempts < max_repair_attempts:
            repair_findings = [
                item for item in quality_review.get("findings", [])
                if isinstance(item, dict) and item.get("code") in repairable_codes and item.get("story_id")
            ]
            if not repair_findings:
                break
            # A repair can expose a residual defect in another story. Keep the
            # number of focused passes bounded, but re-run the gate before
            # rejecting a backlog that the next small repair can resolve.
            target_story_ids = list(dict.fromkeys(str(item["story_id"]) for item in repair_findings))
            reserved_evidence = self._select_duplicate_repair_evidence(contract, evidence_contract, target_story_ids)
            print(json.dumps({
                "event": "project_manager_incremental_quality_repair",
                "attempt": repair_attempts + 1,
                "max_attempts": max_repair_attempts,
                "story_ids": target_story_ids,
                "reserved_evidence_ids": [item.get("id") for item in reserved_evidence],
                "findings": repair_findings,
            }, ensure_ascii=False), file=sys.stderr)
            try:
                # A Quality Gate finding is repaired as an isolated patch.
                # Do not give the provider an entire contract to rewrite: a
                # malformed response must be unable to duplicate, renumber or
                # otherwise contaminate unrelated stories.
                for target_story_id in target_story_ids:
                    target_story = next(
                        (
                            story for story in contract.get("stories", [])
                            if isinstance(story, dict)
                            and str(story.get("id") or "").strip().upper() == target_story_id.upper()
                        ),
                        None,
                    )
                    if not target_story:
                        raise ValueError(f"Reparo isolado sem historia-alvo: {target_story_id}.")
                    target_findings = [
                        item for item in repair_findings
                        if str(item.get("story_id") or "").upper() == target_story_id.upper()
                    ]
                    target_evidence = self._select_duplicate_repair_evidence(
                        contract, evidence_contract, [target_story_id]
                    ) if any(item.get("code") in {
                        "duplicate_story", "duplicate_business_journey", "duplicate_operational_rule"
                    } for item in target_findings) else []
                    print(json.dumps({
                        "event": "project_manager_isolated_quality_repair",
                        "attempt": repair_attempts + 1,
                        "story_id": target_story_id,
                        "finding_codes": [item.get("code") for item in target_findings],
                        "reserved_evidence_ids": [item.get("id") for item in target_evidence],
                    }, ensure_ascii=False), file=sys.stderr)
                    repair_result = generate_text_from_llm(
                        self._build_isolated_story_repair_prompt(
                            target_story, evidence_contract, target_findings, reserved_evidence=target_evidence
                        ),
                        options_override={"temperature": 0.1, "num_predict": 1400, "request_timeout_seconds": timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 100, "require_json_object": True},
                        use_cache=False, task="artifact_repair",
                    )
                    contract = self._apply_isolated_story_repair(
                        contract,
                        self._extract_json_object(repair_result),
                        target_story_id,
                    )
                    # Isolated validation rejects malformed BDD/evidence and
                    # dependency references before the patch can proceed.
                    contract = self._validate_backlog_contract(contract, evidence_contract)
            except (RuntimeError, TimeoutError, TypeError, ValueError, json.JSONDecodeError) as error:
                raise BacklogGenerationError(
                    "Reparo incremental interrompido; os lotes validados foram preservados para nova tentativa.",
                    rejected_draft={
                        "backlog_checkpoint": self._incremental_checkpoint,
                        "retryable": True,
                        "recovery_kind": "quality_repair",
                        "cause": str(error),
                    },
                ) from error
            repair_attempts += 1
            clarifications = self._collect_backlog_clarifications(contract)
            if clarifications and not self._clarifications_answered:
                return {"clarification_required": True, "clarifications": clarifications, "requirements_contract": self._requirements_contract}
            quality_review = self._review_backlog_contract(contract, evidence_contract, evidence_by_id)
        non_review_findings = [
            item for item in quality_review.get("findings", [])
            if isinstance(item, dict) and item.get("code") not in {
                "story_review_required",
                # The contract remains available for human review when an
                # explicit briefing constraint was omitted. Publishing stays
                # blocked by REVISE, but discarding all generated work would
                # hide the exact evidence gap the reviewer must resolve.
                "missing_explicit_constraint_coverage",
            }
        ]
        if quality_review.get("decision") != "PASS" and non_review_findings:
            raise BacklogGenerationError(
                "Backlog incremental reprovado pelo Quality Gate: " + ", ".join(
                    f"{item.get('story_id', 'BACKLOG')}:{item.get('code', 'quality_finding')}"
                    for item in non_review_findings
                ),
                rejected_draft={
                    "backlog_checkpoint": self._incremental_checkpoint,
                    "retryable": True,
                    "recovery_kind": "quality_repair",
                    "cause": "Quality Gate requer reparo focalizado.",
                },
            )
        contract["quality_review"] = {"decision": quality_review["decision"], "domain": quality_review.get("domain", "generic"), "score": quality_review.get("score"), "threshold": quality_review.get("threshold", 80), "dimensions": quality_review.get("dimensions", {}), "readiness": quality_review.get("readiness", {}), "repair_attempts": repair_attempts, "proposals": quality_review.get("proposals", []), "questions": quality_review.get("questions", []), "history": [{"stage": "incremental_review", **quality_review}]}
        contract = self._enrich_backlog_handoff(contract, evidence_contract)
        try:
            markdown = self._render_backlog_contract(contract)
        except ValueError as error:
            raise BacklogGenerationError(
                "Contrato incremental valido, mas a renderizacao final falhou; retome usando os lotes preservados.",
                rejected_draft={"backlog_checkpoint": self._incremental_checkpoint, "retryable": True, "cause": str(error)},
            ) from error
        return {"markdown": markdown, "backlog_contract": {**contract, "evidence": evidence_contract, "requirements_contract": self._requirements_contract}}

    def _generate_ai_backlog(self, idea):
        if str(os.getenv("PROJECT_MANAGER_BACKLOG_STRATEGY", "incremental")).strip().lower() == "incremental":
            return self._generate_incremental_backlog(idea)
        """Generate the complete backlog in one bounded AI call, with one focused repair at most."""
        max_attempts = max(1, min(2, int(os.getenv("PROJECT_MANAGER_BACKLOG_MAX_ATTEMPTS", "1"))))
        request_timeout = max(30, min(90, int(os.getenv("PROJECT_MANAGER_LLM_REQUEST_TIMEOUT_SECONDS", "60"))))
        rejected_draft = None
        last_reason = "sem detalhes"
        evidence_contract = self._build_evidence_contract(idea)

        for attempt in range(1, max_attempts + 1):
            prompt = self._build_single_pass_backlog_prompt(
                idea,
                evidence_contract,
                repair_reason=last_reason if attempt > 1 else None,
            )
            print(
                f"[Project Manager] etapa=backlog_completo tentativa={attempt}/{max_attempts} timeout={request_timeout}s",
                file=sys.stderr,
            )
            try:
                result = generate_text_from_llm(
                    prompt,
                    options_override={
                        "temperature": 0.1,
                        # Eight traceable stories, releases and acceptance
                        # criteria cannot reliably fit in 1,800 tokens. The
                        # compact output contract above keeps this bounded
                        # while preserving enough room for a complete JSON.
                        "num_predict": int(os.getenv("PROJECT_MANAGER_BACKLOG_NUM_PREDICT", "4000")),
                        "request_timeout_seconds": request_timeout,
                        # A retry after a 45-second timeout only delays the
                        # next viable provider in this existing fallback
                        # chain, so move to it immediately.
                        "transient_retries": 0,
                        "json_mode": True,
                        # Reject tiny/non-JSON provider replies before the
                        # router marks them successful, so another model can
                        # be tried in the same AI-only generation attempt.
                        "min_response_chars": 256,
                        "require_json_object": True,
                    },
                    use_cache=False,
                    task="requirements_analysis",
                )
            except Exception as error:
                last_reason = f"Falha de provider na tentativa {attempt}: {error}"
                print(f"[Project Manager] {last_reason}", file=sys.stderr)
                continue

            rejected_draft = result
            candidate_contract = None
            try:
                candidate_contract = self._extract_json_object(result)
                contract = self._validate_backlog_contract(candidate_contract, evidence_contract)
                evidence_by_id = {str(fact.get("id")): str(fact.get("text") or "") for fact in evidence_contract.get("facts", []) if isinstance(fact, dict)}
                clarifications = self._collect_backlog_clarifications(contract)
                if clarifications and not self._clarifications_answered:
                    return {
                        "clarification_required": True,
                        "clarifications": clarifications,
                        "requirements_contract": self._requirements_contract,
                    }
                quality_review = self._review_backlog_contract(contract, evidence_contract, evidence_by_id)
                quality_history = [{"stage": "initial_review", **quality_review}]
                repair_attempts = 0
                if quality_review.get("advisories"):
                    print(json.dumps({
                        "event": "project_manager_backlog_advisories",
                        "count": len(quality_review["advisories"]),
                        "findings": quality_review["advisories"],
                    }, ensure_ascii=False), file=sys.stderr)
                if quality_review["decision"] != "PASS":
                    remaining = quality_review["findings"]
                    # A repair can surface a new finding for the same story
                    # or fail to correct the original one. Permit one focused
                    # retry for the same finding, while bounding the complete
                    # loop so a weak provider response cannot spin forever.
                    finding_attempts = {}
                    max_attempts_per_finding = 2
                    # Four rounds can repair only the first batches of a
                    # larger contract and leave the final newly-found story
                    # without its permitted retry. Five rounds cover that
                    # tail without turning recovery into an unbounded loop.
                    max_story_repairs = max(1, min(2, int(os.getenv("PROJECT_MANAGER_MAX_STORY_REPAIRS", "1"))))
                    for repair_attempt in range(1, max_story_repairs + 1):
                        repair_attempts = repair_attempt
                        eligible_findings = [
                            item for item in remaining
                            if item.get("story_id") and finding_attempts.get((item.get("story_id"), item.get("code")), 0) < max_attempts_per_finding
                        ]
                        if not eligible_findings:
                            break
                        # Repair every finding as a one-story patch. A full
                        # contract response from one provider must never be
                        # able to rewrite the other generated stories.
                        target_story_ids = list(dict.fromkeys(item["story_id"] for item in eligible_findings))[:4]
                        target_story_id_set = set(target_story_ids)
                        story_findings = [item for item in remaining if item.get("story_id") in target_story_id_set]
                        for item in story_findings:
                            key = (item.get("story_id"), item.get("code"))
                            finding_attempts[key] = finding_attempts.get(key, 0) + 1
                        print(json.dumps({"event": "project_manager_story_repair", "attempt": repair_attempt, "story_ids": target_story_ids, "findings": story_findings}, ensure_ascii=False), file=sys.stderr)
                        for target_story_id in target_story_ids:
                            target_story = next(
                                (
                                    story for story in contract.get("stories", [])
                                    if isinstance(story, dict)
                                    and str(story.get("id") or "").strip().upper() == str(target_story_id).upper()
                                ),
                                None,
                            )
                            if not target_story:
                                raise ValueError(f"Reparo isolado sem historia-alvo: {target_story_id}.")
                            target_findings = [
                                item for item in story_findings
                                if str(item.get("story_id") or "").upper() == str(target_story_id).upper()
                            ]
                            target_evidence = self._select_duplicate_repair_evidence(
                                contract, evidence_contract, [target_story_id]
                            ) if any(item.get("code") in {
                                "duplicate_story", "duplicate_business_journey", "duplicate_operational_rule"
                            } for item in target_findings) else []
                            print(json.dumps({
                                "event": "project_manager_isolated_story_repair",
                                "attempt": repair_attempt,
                                "story_id": target_story_id,
                                "finding_codes": [item.get("code") for item in target_findings],
                            }, ensure_ascii=False), file=sys.stderr)
                            repair_result = generate_text_from_llm(
                                self._build_isolated_story_repair_prompt(
                                    target_story, evidence_contract, target_findings, reserved_evidence=target_evidence
                                ),
                                options_override={"temperature": 0.1, "num_predict": 1400, "request_timeout_seconds": request_timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 100, "require_json_object": True},
                                use_cache=False,
                                task="artifact_repair",
                            )
                            contract = self._apply_isolated_story_repair(
                                contract,
                                self._extract_json_object(repair_result),
                                target_story_id,
                            )
                            contract = self._validate_backlog_contract(contract, evidence_contract)
                        quality_review = self._review_backlog_contract(contract, evidence_contract, evidence_by_id)
                        quality_history.append({"stage": f"repair_{repair_attempt}_review", **quality_review})
                        remaining = [
                            item for item in quality_review["findings"]
                            if item.get("code") != "missing_explicit_constraint_coverage"
                        ]
                        if not remaining:
                            break
                    if remaining:
                        raise BacklogGenerationError(
                            "Reparo de historias nao concluiu os achados obrigatorios: " + "; ".join(
                                f"{item['story_id']}:{item['code']}" for item in remaining
                            ),
                            rejected_draft=rejected_draft,
                        )
                contract["quality_review"] = {
                    "decision": quality_review["decision"],
                    "domain": quality_review.get("domain", "generic"),
                    "score": quality_review.get("score"),
                    "threshold": quality_review.get("threshold", 80),
                    "dimensions": quality_review.get("dimensions", {}),
                    "readiness": quality_review.get("readiness", {}),
                    "repair_attempts": repair_attempts,
                    "proposals": quality_review.get("proposals", []),
                    "questions": quality_review.get("questions", []),
                    "history": quality_history,
                }
                contract = self._enrich_backlog_handoff(contract, evidence_contract)
                return {
                    "markdown": self._render_backlog_contract(contract),
                    "backlog_contract": {
                        **contract,
                        "evidence": evidence_contract,
                        "requirements_contract": self._requirements_contract,
                    },
                }
            except (TypeError, ValueError, RuntimeError, json.JSONDecodeError) as error:
                last_reason = str(error)
                print(json.dumps({
                    "event": "project_manager_contract_parse_rejected",
                    "attempt": attempt,
                    "response_chars": len(str(result or "")),
                    "reason": last_reason,
                    "contract_keys": sorted(str(key) for key in candidate_contract.keys()) if isinstance(candidate_contract, dict) else [],
                }, ensure_ascii=False), file=sys.stderr)
            print(
                f"[Project Manager] etapa=validacao tentativa={attempt}/{max_attempts} motivo={last_reason}",
                file=sys.stderr,
            )

            if attempt < max_attempts:
                try:
                    partial_contract = self._extract_json_object(result)
                    stories = partial_contract.get("stories") if isinstance(partial_contract, dict) else None
                    if isinstance(partial_contract, dict) and "contrato sem overview" in last_reason.lower():
                        print("[Project Manager] etapa=reparo_overview", file=sys.stderr)
                        overview = self._extract_json_object(generate_text_from_llm(
                            self._build_overview_repair_prompt(partial_contract, evidence_contract),
                            options_override={"temperature": 0.1, "num_predict": 350, "request_timeout_seconds": request_timeout, "transient_retries": 0, "json_mode": True, "min_response_chars": 20, "require_json_object": True},
                            use_cache=False,
                            task="requirements_analysis",
                        )).get("overview")
                        if not isinstance(overview, str) or not overview.strip():
                            raise ValueError("Reparo da IA sem overview valido.")
                        partial_contract["overview"] = overview.strip()
                        rejected_draft = json.dumps(partial_contract, ensure_ascii=False)
                        contract = self._validate_backlog_contract(partial_contract, evidence_contract)
                        contract = self._enrich_backlog_handoff(contract, evidence_contract)
                        return {"markdown": self._render_backlog_contract(contract), "backlog_contract": {**contract, "evidence": evidence_contract, "requirements_contract": self._requirements_contract}}
                    if isinstance(partial_contract, dict) and any(marker in last_reason.lower() for marker in ("release", "fatias", "mvp")):
                        print("[Project Manager] etapa=reparo_fatias_release", file=sys.stderr)
                        repaired_releases = self._extract_json_object(generate_text_from_llm(
                            self._build_release_repair_prompt(partial_contract, last_reason),
                            options_override={"temperature": 0.1, "num_predict": 700, "request_timeout_seconds": request_timeout, "transient_retries": 0, "json_mode": True},
                            use_cache=False,
                            task="requirements_analysis",
                        )).get("releases", [])
                        partial_contract["releases"] = repaired_releases
                        rejected_draft = json.dumps(partial_contract, ensure_ascii=False)
                        contract = self._validate_backlog_contract(partial_contract, evidence_contract)
                        contract = self._enrich_backlog_handoff(contract, evidence_contract)
                        return {"markdown": self._render_backlog_contract(contract), "backlog_contract": {**contract, "evidence": evidence_contract, "requirements_contract": self._requirements_contract}}
                    if isinstance(stories, list) and stories and len(stories) < self.STORY_RANGE[0]:
                        needed_count = self.STORY_RANGE[0] - len(stories)
                        print(f"[Project Manager] etapa=complemento_historias quantidade={needed_count}", file=sys.stderr)
                        completion = generate_text_from_llm(
                            self._build_missing_stories_prompt(partial_contract, needed_count),
                            options_override={"temperature": 0.1, "num_predict": 1200, "request_timeout_seconds": request_timeout, "transient_retries": 0, "json_mode": True},
                            use_cache=False,
                            task="requirements_analysis",
                        )
                        additions = self._extract_json_object(completion).get("stories", [])
                        partial_contract["stories"] = [*stories, *additions]
                        rejected_draft = json.dumps(partial_contract, ensure_ascii=False)
                        contract = self._validate_backlog_contract(partial_contract, evidence_contract)
                        contract = self._enrich_backlog_handoff(contract, evidence_contract)
                        return {"markdown": self._render_backlog_contract(contract), "backlog_contract": {**contract, "evidence": evidence_contract, "requirements_contract": self._requirements_contract}}
                except (TypeError, ValueError, json.JSONDecodeError, RuntimeError) as repair_error:
                    last_reason = f"Complemento de historias invalido: {repair_error}"
                    print(f"[Project Manager] {last_reason}", file=sys.stderr)
                # A malformed focused repair must not discard the remaining
                # full-contract attempt.  The next iteration is still AI-only
                # and has the complete briefing/evidence context.
                continue

        raise BacklogGenerationError(
            f"O agente project_manager nao conseguiu gerar um backlog valido apos {max_attempts} tentativas. "
            f"Ultimo motivo: {last_reason}",
            rejected_draft=rejected_draft,
        )

    def _curate_story_batch(self, base_context, story_blocks, *, min_stories, max_stories):
        draft_section = self._build_stories_section(story_blocks)
        prompt = f"""
{base_context}

Voce vai atuar como editor final do backlog.

Receba as historias abaixo, consolide e devolva APENAS a secao em Markdown:

{draft_section}

REGRAS DE CURADORIA
- Mantenha entre {min_stories} e {max_stories} historias.
- Remova historias duplicadas ou muito parecidas.
- Prefira a versao mais forte e mais especifica quando houver sobreposicao.
- Remova historias tecnicas ou internas demais, como modelagem de entidade, numero sequencial, tabela, API ou schema.
- Padronize personas em torno de: colaborador, atendente, gestor e administrador.
- Nao deixe historias truncadas.
- Nao deixe nenhuma historia terminar com frase cortada ou titulo generico.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Garanta que as primeiras 8 historias representem o MVP e cubram majoritariamente criacao, configuracao, consulta, aprovacao e acompanhamento do fluxo principal.
- Empurre para o fim ou remova historias de integracoes, exportacoes, analytics avancado, IA, ESG, marketplace, webhooks e automacoes sofisticadas quando ainda faltarem historias basicas.
- Nao introduza financeiro, orcamento ou custos quando o briefing nao citar essa dimensao explicitamente.
- Mantenha as historias de backlog ligadas a acoes observaveis de produto, nao a intencoes abstratas.
- Nao invente escopo fora do briefing.
- Responda APENAS com:
  - ## Historias de Usuario
  - as historias finais
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_CURATION_NUM_PREDICT", "1300"),
        )
        curated_section = self._extract_section(result, "Historias de Usuario")
        if not curated_section:
            raise RuntimeError("Bloco de curadoria sem secao de historias.")
        return curated_section

    def _generate_complementary_stories(self, base_context, existing_story_blocks, *, needed_count):
        if needed_count <= 0:
            return []

        existing_titles = [
            re.sub(
                r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
                "",
                block.splitlines()[0],
                flags=re.IGNORECASE,
            ).strip()
            for block in existing_story_blocks
            if block.splitlines()
        ]
        existing_titles_text = "\n".join(f"- {title}" for title in existing_titles[:25])

        prompt = f"""
{base_context}

HISTORIAS JA CONSOLIDADAS
{existing_titles_text}

TAREFA
Gere APENAS a secao abaixo em Markdown:

## Historias de Usuario

REGRAS
- Gere de {needed_count} a {max(needed_count + 2, needed_count)} historias COMPLEMENTARES.
- Nao repita nem reformule historias ja consolidadas.
- Foque nos fluxos que ainda costumam faltar em backlog inicial: administracao, governanca, relatorios, notificacoes, operacao e excecoes de negocio.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_COMPLEMENT_NUM_PREDICT", "700"),
        )
        complement_section = self._extract_section(result, "Historias de Usuario")
        if not complement_section:
            return []
        return self._extract_story_lines(complement_section)

    def _generate_foundation_stories(self, base_context, existing_story_blocks, missing_signals):
        if not missing_signals:
            return []

        existing_titles = [
            self._story_seed_title(block)
            for block in existing_story_blocks
            if block and self._story_seed_title(block)
        ]
        existing_titles_text = "\n".join(f"- {title}" for title in existing_titles[:30]) or "- Nenhuma historia consolidada ainda."
        focus_text = "\n".join(
            f"- {signal['label']}: {signal['instruction']}" for signal in missing_signals
        )

        prompt = f"""
{base_context}

HISTORIAS JA CONSOLIDADAS
{existing_titles_text}

EIXOS FUNDADORES QUE AINDA FALTAM
{focus_text}

TAREFA
Gere APENAS a secao abaixo em Markdown:

## Historias de Usuario

REGRAS
- Gere entre {len(missing_signals)} e {len(missing_signals) + 2} historias.
- Cubra SOMENTE os eixos fundadores que ainda faltam.
- Nao repita nem reformule historias ja consolidadas.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_FOUNDATION_NUM_PREDICT", "800"),
        )
        foundation_section = self._extract_section(result, "Historias de Usuario")
        if not foundation_section:
            return []
        return self._extract_story_lines(foundation_section)

    def _generate_thematic_stories(self, base_context, theme_label, instructions, *, target_range):
        prompt = f"""
{base_context}

TEMA DESTA RODADA
{theme_label}

TAREFA
Gere APENAS a secao abaixo em Markdown:

## Historias de Usuario

REGRAS
- Gere de {target_range[0]} a {target_range[1]} historias.
- Foque somente no tema desta rodada.
- {instructions}
- Use pelo menos duas personas distintas e relevantes ao tema nesta rodada.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_THEME_NUM_PREDICT", "900"),
            min_response_chars=180,
        )
        themed_section = (
            self._extract_section(result, "Historias de Usuario")
            or self._extract_section(result, "Historias")
            or self._extract_section(result, "User Stories")
            or self._extract_section(result, "Stories")
        )
        # If the model omits the requested heading but does produce stories,
        # parsing the full response is safe: only recognised "Como ..."
        # entries become backlog items.
        story_blocks = self._extract_story_lines(themed_section or result)
        print(json.dumps({
            "event": "project_manager_epic_batch_parsed",
            "theme": theme_label,
            "response_chars": len(str(result or "")),
            "stories_found": len(story_blocks),
            "section_found": bool(themed_section),
        }, ensure_ascii=False), file=sys.stderr)
        return story_blocks

    def _story_business_intent_key(self, story_block):
        """Coarse action/entity key to catch paraphrased duplicate stories."""
        _, normalized = self._normalize_text(self._story_seed_title(story_block))
        actions = (
            ("cancelar", r"\bcancel"), ("bloquear", r"\bbloque"),
            ("alterar", r"\b(alter|reagend)"), ("reservar", r"\breserv"),
            ("consultar", r"\b(consult|busc)"), ("cadastrar", r"\b(cadastr|criar)"),
            ("editar", r"\b(edit|atualiz)"), ("arquivar", r"\b(exclu|arquiv|inativ)"),
            ("visualizar", r"\b(visualiz|agenda|relatori|dashboard)"),
            ("permissoes", r"\b(permiss|autentic|acesso)"),
        )
        entities = (
            ("reserva", r"\breserv"), ("sala", r"\bsala"),
            ("agenda", r"\b(agenda|ocupac)"), ("acesso", r"\b(permiss|acesso|perfil)"),
        )
        action = next((name for name, pattern in actions if re.search(pattern, normalized)), "")
        entity = next((name for name, pattern in entities if re.search(pattern, normalized)), "")
        return f"{action}:{entity}" if action and entity else ""

    def _epic_story_quality_issues(self, story_blocks):
        """Find deterministic defects that must not reach persisted backlog data."""
        issues = []
        seen_intents = {}
        for index, block in enumerate(story_blocks):
            lines = [line.strip() for line in str(block or "").splitlines() if line.strip()]
            title = lines[0] if lines else ""
            normalized_title = self._story_seed_title(block)
            if re.match(r"^Como\s+sistema\b", normalized_title, re.IGNORECASE):
                issues.append((index, "ator_sistema"))
                continue
            detail = " ".join(lines[1:]).strip()
            if not detail:
                issues.append((index, "descricao_ausente"))
                continue
            if re.search(r"(?:^|\s)(?:US|STORY)-\d+\s*\|", detail, re.IGNORECASE):
                issues.append((index, "descricao_contaminada_por_outras_historias"))
                continue
            intent = self._story_business_intent_key(block) or self._story_similarity_key(block)
            if intent and intent in seen_intents:
                issues.append((index, f"intencao_duplicada_com_US_{seen_intents[intent] + 1:02d}"))
                continue
            if intent:
                seen_intents[intent] = index
        return issues

    def _wire_foundation_dependencies(self, stories):
        """Keep declared authentication and role controls ahead of protected work."""
        auth_ids, role_ids = [], []
        for story in stories:
            text = unicodedata.normalize(
                "NFKD", f"{story.get('goal', '')} {story.get('description', '')}"
            ).encode("ascii", "ignore").decode("ascii").lower()
            if re.search(r"\b(autentic|login|credencial)\w*\b", text):
                auth_ids.append(str(story.get("id") or ""))
            if re.search(r"\b(perfil|role|permiss)\w*\b", text):
                role_ids.append(str(story.get("id") or ""))

        for story_id in [*auth_ids, *role_ids]:
            story = next((item for item in stories if str(item.get("id") or "") == story_id), None)
            if story:
                story["release"] = "MVP"
                story["priority"] = "high"

        for story in stories:
            story_id = str(story.get("id") or "")
            if story_id in auth_ids or story_id in role_ids:
                continue
            actor = self._canonical_story_actor(story.get("actor"))
            context = story.get("refinement_context") if isinstance(story.get("refinement_context"), dict) else {}
            dependencies = list(context.get("dependencies") or [])
            if auth_ids and actor not in {"", "sistema"}:
                dependencies.append(auth_ids[0])
            if role_ids and actor == "administrador":
                dependencies.append(role_ids[0])
            context["dependencies"] = self._deduplicate_texts(dependencies)
            story["refinement_context"] = context
        return stories

    def _build_epic_backlog_contract(self, story_blocks, capabilities):
        """Attach deterministic planning metadata to the Markdown backlog."""
        evidence = self._build_evidence_contract(getattr(self, "_current_idea", ""))
        source_ids = [item.get("id") for item in evidence.get("facts", []) if item.get("id")][:1]
        capability_count = max(1, len(capabilities or []))
        stories = []
        for index, block in enumerate(story_blocks, start=1):
            lines = [line.strip() for line in str(block or "").splitlines() if line.strip()]
            title = self._story_seed_title(block)
            detail = re.sub(
                r"^descricao\s*[:\-]?\s*",
                "",
                " ".join(lines[1:]).strip(),
                flags=re.IGNORECASE,
            ).strip()
            parsed = self._parse_story_title(title)
            actor, goal, benefit = parsed if parsed else ("Usuario autorizado", title, "concluir o fluxo solicitado")
            release = "MVP" if index <= 8 else "Fase 2" if index <= 16 else "Fase 3"
            capability_index = min((index - 1) // 4, capability_count - 1) + 1
            story_id = f"US-{index:02d}"
            stories.append({
                "id": story_id,
                "actor": self._canonical_story_actor(actor), "goal": goal.strip(), "benefit": benefit.strip(),
                "description": detail, "lane": self._estimate_story_lane(block),
                "priority": "high" if release == "MVP" else "medium" if release == "Fase 2" else "low",
                "release": release, "source_ids": source_ids, "capability_ids": [f"cap_{capability_index}"],
                "status": "proposed", "review_tags": ["REVIEW_REQUIRED"], "open_questions": [],
                "refinement_context": {"inputs": [], "outputs": [], "confirmed_rules": [], "constraints": [], "dependencies": [], "open_questions": [], "acceptance_hints": [], "acceptance_criteria": []},
            })
        return {
            "evidence": evidence,
            "stories": stories,
            "coverage": [
                {"source_id": source_id, "story_ids": [story["id"] for story in stories]}
                for source_id in source_ids
            ],
        }

    def _generate_missing_stories_fallback(self, base_context, existing_story_blocks, *, needed_count):
        if needed_count <= 0:
            return []

        existing_titles = [
            self._story_seed_title(block)
            for block in existing_story_blocks
            if block and self._story_seed_title(block)
        ]
        existing_titles_text = "\n".join(f"- {title}" for title in existing_titles[:30])

        prompt = f"""
{base_context}

HISTORIAS JA ACEITAS
{existing_titles_text}

TAREFA
Gere APENAS {needed_count} historias faltantes para completar o backlog minimo.
Responda APENAS com:

## Historias de Usuario

REGRAS
- Nao repita nenhuma historia ja aceita.
- Foque no que costuma faltar para fechar um backlog inicial completo.
- Seja direto e especifico.
- Cada historia deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_MISSING_NUM_PREDICT", "950"),
        )
        missing_section = self._extract_section(result, "Historias de Usuario")
        if not missing_section:
            return []
        return self._extract_story_lines(missing_section)

    def _extract_seed_titles_from_text(self, content):
        titles = []
        for raw_line in (content or "").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            cleaned = re.sub(
                r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
                "",
                line,
                flags=re.IGNORECASE,
            ).strip()
            if re.search(r"^Como\b.+\beu quero\b.+\bpara\b.+", cleaned, re.IGNORECASE):
                titles.append(cleaned)
        return titles

    def _generate_seed_titles_fallback(self, base_context, *, min_stories, max_stories):
        prompt = f"""
{base_context}

TAREFA
Gere APENAS uma lista curta de titulos de historias de usuario.

REGRAS
- Gere entre {min_stories} e {max_stories} titulos.
- Cada linha deve conter somente:
  Como ..., eu quero ..., para ...
- Nao adicione Contexto, Valor ou Criterios nesta etapa.
- Nao inclua explicacoes, secoes extras ou observacoes.
- Cubra jornadas principais, operacao, gestao e governanca do produto.
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_SEEDS_NUM_PREDICT", "900"),
        )
        return self._extract_seed_titles_from_text(result)

    def _expand_story_seeds(self, base_context, seed_titles):
        titles = [title.strip() for title in seed_titles if title and title.strip()]
        if not titles:
            return []

        titles_text = "\n".join(f"- {title}" for title in titles)
        prompt = f"""
{base_context}

TITULOS DE HISTORIAS PARA EXPANDIR
{titles_text}

TAREFA
Padronize esses titulos como user stories finais e devolva APENAS:

## Historias de Usuario

REGRAS
- Mantenha o mesmo sentido de cada titulo.
- Nao crie titulos extras fora da lista.
- Para cada historia, entregue um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Nao invente escopo fora do briefing.
"""
        result = self._generate_block(
            prompt,
            num_predict=os.getenv("PROJECT_MANAGER_BLOCK_EXPAND_NUM_PREDICT", "900"),
        )
        expanded_section = self._extract_section(result, "Historias de Usuario")
        if not expanded_section:
            return []
        return self._extract_story_lines(expanded_section)

    def _ensure_minimum_story_count(self, base_context, story_blocks, *, min_stories, max_stories):
        consolidated = list(story_blocks)

        for _round in range(3):
            if len(consolidated) >= min_stories:
                break

            complement_blocks = self._generate_complementary_stories(
                base_context,
                consolidated,
                needed_count=max(min_stories - len(consolidated), 2),
            )
            if not complement_blocks:
                break

            updated = self._dedupe_and_polish_stories(consolidated + complement_blocks, base_context)
            if len(updated) <= len(consolidated):
                break

            consolidated = updated[:max_stories]

        return consolidated[:max_stories]

    def _ensure_foundation_story_coverage(self, base_context, story_blocks, *, min_stories, max_stories):
        consolidated = list(story_blocks)

        for _round in range(3):
            missing_signals = self._get_missing_foundation_signals(consolidated)
            if len(self.FOUNDATION_SIGNAL_PROMPTS) - len(missing_signals) >= 4:
                break

            complement_blocks = self._generate_foundation_stories(
                base_context,
                consolidated,
                missing_signals,
            )
            if not complement_blocks:
                break

            updated = self._dedupe_and_polish_stories(consolidated + complement_blocks, base_context)
            if len(updated) <= len(consolidated):
                break

            consolidated = updated[:max_stories]
            consolidated = self._ensure_minimum_story_count(
                base_context,
                consolidated,
                min_stories=min_stories,
                max_stories=max_stories,
            )

        return consolidated[:max_stories]

    def _collect_story_blocks_incrementally(self, base_context, *, min_stories, max_stories, epics=None):
        default_themes = [
            (
                "Fluxo fundador do produto",
                "Cubra cadastro inicial, criacao da entidade principal, planejamento basico, consulta inicial e confirmacao do fluxo principal.",
                (4, 6),
            ),
            (
                "Operacao e acompanhamento",
                "Cubra acompanhamento operacional, atualizacao de status, execucao do trabalho, alertas, fila e excecoes principais do dia a dia.",
                (4, 6),
            ),
            (
                "Gestao e colaboracao",
                "Cubra visao gerencial, colaboracao entre papeis, configuracao operacional, relatorios principais e tomada de decisao.",
                (3, 5),
            ),
            (
                "Governanca e evolucao",
                "Cubra permissoes, auditoria, automacoes, integracoes, relatorios avancados e cenarios de administracao do produto.",
                (3, 5),
            ),
        ]

        # The blueprint is deliberately small; generate stories from its
        # concrete epics in bounded batches instead of asking one provider to
        # serialize the entire backlog contract at once. Two batches of four
        # stories cover the initial minimum while keeping each response small.
        epic_titles = [str(epic or "").strip() for epic in (epics or []) if str(epic or "").strip()]
        if epic_titles:
            themes = [
                (
                    f"Epico {index}: {epic}",
                    f"Cubra somente o escopo do epico '{epic}'. Nao antecipe funcionalidades de outros epicos.",
                    (4, 4),
                )
                for index, epic in enumerate(epic_titles[:2], start=1)
            ]
        else:
            themes = default_themes

        consolidated = []
        seed_titles = []
        for theme_label, instructions, target_range in themes:
            batch = self._generate_thematic_stories(
                base_context,
                theme_label,
                instructions,
                target_range=target_range,
            )
            for block in batch:
                title = self._story_seed_title(block)
                similarity_key = self._story_similarity_key(block)
                if title and similarity_key and all(
                    self._story_similarity_key(existing_title) != similarity_key for existing_title in seed_titles
                ):
                    seed_titles.append(title)
            if batch:
                consolidated = self._dedupe_and_polish_stories(consolidated + batch, base_context)
            if len(consolidated) >= min_stories:
                break

        consolidated = self._ensure_minimum_story_count(
            base_context,
            consolidated,
            min_stories=min_stories,
            max_stories=max_stories,
        )
        consolidated = self._ensure_foundation_story_coverage(
            base_context,
            consolidated,
            min_stories=min_stories,
            max_stories=max_stories,
        )

        if len(consolidated) < min_stories and seed_titles:
            existing_keys = {self._story_similarity_key(block) for block in consolidated}
            remaining_titles = []
            seen_seed_keys = set()
            for title in seed_titles:
                key = self._story_similarity_key(title)
                if not key or key in existing_keys or key in seen_seed_keys:
                    continue
                seen_seed_keys.add(key)
                remaining_titles.append(title)

            for start in range(0, len(remaining_titles), 4):
                if len(consolidated) >= min_stories:
                    break
                batch_titles = remaining_titles[start:start + 4]
                expanded = self._expand_story_seeds(base_context, batch_titles)
                if expanded:
                    consolidated = self._dedupe_and_polish_stories(consolidated + expanded, base_context)

            consolidated = self._ensure_minimum_story_count(
                base_context,
                consolidated,
                min_stories=min_stories,
                max_stories=max_stories,
            )
            consolidated = self._ensure_foundation_story_coverage(
                base_context,
                consolidated,
                min_stories=min_stories,
                max_stories=max_stories,
            )
            consolidated = self._rebalance_story_batch_for_mvp(
                base_context,
                consolidated,
                min_stories=min_stories,
                max_stories=max_stories,
            )

        if len(consolidated) < min_stories:
            seed_titles_from_fallback = self._generate_seed_titles_fallback(
                base_context,
                min_stories=min_stories,
                max_stories=max_stories,
            )
            if seed_titles_from_fallback:
                existing_keys = {self._story_similarity_key(block) for block in consolidated}
                new_seed_titles = []
                for title in seed_titles_from_fallback:
                    key = self._story_similarity_key(title)
                    if key and key not in existing_keys:
                        existing_keys.add(key)
                        new_seed_titles.append(title)

                for start in range(0, len(new_seed_titles), 4):
                    if len(consolidated) >= min_stories:
                        break
                    batch_titles = new_seed_titles[start:start + 4]
                    expanded = self._expand_story_seeds(base_context, batch_titles)
                    if expanded:
                        consolidated = self._dedupe_and_polish_stories(consolidated + expanded, base_context)

                consolidated = self._ensure_minimum_story_count(
                    base_context,
                    consolidated,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                consolidated = self._ensure_foundation_story_coverage(
                    base_context,
                    consolidated,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                consolidated = self._rebalance_story_batch_for_mvp(
                    base_context,
                    consolidated,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )

        return consolidated[:max_stories]

    def _generate_epic_block_backlog(self, idea):
        """Generate a bounded backlog: one blueprint and small epic batches.

        This is intentionally separate from the former multi-block recovery
        routine, whose complementary-story loops could turn a small backlog
        into dozens of provider calls.
        """
        compact_briefing = self._compact_briefing(idea)
        min_stories, max_stories = self.STORY_RANGE
        planning_context_base = f"""
Voce e um Project Manager Senior especializado em discovery e definicao de backlog.

PROJETO
ID: {self.project_id}

BRIEFING
{compact_briefing}

REGRAS GERAIS
- Responda em portugues.
- Nao invente escopo fora do briefing.
- Planeje uma primeira versao utilizavel antes de evolucoes avancadas.
"""
        overview, capabilities, epics, release_slices = self._generate_backlog_blueprint(
            planning_context_base,
            fallback_overview=compact_briefing,
        )
        stories_per_epic = 4
        try:
            epic_batch_limit = int(os.getenv("PROJECT_MANAGER_EPIC_BLOCK_MAX_EPICS", "6"))
        except (TypeError, ValueError):
            epic_batch_limit = 6
        epic_batch_limit = max(2, min(epic_batch_limit, 6))

        selected_epics = [
            str(epic or "").strip()
            for epic in epics
            if str(epic or "").strip()
        ][:epic_batch_limit]
        if len(selected_epics) < 2:
            raise RuntimeError("Blueprint sem epicos suficientes para gerar blocos de historias.")

        # Keep each provider call small, but do not turn the number of
        # selected epics into a mandatory story count. A coherent backlog may
        # legitimately contain fewer than four stories per epic; quality is
        # bounded by STORY_RANGE, not by a fixed 24-story target.
        planned_story_count = min(max_stories, len(selected_epics) * stories_per_epic)
        required_story_count = min_stories
        print(json.dumps({
            "event": "project_manager_epic_batch_plan_resolved",
            "epics_selected": len(selected_epics),
            "stories_per_epic": stories_per_epic,
            "planned_story_count": planned_story_count,
            "epic_batch_limit": epic_batch_limit,
        }, ensure_ascii=False), file=sys.stderr)

        execution_context = f"""
{planning_context_base}

{self._build_planning_context(overview, capabilities, epics, release_slices)}

Gere apenas user stories em Markdown.
{self._story_block_format_rules()}
""".strip()
        story_blocks = []
        for index, epic in enumerate(selected_epics, start=1):
            story_count_before_epic = len(story_blocks)
            print(json.dumps({
                "event": "project_manager_epic_batch_started",
                "epic_index": index,
                "epic": epic,
                "target_stories": stories_per_epic,
            }, ensure_ascii=False), file=sys.stderr)
            existing_titles = "\n".join(
                f"- {self._story_seed_title(block)}"
                for block in story_blocks
            )
            batch_context = execution_context
            if existing_titles:
                batch_context = f"{execution_context}\n\nHISTORIAS JA GERADAS (NAO REPITA A MESMA INTENCAO):\n{existing_titles}"
            batch = self._generate_thematic_stories(
                batch_context,
                f"Epico {index}: {epic}",
                (
                    f"Cubra exclusivamente o escopo deste epico: {epic}. "
                    "Nao transforme regras de negocio em historias com o ator 'sistema'."
                ),
                target_range=(stories_per_epic, stories_per_epic),
            )
            story_blocks = self._dedupe_and_polish_stories(story_blocks + batch, execution_context)

            # A provider can occasionally end a small batch one story early.
            # Recover only the missing items for this epic instead of losing
            # every successful batch and starting the whole backlog over.
            epic_story_count = len(story_blocks) - story_count_before_epic
            missing_stories = stories_per_epic - epic_story_count
            if missing_stories > 0:
                existing_titles = "\n".join(
                    f"- {self._story_seed_title(block)}"
                    for block in story_blocks
                )
                print(json.dumps({
                    "event": "project_manager_epic_batch_recovery_started",
                    "epic_index": index,
                    "missing_stories": missing_stories,
                }, ensure_ascii=False), file=sys.stderr)
                recovery_batch = self._generate_thematic_stories(
                    f"{execution_context}\n\nHISTORIAS JA GERADAS (NAO REPITA):\n{existing_titles}",
                    f"Epico {index}: {epic} - complemento",
                    (
                        f"Gere somente {missing_stories} historia(s) nova(s) para completar este epico. "
                        "Nao repita as historias ja geradas e nao cubra outro epico."
                    ),
                    target_range=(missing_stories, missing_stories),
                )
                story_blocks = self._dedupe_and_polish_stories(story_blocks + recovery_batch, execution_context)

        story_blocks = story_blocks[:max_stories]
        story_blocks, removed_duplicates = self._deduplicate_epic_story_blocks(story_blocks)
        if removed_duplicates:
            print(json.dumps({
                "event": "project_manager_epic_duplicates_removed",
                "count": len(removed_duplicates),
                "duplicates": removed_duplicates,
            }, ensure_ascii=False), file=sys.stderr)
        quality_issues = self._epic_story_quality_issues(story_blocks)
        if quality_issues:
            print(json.dumps({
                "event": "project_manager_story_quality_advisories",
                "issue_count": len(quality_issues),
                "reasons": [reason for _, reason in quality_issues],
            }, ensure_ascii=False), file=sys.stderr)
        if len(story_blocks) < required_story_count:
            raise RuntimeError(
                f"Blocos por epico geraram {len(story_blocks)} historias; minimo esperado: {required_story_count}."
            )
        self._validate_story_batch_quality(story_blocks, min_stories=required_story_count)
        backlog = self._build_full_backlog_with_structure(
            overview=overview,
            capabilities=capabilities,
            epics=epics,
            release_slices=release_slices,
            story_blocks=story_blocks,
        )
        is_complete, reason = validate_backlog_output(backlog)
        if not is_complete:
            raise RuntimeError(reason or "Backlog por epicos considerado incompleto.")
        contract = self._build_epic_backlog_contract(story_blocks, capabilities)
        evidence_by_id = {
            str(fact.get("id")): str(fact.get("text") or "")
            for fact in contract.get("evidence", {}).get("facts", [])
            if isinstance(fact, dict)
        }
        quality_review = self._review_backlog_contract(
            contract,
            contract.get("evidence", {}),
            evidence_by_id,
        )
        if quality_review.get("decision") != "PASS":
            findings = quality_review.get("findings", [])
            raise BacklogGenerationError(
                "Backlog por epicos reprovado pelo Quality Gate: " + ", ".join(
                    f"{item.get('story_id', 'BACKLOG')}:{item.get('code', 'quality_finding')}"
                    for item in findings
                )
            )
        contract["quality_review"] = {
            "decision": quality_review["decision"],
            "domain": quality_review.get("domain", "generic"),
            "score": quality_review.get("score"),
            "threshold": quality_review.get("threshold", 80),
            "dimensions": quality_review.get("dimensions", {}),
            "repair_attempts": 0,
            "proposals": quality_review.get("proposals", []),
            "questions": quality_review.get("questions", []),
            "history": [{"stage": "epic_blocks_review", **quality_review}],
        }
        return {
            "markdown": backlog,
            "backlog_contract": contract,
        }

    def _generate_multi_block_backlog(self, idea):
        compact_briefing = self._compact_briefing(idea)
        min_stories, max_stories = self.STORY_RANGE
        retry_count = max(1, int(os.getenv("PROJECT_MANAGER_MAX_RETRIES", "1")))
        last_reason = "sem detalhes"

        planning_context_base = f"""
Voce e um Project Manager Senior especializado em discovery e definicao de backlog.

PROJETO
ID: {self.project_id}

BRIEFING
{compact_briefing}

REGRAS GERAIS
- Responda em portugues.
- Pense primeiro na estrutura do backlog antes de escrever historias.
- Use linguagem de produto clara, especifica e executavel.
- Cubra fundacao, operacao, gestao e governanca.
- Nao aceite historias genéricas como "visualizar dados" ou "gerenciar fluxo" sem objeto, contexto ou efeito observavel.
- Prefira historias com ator, acao, objeto e efeito de negocio claros.
- Se a ideia for ampla, transforme em backlog com cobrancas concretas e nao em frases conceituais.
"""

        story_generation_base = f"""
Voce e um Project Manager Senior especializado em discovery e definicao de backlog.

PROJETO
ID: {self.project_id}

BRIEFING
{compact_briefing}

REGRAS GERAIS
- Responda em portugues.
- Gere apenas user stories.
- Nao inclua epicos nem tarefas tecnicas.
- Use personas especificas e reais.
- Evite repetir "usuario" de forma generica.
- Cada story deve vir em um bloco com titulo e descricao curta.
{self._story_block_format_rules()}
- Mantenha o backlog entre {min_stories} e {max_stories} historias.
- Cada story deve cobrir uma acao verificavel de negocio e nao apenas uma intencao abstrata.
- Cada story deve deixar claro o que o usuario faz, o que o sistema confirma e qual o efeito observavel.
- Distribua o backlog para que haja historias de fundacao, operacao, visibilidade e governanca.
"""

        for _attempt in range(1, retry_count + 1):
            try:
                overview, capabilities, epics, release_slices = self._generate_backlog_blueprint(planning_context_base)
                planning_context = self._build_planning_context(overview, capabilities, epics, release_slices)
                execution_context = f"{story_generation_base}\n\n{planning_context}".strip()

                combined_story_blocks = self._collect_story_blocks_incrementally(
                    execution_context,
                    min_stories=min_stories,
                    max_stories=max_stories,
                    epics=epics,
                )

                if len(combined_story_blocks) >= min_stories:
                    curated_section = self._curate_story_batch(
                        execution_context,
                        combined_story_blocks,
                        min_stories=min_stories,
                        max_stories=max_stories,
                    )
                    combined_story_blocks = self._dedupe_and_polish_stories(
                        self._extract_story_lines(curated_section),
                        execution_context,
                    )

                combined_story_blocks = self._ensure_minimum_story_count(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._ensure_foundation_story_coverage(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._ensure_lane_story_coverage(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._rebalance_story_batch_for_mvp(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )

                if len(combined_story_blocks) < min_stories:
                    fallback_blocks = self._generate_missing_stories_fallback(
                        execution_context,
                        combined_story_blocks,
                        needed_count=min_stories - len(combined_story_blocks),
                    )
                    if fallback_blocks:
                        combined_story_blocks = self._dedupe_and_polish_stories(
                            combined_story_blocks + fallback_blocks,
                            execution_context,
                        )

                combined_story_blocks = self._ensure_minimum_story_count(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._ensure_foundation_story_coverage(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._ensure_lane_story_coverage(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                combined_story_blocks = self._rebalance_story_batch_for_mvp(
                    execution_context,
                    combined_story_blocks,
                    min_stories=min_stories,
                    max_stories=max_stories,
                )

                combined_story_blocks = combined_story_blocks[:max_stories]
                self._validate_story_batch_quality(combined_story_blocks, min_stories=min_stories)
                full_backlog = self._build_full_backlog_with_structure(
                    overview=overview,
                    capabilities=capabilities,
                    epics=epics,
                    release_slices=release_slices,
                    story_blocks=combined_story_blocks,
                )

                story_count = self._extract_story_count(full_backlog)
                if story_count < min_stories:
                    raise RuntimeError(
                        f"Backlog consolidado com poucas historias ({story_count}). Minimo esperado: {min_stories}."
                    )

                is_complete, reason = validate_backlog_output(full_backlog)
                if is_complete:
                    return full_backlog

                repaired_backlog = self._repair_backlog_output(
                    execution_context,
                    full_backlog,
                    overview,
                    combined_story_blocks,
                    reason or "",
                    min_stories=min_stories,
                    max_stories=max_stories,
                )
                repaired_ok, repaired_reason = validate_backlog_output(repaired_backlog)
                if repaired_ok:
                    return repaired_backlog

                last_reason = repaired_reason or reason or "Backlog considerado incompleto."
            except Exception as error:
                last_reason = str(error) or "Falha ao montar o backlog."

        raise RuntimeError(
            f"O agente project_manager nao conseguiu gerar uma resposta completa apos {retry_count} tentativas. "
            f"Ultimo motivo: {last_reason}"
        )

    def process(self, idea, elicitation_state=None, elicitation_answers=None, incremental_checkpoint=None):
        # Stories are product decisions. Never replace an unavailable or invalid
        # AI result with deterministic content that can silently invent scope.
        self._current_idea = str(idea or "")
        self._incremental_checkpoint = incremental_checkpoint if isinstance(incremental_checkpoint, dict) else None
        normalized_idea = unicodedata.normalize("NFKD", self._current_idea)
        normalized_idea = "".join(char for char in normalized_idea if not unicodedata.combining(char)).lower()
        supplied_answers = self._normalize_elicitation_answers(elicitation_answers)
        previous_questions = elicitation_state.get("questions", []) if isinstance(elicitation_state, dict) else []
        previous_answers = self._normalize_elicitation_answers(elicitation_state.get("answers") if isinstance(elicitation_state, dict) else {})
        # One response must not bypass unresolved blocking questions.
        self._clarifications_answered = bool(previous_questions) and all(
            previous_answers.get(str(item.get("id"))) or supplied_answers.get(str(item.get("id")))
            for item in previous_questions if isinstance(item, dict) and item.get("blocking", True)
        )
        self._clarifications_answered = self._clarifications_answered or ("clarificacoes respondidas:" in normalized_idea and not previous_questions)
        self._requirements_contract = self._analyze_requirements_contract(idea)
        self._elicitation_state = self._build_elicitation_state(self._requirements_contract, elicitation_state, supplied_answers)
        blocking_questions = self._elicitation_state.get("readiness", {}).get("blocking_question_details", [])
        if blocking_questions:
            return {
                "clarification_required": True,
                "elicitation_required": True,
                "clarifications": [
                    {
                        "id": item["id"], "question": item["question"], "story_ids": [],
                        "reason": item.get("reason", ""), "answer_hint": item.get("answer_hint", ""),
                    }
                    for item in blocking_questions
                ],
                "requirements_contract": self._requirements_contract,
                "elicitation": self._elicitation_state,
            }
        generation_mode = str(os.getenv("PROJECT_MANAGER_GENERATION_MODE", "single_pass") or "single_pass").strip().lower()
        if generation_mode != "single_pass":
            # Epic fragments cannot prove cross-story scope, dependency and
            # acceptance consistency. Keep the setting observable, but use
            # the canonical structured-contract path for publication data.
            print(json.dumps({
                "event": "project_manager_generation_mode_overridden",
                "requested": generation_mode,
                "effective": "single_pass",
                "reason": "canonical_contract_required",
            }, ensure_ascii=False), file=sys.stderr)
        print("[Project Manager] estrategia=single_pass", file=sys.stderr)
        generated_backlog = self._generate_ai_backlog(idea)
        if isinstance(generated_backlog, dict) and generated_backlog.get("clarification_required"):
            return generated_backlog
        if isinstance(generated_backlog, str):
            generated_backlog = {"markdown": generated_backlog, "backlog_contract": {"evidence": {"facts": []}, "stories": []}}
        generated_backlog.setdefault("backlog_contract", {})["requirements_contract"] = self._requirements_contract
        self._elicitation_state["status"] = "READY_FOR_REVIEW"
        self._elicitation_state["phase_history"].extend([
            {"phase": "SYNTHESIS", "status": "completed"},
            {"phase": "READY_FOR_REVIEW", "status": "active"},
        ])
        story_context = {
            "product_intent": str(idea or "").strip(),
            "confirmed_rules": [item["decision"] for item in self._elicitation_state.get("confirmed_decisions", [])],
            "assumptions": self._elicitation_state.get("assumptions", []),
            "open_questions": self._elicitation_state.get("open_questions", []),
            "evidence": self._elicitation_state.get("evidence", []),
            "elicitation_readiness": self._elicitation_state.get("readiness", {}),
        }
        generated_backlog["backlog_contract"]["elicitation"] = self._elicitation_state
        generated_backlog["backlog_contract"]["story_context"] = story_context
        generated_backlog["story_context"] = story_context
        return generated_backlog
