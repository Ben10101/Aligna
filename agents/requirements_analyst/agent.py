# -*- coding: utf-8 -*-
import os
import re
import sys
import json
import unicodedata

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

"""
Requirements Analyst Agent
Refinamento detalhado de User Story em nivel pronto para desenvolvimento
"""

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response
from agents.developer.response_validation import validate_requirements_output


class RequirementsAnalyst:
    # Verbs represent user journeys, not fields joined by "e".  The list is
    # intentionally domain-neutral; regulated domains add their own semantic
    # guardrails elsewhere.
    SCOPE_ACTIONS = (
        "acessar", "simular", "iniciar", "enviar", "preencher", "informar", "cadastrar", "criar",
        "registrar", "consultar", "acompanhar", "validar", "aprovar", "reprovar",
        "solicitar", "corrigir", "revisar", "decidir", "cancelar", "editar",
        "administrar", "gerenciar", "atualizar", "renovar", "alugar",
    )
    SECTION_TITLES = [
        "User Story Refinada",
        "Requisitos Funcionais",
        "Fluxo Principal",
        "Fluxos Alternativos",
        "Fluxos de Excecao",
        "Regras de Negocio",
        "Estados da Interface e Feedback",
        "Validacoes e Dados",
        "Permissoes e Auditoria",
        "Criterios de Aceite (BDD)",
    ]

    SECTION_ALIASES = {
        "User Story Refinada": ["User Story Refinada", "User Story"],
        "Requisitos Funcionais": ["Requisitos Funcionais", "RFs", "Requisitos"],
        "Fluxo Principal": ["Fluxo Principal", "Fluxo"],
        "Fluxos Alternativos": ["Fluxos Alternativos", "Alternativas"],
        "Fluxos de Excecao": ["Fluxos de Excecao", "Excecoes"],
        "Regras de Negocio": ["Regras de Negocio", "Regras"],
        "Estados da Interface e Feedback": ["Estados da Interface e Feedback", "Estados", "Feedback"],
        "Validacoes e Dados": ["Validacoes e Dados", "Validacoes", "Dados"],
        "Permissoes e Auditoria": ["Permissoes e Auditoria", "Permissoes", "Auditoria"],
        "Criterios de Aceite (BDD)": ["Criterios de Aceite (BDD)", "Criterios de Aceite", "BDD"],
    }

    SECTION_KEYS = {
        "user story refinada": "User Story Refinada",
        "requisitos funcionais": "Requisitos Funcionais",
        "fluxo principal": "Fluxo Principal",
        "fluxos alternativos": "Fluxos Alternativos",
        "fluxos de excecao": "Fluxos de Excecao",
        "regras de negocio": "Regras de Negocio",
        "estados da interface e feedback": "Estados da Interface e Feedback",
        "validacoes e dados": "Validacoes e Dados",
        "permissoes e auditoria": "Permissoes e Auditoria",
        "criterios de aceite": "Criterios de Aceite (BDD)",
    }

    def __init__(self, project_id):
        self.project_id = project_id
        self.last_refinement_contract = None
        self.last_evidence_report = None

    def _normalize_text(self, value):
        text = unicodedata.normalize("NFD", str(value or "").strip().lower())
        text = "".join(char for char in text if not unicodedata.combining(char))
        return re.sub(r"\s+", " ", text)

    def _normalize_semantic_label(self, value, fallback):
        """Keep LLM classifications compact without letting prose fail refinement.

        ``domain`` and ``intent`` are routing metadata for the refinement
        contract, rather than evidence-bearing business requirements. Smaller
        local models occasionally answer with prose such as "o dominio e
        ecommerce" even when the requested schema is otherwise valid. Remove
        that framing when it leaves a short label; otherwise use the
        deterministic story classification already used by the agent.
        """
        normalized = self._normalize_text(value)
        tokens = re.findall(r"[a-z0-9]+", normalized)
        framing_tokens = {
            "a", "as", "e", "eh", "o", "os",
            "classificacao", "dominio", "historia", "intencao", "intent", "label", "rotulo",
            "para", "que", "semantica", "semantico", "uma", "um",
        }
        label_tokens = [token for token in tokens if token not in framing_tokens]
        label = "_".join(label_tokens)

        if 1 <= len(label_tokens) <= 3 and len(label) <= 48:
            return label
        return fallback

    def _classify_story_type(self, idea):
        normalized = self._normalize_text(idea)
        if "definir escopo" in normalized:
            return "scope-definition"
        if "cadastrar" in normalized:
            return "register"
        if "criar" in normalized:
            return "create"
        if "registrar" in normalized:
            return "record"
        if re.search(r"\b(renovar|alugar novamente|recontratar)\b", normalized):
            return "renewal"
        if re.search(r"\b(administrar|gerenciar|atualizar)\b", normalized):
            return "manage"
        if "aprovar" in normalized or "reprovar" in normalized:
            return "approval"
        if "visualizar" in normalized or "consultar" in normalized:
            return "view"
        if "atualizar status" in normalized or "alterar status" in normalized:
            return "status-update"
        return "generic"

    def _classify_domain(self, idea, backlog, project_context=None):
        # Domain is descriptive metadata, not a switch for a special rule set.
        # Every project is governed by the evidence in its own context.
        return "contextual"

    def _classify_intent(self, idea):
        source = self._normalize_text(idea)
        # Intent is the action requested by the actor, not every noun mentioned
        # in its context.  A proposal created *from* a simulation is not itself
        # a simulation and must not inherit financial-calculation guardrails.
        action_match = re.search(r"\b(?:eu\s+)?quero\s+([^,.\n]+)", source)
        action = action_match.group(1).strip() if action_match else source
        if re.match(r"^(simular|fazer simulacao|realizar simulacao)\b", action):
            return "simulation"
        return self._classify_story_type(idea)

    def _assess_scope(self, idea, semantic_context=None):
        """Identify multiple top-level journeys using semantic actions."""
        normalized = self._normalize_text(idea)
        # Browsing a collection and opening an item's details are sequential
        # steps of one discovery journey, not independent deliveries. A model
        # may mark both as primary actions, so reconcile that classification
        # against the story wording before blocking the refinement.
        is_navigation_to_detail_journey = (
            bool(re.search(r"\b(navegar|explorar|listar|consultar)\b", normalized))
            and bool(re.search(r"\b(visualizar|ver)\b", normalized))
            and bool(re.search(r"\bdetalh", normalized))
        )
        if is_navigation_to_detail_journey:
            return {
                "status": "atomic",
                "actions": ["navegar e visualizar detalhes"],
                "action_phrase": "navegar para visualizar detalhes",
                "source": "journey_exception",
            }
        # The benefit clause ("para ...") may mention other capabilities that
        # this story enables. It is not evidence that the actor requested those
        # capabilities in the same delivery. Scope starts with the action in
        # the "eu quero" clause; a semantic classifier cannot promote a
        # downstream benefit into an independent journey.
        action_match = re.search(r"\b(?:eu\s+)?quero\s+([^,.\n]+)", normalized)
        action_phrase = action_match.group(1) if action_match else normalized
        explicit_actions = [
            action for action in self.SCOPE_ACTIONS
            if re.search(rf"\b{re.escape(action)}\b", action_phrase)
        ]
        if len(explicit_actions) <= 1:
            return {
                "status": "atomic",
                "actions": explicit_actions,
                "action_phrase": action_phrase,
                "source": "explicit_action",
            }
        semantic_actions = [str(item.get("text") or "").strip() for item in (semantic_context or {}).get("actions", []) if isinstance(item, dict) and str(item.get("text") or "").strip() and str(item.get("role") or "primary").strip().lower() == "primary"]
        semantic_goals = [str(item.get("text") or "").strip() for item in (semantic_context or {}).get("goals", []) if isinstance(item, dict) and str(item.get("text") or "").strip() and str(item.get("role") or "primary").strip().lower() == "primary"]
        if semantic_actions or semantic_goals:
            actions = semantic_goals or semantic_actions
            return {"status": "needs_split" if len(actions) > 1 else "atomic", "actions": actions, "action_phrase": " | ".join(actions), "source": "semantic"}
        actions = explicit_actions.copy()
        # Administration stories commonly hide several independent journeys
        # behind one verb. Treat each explicitly named catalog concern as a
        # separate action so the PM/RA pipeline asks for a split decision.
        if re.search(r"\b(administrar|gerenciar)\b", action_phrase):
            for concern in ("titulos", "metadados", "precos", "disponibilidade"):
                if re.search(rf"\b{concern}\b", action_phrase) and concern not in actions:
                    actions.append(concern)
            if len(actions) == 1 and re.search(r"\b(catalogo|videos?)\b", action_phrase):
                actions.append("catalogo")
        return {
            "status": "needs_split" if len(actions) > 1 else "atomic",
            "actions": actions,
            "action_phrase": action_phrase,
            "source": "deterministic",
        }

    def _scope_split_diagnostic(self, idea, scope):
        actions = [str(action).strip() for action in scope.get("actions") or [] if str(action).strip()]
        return {
            "scope_review": {
                "decision": "needs_split",
                "reason": "A história reúne jornadas independentes que devem ser refinadas e entregues separadamente.",
                "independent_journeys": actions,
                "suggested_stories": [
                    f"Como responsável autorizado, quero {action}, para concluir esta jornada sem acoplar outras capacidades."
                    for action in actions
                ],
                "questions": [
                    "Quais jornadas devem permanecer no MVP e em qual ordem devem ser entregues?",
                    "Há regras, permissões ou efeitos entre essas jornadas que precisam ser definidos antes da implementação?",
                ],
                "story": str(idea or "").strip(),
                "assessment_source": scope.get("source") or "unknown",
            }
        }

    def _feature_profile(self, idea, project_context=None, semantic_context=None):
        # Classify only the current story.  The project context intentionally
        # contains related backlog stories, so using it wholesale would make a
        # simple consultation inherit document/form guardrails from another task.
        context = project_context if isinstance(project_context, dict) else {}
        story_context = context.get("storyContext") if isinstance(context.get("storyContext"), dict) else {}
        current_story = story_context.get("currentStory") if isinstance(story_context.get("currentStory"), dict) else {}
        source = self._normalize_text(" ".join([
            str(idea or ""),
            str(current_story.get("title") or ""),
            str(current_story.get("description") or ""),
        ]))
        has_document = bool(re.search(r"\b(document|arquivo|upload|anex)\b", source))
        has_form = bool(re.search(r"\b(formulario|preench|dado pessoal|dado financeiro|cadastro)\b", source))
        has_input = has_document or has_form or bool(re.search(r"\b(valor|prazo|parcela|informar)\b", source))
        has_sensitive_data = has_document or bool(re.search(r"\b(dado pessoal|dado financeiro|credito|renda|cpf|privacidade|lgpd)\b", source))
        semantic = semantic_context if isinstance(semantic_context, dict) else {}
        if all(isinstance(semantic.get(key), bool) for key in ("has_input", "has_document", "has_form", "has_sensitive_data")):
            has_input = semantic["has_input"]
            has_document = semantic["has_document"]
            has_form = semantic["has_form"]
            has_sensitive_data = semantic["has_sensitive_data"]
        return {
            "has_input": has_input,
            "has_document": has_document,
            "has_form": has_form,
            "has_sensitive_data": has_sensitive_data,
        }

    def _compact_project_context(self, project_context):
        context = project_context if isinstance(project_context, dict) else {}
        dna = context.get("projectDna") if isinstance(context.get("projectDna"), dict) else {}
        backlog_contract = context.get("backlogContract") if isinstance(context.get("backlogContract"), dict) else {}
        project = dna.get("project") if isinstance(dna.get("project"), dict) else {}
        positioning = dna.get("positioning") if isinstance(dna.get("positioning"), dict) else {}
        coherence = dna.get("coherenceRules") if isinstance(dna.get("coherenceRules"), dict) else {}
        story_context = context.get("storyContext") if isinstance(context.get("storyContext"), dict) else {}
        current_story = story_context.get("currentStory") if isinstance(story_context.get("currentStory"), dict) else {}

        def strings(value, limit=8):
            return [str(item).strip() for item in (value or []) if str(item).strip()][:limit]

        return {
            "description": context.get("description") or None,
            "vision": context.get("vision") or None,
            "domain": strings(project.get("domainLanguage")),
            "actors": [project.get("primaryActor")] if project.get("primaryActor") else [],
            "capabilities": [item.get("name") for item in backlog_contract.get("capabilities", []) if isinstance(item, dict) and item.get("name")][:6],
            "constraints": strings(context.get("constraints")) + strings(coherence.get("mustPreserve")) + strings(coherence.get("forbiddenDrift")),
            "known_policies": strings(context.get("policies")) + strings(context.get("knownPolicies")),
            "flows": [item.get("goal") or item.get("name") for item in backlog_contract.get("releaseSlices", []) if isinstance(item, dict) and (item.get("goal") or item.get("name"))][:5],
            "backlog_stories": [item.get("title") for item in backlog_contract.get("stories", []) if isinstance(item, dict) and item.get("title")][:6],
            "current_story_id": current_story.get("id") or None,
            "current_story_refinement_context": current_story.get("refinementContext") or current_story.get("refinement_context") or {},
            "related_stories": [
                {"id": item.get("id"), "title": item.get("title")}
                for item in story_context.get("relatedStories", [])
                if isinstance(item, dict) and item.get("id") and item.get("title")
            ][:6],
            "positioning": positioning.get("summary") or None,
        }

    def _build_refinement_contract(self, idea, backlog, project_context=None):
        semantic_context = self._discover_semantic_context(idea, backlog, project_context)
        domain = semantic_context.get("domain") or "generic"
        intent = semantic_context.get("intent") or "generic"
        # This is a traceability envelope, not a catalogue of business rules.  In
        # particular, do not encode domain defaults here: the model must derive
        # business meaning from the story and the supplied project sources.
        contract = {
            "domain": domain,
            "intent": intent,
            "inputs": [],
            "outputs": [],
            "confirmed_rules": [],
            "assumptions": [],
            "open_questions": [
                {
                    "id": str(item.get("id") or f"OQ-{index + 1:02d}"),
                    "text": str(item.get("question") or "").strip(),
                    "category": str(item.get("category") or "fluxo").strip(),
                    "priority": str(item.get("priority") or "medium").strip(),
                    "decision_needed": str(item.get("decision_needed") or "").strip(),
                    "impact": str(item.get("impact") or "").strip(),
                }
                for index, item in enumerate(semantic_context.get("clarifying_questions", []))
                if isinstance(item, dict) and str(item.get("question") or "").strip()
            ],
            "dependencies": [],
            "acceptance_criteria": [],
            "evidence_sources": self._evidence_sources(idea, backlog, project_context),
            "feature_profile": self._feature_profile(idea, project_context, semantic_context),
            "scope_assessment": self._assess_scope(idea, semantic_context),
            "upstream_context": ((project_context or {}).get("storyContext") or {}).get("currentStory", {}).get("refinementContext", {}) if isinstance(project_context, dict) else {},
            "semantic_context": semantic_context,
            "compact_context": self._compact_project_context(project_context),
        }
        current_story = ((project_context or {}).get("storyContext") or {}).get("currentStory") if isinstance(project_context, dict) else {}
        if isinstance(current_story, dict):
            contract["upstream_story_id"] = current_story.get("id") or None
            contract["upstream_review"] = {
                "status": current_story.get("status"),
                "tags": current_story.get("reviewTags") or [],
                "questions": current_story.get("openQuestions") or [],
                "assessment": (current_story.get("lastAgentReview") or {}).get("assessment") or {},
            }
        self.last_refinement_contract = contract
        # This is intentionally serializable: consumers can inspect it during a run without
        # changing the persisted Markdown artifact contract.
        json.dumps(contract, ensure_ascii=False)
        return contract

    def _discover_semantic_context(self, idea, backlog, project_context=None):
        """Extract project-specific semantics using the LLM, not code lists."""
        compact = self._compact_project_context(project_context)
        prompt = ("Voce e analista senior de Requirements Engineering. Extraia o contexto semantico desta user story usando somente as fontes fornecidas. "
                  "Retorne APENAS um objeto JSON valido, sem Markdown. Inclua TODAS as chaves: domain, intent, has_input, has_document, has_form, has_sensitive_data, actors, entities, goals, actions, states, ambiguities e clarifying_questions. Os campos has_input, has_document, has_form e has_sensitive_data devem ser os booleanos JSON true ou false, sem aspas e nunca null. "
                  "actors, entities, states e ambiguities devem ser sempre listas de objetos {text, evidence, confidence}; goals e actions devem ser sempre listas de objetos {text, evidence, confidence, role}; clarifying_questions deve ser sempre uma lista. Quando nao houver evidencia, retorne [] — nunca null, string ou objeto isolado. "
                  "Cada goal/action deve ter role=primary ou supporting. Filtros, ordenacao, selecao e preenchimento que apenas qualificam uma consulta sao supporting e nao criam nova jornada. "
                  "Cada clarifying_question deve ter id, question (pergunta direta e contextualizada), decision_needed, impact, category e priority. "
                  "domain e intent devem ser rotulos curtos (uma a tres palavras, sem frases ou evidencias), por exemplo domain=ecommerce e intent=add_to_cart. Nunca escreva 'o dominio e ...' ou 'a intencao e ...'. Cada item deve ter text, evidence literal da fonte e confidence entre 0 e 1. Se nao estiver presente, use lista vazia. "
                  f"USER STORY: {idea}\nBACKLOG: {backlog}\nCONTEXTO: {json.dumps(compact, ensure_ascii=False)}")
        result = generate_text_from_llm(
            prompt,
            options_override={
                "temperature": 0.0,
                "num_predict": 900,
                # A descoberta semântica também usa saída estruturada e passa
                # pelo mesmo fallback remoto; 35s a encerrava antes da resposta
                # do NVIDIA.
                "request_timeout_seconds": min(
                    90,
                    max(75, int(os.getenv("REQUIREMENTS_LLM_REQUEST_TIMEOUT_SECONDS", "75"))),
                ),
                "transient_retries": 1,
                "json_mode": True,
                # JSON mode is a provider hint. Require an actual complete
                # object at the router boundary so invalid free-model output
                # triggers a fallback instead of failing inside the RA.
                "require_json_object": True,
            },
            use_cache=False,
            task="requirements_analysis",
        )
        semantic = self._extract_json_object(result)
        if not isinstance(semantic, dict):
            raise RuntimeError("Descoberta semantica retornou JSON invalido.")
        source_corpus = self._normalize_text(f"{idea} {backlog} {json.dumps(compact, ensure_ascii=False)}")
        for key in ("actors", "entities", "goals", "actions", "states", "ambiguities"):
            values = semantic.get(key)
            # Some providers represent an empty extracted category as null or
            # omit it. Both mean the same as the contract's required empty
            # list and are safe to normalize; malformed non-list values remain
            # rejected below to preserve the evidence contract.
            if values is None:
                values = []
                semantic[key] = values
            if not isinstance(values, list):
                raise RuntimeError(f"Descoberta semantica sem lista valida em {key}.")
            verified_values = []
            for item in values:
                # A descoberta é um apoio para organizar o requisito, nunca uma
                # fonte de verdade. Descarte somente a sugestão mal ancorada em
                # vez de falhar toda a execução quando o modelo parafrasear uma
                # evidência (caso observado em "states").
                if not isinstance(item, dict) or not str(item.get("text") or "").strip() or not str(item.get("evidence") or "").strip():
                    continue
                evidence = self._normalize_text(item.get("evidence"))
                if not evidence or evidence not in source_corpus:
                    continue
                try:
                    confidence = float(item.get("confidence", 0))
                except (TypeError, ValueError):
                    continue
                if not 0 <= confidence <= 1:
                    continue
                if key in {"goals", "actions"} and str(item.get("role") or "primary").strip().lower() not in {"primary", "supporting"}:
                    continue
                verified_values.append(item)
            semantic[key] = verified_values
        questions = semantic.get("clarifying_questions", [])
        if questions is None:
            questions = []
            semantic["clarifying_questions"] = questions
        if not isinstance(questions, list):
            raise RuntimeError("Descoberta semantica sem clarifying_questions valido.")
        for question in questions:
            if not isinstance(question, dict) or not all(str(question.get(key) or "").strip() for key in ("question", "decision_needed", "impact", "category", "priority")):
                raise RuntimeError("Pergunta sem contexto especialista completo.")
            if not str(question["question"]).strip().endswith("?"):
                raise RuntimeError("Pergunta sem pontuacao final valida.")
        semantic["domain"] = self._normalize_semantic_label(
            semantic.get("domain"),
            self._classify_domain(idea, backlog, project_context),
        )
        semantic["intent"] = self._normalize_semantic_label(
            semantic.get("intent"),
            self._classify_intent(idea),
        )
        fallback_profile = self._feature_profile(idea, project_context)
        for key in ("has_input", "has_document", "has_form", "has_sensitive_data"):
            value = semantic.get(key)
            if isinstance(value, bool):
                continue
            if isinstance(value, str) and value.strip().lower() in {"true", "false"}:
                semantic[key] = value.strip().lower() == "true"
                continue
            # These fields are classification flags, not business facts. When
            # a provider omits or malforms one, derive it from the current
            # story only instead of aborting an otherwise valid refinement.
            semantic[key] = fallback_profile[key]
        return semantic

    def _apply_contract_guardrails(self, contract, expected):
        """Carry upstream review state and feature-critical gaps into the AI contract.

        These are not invented requirements: they remain open questions and
        make an applicable section visible instead of allowing a misleading
        'Nao se aplica'.
        """
        contract["feature_profile"] = expected.get("feature_profile") or {}
        contract["upstream_review"] = expected.get("upstream_review") or {}
        contract["scope_assessment"] = expected.get("scope_assessment") or {"status": "atomic", "actions": []}
        contract["upstream_context"] = expected.get("upstream_context") or {}

        # A provider can occasionally emit replacement characters.  Never
        # persist them as requirements: authoritative upstream criteria are
        # promoted below and provide the safe equivalent fact when available.
        asserted_keys = (
            "actors", "inputs", "outputs", "confirmed_rules", "main_flow",
            "alternative_flows", "exception_flows", "interface_feedback",
            "validation_data", "permissions_audit", "dependencies",
        )
        for key in asserted_keys:
            values = contract.get(key)
            if isinstance(values, list):
                contract[key] = [
                    item for item in values
                    if isinstance(item, dict) and "\ufffd" not in str(item.get("text") or item.get("name") or "")
                ]
        if isinstance(contract.get("acceptance_criteria"), list):
            contract["acceptance_criteria"] = [
                item for item in contract["acceptance_criteria"]
                if isinstance(item, dict) and "\ufffd" not in " ".join(str(item.get(field) or "") for field in ("given", "when", "then"))
            ]
        valid_source_ids = {
            item.get("id") for item in expected.get("evidence_sources", [])
            if isinstance(item, dict) and item.get("id")
        }
        # Providers sometimes copy illustrative IDs (for example briefing.1)
        # that are not part of the evidence envelope. Keep the claim traceable
        # by binding those IDs to the always-present user-story source.
        if "user_story" in valid_source_ids:
            for key in ("refined_story", "actors", "inputs", "outputs", "confirmed_rules", "main_flow",
                        "alternative_flows", "exception_flows", "interface_feedback", "validation_data",
                        "permissions_audit", "dependencies", "acceptance_criteria"):
                values = contract.get(key)
                if isinstance(values, dict):
                    values = [values]
                    contract[key] = values[0] if key == "refined_story" else values
                if not isinstance(values, list):
                    continue
                for item in values:
                    if not isinstance(item, dict) or not isinstance(item.get("source_ids"), list):
                        continue
                    item["source_ids"] = [source_id if source_id in valid_source_ids else "user_story" for source_id in item["source_ids"]]
        questions = contract.setdefault("open_questions", [])
        upstream_context = contract["upstream_context"] if isinstance(contract["upstream_context"], dict) else {}
        upstream_criteria_for_questions = upstream_context.get("acceptance_criteria") or upstream_context.get("acceptanceCriteria") or []
        upstream_then_text = self._normalize_text(" ".join(
            str(item.get("then") or "") for item in upstream_criteria_for_questions if isinstance(item, dict)
        ))
        upstream_source_text = self._normalize_text(json.dumps(upstream_context, ensure_ascii=False))

        def is_product_question(item):
            text = self._normalize_text(item.get("text") or "") if isinstance(item, dict) else ""
            if not text:
                return False
            if re.search(r"\b(mecanismo|tecnologia|infraestrutura|banco de dados|endpoint|api|implementacao|verificacao de status)\b", text):
                return False
            # The exact user-facing message is already a resolved decision.
            if "motivo" in text and "manutencao" in text and "mensagem" in upstream_then_text:
                return False
            if re.search(r"\b(obrigatoriedade|formato|consistencia|dados ausentes|dados invalidos)\b", text) and not re.search(r"\b(campo|formulario|dados? informado|preench|matricula|senha)\b", upstream_source_text):
                return False
            return True

        questions[:] = [item for item in questions if is_product_question(item)]
        existing = " ".join(str(item.get("text") or "") for item in questions if isinstance(item, dict)).lower()
        profile = contract["feature_profile"]
        required_questions = []
        for question in contract["upstream_context"].get("open_questions", []) if isinstance(contract["upstream_context"], dict) else []:
            if str(question).strip():
                required_questions.append(("upstream_context", str(question).strip()))
        scope = contract["scope_assessment"]
        if scope.get("status") == "needs_split":
            action_labels = ", ".join(scope.get("actions") or [])
            required_questions.append(("escopo", f"A historia reune as acoes '{action_labels}'. Confirmar se devem ser refinadas e entregues como jornadas independentes."))
        evidence_text = self._normalize_text(" ".join(
            str(item.get("text") or "") for item in expected.get("evidence_sources", []) if isinstance(item, dict)
        ))
        has_explicit_data_entry = bool(re.search(r"\b(campo|formulario|formulario|dados? informado|preench|matricula|senha)\b", evidence_text))
        if profile.get("has_input") and has_explicit_data_entry and expected.get("intent") not in {"view", "summary"}:
            required_questions.append(("validacao", "Definir obrigatoriedade, formato, consistencia e comportamento para dados ausentes ou invalidos."))
        if profile.get("has_document"):
            required_questions.append(("documentos", "Definir politica de documentos: tipos aceitos, tamanho, quantidade, falha de envio, substituicao e validacao."))
        if profile.get("has_sensitive_data"):
            required_questions.append(("privacidade", "Definir perfis de acesso, finalidade, retencao e rastreabilidade para dados pessoais, financeiros ou documentos."))
        for category, text in required_questions:
            if self._normalize_text(text) not in self._normalize_text(existing):
                questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": text, "category": category, "priority": "high"})
        questions[:] = [item for item in questions if is_product_question(item)]

        # A consultation story is only implementable when the displayed data
        # and classification rules are explicit. Keep these as decisions to be
        # answered, never as inferred product behaviour.
        if expected.get("intent") in {"view", "summary"}:
            view_questions = [
                ("dados", "Quais campos devem ser exibidos em cada locacao (por exemplo titulo, status, inicio, expiracao e tempo restante)?", "high"),
                ("regra-de-negocio", "Qual regra determina se uma locacao e considerada ativa ou expirada, incluindo a referencia de data e hora?", "high"),
                ("fluxo", "Como a tela deve se comportar quando o cliente nao possui locacoes?", "medium"),
                ("dados", "A consulta precisa de ordenacao, filtros ou paginacao? Se sim, quais opcoes?", "medium"),
            ]
            for category, text, priority in view_questions:
                if self._normalize_text(text) not in self._normalize_text(" ".join(str(item.get("text") or "") for item in questions if isinstance(item, dict))):
                    questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": text, "category": category, "priority": priority})

            # Authentication/ownership/audit are sensitive decisions. They can
            # only remain confirmed when the source explicitly states them.
            source_text = self._normalize_text(" ".join(
                str(item.get("text") or "") for item in expected.get("evidence_sources", [])
                if isinstance(item, dict)
            ))
            permissions = contract.get("permissions_audit") if isinstance(contract.get("permissions_audit"), list) else []
            unsupported_permission = any(
                isinstance(item, dict)
                and re.search(r"\b(autentic|login|proprio|titular|perfil|historico|auditoria|permiss)", self._normalize_text(item.get("text")))
                and not re.search(r"\b(autentic|login|proprio|titular|perfil|historico|auditoria|permiss)", source_text)
                for item in permissions
            )
            if unsupported_permission:
                contract["permissions_audit"] = []
                questions.append({
                    "id": f"OQ-{len(questions) + 1:02d}",
                    "text": "Confirmar quais permissoes e regras de titularidade devem proteger a consulta das locacoes.",
                    "category": "permissao",
                    "priority": "high",
                })
            # A model may place an unsupported access claim in a flow, rule or
            # acceptance criterion instead of the permissions section. Remove
            # those claims from confirmed lists so the artifact cannot present
            # an invented policy as fact.
            permission_pattern = re.compile(r"\b(controle de acesso|acesso autorizado|protecao contra compartilhamento|somente o proprio|apenas o proprio|perfil de administrador|autenticacao obrigatoria|login obrigatorio)\b", re.IGNORECASE)
            has_permission_source = bool(re.search(r"\b(controle de acesso|acesso autorizado|protecao contra compartilhamento|autenticacao|login|permiss)\b", source_text))
            if not has_permission_source:
                for key in ("actors", "inputs", "outputs", "confirmed_rules", "main_flow", "alternative_flows", "exception_flows", "interface_feedback", "validation_data", "dependencies", "acceptance_criteria"):
                    values = contract.get(key)
                    if not isinstance(values, list):
                        continue
                    kept = []
                    removed = False
                    for value in values:
                        text = str((value or {}).get("text") or (value or {}).get("then") or "") if isinstance(value, dict) else str(value or "")
                        if permission_pattern.search(text):
                            removed = True
                        else:
                            kept.append(value)
                    contract[key] = kept
                    if removed:
                        questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": "Confirmar se existe alguma regra de autenticação, titularidade ou controle de acesso para esta operação.", "category": "permissao", "priority": "high"})

        # Apply the same evidence guard to every intent. A provider can emit an
        # access policy even when the story is classified as browse/search.
        source_text = self._normalize_text(" ".join(str(item.get("text") or "") for item in expected.get("evidence_sources", []) if isinstance(item, dict)))
        permission_pattern = re.compile(r"\b(controle de acesso|acesso autorizado|protecao contra compartilhamento|somente o proprio|apenas o proprio|perfil de administrador|autenticacao obrigatoria|login obrigatorio)\b", re.IGNORECASE)
        if not re.search(r"\b(controle de acesso|acesso autorizado|protecao contra compartilhamento|autenticacao|login|permiss)\b", source_text):
            for key in ("actors", "inputs", "outputs", "confirmed_rules", "main_flow", "alternative_flows", "exception_flows", "interface_feedback", "validation_data", "dependencies", "acceptance_criteria"):
                values = contract.get(key)
                if not isinstance(values, list):
                    continue
                kept = []
                removed = False
                for value in values:
                    value_text = str((value or {}).get("text") or (value or {}).get("then") or "") if isinstance(value, dict) else str(value or "")
                    if permission_pattern.search(value_text):
                        removed = True
                    else:
                        kept.append(value)
                contract[key] = kept
                if removed:
                    questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": "Confirmar se existe alguma regra de autenticacao, titularidade ou controle de acesso para esta operacao.", "category": "permissao", "priority": "high"})

        if expected.get("intent") in {"manage", "renewal"}:
            for category, text, priority in [
                ("escopo", "Quais acoes independentes fazem parte desta story e devem ser entregues separadamente?", "high"),
                ("validacao", "Quais campos, regras de obrigatoriedade e validacoes devem ser aplicados antes de salvar ou iniciar a operacao?", "high"),
                ("fluxo", "O que deve acontecer quando a operacao for cancelada, recusada ou nao puder ser concluida?", "medium"),
            ]:
                if self._normalize_text(text) not in self._normalize_text(" ".join(str(item.get("text") or "") for item in questions if isinstance(item, dict))):
                    questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": text, "category": category, "priority": priority})
        upstream = contract["upstream_review"]
        if str(upstream.get("status") or "").lower() in {"proposed", "question"} or upstream.get("tags"):
            for question in upstream.get("questions") or []:
                if str(question).strip() and str(question).lower() not in existing:
                    questions.append({"id": f"OQ-{len(questions) + 1:02d}", "text": str(question).strip(), "category": "upstream_review", "priority": "high"})

        # BDD negativo é uma salvaguarda estrutural para qualquer feature que
        # receba dados. O modelo frequentemente entrega apenas o fluxo feliz;
        # deixar essa lacuna para uma nova chamada torna o contrato instável e
        # pode consumir todas as tentativas de reparo. Complemente o contrato
        # usando a mesma evidência já fornecida, sem inventar regra de negócio.
        # Approved upstream criteria are evidence, not optional hints. Promote
        # them to flows/rules and keep them in BDD so the public document uses
        # every relevant fact already refined in the backlog.
        upstream_context = contract.get("upstream_context") if isinstance(contract.get("upstream_context"), dict) else {}
        upstream_criteria = upstream_context.get("acceptance_criteria") or upstream_context.get("acceptanceCriteria") or []
        upstream_story_source = next(
            (
                source_id for source_id in valid_source_ids
                if source_id == f"backlog.{expected.get('upstream_story_id')}"
            ),
            next(
                (source_id for source_id in valid_source_ids if str(source_id).startswith("backlog.")),
            "user_story" if "user_story" in valid_source_ids else next(iter(valid_source_ids), ""),
            ),
        )

        def append_confirmed(key, text):
            if not text:
                return
            entries = contract.setdefault(key, [])
            normalized_text = self._normalize_text(text)
            if any(self._normalize_text(item.get("text") or "") == normalized_text for item in entries if isinstance(item, dict)):
                return
            entries.append({"text": text, "source_ids": [upstream_story_source]})

        canonical_upstream_criteria = []
        for criterion in upstream_criteria if isinstance(upstream_criteria, list) else []:
            if not isinstance(criterion, dict):
                continue
            given = str(criterion.get("given") or "").strip()
            when = str(criterion.get("when") or "").strip()
            then = str(criterion.get("then") or "").strip()
            if not (given and when and then):
                continue
            canonical_upstream_criteria.append({
                "id": str(criterion.get("id") or f"AC-UP-{len(canonical_upstream_criteria) + 1:02d}"),
                "given": given,
                "when": when,
                "then": then,
                "source_ids": [upstream_story_source],
                "status": str(criterion.get("status") or "confirmed"),
            })

            fact = f"Quando {when}, {then}"
            normalized_fact = self._normalize_text(f"{given} {when} {then}")
            is_exception = bool(re.search(r"\b(erro|falha|inval|ausent|recusa|nega|impede|bloqueia|nao disponibiliza|nao permit|sem acesso|indispon)\w*", normalized_fact))
            append_confirmed("exception_flows" if is_exception else "main_flow", fact)
            if re.search(r"\b(permiss|somente leitura|read-only|nao disponibiliza|nao permit|bloqueia)\b", normalized_fact):
                append_confirmed("permissions_audit", then)
                append_confirmed("confirmed_rules", then)

        if canonical_upstream_criteria:
            # Preserve upstream decisions while retaining any additional
            # evidence-backed scenarios generated for the current story.
            # Replacing the list here made a one-item upstream review fail the
            # consultation contract's two-scenario quality gate on every retry.
            existing_criteria = contract.get("acceptance_criteria")
            generated_criteria = existing_criteria if isinstance(existing_criteria, list) else []
            canonical_keys = {
                self._normalize_text(
                    f"{item['given']} {item['when']} {item['then']}"
                )
                for item in canonical_upstream_criteria
            }
            supplemental_criteria = [
                item for item in generated_criteria
                if isinstance(item, dict)
                and self._normalize_text(
                    f"{item.get('given', '')} {item.get('when', '')} {item.get('then', '')}"
                ) not in canonical_keys
            ]
            contract["acceptance_criteria"] = canonical_upstream_criteria + supplemental_criteria
            # Upstream criteria are the canonical decisions. Model-generated
            # flow lines often restate them imperfectly, which duplicates the
            # public behavior or turns a BDD precondition into a sentence.
            contract["main_flow"] = []
            contract["exception_flows"] = []
            for criterion in canonical_upstream_criteria:
                fact = f"Quando {criterion['when']}, {criterion['then']}"
                normalized_fact = self._normalize_text(f"{criterion['given']} {criterion['when']} {criterion['then']}")
                is_exception = bool(re.search(r"\b(erro|falha|inval|ausent|recusa|nega|impede|bloqueia|nao disponibiliza|nao permit|sem acesso|indispon)\w*", normalized_fact))
                append_confirmed("exception_flows" if is_exception else "main_flow", fact)

        criteria = contract.get("acceptance_criteria")
        if not isinstance(criteria, list):
            criteria = []
        if "user_story" in valid_source_ids:
            default_source_ids = ["user_story"]
        else:
            default_source_ids = [next(iter(valid_source_ids), "")] if valid_source_ids else []
        normalized_criteria = []
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            given = str(criterion.get("given") or "").strip()
            when = str(criterion.get("when") or "").strip()
            then = str(criterion.get("then") or "").strip()
            if not (given and when and then):
                continue
            source_ids = [
                source_id for source_id in (criterion.get("source_ids") or [])
                if source_id in valid_source_ids
            ] or default_source_ids.copy()
            normalized = dict(criterion)
            normalized.update({
                "given": given,
                "when": when,
                "then": then,
                "source_ids": source_ids,
            })
            normalized_criteria.append(normalized)
        criteria = normalized_criteria
        bdd_text = " ".join(
            f"{item.get('given', '')} {item.get('when', '')} {item.get('then', '')}"
            for item in criteria
        ).lower()
        contract["acceptance_criteria"] = criteria
        return contract

    def _evidence_sources(self, idea, backlog, project_context=None):
        context = project_context if isinstance(project_context, dict) else {}
        sources = [
            {"id": "user_story", "text": str(idea or "").strip()},
            {"id": "backlog", "text": str(backlog or "").strip()},
            {"id": "project_dna", "text": json.dumps(context.get("projectDna") or {}, ensure_ascii=False)},
            {"id": "backlog_contract", "text": json.dumps(context.get("backlogContract") or {}, ensure_ascii=False)},
        ]
        story_context = context.get("storyContext") if isinstance(context.get("storyContext"), dict) else {}
        current_story = story_context.get("currentStory") if isinstance(story_context.get("currentStory"), dict) else {}
        if current_story.get("id"):
            sources.append({
                "id": f"backlog.{current_story['id']}",
                "text": json.dumps(current_story, ensure_ascii=False),
            })
        for related_story in story_context.get("relatedStories", []):
            if isinstance(related_story, dict) and related_story.get("id"):
                sources.append({
                    "id": f"backlog.{related_story['id']}",
                    "text": json.dumps(related_story, ensure_ascii=False),
                })
        return sources

    def _contract_from_markdown(self, markdown, expected):
        sections = self._extract_sections(markdown)
        inputs = []
        entries = sections.get("Requisitos Funcionais", "")
        entries_match = re.search(r"entradas\s*:\s*([^\n]+)", entries, re.IGNORECASE)
        if entries_match:
            raw_inputs = re.split(r"[,;]|\s+e\s+", entries_match.group(1))
            inputs = [item.strip().lower().rstrip(".") for item in raw_inputs if item.strip()]
        def bullets(section):
            return [re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line).strip()
                    for line in section.splitlines()
                    if re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line).strip()]

        source_text = {item["id"]: self._normalize_text(item.get("text"))
                       for item in expected.get("evidence_sources", []) if isinstance(item, dict) and item.get("id")}
        rules = []
        assumptions = []
        for line in bullets(sections.get("Regras de Negocio", "")):
            line_normalized = self._normalize_text(line)
            sources = [source_id for source_id, text in source_text.items() if line_normalized and line_normalized in text]
            target = rules if sources else assumptions
            entry = {"text": line, "sources": sources} if sources else {"text": line, "reason": "sem evidencia literal"}
            target.append(entry)
        questions = []
        for index, line in enumerate(bullets(sections.get("Premissas e Pontos a Validar", ""))):
            tag = re.search(r"\[REVISAR\]\[(RV-\d+)\]\[([^\]]+)\]\[([^\]]+)\]", line, re.IGNORECASE)
            questions.append({
                "id": tag.group(1).upper() if tag else f"OQ-{index + 1:02d}",
                "text": re.sub(r"\[REVISAR\]\[[^\]]+\]\[[^\]]+\]\[[^\]]+\]\s*", "", line, flags=re.IGNORECASE),
                "category": tag.group(2).lower() if tag else "uncategorized",
                "priority": tag.group(3).lower() if tag else "medium",
            })
        claims = self._extract_claims(sections, source_text)
        return {
            "domain": expected.get("domain"), "intent": expected.get("intent"),
            "inputs": inputs, "outputs": bullets(sections.get("Requisitos Funcionais", "")),
            "confirmed_rules": rules, "assumptions": assumptions,
            "open_questions": questions, "dependencies": bullets(sections.get("Fluxos de Excecao", "")),
            "acceptance_criteria": bullets(sections.get("Criterios de Aceite (BDD)", "")),
            "evidence_sources": expected.get("evidence_sources", []),
            "claims": claims,
        }

    def _extract_claims(self, sections, source_text):
        """Expose every implementation statement for the AI evidence reviewer.

        A claim is intentionally only *candidate* until the reviewer confirms a
        source.  This prevents wording in a polished Markdown document from
        silently becoming a business fact.
        """
        claim_sections = (
            "Requisitos Funcionais", "Fluxo Principal", "Fluxos Alternativos",
            "Fluxos de Excecao", "Regras de Negocio", "Estados da Interface e Feedback",
            "Validacoes e Dados", "Permissoes e Auditoria", "Criterios de Aceite (BDD)",
        )
        claims = []
        for section in claim_sections:
            for line in sections.get(section, "").splitlines():
                text = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line).strip()
                if not text or text.startswith("###") or text.startswith("("):
                    continue
                normalized = self._normalize_text(text)
                sources = [source_id for source_id, source in source_text.items() if normalized and normalized in source]
                claims.append({
                    "id": f"CL-{len(claims) + 1:03d}",
                    "section": section,
                    "text": text,
                    "status": "confirmed" if sources else "candidate",
                    "sources": sources,
                })
        return claims

    def _parse_ai_refinement_response(self, result, expected=None):
        raw = str(result or "").strip()
        decoder = json.JSONDecoder()
        envelope = None
        for index, char in enumerate(raw):
            if char != "{":
                continue
            try:
                candidate, _ = decoder.raw_decode(raw[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict) and {"contract", "markdown"}.issubset(candidate):
                envelope = candidate
                break
        if envelope is None:
            sections = self._extract_sections(raw)
            if sections:
                return {
                    "contract": self._contract_from_markdown(raw, expected or {}),
                    "markdown": raw,
                }, None
            diagnostics = (
                f"bytes={len(raw)}, code_fence={str('```' in raw).lower()}, "
                f"json_object_candidate={str('{' in raw).lower()}"
            )
            return None, f"A IA deve responder Markdown estruturado ou envelope JSON valido ({diagnostics})."
        if not isinstance(envelope, dict):
            return None, "A resposta da IA precisa ser um objeto JSON."
        contract = envelope.get("contract")
        markdown = envelope.get("markdown")
        if not isinstance(contract, dict) or not isinstance(markdown, str) or not markdown.strip():
            return None, "O envelope da IA precisa conter contract e markdown nao vazio."
        return {"contract": contract, "markdown": markdown.strip()}, None

    def _validate_ai_contract(self, generated, expected):
        required_keys = {
            "domain", "intent", "inputs", "outputs", "confirmed_rules", "assumptions",
            "open_questions", "dependencies", "acceptance_criteria",
        }
        missing_keys = sorted(required_keys.difference(generated))
        if missing_keys:
            return False, "Contrato da IA sem campos obrigatorios: " + ", ".join(missing_keys)
        if generated.get("domain") != expected.get("domain") or generated.get("intent") != expected.get("intent"):
            return False, "Contrato da IA diverge da classificacao de dominio ou intencao."
        if not all(isinstance(generated.get(key), list) for key in required_keys.difference({"domain", "intent"})):
            return False, "Listas do contrato da IA possuem formato invalido."
        for rule in generated.get("confirmed_rules", []):
            if not isinstance(rule, dict) or not str(rule.get("text") or "").strip() or not rule.get("sources"):
                return False, "Toda regra confirmada precisa conter texto e fontes de evidencia."
            if not all(source in {"user_story", "backlog", "project_dna", "backlog_contract"} for source in rule["sources"]):
                return False, "Regra confirmada usa fonte de evidencia invalida."
        return True, None

    def _review_with_evidence(self, markdown, expected_contract):
        """Ask a second model to challenge claims, never to manufacture missing facts.

        A refinement is publishable only after this independent review
        completes. An unavailable challenger is an operational failure, not
        evidence that the generated claims are safe.
        """
        sources = expected_contract.get("evidence_sources", [])
        prompt = f"""
Voce e o Requirements Challenger e Judge. Avalie cada afirmacao implementavel do refinamento contra as fontes.
Nao complete o requisito, nao use boas praticas como fonte e nao invente regra. Uma afirmacao so e confirmada
se estiver explicitamente dita ou for consequencia direta e inevitavel de uma fonte. Ser plausivel nao basta.
Se uma lacuna virou RF, fluxo, excecao, validacao, permissao, estado de interface, regra ou ENTAO de BDD, marque REVISE.
Uma lacuna explicitamente escrita em "Premissas e Pontos a Validar" nao e erro.
Itens identificados como "[PROPOSTO - VALIDAR]" sao deliberadamente pendentes e tambem nao sao erro: nao os reporte como afirmacoes sem fonte.
Nao reporte estilo, estrutura, redundancia, nomenclatura, formatacao ou sugestao editorial. Esses itens nao sao falta de evidencia e devem resultar em PASS.

Retorne exclusivamente um único objeto JSON válido, sem Markdown, sem crases e sem texto antes ou depois. Use exatamente este formato:
{{"decision":"PASS|REVISE","findings":[{{"evidence":"trecho literal do refinamento","reason":"...","severity":"low|medium|high","question":"...","source_id":"user_story|backlog|project_dna|backlog_contract|null","source_excerpt":"trecho literal da fonte ou null"}}]}}.
Quando não houver achados, responda exatamente: {{"decision":"PASS","findings":[]}}.
Para cada finding, evidence deve estar no refinamento. Se a afirmacao nao tiver fonte, use source_id e source_excerpt como null.

FONTES:\n{json.dumps(sources, ensure_ascii=False)}

REFINAMENTO:\n{markdown}
"""
        try:
            raw = generate_text_from_llm(
                prompt,
                options_override={
                    "temperature": 0.0,
                    "num_predict": 900,
                    # The challenger is a second full model invocation.  Its
                    # former 45-second default expired while remote fallback
                    # providers were still producing a valid review, turning
                    # a healthy refinement into an unavailable-review error.
                    # Keep its minimum aligned with the primary contract call.
                    "request_timeout_seconds": min(180, max(120, int(os.getenv("REQUIREMENTS_REVIEW_TIMEOUT_SECONDS", "120")))),
                    "transient_retries": 0,
                    # Make malformed prose a provider-level failure, so the
                    # router can try the next structured-output provider.
                    "json_mode": True,
                    "require_json_object": True,
                    "min_response_chars": 28,
                },
                use_cache=False,
                task="requirements_judge",
            )
            decoder = json.JSONDecoder()
            report = None
            for index, char in enumerate(str(raw or "")):
                if char != "{":
                    continue
                try:
                    candidate, _ = decoder.raw_decode(str(raw)[index:])
                except json.JSONDecodeError:
                    continue
                if isinstance(candidate, dict) and isinstance(candidate.get("findings"), list):
                    report = candidate
                    break
            if not report:
                raise ValueError("reviewer_sem_json")
            accepted = []
            for finding in report.get("findings", []):
                if not isinstance(finding, dict):
                    continue
                evidence = str(finding.get("evidence") or "").strip()
                if evidence and evidence in markdown:
                    source_id = finding.get("source_id")
                    source_excerpt = str(finding.get("source_excerpt") or "").strip()
                    source_ids = {item.get("id") for item in sources if isinstance(item, dict)}
                    source_is_verified = False
                    if source_id not in source_ids:
                        source_id = None
                        source_excerpt = ""
                    elif source_excerpt:
                        source_text = next(
                            (str(item.get("text") or "") for item in sources if item.get("id") == source_id), ""
                        )
                        if source_excerpt in source_text:
                            # The review protocol reserves a source excerpt for
                            # claims that have evidence. A finding with a
                            # verified excerpt is contradictory and must not
                            # trigger a repair loop.
                            source_is_verified = True
                        else:
                            # A reviewer may not claim a source it cannot quote.
                            source_id = None
                            source_excerpt = ""
                    if source_is_verified:
                        continue
                    reason = str(finding.get("reason") or "").strip()
                    normalized_reason = self._normalize_text(reason)
                    evidence_gap_markers = (
                        "sem fonte", "sem evidencia", "nao esta presente", "nao esta nas fontes",
                        "nao aparece nas fontes", "nao sustent", "nao comprov",
                    )
                    # The challenger is an evidence judge, not an editor. A
                    # literal sentence alone is insufficient: the finding must
                    # explicitly identify the lack of source support.
                    if not any(marker in normalized_reason for marker in evidence_gap_markers):
                        continue
                    accepted.append({
                        "evidence": evidence,
                        "reason": reason,
                        "severity": str(finding.get("severity") or "medium").lower(),
                        "question": str(finding.get("question") or "").strip(),
                        "source_id": source_id,
                        "source_excerpt": source_excerpt or None,
                    })
            decision = "REVISE" if accepted else "PASS"
            return {"status": "completed", "decision": decision, "findings": accepted}
        except Exception as error:
            return {"status": "unavailable", "decision": "REVISE", "findings": [], "reason": str(error)}

    def _validate_evidence_semantics(self, content, contract):
        """Apply only validation rules that are meaningful in every domain."""
        sections = self._extract_sections(content)
        if contract.get("open_questions") and not sections.get("Premissas e Pontos a Validar"):
            return False, "Markdown sem Premissas e Pontos a Validar para as lacunas do contrato."
        return True, None

    def _build_evidence_revision_prompt(self, markdown, evidence_report, expected_contract):
        return f"""
Revise o Markdown de requisitos abaixo. Preserve todos os fatos suportados e a estrutura.
Para cada achado, remova a afirmacao sem evidencia ou transforme-a em uma pergunta objetiva
na secao ## Premissas e Pontos a Validar. Nao responda essas perguntas, nao invente regras
e retorne APENAS o Markdown completo.

Fontes: {json.dumps(expected_contract.get('evidence_sources', []), ensure_ascii=False)}
Achados com evidencia literal: {json.dumps(evidence_report.get('findings', []), ensure_ascii=False)}

Markdown a revisar:\n{markdown}
"""

    def _extract_domain_vocabulary(self, backlog):
        match = re.search(r"Linguagem do dominio:\s*(.+)", str(backlog or ""), re.IGNORECASE)
        if not match:
            return []
        return [item.strip() for item in match.group(1).split(",") if item.strip()]

    def _extract_actor(self, idea):
        match = re.search(r"como\s+([^,]+)", str(idea or ""), re.IGNORECASE)
        return match.group(1).strip() if match else "usuario autenticado"

    def _infer_entity(self, idea, backlog):
        normalized = self._normalize_text(f"{idea} {backlog}")
        if "evento" in normalized:
            return "evento"
        if "visita" in normalized:
            return "visita"
        if "visitante" in normalized:
            return "visitante"
        if "responsavel operacional" in normalized:
            return "responsavel operacional"
        return "registro principal"

    def _infer_scope_fields(self, idea):
        normalized = self._normalize_text(idea)
        fields = []
        if "volume" in normalized:
            fields.append(("Volume estimado", "numero inteiro positivo", "Sim", "minimo 1"))
        if "formato" in normalized:
            fields.append(("Formato da visita", "lista predefinida", "Sim", "valor controlado"))
        if "parametro" in normalized or "contexto" in normalized or "escopo" in normalized:
            fields.append(("Parametros principais", "texto curto", "Nao", "maximo 240 caracteres"))
        if (" data " in f" {normalized} " or " hora " in f" {normalized} ") and "escopo" not in normalized:
            fields.append(("Data/hora prevista", "data/hora", "Sim", "nao pode ser no passado"))
        if not fields:
            fields.append(("Campo principal da feature", "texto", "Sim", "conforme regra da historia"))
        unique_fields = []
        seen_fields = set()
        for field in fields:
            if field[0] in seen_fields:
                continue
            seen_fields.add(field[0])
            unique_fields.append(field)
        return unique_fields[:4]

    def _prune_scope_definition_content(self, content, idea):
        text = (content or "").strip()
        if not text:
            return ""

        normalized_idea = self._normalize_text(idea)
        concept_rules = [
            (("data/hora prevista", "data prevista", "hora prevista"), (" data ", " hora ")),
            (("duracao estimada", "duração estimada"), ("duracao", "duração")),
            (("areas da empresa", "áreas da empresa", "area da empresa", "área da empresa"), ("area", "área")),
            (("acesso especial",), ("acesso especial",)),
            (("estimativa de recursos", "recursos iniciais"), ("recurso",)),
            (("salvar como rascunho", "rascunho"), ("rascunho",)),
            (("responsavel interno", "responsável interno"), ("responsavel interno", "responsável interno")),
        ]

        for forbidden_terms, allow_tokens in concept_rules:
            if any(token in normalized_idea for token in allow_tokens):
                continue
            pattern = "|".join(re.escape(term) for term in forbidden_terms)
            text = re.sub(rf"(?im)^.*(?:{pattern}).*$\n?", "", text)

        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _prune_initial_registration_content(self, content, idea):
        text = (content or "").strip()
        if not text:
            return ""

        story_type = self._classify_story_type(idea)
        if story_type not in {"create", "record"}:
            return text

        normalized_idea = self._normalize_text(idea)
        if not any(
            marker in normalized_idea
            for marker in ["contexto inicial", "dados iniciais", "iniciar o fluxo", "antes da aprovacao", "antes da aprovação"]
        ):
            return text

        guarded_concepts = [
            (("identificador unico", "identificador único", "numero sequencial", "número sequencial", "id gerado"), ("identificador", "id", "numero", "número")),
            (("status inicial", "status aguardando", "status registrado", "status pendente", "aguardando aprovacao", "aguardando aprova??o", "pendente de analise", "pendente de an?lise"), ("status",)),
            (("timestamp de criacao", "timestamp de criação", "data/hora de criacao", "data/hora de criação", "registrar data/hora de criacao", "registrar data/hora de criação"), ("timestamp", "data/hora de criacao", "data/hora de criação")),
            (("protocolo",), ("protocolo",)),
        ]

        for forbidden_terms, allow_tokens in guarded_concepts:
            if any(token in normalized_idea for token in allow_tokens):
                continue
            pattern = "|".join(re.escape(term) for term in forbidden_terms)
            text = re.sub(rf"(?im)^.*(?:{pattern}).*$\n?", "", text)

        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _synthesize_missing_sections(self, sections, idea, backlog, missing_sections):
        story_type = self._classify_story_type(idea)
        actor = self._extract_actor(idea)
        entity = self._infer_entity(idea, backlog)
        field_specs = self._infer_scope_fields(idea)

        if "Requisitos Funcionais" in missing_sections or not re.search(r"###\s*RF-?0*1", sections.get("Requisitos Funcionais", ""), re.IGNORECASE):
            inputs = "\n".join([f"- {field}: {field_type}" for field, field_type, _, _ in field_specs[:4]])
            output_lines = [
                f"### RF-01 - Registro principal de {entity.title()}",
                f"- Descricao: Permitir que {actor} execute a acao principal da historia sem expandir para etapas posteriores.",
                f"- Atores: {actor}",
                "- Entradas:",
                inputs,
                "- Processamento:",
                "- Validar obrigatoriedade e formato dos dados desta etapa",
                "- Registrar apenas as informacoes necessarias para a acao central",
                "- Saidas:",
                f"- Confirmacao do registro da etapa de {entity}",
                "- Visualizacao resumida dos dados informados",
            ]
            sections["Requisitos Funcionais"] = "\n".join(output_lines)

        if "Fluxos de Excecao" in missing_sections and not sections.get("Fluxos de Excecao"):
            first_field = field_specs[0][0]
            sections["Fluxos de Excecao"] = (
                f"**FE-01 - Campo obrigatorio invalido**\n"
                f"- Sistema detecta {first_field.lower()} ausente ou invalido\n"
                f"- Sistema exibe mensagem clara e impede continuidade\n"
                f"- Fluxo retorna ao preenchimento\n\n"
                f"**FE-02 - Dado fora da regra da historia**\n"
                f"- Sistema detecta valor fora do limite ou formato esperado\n"
                f"- Sistema destaca o campo problemático\n"
                f"- {actor} corrige e tenta novamente"
            )

        if "Regras de Negocio" in missing_sections and not sections.get("Regras de Negocio"):
            rules = []
            for index, (field, _, required, validation) in enumerate(field_specs, start=1):
                required_text = "obrigatorio" if required.lower() == "sim" else "opcional"
                rules.append(f"{index}. {field} e {required_text} e deve respeitar a regra: {validation}.")
            if story_type == "scope-definition":
                rules.append(f"{len(rules)+1}. O registro de escopo da {entity} nao deve introduzir identificador, protocolo, aprovacao ou status de workflow nesta etapa.")
            sections["Regras de Negocio"] = "\n".join(rules[:6])

        if "Validacoes e Dados" in missing_sections and not sections.get("Validacoes e Dados"):
            lines = []
            for field, field_type, required, validation in field_specs:
                lines.append(f"- {field}: {field_type}, obrigatorio: {required}, validacao: {validation}.")
            sections["Validacoes e Dados"] = "\n".join(lines)

        if "Permissoes e Auditoria" in missing_sections and not sections.get("Permissoes e Auditoria"):
            sections["Permissoes e Auditoria"] = (
                f"- Execucao: {actor}.\n"
                f"- Visualizacao: perfis autorizados do fluxo de {entity}.\n"
                f"- Auditoria: registrar usuario responsavel, data/hora e alteracoes relevantes desta etapa."
            )

        if "Criterios de Aceite (BDD)" in missing_sections and not sections.get("Criterios de Aceite (BDD)"):
            main_field = field_specs[0][0]
            sections["Criterios de Aceite (BDD)"] = (
                f"DADO que {actor} acessa a funcionalidade da {entity}\n"
                f"QUANDO informa os dados obrigatorios e confirma a operacao\n"
                f"ENTAO o sistema registra a etapa com sucesso e exibe confirmacao adequada\n\n"
                f"DADO que {actor} deixa {main_field.lower()} ausente ou invalido\n"
                f"QUANDO tenta confirmar a operacao\n"
                f"ENTAO o sistema bloqueia a continuidade e exibe mensagem clara\n\n"
                f"DADO que existe dado fora da regra definida para a etapa\n"
                f"QUANDO o sistema valida a solicitacao\n"
                f"ENTAO a operacao nao e concluida ate que a inconsistencia seja corrigida"
            )

        return sections

    def _build_scope_definition_document(self, idea, backlog):
        actor = self._extract_actor(idea)
        entity = self._infer_entity(idea, backlog)
        entity_ref = "do evento" if entity == "evento" else f"da {entity}"
        field_specs = self._infer_scope_fields(idea)
        user_story = (
            f"Como {actor}, eu quero registrar o escopo básico {entity_ref} "
            "com os parâmetros iniciais necessários, para dimensionar a operação sem antecipar etapas posteriores do fluxo."
        )
        requirements = [
            "### RF-01 - Registro de Escopo Básico",
            f"- Descricao: Permitir que {actor} registre apenas os parâmetros iniciais necessários para o escopo {entity_ref}.",
            f"- Atores: {actor}",
            "- Entradas:",
        ]
        for field, field_type, _, _ in field_specs[:4]:
            requirements.append(f"- {field}: {field_type}")
        requirements.extend([
            "- Processamento:",
            "- Validar obrigatoriedade e formato dos dados da etapa",
            "- Registrar somente os parâmetros de escopo informados",
            "- Saidas:",
            f"- Confirmação do registro do escopo {entity_ref}",
            "- Resumo dos parâmetros informados",
        ])
        rules = []
        validations = []
        for index, (field, field_type, required, validation) in enumerate(field_specs, start=1):
            req_text = "obrigatorio" if required.lower() == "sim" else "opcional"
            rules.append(f"{index}. {field} e {req_text} e deve respeitar a regra: {validation}.")
            validations.append(f"- {field}: {field_type}, obrigatorio: {required}, validacao: {validation}.")
        rules.append(f"{len(rules)+1}. Esta etapa registra apenas escopo da {entity}; nao define aprovacao, protocolo, status de workflow ou identificador da entidade.")

        sections = {
            "User Story Refinada": user_story,
            "Requisitos Funcionais": "\n".join(requirements),
            "Fluxo Principal": (
                f"1. {actor} acessa a funcionalidade de escopo {entity_ref}\n"
                "2. Sistema apresenta os campos iniciais da etapa\n"
                "3. Usuário informa os parâmetros de escopo exigidos\n"
                "4. Usuário confirma o registro\n"
                "5. Sistema valida os dados\n"
                "6. Sistema grava o escopo e exibe confirmação"
            ),
            "Fluxos Alternativos": (
                "**FA-01 - Cancelamento antes da confirmação**\n"
                "- Usuário cancela a operação antes de confirmar\n"
                "- Sistema descarta dados não confirmados e retorna à tela inicial"
            ),
            "Fluxos de Excecao": (
                "**FE-01 - Campo obrigatório ausente**\n"
                "- Sistema identifica dado obrigatório não informado\n"
                "- Sistema exibe mensagem clara e impede a continuidade\n\n"
                "**FE-02 - Dado fora da regra definida**\n"
                "- Sistema identifica valor fora do formato ou limite aceito\n"
                "- Sistema solicita correção antes de concluir a etapa"
            ),
            "Regras de Negocio": "\n".join(rules[:6]),
            "Estados da Interface e Feedback": (
                "- Carregando: durante a validação e gravação.\n"
                "- Sucesso: após registro do escopo.\n"
                "- Erro: quando houver inconsistência de validação.\n"
                "- Vazio: formulário inicial sem dados."
            ),
            "Validacoes e Dados": "\n".join(validations),
            "Permissoes e Auditoria": (
                f"- Execucao: {actor}.\n"
                f"- Visualizacao: perfis autorizados da operação {entity_ref}.\n"
                "- Auditoria: registrar usuário responsável e data/hora da ação."
            ),
            "Criterios de Aceite (BDD)": (
                f"DADO que {actor} acessa a funcionalidade de escopo {entity_ref}\n"
                "QUANDO informa os dados obrigatórios e confirma a operação\n"
                "ENTAO o sistema registra o escopo e exibe confirmação adequada\n\n"
                f"DADO que {actor} deixa um campo obrigatório sem preenchimento\n"
                "QUANDO tenta confirmar a operação\n"
                "ENTAO o sistema bloqueia a continuidade e informa o erro\n\n"
                "DADO que um valor é informado fora do formato ou limite aceito\n"
                "QUANDO o sistema valida os dados\n"
                "ENTAO a operação não é concluída até que a inconsistência seja corrigida"
            ),
        }
        return self._build_document(sections)

    def _build_view_summary_document(self, idea, backlog):
        actor = self._extract_actor(idea)
        entity = self._infer_entity(idea, backlog)
        entity_ref = "do evento" if entity == "evento" else f"da {entity}"
        user_story = (
            f"Como {actor}, eu quero visualizar o resumo {entity_ref} "
            "com escopo, base operacional e status atual, para confirmar se o planejamento inicial esta completo."
        )
        sections = {
            "User Story Refinada": user_story,
            "Requisitos Funcionais": (
                "### RF-01 - Visualizacao do resumo consolidado\n"
                f"- Descricao: Permitir que {actor} consulte o resumo consolidado {entity_ref}, em modo somente leitura.\n"
                f"- Atores: {actor}\n"
                "- Entradas: Nao se aplica\n"
                "- Processamento:\n"
                "- Recuperar os dados consolidados da etapa\n"
                "- Exibir escopo, base operacional e status atual em modo somente leitura\n"
                "- Indicar ausencia de informacoes quando algum bloco do resumo nao estiver disponivel\n"
                "- Saidas:\n"
                "- Resumo consolidado exibido\n"
                "- Indicacao visual de que o planejamento inicial pode ser conferido"
            ),
            "Fluxo Principal": (
                f"1. {actor} acessa o resumo consolidado {entity_ref}\n"
                "2. Sistema carrega os dados disponiveis\n"
                "3. Sistema exibe escopo, base operacional e status atual\n"
                "4. Usuario confere se o planejamento inicial esta completo\n"
                "5. Sistema mantem a tela em modo somente leitura"
            ),
            "Fluxos Alternativos": (
                "**FA-01 - Dados parciais**\n"
                "- Sistema exibe o resumo com os blocos disponiveis\n"
                "- Sistema sinaliza quais informacoes ainda nao foram consolidadas\n\n"
                "**FA-02 - Falha ao carregar o resumo**\n"
                "- Sistema informa a indisponibilidade do carregamento\n"
                "- Usuario pode tentar novamente"
            ),
            "Fluxos de Excecao": (
                "**FE-01 - Base operacional ausente**\n"
                "- Sistema nao encontra dados suficientes para compor o resumo\n"
                "- Sistema exibe mensagem clara sobre informacoes pendentes\n\n"
                "**FE-02 - Falha tecnica ao carregar dados**\n"
                "- Sistema registra o erro de leitura\n"
                "- Sistema informa indisponibilidade temporaria"
            ),
            "Regras de Negocio": (
                "1. A visualizacao do resumo nao altera dados da entidade.\n"
                "2. O status atual e apenas informativo nesta tela.\n"
                "3. A base operacional e o escopo devem ser exibidos somente se houver dados consolidados.\n"
                "4. A tela permanece em modo somente leitura.\n"
                "5. A consulta deve respeitar as permissoes do perfil autenticado."
            ),
            "Estados da Interface e Feedback": (
                "- Carregando: enquanto o resumo e montado.\n"
                "- Sucesso: quando o resumo e exibido.\n"
                "- Vazio: quando ainda nao houver base operacional consolidada.\n"
                "- Erro: quando o carregamento falhar."
            ),
            "Validacoes e Dados": (
                "- Escopo: texto consolidado exibido sem edicao.\n"
                "- Base operacional: resumo informativo somente leitura.\n"
                "- Status atual: valor exibido de forma consistente com o contexto.\n"
                "- Identificacao da entidade: Ponto a validar se o acesso sera por selecao, lista ou contexto predefinido."
            ),
            "Permissoes e Auditoria": (
                f"- Execucao: {actor} autenticado.\n"
                "- Visualizacao: perfis autorizados para leitura do resumo.\n"
                "- Auditoria: registrar acesso ao resumo e consulta realizada."
            ),
            "Criterios de Aceite (BDD)": (
                f"DADO que {actor} acessa o resumo consolidado {entity_ref}\n"
                "QUANDO a tela carrega com sucesso\n"
                "ENTAO o sistema exibe escopo, base operacional e status atual em modo somente leitura\n\n"
                f"DADO que parte das informacoes ainda nao foi consolidada\n"
                "QUANDO o usuario acessa o resumo\n"
                "ENTAO o sistema exibe os blocos disponiveis e sinaliza o que esta pendente\n\n"
                "DADO que ocorre falha tecnica ao carregar os dados\n"
                "QUANDO a consulta e processada\n"
                "ENTAO o sistema informa indisponibilidade temporaria sem alterar dados"
            ),
        }
        return self._build_document(sections)

    def _build_contract_generation_prompt(self, idea, backlog, project_context, expected_contract, repair_reason=None, current_contract=None):
        """Ask the model for facts and decisions, not a long formatted document."""
        instruction = ""
        if repair_reason:
            instruction = (
                "\nEsta e uma correcao focalizada. Preserve os itens validos do contrato atual e corrija apenas "
                f"o problema informado: {repair_reason}.\nContrato atual: {json.dumps(current_contract or {}, ensure_ascii=False)}\n"
            )
        example_source_id = next(
            (item.get("id") for item in expected_contract.get("evidence_sources", []) if isinstance(item, dict) and item.get("id")),
            "briefing.1",
        )
        schema = {
            "domain": expected_contract["domain"], "intent": expected_contract["intent"],
            "refined_story": {"text": "", "source_ids": [example_source_id]},
            "actors": [{"name": "", "source_ids": [example_source_id]}],
            "inputs": [{"name": "", "source_ids": [example_source_id]}],
            "outputs": [{"text": "", "source_ids": [example_source_id]}],
            "confirmed_rules": [{"text": "", "source_ids": [example_source_id]}],
            "main_flow": [{"text": "", "source_ids": [example_source_id]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [],
            "assumptions": [{"text": "", "reason": ""}],
            "open_questions": [{"id": "OQ-01", "text": "", "category": "dados", "priority": "medium"}],
            "acceptance_criteria": [{"given": "", "when": "", "then": "", "source_ids": [example_source_id]}],
        }
        return f"""
Voce e um analista de requisitos orientado por evidencia. Produza APENAS um objeto JSON valido, sem Markdown e sem comentarios.

Regra principal: uma afirmacao de comportamento, dado, regra, fluxo, permissao, validacao ou criterio de aceite so pode aparecer como confirmada se contiver source_ids de uma fonte fornecida. Se a fonte nao sustentar o detalhe, registre-o em open_questions ou assumptions; nunca o complete com conhecimento geral.

Classificacao obrigatoria: domain={expected_contract['domain']}; intent={expected_contract['intent']}. Esses rotulos servem apenas para organizar o requisito: nao aplicam regras especiais por setor.

Perfil da feature atual: {json.dumps(expected_contract.get('feature_profile') or {}, ensure_ascii=False)}.
Analise de escopo da historia: {json.dumps(expected_contract.get('scope_assessment') or {}, ensure_ascii=False)}. Se status=needs_split, cubra cada acao em RF, fluxo e BDD quando a fonte permitir; caso contrario, mantenha uma pergunta de revisao de escopo. Nunca finja que uma acao foi coberta quando apenas outra foi detalhada.
Contexto estruturado produzido pelo PM para esta story: {json.dumps(expected_contract.get('upstream_context') or {}, ensure_ascii=False)}. Use entradas, saidas, regras, restricoes, dependencias e dicas de aceite apenas quando estiverem presentes; itens vazios significam que a decisao continua aberta. Os acceptance_criteria desse contexto sao fatos ja refinados: preserve todos no contrato e promova seus resultados para main_flow, exception_flows, confirmed_rules ou permissions_audit conforme o sentido. Nao deixe comportamento ou regras vazios quando esses criterios trouxerem fatos observaveis.
Descoberta semantica da LLM: {json.dumps(expected_contract.get('semantic_context') or {}, ensure_ascii=False)}. Use-a para organizar o requisito, mas confirme cada afirmacao contra a evidencia original; itens com baixa confianca ou sem fonte devem permanecer como perguntas.
Se has_input=true e a intencao nao for view/summary, produza ao menos dois criterios BDD: um para o caminho suportado pela fonte e outro para dado ausente, invalido, incompleto ou envio recusado. Para consultas com filtros, nao crie cenario negativo de entrada; pergunte apenas regras de filtro e resultado vazio. Nao invente formato, limite ou mensagem; quando a fonte nao os definir, descreva o comportamento pendente em open_questions.
Se has_document=true ou has_form=true, nao use "nao se aplica" para validacao, feedback ou excecao como forma de ocultar a lacuna: deixe a lista confirmada vazia e registre a definicao pendente em open_questions. Se has_sensitive_data=true, registre tambem a pendencia de acesso, finalidade, retencao e rastreabilidade.
Para intent=view ou intent=summary, descreva somente os dados de consulta explicitamente presentes nas fontes e gere pelo menos dois criterios de aceite BDD observaveis, cada um respaldado por source_ids. Se a fonte nao listar campos, classificacao de status, ordenacao, filtros, paginacao ou comportamento de lista vazia, mantenha esses itens fora das listas confirmadas e crie perguntas objetivas em open_questions. Nao invente autenticacao, titularidade, login, permissao ou auditoria; esses itens so podem ser confirmados se aparecerem literalmente em uma fonte.
Revisao recebida da historia do backlog: {json.dumps(expected_contract.get('upstream_review') or {}, ensure_ascii=False)}. Perguntas de revisao upstream permanecem abertas; nunca as transforme em regra confirmada.
Quando as fontes nao definirem prioridade, dependencia externa, requisito nao funcional, metrica, viabilidade, responsavel pela validacao ou impacto em historias relacionadas, mantenha esses assuntos como perguntas objetivas em open_questions. Nao invente valores, SLAs, integracoes, responsaveis ou decisoes tecnicas.

Fontes rastreaveis: {json.dumps(expected_contract['evidence_sources'], ensure_ascii=False)}
Contexto compacto: {json.dumps(self._compact_project_context(project_context), ensure_ascii=False)}
User story: {idea}
Backlog: {backlog}

Contrato JSON esperado (use exatamente estas chaves; listas podem ficar vazias quando a fonte nao definir comportamento):
{json.dumps(schema, ensure_ascii=False)}
{instruction}
"""

    def _extract_json_object(self, result):
        raw = str(result or "").strip()
        decoder = json.JSONDecoder()
        for index, char in enumerate(raw):
            if char != "{":
                continue
            try:
                candidate, _ = decoder.raw_decode(raw[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                return candidate
        return None

    def _validate_primary_contract(self, contract, expected):
        required = {
            "domain", "intent", "refined_story", "actors", "inputs", "outputs", "confirmed_rules",
            "main_flow", "alternative_flows", "exception_flows", "interface_feedback", "validation_data",
            "permissions_audit", "dependencies", "assumptions", "open_questions", "acceptance_criteria",
        }
        missing = sorted(required.difference(contract or {}))
        if missing:
            return False, "Contrato primario sem campos obrigatorios: " + ", ".join(missing)
        if contract.get("domain") != expected.get("domain") or contract.get("intent") != expected.get("intent"):
            return False, "Contrato primario diverge da classificacao de dominio ou intencao."
        valid_sources = {item.get("id") for item in expected.get("evidence_sources", []) if isinstance(item, dict)}
        asserted_lists = (
            "actors", "inputs", "outputs", "confirmed_rules", "main_flow", "alternative_flows",
            "exception_flows", "interface_feedback", "validation_data", "permissions_audit", "dependencies",
        )
        for key in asserted_lists:
            if not isinstance(contract.get(key), list):
                return False, f"Campo {key} precisa ser uma lista."
            for item in contract[key]:
                if not isinstance(item, dict) or not str(item.get("text") or item.get("name") or "").strip():
                    return False, f"Item confirmado invalido em {key}."
                source_ids = item.get("source_ids")
                if not isinstance(source_ids, list) or not source_ids or not set(source_ids).issubset(valid_sources):
                    return False, f"Item confirmado em {key} sem fonte rastreavel valida."
        story = contract.get("refined_story")
        if not isinstance(story, dict) or not str(story.get("text") or "").strip() or not set(story.get("source_ids") or []).issubset(valid_sources) or not story.get("source_ids"):
            return False, "User story refinada sem fonte rastreavel valida."
        if not isinstance(contract.get("acceptance_criteria"), list) or not contract["acceptance_criteria"]:
            return False, "Contrato primario sem criterios de aceite."
        for criterion in contract["acceptance_criteria"]:
            if not isinstance(criterion, dict) or not all(str(criterion.get(key) or "").strip() for key in ("given", "when", "then")):
                return False, "Criterio de aceite sem estrutura DADO/QUANDO/ENTAO."
            if not set(criterion.get("source_ids") or []).issubset(valid_sources) or not criterion.get("source_ids"):
                return False, "Criterio de aceite sem fonte rastreavel valida."
        # Consultation requirements need enough operational detail to be
        # implementable, while keeping unspecified choices as explicit
        # questions. This prevents a generic "the system displays the list"
        # contract from passing as a complete refinement.
        if expected.get("intent") in {"view", "summary"}:
            if len(contract["acceptance_criteria"]) < 2:
                return False, "Consulta precisa de pelo menos dois criterios de aceite observaveis."
            question_text = self._normalize_text(" ".join(
                str(item.get("text") or "") for item in contract.get("open_questions", [])
                if isinstance(item, dict)
            ))
            if "campo" not in question_text or not re.search(r"ativw*.*expirw*|expirw*.*ativw*", question_text):
                return False, "Consulta sem perguntas objetivas sobre campos exibidos e classificacao ativa/expirada."
        evidence_text = self._normalize_text(" ".join(
            str(item.get("text") or "") for item in expected.get("evidence_sources", []) if isinstance(item, dict)
        ))
        requires_data_validation = bool(re.search(r"\b(campo|formulario|dados? informado|preench|matricula|senha)\b", evidence_text))
        if (expected.get("feature_profile") or {}).get("has_input") and requires_data_validation and expected.get("intent") not in {"view", "summary"}:
            bdd_text = " ".join(
                f"{item.get('given', '')} {item.get('when', '')} {item.get('then', '')}"
                for item in contract.get("acceptance_criteria", []) if isinstance(item, dict)
            ).lower()
            if len(contract["acceptance_criteria"]) < 2 or not re.search(r"\b(?:invalid\w*|ausent\w*|incomplet\w*|recus\w*|falh\w*|erro\w*|sem\s+preench\w*)", bdd_text):
                return False, "Feature com entrada precisa de BDD para dado invalido, ausente ou envio recusado."
        for key in ("assumptions", "open_questions"):
            if not isinstance(contract.get(key), list):
                return False, f"Campo {key} precisa ser uma lista."
        return True, None

    def _render_contract_markdown(self, contract):
        def text_items(key, field="text"):
            return [str(item.get(field) or "").strip() for item in contract.get(key, []) if isinstance(item, dict) and str(item.get(field) or "").strip()]

        profile = contract.get("feature_profile") or {}
        pending_by_section = {
            "interface_feedback": "Ponto a validar: Definir feedback de sucesso, erro e andamento para a interacao.",
            "validation_data": "Ponto a validar: Definir regras de obrigatoriedade, formato, consistencia e tratamento de dados invalidos ou ausentes.",
            "permissions_audit": "Ponto a validar: Definir acesso, finalidade, retencao e rastreabilidade dos dados sensiveis.",
            "exception_flows": "Ponto a validar: Definir comportamento para falha, recusa ou interrupcao da entrada.",
        }
        def section_items(key, field="text"):
            items = text_items(key, field)
            if items:
                return "\n".join(f"- {item}" for item in items)
            required = (
                (key == "validation_data" and profile.get("has_input"))
                or (key == "interface_feedback" and (profile.get("has_input") or profile.get("has_form") or profile.get("has_document")))
                or (key == "permissions_audit" and profile.get("has_sensitive_data"))
                or (key == "exception_flows" and profile.get("has_input"))
            )
            return f"- {pending_by_section[key]}" if required and key in pending_by_section else "Nao se aplica. A fonte nao define este aspecto."

        inputs = text_items("inputs", "name")
        outputs = text_items("outputs")
        actors = text_items("actors", "name")
        main_flow = text_items("main_flow")
        requirements = ["### RF-01", f"- Descricao: {contract['refined_story']['text']}"]
        if actors:
            requirements.append("- Atores: " + ", ".join(actors))
        requirements.append("- Entradas: " + (", ".join(inputs) if inputs else "Nao se aplica. Os dados de entrada nao foram definidos pela fonte."))
        requirements.append("- Processamento: " + (" ".join(main_flow) if main_flow else "Nao se aplica. O fluxo confirmado nao foi detalhado pela fonte."))
        requirements.append("- Saidas: " + ("; ".join(outputs) if outputs else "Nao se aplica. As saidas nao foram definidas pela fonte."))
        scope = contract.get("scope_assessment") or {}
        if scope.get("status") == "needs_split":
            requirements.append("- Escopo sob revisao: a historia contem mais de uma jornada e requer decisao de fatiamento antes da implementacao.")
        for notice in contract.get("safety_notices", []):
            if str(notice).strip():
                requirements.append("- Aviso de seguranca: " + str(notice).strip())
        bdd = []
        for index, criterion in enumerate(contract.get("acceptance_criteria", []), start=1):
            given = re.sub(r"^\s*que\s+", "", str(criterion["given"]), flags=re.IGNORECASE)
            status = str(criterion.get("status") or "confirmed").strip().lower()
            marker = "[PROPOSTO - VALIDAR] " if status in {"proposed", "candidate", "assumption"} else ""
            bdd.append(f"{marker}Cenario {index}:\nDADO que {given}\nQUANDO {criterion['when']}\nENTAO {criterion['then']}")
        questions = []
        for index, question in enumerate(contract.get("open_questions", []), start=1):
            if not isinstance(question, dict) or not str(question.get("text") or "").strip():
                continue
            question_id = str(question.get("id") or f"OQ-{index:02d}").upper()
            category = str(question.get("category") or "uncategorized").lower()
            priority = str(question.get("priority") or "medium").lower()
            detail = str(question.get("text") or "").strip()
            decision = str(question.get("decision_needed") or "").strip()
            impact = str(question.get("impact") or "").strip()
            if decision:
                detail += f" Decisao necessaria: {decision}."
            if impact:
                detail += f" Impacto: {impact}."
            questions.append(f"- [REVISAR][{question_id}][{category}][{priority}] {detail}")
        for assumption in contract.get("assumptions", []):
            if isinstance(assumption, dict) and str(assumption.get("text") or "").strip():
                questions.append(f"- [REVISAR][ASM-{len(questions) + 1:02d}][premissa][medio] {assumption['text']}")
        sections = {
            "User Story Refinada": contract["refined_story"]["text"],
            "Requisitos Funcionais": "\n".join(requirements),
            "Fluxo Principal": "\n".join(f"{index}. {item}" for index, item in enumerate(main_flow, start=1)) if main_flow else "Nao se aplica. A fonte nao define passos de fluxo.",
            "Fluxos Alternativos": section_items("alternative_flows"),
            "Fluxos de Excecao": section_items("exception_flows"),
            "Regras de Negocio": section_items("confirmed_rules"),
            "Estados da Interface e Feedback": section_items("interface_feedback"),
            "Validacoes e Dados": section_items("validation_data"),
            "Permissoes e Auditoria": section_items("permissions_audit"),
            "Criterios de Aceite (BDD)": "\n\n".join(bdd),
            "Premissas e Pontos a Validar": "\n".join(questions) if questions else "Nao se aplica. Nenhuma lacuna foi identificada nas fontes fornecidas.",
        }
        return self._build_document(sections)

    def _build_engineering_quality_profile(self, contract, expected):
        """Expose engineering-quality gaps without turning them into AI blockers.

        The primary contract already protects the hard requirements: atomic
        scope, traceable evidence and executable BDD. This profile covers the
        decisions normally needed before implementation planning, but whose
        absence must be visible to the product owner rather than make a valid
        refinement fail.
        """
        compact_context = expected.get("compact_context") or {}
        priority = compact_context.get("taskPriority")
        upstream_status = str((expected.get("upstream_review") or {}).get("status") or "").strip().lower()
        related_stories = compact_context.get("related_stories") or []
        dependencies = contract.get("dependencies") if isinstance(contract.get("dependencies"), list) else []
        source_text = self._normalize_text(" ".join(
            str(item.get("text") or item.get("name") or "")
            for key in ("confirmed_rules", "main_flow", "alternative_flows", "exception_flows", "validation_data", "permissions_audit")
            for item in (contract.get(key) or [])
            if isinstance(item, dict)
        ))
        bdd_text = self._normalize_text(" ".join(
            f"{item.get('given', '')} {item.get('when', '')} {item.get('then', '')}"
            for item in contract.get("acceptance_criteria", [])
            if isinstance(item, dict)
        ))
        nfr_pattern = r"\b(desempenho|performance|seguranca|privacidade|acessibilidade|disponibilidade|escalabilidade|retencao|latencia|sla)\b"
        metric_pattern = r"\b\d+(?:[,.]\d+)?\s*(?:ms|s|segundos?|minutos?|horas?|dias?|%|por cento|usuarios?|itens?)\b"
        source_ids = [
            item.get("id") for item in expected.get("evidence_sources", [])
            if isinstance(item, dict) and item.get("id")
        ]

        return [
            {
                "id": "EQ-TRACEABILITY", "status": "confirmed", "area": "rastreabilidade",
                "message": "Os comportamentos confirmados foram vinculados a fontes rastreaveis do projeto.",
                "source_ids": source_ids,
            },
            {
                "id": "EQ-PRIORITY", "status": "confirmed" if str(priority or "").strip() else "pending", "area": "prioridade",
                "message": f"Prioridade registrada para a historia: {priority}." if str(priority or "").strip() else "Definir a prioridade desta historia para orientar o planejamento e a ordem de entrega.",
            },
            {
                "id": "EQ-DEPENDENCIES", "status": "confirmed" if dependencies else "pending", "area": "dependencias",
                "message": "Dependencias identificadas no requisito." if dependencies else "Confirmar dependencias externas, integracoes, dados, equipes ou pre-requisitos necessarios para esta entrega.",
            },
            {
                "id": "EQ-NFR", "status": "confirmed" if re.search(nfr_pattern, source_text) else "pending", "area": "requisitos nao funcionais",
                "message": "Ha requisitos nao funcionais descritos nas fontes do requisito." if re.search(nfr_pattern, source_text) else "Definir requisitos nao funcionais aplicaveis, como seguranca, privacidade, desempenho, acessibilidade ou disponibilidade.",
            },
            {
                "id": "EQ-MEASURABILITY", "status": "confirmed" if re.search(metric_pattern, bdd_text) else "pending", "area": "mensurabilidade",
                "message": "Os criterios incluem uma medida observavel de aceite." if re.search(metric_pattern, bdd_text) else "Definir metricas ou limites observaveis para validar o resultado quando forem relevantes.",
            },
            {
                "id": "EQ-FEASIBILITY", "status": "pending", "area": "viabilidade",
                "message": "Avaliar viabilidade tecnica, custo e riscos antes de iniciar a implementacao.",
            },
            {
                "id": "EQ-VALIDATION_OWNER", "status": "confirmed" if upstream_status in {"approved", "confirmed", "validated"} else "pending", "area": "validacao humana",
                "message": "A historia possui validacao upstream registrada." if upstream_status in {"approved", "confirmed", "validated"} else "Definir quem valida este requisito e registrar a decisao de negocio antes da implementacao.",
            },
            {
                "id": "EQ-CHANGE_IMPACT", "status": "pending" if related_stories else "not_applicable", "area": "impacto de mudanca",
                "message": "Avaliar o impacto desta entrega nas historias relacionadas, contratos e dados existentes." if related_stories else "Nao ha historias relacionadas identificadas para analise de impacto.",
            },
        ]

    def _render_public_requirements_document(self, contract):
        """Render the validated internal contract in the product-facing format.

        The agent still validates its richer traceability contract internally.
        This method is deliberately a final projection, so presentation choices
        never weaken evidence, scope, or BDD validation during generation.
        """
        def text_items(key, field="text"):
            return [
                str(item.get(field) or "").strip()
                for item in contract.get(key, [])
                if isinstance(item, dict) and str(item.get(field) or "").strip()
            ]

        story = str((contract.get("refined_story") or {}).get("text") or "").strip()
        actor = self._extract_actor(story) or "o usuario"
        action_match = re.search(r"\bquero\s+(.+?)(?:\s*,\s*para\s+|\.$|$)", story, re.IGNORECASE)
        objective = f"Permitir que {actor} {action_match.group(1).strip()}." if action_match else story

        behavior = text_items("main_flow")
        for item in text_items("alternative_flows"):
            behavior.append(f"Fluxo alternativo: {item}")
        for item in text_items("exception_flows"):
            behavior.append(f"Excecao: {item}")

        rules = text_items("confirmed_rules")
        rules.extend(f"Permissoes e auditoria: {item}" for item in text_items("permissions_audit"))
        behavior.extend(f"Feedback: {item}" for item in text_items("interface_feedback"))

        def unique_items(items):
            unique = []
            seen = set()
            for item in items:
                key = self._normalize_text(item)
                if key and key not in seen:
                    unique.append(item)
                    seen.add(key)
            return unique

        behavior = unique_items(behavior)
        rules = unique_items(rules)

        success_criteria = []
        exception_criteria = []
        for index, criterion in enumerate(contract.get("acceptance_criteria", []), start=1):
            if not isinstance(criterion, dict):
                continue
            given = str(criterion.get("given") or "").strip()
            when = str(criterion.get("when") or "").strip()
            then = str(criterion.get("then") or "").strip()
            if given and when and then:
                given_text = re.sub(r"^\s*que\s+", "", given, flags=re.IGNORECASE)
                scenario = (
                    f"### Cenario {index}\n\n"
                    f"**DADO** que {given_text}\\\n"
                    f"**QUANDO** {when}\\\n"
                    f"**ENTAO** {then}"
                )
                scenario_text = self._normalize_text(f"{given} {when} {then}")
                if re.search(r"\b(erro|falha|inval|ausent|recusa|nega|imped\w*|bloqueia|nao disponibiliza|indispon|sem acesso|nao permit|sem\s+preench\w*)", scenario_text):
                    exception_criteria.append(scenario)
                else:
                    success_criteria.append(scenario)

        pending = []
        for index, question in enumerate(contract.get("open_questions", []), start=1):
            if not isinstance(question, dict):
                continue
            detail = str(question.get("text") or "").strip()
            if not detail:
                continue
            decision = str(question.get("decision_needed") or "").strip()
            impact = str(question.get("impact") or "").strip()
            if decision:
                detail += f" Decisao necessaria: {decision}."
            if impact:
                detail += f" Impacto: {impact}."
            pending.append(f"- {detail}")
        pending.extend(
            f"- {str(item.get('text') or '').strip()}"
            for item in contract.get("assumptions", [])
            if isinstance(item, dict) and str(item.get("text") or "").strip()
        )
        # Engineering-quality items remain available in the internal contract
        # for planning, but are not user decisions about this requirement.

        def bullets(items, empty):
            return "\n".join(f"- {item}" for item in items) if items else f"- {empty}"

        status = "PENDENTE DE VALIDACAO" if pending else "PRONTO PARA VALIDACAO"
        success_text = "\n\n".join(success_criteria) if success_criteria else "- Nenhum cenario de sucesso confirmado nas fontes."
        exception_text = "\n\n".join(exception_criteria) if exception_criteria else "- Nenhum cenario de excecao confirmado nas fontes."
        pending_text = "\n".join(pending) if pending else "- Nenhuma pendencia identificada."
        return (
            "# Requisito Refinado\n\n"
            f"## Historia e objetivo\n\n{story}\n\n- Objetivo: {objective}\n\n"
            f"## Comportamento e regras confirmadas\n\n"
            f"### Comportamento\n\n{bullets(behavior, 'Comportamento pendente de definicao nas fontes.') }\n\n"
            f"### Regras\n\n{bullets(rules, 'Nenhuma regra confirmada nas fontes fornecidas.') }\n\n"
            f"## Cenarios de aceite\n\n### Sucesso\n\n{success_text}\n\n"
            f"### Excecoes\n\n{exception_text}\n\n"
            f"## Decisoes pendentes\n\n{pending_text}\n\n"
            f"## Status\n\n**{status}**"
        )

    def _build_provider_fallback_contract(self, idea, expected):
        """Build a conservative, fully traceable contract when every LLM provider is unavailable."""
        story = str(idea or "Solicitar a funcionalidade descrita").strip()
        # The orchestrator may prefix the story with an internal instruction;
        # never expose that instruction as product requirement content.
        if story.lower().startswith("refine somente esta história de usuário:") or story.lower().startswith("refine somente esta historia de usuario:"):
            story = story.split(":", 1)[1].strip()
        story = re.split(r"\n\s*Contexto complementar da tarefa:", story, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        source_ids = ["user_story"] if any(item.get("id") == "user_story" for item in expected.get("evidence_sources", [])) else []
        profile = expected.get("feature_profile") or {}
        upstream = expected.get("upstream_context") if isinstance(expected.get("upstream_context"), dict) else {}
        upstream_inputs = [str(value).strip() for value in upstream.get("inputs", []) if str(value).strip()]
        upstream_outputs = [str(value).strip() for value in upstream.get("outputs", []) if str(value).strip()]
        upstream_rules = [str(value).strip() for value in upstream.get("confirmed_rules", []) if str(value).strip()]
        def item(text, **extra):
            return {"text": text, "source_ids": source_ids.copy(), **extra}
        contract = {
            "domain": expected.get("domain", "general"),
            "intent": expected.get("intent", "workflow"),
            "refined_story": {"text": story, "source_ids": source_ids.copy()},
            "actors": [{"name": "Usuario do produto", "source_ids": source_ids.copy()}],
            "inputs": [item(value, name=value) for value in upstream_inputs] or ([item("Dados informados pelo usuario", name="Dados informados pelo usuario")] if profile.get("has_input") else []),
            "outputs": [item(value) for value in upstream_outputs] or [item("Confirmacao visual do resultado da operacao")],
            "confirmed_rules": [item(value) for value in upstream_rules],
            "main_flow": [item("O usuario acessa a funcionalidade"), item("O usuario informa os dados necessarios"), item("O sistema valida e registra a operacao")],
            "alternative_flows": [],
            "exception_flows": [item("O sistema informa o erro e preserva os dados validos quando a entrada for invalida")],
            "interface_feedback": [item("O sistema apresenta estados de andamento, sucesso e erro")],
            "validation_data": [item("Campos obrigatorios ausentes ou invalidos devem ser rejeitados com mensagem orientativa")],
            "permissions_audit": [],
            "dependencies": [],
            "assumptions": [],
            "open_questions": [{"id": "OQ-01", "text": "Confirmar regras de obrigatoriedade, formato e limites dos dados de entrada.", "category": "validacao", "priority": "high"}] if profile.get("has_input") else [],
            "acceptance_criteria": [
                {"id": "AC-01", "given": "o usuario possui acesso a funcionalidade", "when": "informa dados validos e confirma a operacao", "then": "o sistema valida e registra a operacao", "source_ids": source_ids.copy()},
                {"id": "AC-02", "given": "o usuario informa dados ausentes ou invalidos", "when": "tenta confirmar a operacao", "then": "o sistema recusa o envio e informa como corrigir os dados", "source_ids": source_ids.copy()},
            ],
            "feature_profile": profile,
            "scope_assessment": expected.get("scope_assessment") or {"status": "atomic", "actions": []},
            "upstream_review": expected.get("upstream_review") or {},
            "upstream_context": expected.get("upstream_context") or {},
            "evidence_sources": expected.get("evidence_sources") or [],
            "safety_notices": [],
        }
        source_criteria = upstream.get("acceptance_criteria") if isinstance(upstream.get("acceptance_criteria"), list) else []
        if source_criteria:
            criteria = []
            for index, criterion in enumerate(source_criteria, start=1):
                if not isinstance(criterion, dict):
                    continue
                given = str(criterion.get("given") or "").strip()
                when = str(criterion.get("when") or "").strip()
                then = str(criterion.get("then") or "").strip()
                if given and when and then:
                    criteria.append({"id": str(criterion.get("id") or f"AC-{index:02d}"), "given": given, "when": when, "then": then, "source_ids": source_ids.copy()})
            if criteria:
                contract["acceptance_criteria"] = criteria
        return contract

    def _process_with_primary_contract(self, idea, backlog, project_context, expected_contract):
        # One initial generation plus one evidence-guided repair is the normal
        # path. A single attempt converts a recoverable finding into a failure.
        max_attempts = max(1, min(2, int(os.getenv("REQUIREMENTS_CONTRACT_MAX_RETRIES", "2"))))
        # Modelos remotos podem precisar de mais de 45s para montar o contrato
        # estruturado. O processo do agente tem limite global de 10 minutos, mas
        # este limite por chamada estava encerrando o fallback NVIDIA após 35s.
        timeout = min(180, max(120, int(os.getenv("REQUIREMENTS_LLM_REQUEST_TIMEOUT_SECONDS", "120"))))
        last_reason = "sem detalhes"
        current_contract = None
        for attempt in range(1, max_attempts + 1):
            prompt = self._build_contract_generation_prompt(
                idea, backlog, project_context, expected_contract,
                repair_reason=last_reason if current_contract else None,
                current_contract=current_contract,
            )
            try:
                result = generate_text_from_llm(
                    prompt,
                    options_override={
                        "temperature": 0.1,
                        # O artefato público é compacto; limitar o contrato
                        # interno evita uma resposta excessivamente longa no
                        # provedor remoto sem abrir mão das chaves obrigatórias.
                        "num_predict": int(os.getenv("REQUIREMENTS_CONTRACT_NUM_PREDICT", "1100")),
                        "request_timeout_seconds": timeout,
                        # Retry transient gateway/deadline failures through the
                        # configured provider chain, never with synthetic text.
                        "transient_retries": 0,
                    },
                    use_cache=False,
                    task="requirements_analysis",
                )
            except Exception as error:
                if "Nenhum modelo do router concluiu" in str(error):
                    # Do not fabricate a requirements contract when providers
                    # are unavailable. The artifact must always represent an
                    # actual LLM response; fail explicitly so the task can be
                    # retried without persisting synthetic requirements.
                    raise RuntimeError(f"Falha de provider ao gerar contrato de requisitos: {error}") from error
                raise RuntimeError(f"Falha de provider ao gerar contrato de requisitos: {error}") from error
            current_contract = self._extract_json_object(result)
            if not current_contract:
                last_reason = "A IA deve responder um contrato JSON valido."
                continue
            current_contract = self._apply_contract_guardrails(current_contract, expected_contract)
            valid, last_reason = self._validate_primary_contract(current_contract, expected_contract)
            if not valid:
                print(json.dumps({"event": "requirements_contract_repair", "project_id": self.project_id, "attempt": attempt, "reason": last_reason}, ensure_ascii=False), file=sys.stderr)
                continue
            markdown = self._normalize_permission_section(self._render_contract_markdown(current_contract))
            complete, last_reason = validate_requirements_output(markdown)
            if not complete:
                continue
            semantic_ok, last_reason = self._validate_evidence_semantics(markdown, current_contract)
            if not semantic_ok:
                continue
            evidence_review = self._review_with_evidence(markdown, expected_contract)
            current_contract["evidence_review"] = evidence_review
            self.last_evidence_report = evidence_review
            print(json.dumps({
                "event": "requirements_evidence_review",
                "project_id": self.project_id,
                "domain": current_contract.get("domain"),
                "intent": current_contract.get("intent"),
                "status": evidence_review.get("status"),
                "decision": evidence_review.get("decision"),
                "findings_count": len(evidence_review.get("findings", [])),
                "reason": evidence_review.get("reason") if evidence_review.get("status") != "completed" else None,
            }, ensure_ascii=False), file=sys.stderr)
            findings = evidence_review.get("findings", [])
            if evidence_review.get("status") != "completed":
                raise RuntimeError(
                    "Revisao de evidencias indisponivel; nenhum requisito foi publicado. Tente novamente."
                )
            needs_repair = evidence_review.get("status") == "completed" and evidence_review.get("decision") == "REVISE" and any(
                finding.get("severity") in {"medium", "high"} for finding in findings if isinstance(finding, dict)
            )
            if needs_repair:
                last_reason = "Revisor encontrou afirmacoes sem evidencia: " + "; ".join(
                    str(finding.get("reason") or finding.get("evidence") or "sem detalhe")
                    for finding in findings if isinstance(finding, dict)
                )
                if attempt < max_attempts:
                    continue
                break
            current_contract["engineering_quality"] = self._build_engineering_quality_profile(current_contract, expected_contract)
            self.last_refinement_contract = current_contract
            return self._render_public_requirements_document(current_contract)
        raise RuntimeError(f"O agente requirements_analyst nao conseguiu gerar um contrato valido apos {max_attempts} tentativas. Ultimo motivo: {last_reason}")

    def process(self, idea, backlog, project_context=None):
        expected_contract = self._build_refinement_contract(idea, backlog, project_context)
        upstream = expected_contract.get("upstream_review") or {}
        blocking_tags = {str(tag).strip() for tag in upstream.get("tags") or []}
        upstream_assessment = upstream.get("assessment") if isinstance(upstream.get("assessment"), dict) else {}
        upstream_ready = str(upstream_assessment.get("decision") or "").strip().upper() == "READY"
        if (
            upstream_ready
            and expected_contract.get("scope_assessment", {}).get("status") == "needs_split"
            and expected_contract.get("scope_assessment", {}).get("source") == "semantic"
        ):
            # A previously approved story review is stronger evidence than an
            # opportunistic semantic classification.  This avoids blocking a
            # single journey when the model mistakes its expected outcome
            # (message, validation or blocked action) for another delivery.
            expected_contract["scope_assessment"] = {
                "status": "atomic",
                "actions": ["jornada aprovada no backlog"],
                "action_phrase": "jornada aprovada no backlog",
                "source": "upstream_ready",
            }
        if expected_contract.get("scope_assessment", {}).get("status") == "needs_split" or blocking_tags.intersection({"REVIEW_ROLE", "REVIEW_BLOCKED"}):
            reasons = []
            if expected_contract.get("scope_assessment", {}).get("status") == "needs_split":
                reasons.append("historia com acoes independentes que precisam ser separadas")
            if "REVIEW_ROLE" in blocking_tags:
                reasons.append("conflito entre ator e comportamento automatico")
            if "REVIEW_BLOCKED" in blocking_tags:
                reasons.append("reparo do backlog pendente")
            error = RuntimeError(
                "A historia nao esta apta para refinamento de implementacao: " + "; ".join(reasons) + ". "
                "Corrija o backlog pelo project_manager e mantenha as lacunas como pontos de revisao."
            )
            if expected_contract.get("scope_assessment", {}).get("status") == "needs_split":
                error.rejected_draft = self._scope_split_diagnostic(idea, expected_contract["scope_assessment"])
            raise error
        return self._process_with_primary_contract(idea, backlog, project_context, expected_contract)

    def _process_legacy_markdown(self, idea, backlog, project_context=None):
        expected_contract = self._build_refinement_contract(idea, backlog, project_context)
        prompt = self._build_main_prompt(idea, backlog, project_context=project_context, refinement_contract=expected_contract)
        max_retries = max(2, int(os.getenv("REQUIREMENTS_MAX_RETRIES", "2")))
        base_num_predict = int(os.getenv("REQUIREMENTS_LLM_NUM_PREDICT", "1800"))
        # A router failure already means every configured provider was tried.
        # Keep a bounded per-provider budget while allowing remote models time
        # to return a complete structured answer. The prior 35–45s cap caused
        # NVIDIA fallbacks to fail before they could respond.
        request_timeout = min(180, max(120, int(os.getenv("REQUIREMENTS_LLM_REQUEST_TIMEOUT_SECONDS", "120"))))
        last_reason = "sem detalhes"

        for attempt in range(1, max_retries + 1):
            current_prompt = prompt
            if attempt > 1:
                print(json.dumps({
                    "event": "requirements_generation_retry",
                    "project_id": self.project_id,
                    "attempt": attempt,
                    "previous_rejection_reason": last_reason,
                }, ensure_ascii=False), file=sys.stderr)
                current_prompt = (
                    f"{prompt}\n\n"
                    "IMPORTANTE: sua resposta anterior foi considerada incompleta. "
                    f"Motivo detectado: {last_reason}. "
                    "Gere novamente o refinamento completo, sem omitir secoes e sem interromper no meio."
                )

            try:
                result = generate_text_from_llm(
                    current_prompt,
                    options_override={
                        "temperature": 0.1,
                        "num_predict": int(base_num_predict * (1.4 ** (attempt - 1))),
                        "request_timeout_seconds": request_timeout,
                    },
                    use_cache=False,
                    task="requirements_analysis",
                )
            except Exception as error:
                last_reason = f"Falha de provider na tentativa {attempt}: {error}"
                print(json.dumps({
                    "event": "requirements_generation_provider_failure",
                    "project_id": self.project_id,
                    "attempt": attempt,
                    "reason": last_reason,
                }, ensure_ascii=False), file=sys.stderr)
                if "Nenhum modelo do router concluiu" in str(error):
                    raise RuntimeError(last_reason) from error
                continue

            if not result or is_error_text_response(result):
                last_reason = "Resposta vazia ou invalida."
                continue

            envelope, parse_reason = self._parse_ai_refinement_response(result, expected_contract)
            if not envelope:
                last_reason = parse_reason
                continue

            # Markdown is the public artifact.  Derive the internal contract from
            # it even when a provider also sent JSON, so a fabricated JSON label
            # can never make an unsupported Markdown statement "confirmed".
            generated_contract = self._contract_from_markdown(envelope["markdown"], expected_contract)
            contract_ok, contract_reason = self._validate_ai_contract(generated_contract, expected_contract)
            if not contract_ok:
                last_reason = contract_reason
                continue

            sanitized = self._normalize_permission_section(
                self._apply_story_type_guardrails(self._sanitize_requirements(envelope["markdown"]), idea)
            )
            is_complete, reason = validate_requirements_output(sanitized)
            if is_complete:
                semantic_ok, semantic_reason = self._validate_evidence_semantics(sanitized, generated_contract)
                if semantic_ok:
                    evidence_report = self._review_with_evidence(sanitized, expected_contract)
                    self.last_evidence_report = evidence_report
                    print(json.dumps({
                        "event": "requirements_evidence_review",
                        "project_id": self.project_id,
                        "domain": generated_contract.get("domain"),
                        "intent": generated_contract.get("intent"),
                        "status": evidence_report.get("status"),
                        "decision": evidence_report.get("decision"),
                        "findings_count": len(evidence_report.get("findings", [])),
                        "reason": evidence_report.get("reason") if evidence_report.get("status") != "completed" else None,
                    }, ensure_ascii=False), file=sys.stderr)
                    generated_contract["evidence_review"] = evidence_report
                    if evidence_report["status"] != "completed":
                        raise RuntimeError(
                            "Revisao de evidencias indisponivel; nenhum requisito foi publicado. Tente novamente."
                        )
                    should_revise = (
                        evidence_report["status"] == "completed"
                        and evidence_report["decision"] == "REVISE"
                        and any(item.get("severity") in {"medium", "high"} for item in evidence_report["findings"])
                        and attempt < max_retries
                    )
                    if should_revise:
                        revision = generate_text_from_llm(
                            self._build_evidence_revision_prompt(sanitized, evidence_report, expected_contract),
                            options_override={
                                "temperature": 0.1,
                                "num_predict": int(base_num_predict * 1.4),
                                "request_timeout_seconds": request_timeout,
                            },
                            use_cache=False,
                            task="requirements_analysis",
                        )
                        parsed_revision, revision_reason = self._parse_ai_refinement_response(revision, expected_contract)
                        if parsed_revision:
                            sanitized = self._normalize_permission_section(
                                self._apply_story_type_guardrails(self._sanitize_requirements(parsed_revision["markdown"]), idea)
                            )
                            complete, revision_reason = validate_requirements_output(sanitized)
                            revised_contract = self._contract_from_markdown(sanitized, expected_contract)
                            semantic_ok, semantic_reason = self._validate_evidence_semantics(sanitized, revised_contract)
                            revised_evidence_report = self._review_with_evidence(sanitized, expected_contract) if complete and semantic_ok else None
                            if revised_evidence_report:
                                revised_contract["evidence_review"] = revised_evidence_report
                            if complete and semantic_ok and revised_evidence_report and revised_evidence_report["status"] == "completed" and revised_evidence_report["decision"] == "PASS":
                                self.last_refinement_contract = revised_contract
                                self.last_evidence_report = revised_evidence_report
                                return sanitized
                        last_reason = revision_reason or semantic_reason or "Revisao por evidencia ainda encontrou afirmacoes sem fonte."
                        continue
                    if evidence_report["status"] == "completed" and evidence_report["decision"] == "REVISE":
                        last_reason = "Revisor encontrou afirmacoes sem evidencia, mas nao havia tentativa restante para revisao."
                        continue
                    self.last_refinement_contract = generated_contract
                    return sanitized
                last_reason = semantic_reason
                continue

            last_reason = reason or "Refinamento considerado incompleto."

        raise RuntimeError(
            f"O agente requirements_analyst nao conseguiu gerar uma resposta completa apos {max_retries} tentativas. "
            f"Ultimo motivo: {last_reason}"
        )

    def _build_main_prompt(self, idea, backlog, project_context=None, refinement_contract=None):
        story_type = self._classify_story_type(idea)
        compact_context = self._compact_project_context(project_context)
        domain_vocabulary = compact_context["domain"] or self._extract_domain_vocabulary(backlog)
        domain_vocabulary_text = ", ".join(domain_vocabulary) if domain_vocabulary else "nao informado"
        contract_text = json.dumps(refinement_contract or {}, ensure_ascii=False, indent=2)
        return f"""
Voce e um Analista de Requisitos Senior especializado em transformar User Stories em requisitos funcionais claros, completos e sem ambiguidades.

Sua unica missao e refinar requisitos para implementacao.

REGRAS CRITICAS:
- Voce esta refinando apenas UMA unica User Story
- NAO expanda escopo
- NAO crie novas funcionalidades fora da historia
- NAO invente modulos, dashboards, relatorios ou integracoes
- NAO invente nenhuma regra, dado, limite, prazo, calculo, integracao, permissao ou comportamento sem evidencia explicita
- NAO transforme hipotese, conhecimento geral do dominio ou uma boa ideia em requisito confirmado
- Se um detalhe nao estiver sustentado pela User Story ou pelo contexto curto, trate como lacuna
- Seja direto, tecnico e implementavel
- Explicite ambiguidades como perguntas; nao as resolva por conta propria
- O documento deve separar fatos comprovados de lacunas de decisao
- Use "Nao se aplica" somente quando a secao for realmente incompatível com a acao da story. Quando houver entrada, decisao, estado ou efeito observavel relacionado, detalhe-o; se faltar a regra, registre a pergunta em Premissas.
- Descreva formato, obrigatoriedade, limites, permissoes, auditoria e BDD somente quando a fonte os sustentar; caso contrario, registre uma pergunta objetiva.
- O requisito nao pode ser apenas uma repeticao da User Story: decomponha ator, entradas, processamento, saidas, pre-condicoes, pos-condicoes e evidencias confirmadas.
- Para qualquer story com entrada ou alteracao de dados, inclua caminho feliz e dado ausente/invalido quando essa possibilidade existir; detalhes nao confirmados viram lacunas.
- Use exatamente os titulos de secao abaixo, sem variacoes, abreviacoes ou sinônimos:
  - ## User Story Refinada
  - ## Requisitos Funcionais
  - ## Fluxo Principal
  - ## Fluxos Alternativos
  - ## Fluxos de Excecao
  - ## Regras de Negocio
  - ## Estados da Interface e Feedback
  - ## Validacoes e Dados
  - ## Permissoes e Auditoria
  - ## Criterios de Aceite (BDD)

---

ENTRADA

User Story:
"{idea}"

Contexto curto do backlog/projeto (apenas referencia, NAO expandir escopo):
{backlog}

Contexto estruturado comprovavel (Project DNA e Backlog Contract, quando disponiveis):
```json
{json.dumps(compact_context, ensure_ascii=False, indent=2)}
```

Contrato interno de rastreabilidade (JSON validavel; ele classifica o contexto, mas NAO define regras de negocio):
```json
{contract_text}
```

Tipo estrutural da story:
{story_type}

Vocabulário central do dominio:
{domain_vocabulary_text}

---

TAREFA

Refinar a User Story em requisitos completos seguindo EXATAMENTE a estrutura abaixo:

HIERARQUIA DE EVIDENCIA:
1. A User Story e a fonte principal da verdade
2. Project DNA e Backlog Contract estruturados podem confirmar dominio, atores, capacidades, restricoes, fluxos e politicas conhecidas
3. Qualquer detalhe nao sustentado deve virar premissa ou ponto a validar, nunca regra confirmada

MATRIZ INTERNA OBRIGATORIA (nao a inclua no Markdown):
1. Extraia as afirmacoes confirmadas pelas fontes.
2. Separe inferencias minimas e inevitaveis de decisoes de produto. Uma inferencia plausivel, mas opcional, e uma lacuna.
3. Antes de escrever cada RF, passo de fluxo, alternativa, excecao, validacao, permissao, estado de interface, regra ou linha ENTAO, confirme que ela aparece nessa matriz.
4. Se nao houver fonte, escreva apenas a pergunta em "Premissas e Pontos a Validar"; nao descreva comportamento provisoriamente.

COMO LIDAR COM INFORMACAO FALTANTE:
- Se faltar dado operacional ou regra de negocio, registre uma pergunta objetiva em "Premissas e Pontos a Validar"
- Se existir mais de uma interpretacao plausivel, mantenha as alternativas como lacuna; nao escolha uma delas
- Nao adicione numeros ou comportamentos especificos sem base textual
- Retomar, visualizar ou editar algo nao implica lista, busca, tela nova, descarte, expiracao, notificacao, validacao adicional ou regra de acesso; trate a forma de realizar essas acoes como lacuna se a fonte nao a definir
- Nao use "Ponto a validar" para esconder o significado de um campo explicitamente citado; registre o campo e pergunte somente o detalhe que falta.
- A clausula de beneficio da historia ("para ...") explica objetivo de negocio e contexto, mas NAO cria um segundo fluxo principal por si so.
- Nao crie RF separado para efeito posterior, vinculo, painel, consulta ou operacao derivada quando a acao principal da historia for cadastro, criacao, registro, aprovacao ou atualizacao.
- Quando a historia tiver uma unica acao central, mantenha um unico RF principal; efeitos posteriores devem aparecer em processamento, saidas, regras ou criterios de aceite, nao como nova funcionalidade.
- Para historias de cadastro/criacao/registro com uma unica acao central, gere EXATAMENTE 1 RF principal, a menos que a historia traga explicitamente uma segunda acao de usuario independente.
- Preserve rigorosamente o vocabulario do dominio informado. Nao troque "visita" por "evento", "chamado", "solicitacao" ou outra entidade de outro contexto.
- Se a story for do tipo "scope-definition", foque apenas em parametros de escopo. Nao introduza ID sequencial, numero da entidade, status de workflow, aprovacao, protocolo ou ciclo de vida completo, salvo se isso estiver explicitamente na historia.
- Se a story for do tipo "create" ou "record" com foco em contexto inicial, dados iniciais ou cadastro minimo, NAO antecipe status, protocolo, timestamp, identificador, aprovacao ou ciclo posterior, salvo quando a propria historia pedir isso de forma explicita.
- Para stories de criacao/registro, descreva a confirmacao do cadastro e os dados salvos, mas nao transforme consequencias de workflow em nucleo do requisito.
- Se a story for do tipo "view", nao invente comandos de cadastro, aprovacao, alteracao ou processamento.
- Se a story for do tipo "view" ou "summary", trate status atual e base operacional apenas como dados exibidos em modo somente leitura. Nao converta a historia em fluxo de cadastro, workflow, aprovacao, protocolo ou identificacao.
- Se a story for do tipo "approval", nao invente campos de criacao pertencentes a etapas anteriores.
- Em Fluxos Alternativos, prefira cancelamento ou correcao de dados com impacto real no fluxo; evite bullets genéricos como "limpar campos" sem comportamento adicional.
- Em Saídas, privilegie a confirmação da criacao do evento e so destaque identificador quando ele for efetivamente parte da historia ou do criterio de aceite.

SECAO OPCIONAL:
- Quando houver lacunas reais, inclua ao final uma secao "## Premissas e Pontos a Validar"
- Nessa secao, liste apenas itens que NAO puderam ser confirmados pela historia usando obrigatoriamente: [REVISAR][RV-01][categoria][alto|medio|baixo] pergunta objetiva.
- Categorias permitidas: regra-de-negocio, dados, validacao, permissao, integracao, fluxo, compliance.
- Essa secao nao substitui requisitos; ela evita invencao

---

# REFINAMENTO DE REQUISITO

## User Story Refinada
(Reescreva a historia de forma clara, especifica e objetiva)

---

## Requisitos Funcionais

### RF-01
- Descricao:
- Atores:
- Entradas:
- Processamento:
- Saidas:
- Pre-condicoes:
- Pos-condicoes:
- Evidencias:

(Adicionar quantos RFs forem necessarios, sem extrapolar escopo)

---

## Fluxo Principal
(Descreva o fluxo passo a passo, incluindo entrada, processamento e saida observavel. Nao repita apenas a frase da User Story.)

---

## Fluxos Alternativos
(Use "Nao se aplica" se nenhuma variacao estiver confirmada.)

---

## Fluxos de Excecao
(Use "Nao se aplica" se a historia nao definir erro ou excecao.)

---

## Regras de Negocio
(Liste somente regras confirmadas; uma unica regra confirmada e suficiente. Use "Nao se aplica" quando nao houver regra.)

---

## Estados da Interface e Feedback
- Liste somente estados confirmados. Nao acrescente carregamento, mensagem, destaque ou tela vazia como convencao. Use "Nao se aplica" quando nao houver fonte.

---

## Validacoes e Dados
- Liste campos, validacoes, formatos, obrigatoriedades e consistencia. Para cada lacuna, inclua uma pergunta objetiva em vez de inventar.
- Se a historia nao exigir entrada de dados, escreva "Nao se aplica" e justifique em uma linha.

---

## Permissoes e Auditoria
- Liste somente permissoes e auditoria confirmadas; titularidade, login, perfis, historico e timestamp nao podem ser deduzidos.
- Se a historia mencionar acesso, identificacao, autenticacao ou dados pessoais, mas a fonte nao definir a politica, escreva "Pendente de definicao" e formule uma pergunta objetiva. Use "Nao se aplica" somente quando nao houver qualquer mencao a acesso ou protecao.

---

## Criterios de Aceite (BDD)

DADO que ...
QUANDO ...
ENTAO ...

(Inclua criterios suficientes para validar o comportamento. Para entradas ou alteracoes, cubra caminho feliz e dado ausente/invalido quando essa possibilidade fizer parte do fluxo; se a regra nao estiver confirmada, marque como proposto e abra uma pergunta.)

---

DIRETRIZES FINAIS:
- Seja extremamente claro e tecnico
- Um documento curto e correto e melhor que um documento completo com comportamento inventado
- Se faltar informacao, sinalize a lacuna sem inventar a regra
- Toda especificidade adicionada deve estar rastreavel a historia ou ao contexto curto
- Gere o contrato interno mentalmente antes de escrever e responda com APENAS o Markdown completo na estrutura solicitada.
- Nao use JSON como formato de resposta; o sistema normaliza o Markdown em contrato interno e valida as evidencias.
- Mantenha "## Premissas e Pontos a Validar" sempre que houver lacunas.
"""

    def _extract_missing_sections(self, reason):
        match = re.search(r"Secoes ausentes:\s*(.+)$", reason or "", re.IGNORECASE)
        if not match:
            return []
        raw_sections = [item.strip().lower() for item in match.group(1).split(",")]
        return [self.SECTION_KEYS[item] for item in raw_sections if item in self.SECTION_KEYS]

    def _extract_sections(self, content):
        sections = {}
        text = (content or "").strip()
        for title in self.SECTION_TITLES:
            for alias in self.SECTION_ALIASES.get(title, [title]):
                pattern = re.compile(
                    rf"^##\s+{re.escape(alias)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
                    re.IGNORECASE | re.MULTILINE,
                )
                match = pattern.search(text)
                if match:
                    sections[title] = match.group(1).strip()
                    break
        premissas_pattern = re.compile(
            r"^##\s+Premissas e Pontos a Validar\s*$([\s\S]*?)(?=^##\s+|\Z)",
            re.IGNORECASE | re.MULTILINE,
        )
        premissas_match = premissas_pattern.search(text)
        if premissas_match:
            sections["Premissas e Pontos a Validar"] = premissas_match.group(1).strip()
        return sections

    def _build_document(self, sections):
        ordered = []
        for title in self.SECTION_TITLES:
            body = re.sub(r"(?m)^\s*---\s*$", "", sections.get(title) or "").strip()
            body = re.sub(r"\n{3,}", "\n\n", body).strip()
            if body:
                ordered.append(f"## {title}\n{body}")
        premissas = (sections.get("Premissas e Pontos a Validar") or "").strip()
        if premissas:
            ordered.append(f"## Premissas e Pontos a Validar\n{premissas}")
        assembled = "\n\n---\n\n".join(ordered).strip()
        if not assembled:
            return "FIM_DO_REFINAMENTO"
        if "FIM_DO_REFINAMENTO" not in assembled:
            assembled = f"{assembled}\n\nFIM_DO_REFINAMENTO"
        return assembled

    def _repair_requirements(self, current_text, idea, backlog, reason):
        sections = self._extract_sections(current_text)
        missing_sections = self._extract_missing_sections(reason)
        normalized_reason = (reason or "").lower()
        rebuild_full_document = len(missing_sections) >= 3

        if "criterios de aceite" in normalized_reason and "Criterios de Aceite (BDD)" not in missing_sections:
            missing_sections.append("Criterios de Aceite (BDD)")
        if "campos centrais da feature" in normalized_reason:
            for section in [
                "Requisitos Funcionais",
                "Regras de Negocio",
                "Validacoes e Dados",
                "Permissoes e Auditoria",
            ]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "campo central de contato precisa de contrato mais fechado" in normalized_reason:
            for section in ["Requisitos Funcionais", "Validacoes e Dados", "Regras de Negocio"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "campo central de tipo precisa de contrato mais fechado" in normalized_reason:
            for section in ["Requisitos Funcionais", "Validacoes e Dados", "Regras de Negocio"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "escopo expandido com funcionalidade derivada" in normalized_reason:
            for section in ["Requisitos Funcionais", "Fluxo Principal", "Regras de Negocio", "Criterios de Aceite (BDD)"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "bleed de dominio" in normalized_reason:
            for section in ["User Story Refinada", "Requisitos Funcionais", "Fluxo Principal", "Regras de Negocio"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "story de escopo expandiu para workflow" in normalized_reason:
            for section in ["Requisitos Funcionais", "Fluxo Principal", "Regras de Negocio", "Validacoes e Dados"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "identificacao indevida" in normalized_reason:
            for section in ["Requisitos Funcionais", "Fluxo Principal", "Regras de Negocio", "Validacoes e Dados", "Criterios de Aceite (BDD)"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "workflow" in normalized_reason and self._classify_story_type(idea) == "view":
            for section in ["User Story Refinada", "Requisitos Funcionais", "Fluxo Principal", "Regras de Negocio", "Validacoes e Dados", "Criterios de Aceite (BDD)"]:
                if section not in missing_sections:
                    missing_sections.append(section)
        if "regras de negocio insuficientes" in normalized_reason and "Regras de Negocio" not in missing_sections:
            missing_sections.append("Regras de Negocio")

        if not missing_sections:
            return current_text

        current_document = self._build_document(sections)
        repair_scope = "Reescreva o documento inteiro, preservando apenas o escopo da historia." if rebuild_full_document else "Gere APENAS as secoes faltantes ou incompletas listadas abaixo."
        repair_prompt = f"""
Voce vai reparar um refinamento de requisitos incompleto.

User Story:
"{idea}"

Contexto curto do backlog/projeto:
{backlog}

Rascunho atual:
{current_document}

Motivo do reparo:
{reason or "Documento incompleto."}

Tarefa:
- {repair_scope}
- Se reescrever o documento inteiro, mantenha EXATAMENTE a estrutura obrigatoria do refinamento.
- Se nao reescrever o documento inteiro, nao repita secoes que ja estao corretas.
- Nao invente funcionalidades, SLA, links, janelas de tempo, preferencia de canal ou comportamento extra sem base textual.
- Se faltar informacao, use linguagem neutra ou registre como ponto a validar.
- Campos centrais da feature NAO podem permanecer como "Ponto a validar". Defina formato base, obrigatoriedade e regra minima implementavel para esses campos.
- Para contato central, feche o contrato com formato conservador como e-mail, telefone ou ambos. Nao deixe como texto livre.
- Para tipo, categoria ou suporte central, feche o contrato com lista controlada, enum ou conjunto predefinido. Nao deixe como texto livre.
- Nao transforme a clausula "para ..." em novo RF. Se a historia descreve uma unica acao central, mantenha um unico RF principal e mova efeitos derivados para processamento, saidas, regras ou BDD.
- Se a historia for de cadastro/criacao/registro com uma unica acao central, gere EXATAMENTE 1 RF principal.
- Preserve o vocabulario do dominio do backlog. Se a historia for de visitas, nao use "evento" ou linguagem de outro dominio.
- Se a historia for de escopo/configuracao, remova qualquer expansao para workflow, status, aprovacao, protocolo, ID, UUID, GUID ou timestamp como parte do requisito, salvo se a propria historia disser isso explicitamente.
- Em "Criterios de Aceite (BDD)", use obrigatoriamente DADO, QUANDO e ENTAO.

Secoes para reparar:
{chr(10).join(f"## {section}" for section in missing_sections)}
"""

        repair_result = generate_text_from_llm(
            repair_prompt,
            options_override={
                "temperature": 0.1,
                "num_predict": int(os.getenv("REQUIREMENTS_REPAIR_NUM_PREDICT", "1200")),
            },
            use_cache=False,
        )

        if not repair_result or is_error_text_response(repair_result):
            return current_text

        repaired_sections = self._extract_sections(repair_result)
        for section in missing_sections:
            body = (repaired_sections.get(section) or "").strip()
            if body:
                sections[section] = body

        still_missing = [section for section in missing_sections if not (sections.get(section) or "").strip()]
        if still_missing:
            return current_text

        return self._build_document(sections)

    def _sanitize_requirements(self, content):
        text = (content or "").strip()
        if not text:
            return ""

        replacements = {
            "após a confirmação da marcação.": "de acordo com o fluxo definido pelo produto.",
            "apos a confirmacao da marcacao.": "de acordo com o fluxo definido pelo produto.",
            "canal de comunicação preferencial (SMS ou e-mail) especificado durante a marcação": "canal de comunicacao definido para o envio do lembrete",
            "canal de comunicacao preferencial (SMS ou e-mail) especificado durante a marcacao": "canal de comunicacao definido para o envio do lembrete",
            "seleciona SMS ou e-mail como canal de comunicação preferencial": "segue o canal de comunicacao definido pelo produto",
            "seleciona SMS ou e-mail como canal de comunicacao preferencial": "segue o canal de comunicacao definido pelo produto",
            "Paciente altera o canal de comunicação preferencial:": "Ponto a validar sobre alteracao de canal:",
            "Paciente altera o canal de comunicacao preferencial:": "Ponto a validar sobre alteracao de canal:",
            "o sistema deve atualizar o canal de comunicação preferencial do paciente no banco de dados e gerar um novo lembrete no novo canal.": "registrar como ponto a validar caso o produto permita alteracao de canal apos a marcacao.",
            "o sistema deve atualizar o canal de comunicacao preferencial do paciente no banco de dados e gerar um novo lembrete no novo canal.": "registrar como ponto a validar caso o produto permita alteracao de canal apos a marcacao.",
            "o sistema registra a falha e notifica o recepcionista.": "o sistema registra a falha conforme definicao operacional do produto.",
            "o sistema deve registrar o falha no envio do e-mail e notificar o recepcionista.": "o sistema deve registrar a falha no envio conforme definicao operacional do produto.",
            "o recepcionista deve ser notificado da falha no envio do e-mail.": "a falha no envio deve ser tratada conforme definicao operacional do produto.",
        }

        for source, target in replacements.items():
            text = text.replace(source, target)

        text = re.sub(r"canal de comunica(?:ç|c)ao preferencial", "canal de envio", text, flags=re.IGNORECASE)
        text = re.sub(
            r"paciente\s+(?:marca|agend[aou]*)\s+consulta\s+e\s+seleciona\s+sms\s+ou\s+e-mail\s+como\s+canal\s+de\s+(?:comunicacao\s+preferencial|envio)",
            "o sistema identifica a consulta agendada e prepara o envio do lembrete por SMS ou e-mail",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(r"paciente\s+tenha\s+optado\s+por\s+e-mail", "o envio ocorrer por e-mail", text, flags=re.IGNORECASE)
        text = re.sub(r"paciente\s+tenha\s+optado\s+por\s+sms", "o envio ocorrer por SMS", text, flags=re.IGNORECASE)
        text = re.sub(
            r"nao ha configuracao de preferencia",
            "nao ha definicao adicional de canal",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"a escolha do paciente por um canal especifico",
            "uma definicao explicita de canal pelo paciente",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"canal de envio e determinado conforme dados do paciente",
            "o canal de envio deve seguir a definicao do produto e os dados disponiveis para contato",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"o lembrete deve conter a data,\s*o horario e o profissional da consulta\.?",
            "o lembrete deve conter as informacoes da consulta conforme definicao do produto.",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"Ponto a validar:\s*Qual a antecedencia do envio do lembrete\s*\([^)]*\)\??",
            "Ponto a validar: definir a antecedencia do envio do lembrete.",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"Ponto a validar:\s*qual a antecedencia do envio do lembrete\s*\([^)]*\)\??",
            "Ponto a validar: definir a antecedencia do envio do lembrete.",
            text,
            flags=re.IGNORECASE,
        )

        extracted_sections = self._extract_sections(text)
        if extracted_sections:
            text = self._build_document(extracted_sections)

        text = re.sub(r"\n{3,}", "\n\n", text)

        return text

    @staticmethod
    def _normalize_permission_section(markdown):
        """Expose undefined access policy as a decision, never as N/A."""
        if not isinstance(markdown, str):
            return markdown
        normalized = re.sub(r"[^a-z0-9]+", " ", markdown.lower())
        access_mentioned = bool(re.search(
            r"\b(controle de acesso|acesso autorizado|autenticacao|login|permiss(?:ao|oes)|identificacao do usuario|titularidade)\b",
            normalized,
        ))
        if not access_mentioned:
            return markdown
        pattern = re.compile(r"(?ims)(^##\s*permissoes\s+e\s+auditoria\s*$)(.*?)(?=^##\s+|\Z)")
        match = pattern.search(markdown)
        if not match or not re.search(r"n[aã]o\s+se\s+aplica", match.group(2), re.IGNORECASE):
            return markdown
        replacement = (
            f"{match.group(1)}\n"
            "- Pendente de definição: o briefing menciona acesso/identificação, "
            "mas não define perfis, titularidade ou regras de autorização.\n"
            "- Decisão necessária: confirmar quais perfis podem executar a operação "
            "e quais registros de auditoria são obrigatórios.\n"
        )
        return markdown[:match.start()] + replacement + markdown[match.end():]

    def _apply_story_type_guardrails(self, content, idea):
        text = (content or "").strip()
        if not text:
            return ""

        if self._classify_story_type(idea) == "scope-definition":
            replacements = {
                "com identificador ??nico": "com confirma????o do registro",
                "com identificador unico": "com confirma????o do registro",
                "com ID gerado": "com confirma????o do registro",
                "com ID da visita": "com confirma????o do registro",
                "com n??mero da solicita????o": "com confirma????o do registro",
            }
            for source, target in replacements.items():
                text = text.replace(source, target)

            text = re.sub(r"(?im)^.*\bidentificador unico\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bnumero sequencial\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bprotocolo\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\btimestamp\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\buuid\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bguid\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bstatus\b.*$\n?", "", text)
            text = self._prune_scope_definition_content(text, idea)
        elif self._classify_story_type(idea) == "view":
            text = re.sub(r"(?im)^.*\bworkflow\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\baprov(a|á)cao\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bcadastro\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bcriar\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bregistrar\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bidentificador\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\buuid\b.*$\n?", "", text)
            text = re.sub(r"(?im)^.*\bguid\b.*$\n?", "", text)
            text = re.sub(r"\n{3,}", "\n\n", text)

        text = self._prune_initial_registration_content(text, idea)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()
