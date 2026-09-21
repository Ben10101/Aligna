# -*- coding: utf-8 -*-
import json
import os
import unittest
from unittest.mock import patch

from agents.developer.llm_service import get_provider_timeout_seconds
from agents.developer.response_validation import validate_requirements_output
from agents.requirements_analyst.agent import RequirementsAnalyst


class RequirementsAnalystCreditSimulationTests(unittest.TestCase):
    STORY = (
        "Como cliente, quero simular um emprestimo informando valor, prazo e numero de parcelas "
        "para conhecer uma estimativa."
    )

    def setUp(self):
        self.agent = RequirementsAnalyst("credit-test")
        self.context = {
            "projectDna": {
                "project": {"primaryActor": "cliente", "domainLanguage": ["credito", "condicao de credito"]},
                "coherenceRules": {"mustPreserve": ["nao prometer aprovacao"]},
            },
            "backlogContract": {
                "capabilities": [{"name": "Simulacao de credito"}],
                "releaseSlices": [{"name": "Simular", "goal": "consultar condicao aplicavel"}],
            },
        }

    def test_credit_contract_is_json_and_contains_only_classification_and_sources(self):
        contract = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)

        self.assertEqual("contextual", contract["domain"])
        self.assertEqual("simulation", contract["intent"])
        self.assertEqual([], contract["inputs"])
        self.assertEqual([], contract["open_questions"])
        self.assertEqual({"user_story", "backlog", "project_dna", "backlog_contract"}, {item["id"] for item in contract["evidence_sources"]})
        self.assertEqual(contract, json.loads(json.dumps(contract)))

    def test_story_context_exposes_current_and_related_backlog_sources(self):
        context = {
            **self.context,
            "storyContext": {
                "currentStory": {"id": "story_2", "title": "Como cliente, eu quero simular credito.", "description": "Usar dados solicitados."},
                "relatedStories": [{"id": "story_1", "title": "Como cliente, eu quero iniciar uma proposta."}],
            },
        }
        contract = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", context)
        source_ids = {item["id"] for item in contract["evidence_sources"]}

        self.assertIn("backlog.story_2", source_ids)
        self.assertIn("backlog.story_1", source_ids)

    def test_semantic_discovery_normalizes_null_categories_and_requests_json(self):
        response = {
            "domain": "generic", "intent": "view",
            "has_input": "false", "has_document": None, "has_form": False, "has_sensitive_data": False,
            "actors": None, "entities": [], "goals": [], "actions": [], "states": [], "ambiguities": [],
            "clarifying_questions": [],
        }

        with patch("agents.requirements_analyst.agent.generate_text_from_llm", return_value=json.dumps(response)) as mocked:
            semantic = self.agent._discover_semantic_context("Como cliente, quero consultar produtos.", "", {})

        self.assertEqual([], semantic["actors"])
        self.assertFalse(semantic["has_input"])
        self.assertFalse(semantic["has_document"])
        self.assertTrue(mocked.call_args.kwargs["options_override"]["json_mode"])
        self.assertTrue(mocked.call_args.kwargs["options_override"]["require_json_object"])

    def test_semantic_discovery_normalizes_prose_classification_labels(self):
        response = {
            "domain": "O dominio e ecommerce de moda.",
            "intent": "A intencao e adicionar ao carrinho.",
            "has_input": False, "has_document": False, "has_form": False, "has_sensitive_data": False,
            "actors": [], "entities": [], "goals": [], "actions": [], "states": [], "ambiguities": [],
            "clarifying_questions": [],
        }

        with patch("agents.requirements_analyst.agent.generate_text_from_llm", return_value=json.dumps(response)):
            semantic = self.agent._discover_semantic_context(
                "Como cliente, quero adicionar uma roupa ao carrinho.", "", {}
            )

        self.assertEqual("ecommerce_de_moda", semantic["domain"])
        self.assertEqual("adicionar_ao_carrinho", semantic["intent"])

    def test_requirements_agent_marks_compound_story_for_scope_review(self):
        story = "Como cliente, quero simular credito e iniciar uma solicitacao, para seguir com a proposta."
        expected = self.agent._build_refinement_contract(story, "Backlog", self.context)
        guarded = self.agent._apply_contract_guardrails({"open_questions": []}, expected)

        self.assertEqual("needs_split", expected["scope_assessment"]["status"])
        self.assertEqual(["simular", "iniciar"], expected["scope_assessment"]["actions"])
        self.assertTrue(any(item["category"] == "escopo" for item in guarded["open_questions"]))

    def test_story_benefit_does_not_become_an_independent_journey(self):
        story = (
            "Como equipe administrativa, eu quero cadastrar uma nova sala no sistema, "
            "para que o espaco fique disponivel para consulta e reserva pelos professores."
        )
        semantic = {
            "actions": [
                {"text": "cadastrar sala", "role": "primary"},
                {"text": "consultar disponibilidade", "role": "primary"},
                {"text": "reservar sala", "role": "primary"},
            ],
            "goals": [],
        }

        scope = self.agent._assess_scope(story, semantic)

        self.assertEqual("atomic", scope["status"])
        self.assertEqual("explicit_action", scope["source"])
        self.assertEqual(["cadastrar"], scope["actions"])

    def test_public_document_groups_negative_bdd_scenarios_as_exceptions(self):
        contract = {
            "refined_story": {"text": "Como administradora, quero cadastrar uma sala."},
            "main_flow": [], "alternative_flows": [], "exception_flows": [],
            "interface_feedback": [], "confirmed_rules": [], "permissions_audit": [],
            "open_questions": [], "assumptions": [],
            "acceptance_criteria": [
                {"given": "a administradora esta na tela", "when": "salva uma sala valida", "then": "a sala e cadastrada"},
                {"given": "a administradora nao preenche a capacidade", "when": "tenta salvar", "then": "o sistema deve impedir o cadastro"},
            ],
        }

        document = self.agent._render_public_requirements_document(contract)

        self.assertLess(document.index("### Sucesso"), document.index("### Cenario 1"))
        self.assertLess(document.index("### Excecoes"), document.index("### Cenario 2"))

    def test_ready_upstream_review_cannot_override_deterministic_scope_evidence(self):
        story = "Como administrador, quero acessar painel, cadastrar salas e gerenciar reservas."
        contract = {
            "scope_assessment": {
                "status": "needs_split",
                "source": "deterministic",
                "actions": ["acessar o painel administrativo", "gerenciar salas", "gerenciar reservas"],
            },
            "upstream_review": {"tags": [], "assessment": {"decision": "READY"}},
        }

        with patch.object(self.agent, "_build_refinement_contract", return_value=contract):
            with self.assertRaisesRegex(RuntimeError, "acoes independentes") as raised:
                self.agent.process(story, "Backlog", project_context={})

        diagnostic = raised.exception.rejected_draft["scope_review"]
        self.assertEqual("needs_split", diagnostic["decision"])
        self.assertEqual(contract["scope_assessment"]["actions"], diagnostic["independent_journeys"])

    def test_catalog_navigation_and_details_are_one_discovery_journey(self):
        story = "Como cliente, quero navegar pelo catalogo e visualizar os detalhes de cada item, para escolher o produto correto."
        semantic = {
            "actions": [
                {"text": "navegar pelo catalogo", "role": "primary"},
                {"text": "visualizar detalhes do item", "role": "primary"},
            ],
            "goals": [],
        }

        scope = self.agent._assess_scope(story, semantic)

        self.assertEqual("atomic", scope["status"])
        self.assertEqual(["navegar e visualizar detalhes"], scope["actions"])

    def test_requirements_agent_blocks_story_with_upstream_role_conflict(self):
        context = {
            "storyContext": {
                "currentStory": {
                    "id": "story_1",
                    "title": "Como analista, quero validar uma proposta.",
                    "status": "confirmed",
                    "reviewTags": ["REVIEW_ROLE"],
                    "openQuestions": ["Confirmar o ator responsavel."],
                }
            }
        }

        with self.assertRaisesRegex(RuntimeError, "conflito entre ator"):
            self.agent.process("Como analista, quero validar uma proposta.", "Backlog", project_context=context)

    def test_feature_profile_uses_only_current_story_not_related_backlog(self):
        context = {
            **self.context,
            "storyContext": {
                "currentStory": {"id": "story_2", "title": "Como operador, quero consultar visitante.", "description": "Consultar os dados ja cadastrados."},
                "relatedStories": [{"id": "story_3", "title": "Como cliente, quero enviar documentos da proposta."}],
            },
        }

        profile = self.agent._feature_profile("Como operador, quero consultar visitante.", context)

        self.assertFalse(profile["has_document"])
        self.assertFalse(profile["has_input"])

    def test_input_feature_renders_review_points_instead_of_not_applicable(self):
        contract = {
            "refined_story": {"text": "Como cliente, quero informar renda.", "source_ids": ["user_story"]},
            "actors": [{"name": "cliente", "source_ids": ["user_story"]}],
            "inputs": [{"name": "renda", "source_ids": ["user_story"]}],
            "outputs": [], "confirmed_rules": [],
            "main_flow": [{"text": "Cliente informa renda.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [], "assumptions": [],
            "open_questions": [],
            "acceptance_criteria": [
                {"given": "o cliente informa renda", "when": "confirma", "then": "o sistema recebe a informacao", "source_ids": ["user_story"]},
                {"given": "a renda esta ausente", "when": "confirma", "then": "o sistema aplica a validacao pendente", "source_ids": ["user_story"]},
            ],
            "feature_profile": {"has_input": True, "has_document": False, "has_form": True, "has_sensitive_data": True},
        }

        markdown = self.agent._render_contract_markdown(contract)

        self.assertIn("Ponto a validar: Definir regras de obrigatoriedade", markdown)
        self.assertIn("Ponto a validar: Definir acesso", markdown)
        valid, reason = validate_requirements_output(markdown)
        self.assertTrue(valid, reason)

    def test_primary_contract_rejects_confirmed_content_without_a_source(self):
        expected = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        contract = {
            "domain": "contextual", "intent": "simulation",
            "refined_story": {"text": "Simular credito.", "source_ids": ["user_story"]},
            "actors": [],
            "inputs": [{"name": "valor solicitado", "source_ids": []}],
            "outputs": [], "confirmed_rules": [],
            "main_flow": [{"text": "Cliente solicita a simulacao.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [],
            "assumptions": [], "open_questions": [],
            "acceptance_criteria": [{"given": "o cliente solicita uma simulacao", "when": "informa os dados", "then": "o sistema registra a solicitacao", "source_ids": ["user_story"]}],
        }

        valid, reason = self.agent._validate_primary_contract(contract, expected)
        self.assertFalse(valid)
        self.assertIn("sem fonte rastreavel", reason)

    def test_process_repairs_a_partial_json_contract_without_markdown_fallback(self):
        story = "Como operador, eu quero consultar um visitante, para conferir seus dados."
        expected = self.agent._build_refinement_contract(story, "", {})
        valid_contract = {
            "domain": "generic", "intent": "view",
            "refined_story": {"text": story, "source_ids": ["user_story"]},
            "actors": [{"name": "operador", "source_ids": ["user_story"]}],
            "inputs": [], "outputs": [{"text": "dados do visitante para consulta", "source_ids": ["user_story"]}],
            "confirmed_rules": [],
            "main_flow": [{"text": "O operador consulta os dados do visitante.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [],
            "assumptions": [], "open_questions": [],
            "acceptance_criteria": [{"given": "o operador precisa conferir um visitante", "when": "consulta seus dados", "then": "o sistema apresenta os dados do visitante", "source_ids": ["user_story"]}],
        }
        responses = [json.dumps({"domain": "generic"}), json.dumps(valid_contract), json.dumps({"decision": "PASS", "findings": []})]
        with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=responses) as mocked:
            result = self.agent._process_with_primary_contract(story, "", {}, expected)

        self.assertIn("## 3. Comportamento esperado", result)
        self.assertIn("## 6. Cenarios de aceitacao", result)
        self.assertEqual(3, mocked.call_count)

    def test_public_document_exposes_non_blocking_engineering_quality_gaps(self):
        expected = {
            "evidence_sources": [{"id": "user_story", "text": "Como cliente, quero consultar meus pedidos."}],
            "compact_context": {"taskPriority": None, "related_stories": []},
            "upstream_review": {},
        }
        contract = {
            "refined_story": {"text": "Como cliente, quero consultar meus pedidos.", "source_ids": ["user_story"]},
            "actors": [{"name": "cliente", "source_ids": ["user_story"]}],
            "inputs": [], "outputs": [{"text": "lista de pedidos", "source_ids": ["user_story"]}],
            "confirmed_rules": [], "main_flow": [{"text": "O cliente consulta os pedidos.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [],
            "assumptions": [], "open_questions": [],
            "acceptance_criteria": [{"given": "o cliente possui pedidos", "when": "consulta seus pedidos", "then": "o sistema apresenta a lista", "source_ids": ["user_story"]}],
        }
        contract["engineering_quality"] = self.agent._build_engineering_quality_profile(contract, expected)

        document = self.agent._render_public_requirements_document(contract)

        self.assertIn("Definir a prioridade desta historia", document)
        self.assertIn("Definir requisitos nao funcionais aplicaveis", document)
        self.assertIn("Avaliar viabilidade tecnica", document)
        self.assertIn("**PENDENTE DE VALIDACAO**", document)

    def test_universal_semantic_validation_does_not_select_rules_by_domain(self):
        contract = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        unsafe = "## Regras de Negocio\nA parcela e calculada pelo valor dividido pelo numero de parcelas."

        semantic_ok, reason = self.agent._validate_evidence_semantics(unsafe, contract)
        self.assertTrue(semantic_ok, reason)

    def test_universal_semantic_validation_requires_visible_open_questions(self):
        contract = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        contract["open_questions"] = [{"id": "OQ-01", "text": "Definir a politica aplicavel."}]
        unsafe = "## Requisitos Funcionais\n- Processamento: apresentar a estimativa."

        semantic_ok, reason = self.agent._validate_evidence_semantics(unsafe, contract)
        self.assertFalse(semantic_ok)
        self.assertIn("Premissas", reason)

    def test_credit_simulation_guardrail_renders_non_approval_notice_when_ai_omits_it(self):
        expected = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        generated = {
            "domain": "contextual", "intent": "simulation",
            "refined_story": {"text": self.STORY, "source_ids": ["user_story"]},
            "actors": [{"name": "cliente", "source_ids": ["user_story"]}],
            "inputs": [{"name": "valor solicitado", "source_ids": ["user_story"]}],
            "outputs": [{"text": "estimativa conforme condicao aplicavel", "source_ids": ["user_story"]}],
            "confirmed_rules": [],
            "main_flow": [{"text": "Cliente solicita uma simulacao.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [],
            "validation_data": [], "permissions_audit": [], "dependencies": [], "assumptions": [], "open_questions": [],
            "acceptance_criteria": [
                {"given": "o cliente informa os dados", "when": "solicita a simulacao", "then": "o sistema consulta condicao aplicavel", "source_ids": ["user_story"]},
                {"given": "um dado esta ausente", "when": "solicita a simulacao", "then": "o sistema aplica a validacao configurada", "source_ids": ["user_story"]},
            ],
        }

        markdown = self.agent._render_contract_markdown(self.agent._apply_contract_guardrails(generated, expected))
        semantic_ok, reason = self.agent._validate_evidence_semantics(markdown, expected)

        self.assertNotIn("nao representa aprovacao", markdown)
        self.assertTrue(semantic_ok, reason)

    def test_parser_accepts_json_envelope_wrapped_in_prose_and_code_fence(self):
        envelope = {"contract": {"domain": "generic"}, "markdown": "## User Story Refinada\nTexto"}
        parsed, reason = self.agent._parse_ai_refinement_response(
            "Aqui esta o refinamento:\n```json\n" + json.dumps(envelope) + "\n```"
        )

        self.assertIsNone(reason)
        self.assertEqual(envelope, parsed)

    def test_parser_normalizes_markdown_only_response(self):
        expected = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        markdown = """## User Story Refinada
Simular credito.

## Requisitos Funcionais
### RF-01
- Entradas: valor solicitado, prazo e numero de parcelas.

## Premissas e Pontos a Validar
- Definir politica, taxa, metodo de calculo, relacao entre prazo e parcela, limite e arredondamento.
"""
        parsed, reason = self.agent._parse_ai_refinement_response(markdown, expected)

        self.assertIsNone(reason)
        self.assertEqual(markdown.strip(), parsed["markdown"])
        self.assertIn("politica", parsed["contract"]["open_questions"][0]["text"].lower())

    def test_markdown_contract_preserves_open_question_without_domain_specific_id(self):
        expected = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        markdown = "## Premissas e Pontos a Validar\n- Definir a taxa aplicavel para a simulacao."
        contract = self.agent._contract_from_markdown(markdown, expected)

        self.assertEqual("OQ-01", contract["open_questions"][0]["id"])

    def test_markdown_contract_reads_visible_review_tag(self):
        expected = {"evidence_sources": []}
        contract = self.agent._contract_from_markdown(
            "## Premissas e Pontos a Validar\n- [REVISAR][RV-07][regra-de-negocio][alto] Definir a politica financeira.",
            expected,
        )

        point = contract["open_questions"][0]
        self.assertEqual("RV-07", point["id"])
        self.assertEqual("regra-de-negocio", point["category"])
        self.assertEqual("alto", point["priority"])

    def test_accepts_ai_markdown_and_derives_internal_traceability_contract(self):
        expected = self.agent._build_refinement_contract(self.STORY, "Backlog de credito", self.context)
        markdown = self.agent._build_document({
            "User Story Refinada": "Como cliente, quero solicitar uma estimativa de credito que nao representa aprovacao automatica.",
            "Requisitos Funcionais": "### RF-01\n- Descricao: apresentar uma simulacao de credito conforme regra a definir.\n- Dados mencionados: valor solicitado, prazo e numero de parcelas.",
            "Fluxo Principal": "1. Cliente informa valor solicitado, prazo e numero de parcelas.\n2. Sistema consulta condicao de credito aplicavel.\n3. Sistema apresenta a estimativa.",
            "Fluxos Alternativos": "- Cliente corrige dados invalidos.",
            "Fluxos de Excecao": "- Sem condicao aplicavel, o sistema informa indisponibilidade.",
            "Regras de Negocio": "1. A simulacao nao representa aprovacao automatica.\n2. O sistema nao deve calcular parcela sem politica aplicavel.",
            "Estados da Interface e Feedback": "- Sucesso, erro e carregando.",
            "Validacoes e Dados": "- Valor solicitado: decimal obrigatorio.\n- Prazo: inteiro obrigatorio.\n- Numero de parcelas: inteiro obrigatorio; relacao com prazo pendente.",
            "Permissoes e Auditoria": "- Cliente executa a simulacao.",
            "Criterios de Aceite (BDD)": "DADO dados validos\nQUANDO existe condicao de credito aplicavel\nENTAO o sistema apresenta uma estimativa sem aprovacao automatica\n\nDADO dados invalidos\nQUANDO solicita a simulacao\nENTAO o sistema informa o erro\n\nDADO ausencia de condicao de credito aplicavel\nQUANDO solicita a simulacao\nENTAO o sistema informa indisponibilidade",
            "Premissas e Pontos a Validar": "- Definir politica, calculo, limites, arredondamento e relacao prazo-parcelas.",
        })

        primary_contract = {
            "domain": "contextual", "intent": "simulation",
            "refined_story": {"text": "Como cliente, quero simular credito para conhecer uma estimativa que nao representa aprovacao.", "source_ids": ["user_story"]},
            "actors": [{"name": "cliente", "source_ids": ["user_story"]}],
            "inputs": [
                {"name": "valor solicitado", "source_ids": ["user_story"]},
                {"name": "prazo", "source_ids": ["user_story"]},
                {"name": "numero de parcelas", "source_ids": ["user_story"]},
            ],
            "outputs": [{"text": "estimativa conforme condicao de credito aplicavel", "source_ids": ["user_story"]}],
            "confirmed_rules": [{"text": "A simulacao nao representa aprovacao.", "source_ids": ["project_dna"]}],
            "main_flow": [{"text": "Cliente informa valor solicitado, prazo e numero de parcelas.", "source_ids": ["user_story"]}],
            "alternative_flows": [], "exception_flows": [], "interface_feedback": [], "validation_data": [],
            "permissions_audit": [], "dependencies": [], "assumptions": [],
            "open_questions": [{"id": "OQ-01", "text": "Definir politica, calculo, limites, arredondamento e relacao prazo-parcelas.", "category": "regra-de-negocio", "priority": "alto"}],
            "acceptance_criteria": [
                {"given": "o cliente informa os dados da simulacao", "when": "solicita a estimativa", "then": "o sistema apresenta estimativa conforme condicao aplicavel, sem aprovacao automatica", "source_ids": ["user_story"]},
                {"given": "um dado da simulacao esta ausente ou invalido", "when": "o cliente solicita a estimativa", "then": "o sistema informa que a solicitacao nao pode prosseguir conforme validacao aplicavel", "source_ids": ["user_story"]},
            ],
        }
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("REQUIREMENTS_EVIDENCE_REVIEW_REQUIRED", None)
            with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=[json.dumps(primary_contract), json.dumps({"decision": "PASS", "findings": []})]):
                result = self.agent.process(self.STORY, "Backlog de credito", project_context=self.context)

        self.assertIn("## Premissas e Pontos a Validar", result)
        self.assertIn("FIM_DO_REFINAMENTO", result)
        self.assertEqual("contextual", self.agent.last_refinement_contract["domain"])
        self.assertTrue(self.agent.last_refinement_contract["open_questions"])

    def test_evidence_reviewer_keeps_only_findings_with_literal_requirement_evidence(self):
        markdown = "## Regras de Negocio\n- A parcela sera sempre fixa."
        response = json.dumps({"decision": "REVISE", "findings": [
            {"evidence": "A parcela sera sempre fixa.", "reason": "Sem fonte", "severity": "high", "question": "Qual politica?"},
            {"evidence": "texto inexistente", "reason": "Ignorar", "severity": "high", "question": ""},
            {"evidence": "A parcela sera sempre fixa.", "reason": "O texto esta redundante.", "severity": "high", "question": ""},
        ]})
        expected = {"evidence_sources": []}
        with patch("agents.requirements_analyst.agent.generate_text_from_llm", return_value=response):
            report = self.agent._review_with_evidence(markdown, expected)

        self.assertEqual("REVISE", report["decision"])
        self.assertEqual(1, len(report["findings"]))

    def test_internal_contract_exposes_candidate_claims_for_all_behavior_sections(self):
        expected = self.agent._build_refinement_contract(self.STORY, "", self.context)
        contract = self.agent._contract_from_markdown(
            "## Fluxo Principal\n1. Sistema cria lista de rascunhos.\n\n## Regras de Negocio\n1. Permitir varios rascunhos.",
            expected,
        )

        self.assertEqual(2, len(contract["claims"]))
        self.assertTrue(all(item["status"] == "candidate" for item in contract["claims"]))

    def test_unavailable_evidence_review_blocks_approval_by_default(self):
        expected = self.agent._build_refinement_contract(self.STORY, "", self.context)
        with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=RuntimeError("indisponivel")):
            report = self.agent._review_with_evidence("## Regras de Negocio\n- Exemplo", expected)

        self.assertEqual("unavailable", report["status"])
        self.assertEqual("REVISE", report["decision"])

    def test_evidence_reviewer_uses_primary_request_timeout_floor(self):
        expected = {"evidence_sources": []}
        captured = {}

        def respond(_prompt, options_override=None, **_kwargs):
            captured.update(options_override or {})
            return json.dumps({"decision": "PASS", "findings": []})

        with patch.dict(os.environ, {"REQUIREMENTS_REVIEW_TIMEOUT_SECONDS": "30"}, clear=False):
            with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=respond):
                report = self.agent._review_with_evidence("## Regras de Negocio\n- Exemplo", expected)

        self.assertEqual("completed", report["status"])
        self.assertEqual(120, captured["request_timeout_seconds"])
        self.assertTrue(captured["json_mode"])
        self.assertTrue(captured["require_json_object"])

    def test_central_field_detail_can_be_an_open_question_without_rejection(self):
        document = self.agent._build_document({
            "User Story Refinada": "Como cliente, quero informar meu contato para seguir com a solicitacao.",
            "Requisitos Funcionais": "### RF-01\n- Descricao: registrar o contato informado pelo cliente.",
            "Fluxo Principal": "1. Cliente informa contato.\n2. Sistema registra o contato.\n3. Sistema confirma o registro.",
            "Fluxos Alternativos": "- Nao se aplica.",
            "Fluxos de Excecao": "- Nao se aplica.",
            "Regras de Negocio": "1. O contato informado deve ser registrado.\n2. Detalhes de formato dependem de definicao pendente.",
            "Estados da Interface e Feedback": "- Nao se aplica.",
            "Validacoes e Dados": "- Contato: campo com significado explicito; formato e obrigatoriedade pendentes em Premissas.",
            "Permissoes e Auditoria": "- Nao se aplica.",
            "Criterios de Aceite (BDD)": "DADO que o cliente informa contato\nQUANDO confirma o registro\nENTAO o sistema registra o contato.",
            "Premissas e Pontos a Validar": "- Contato: definir formato, obrigatoriedade e regra de validacao.",
        })

        valid, reason = validate_requirements_output(document)
        self.assertTrue(valid, reason)

    def test_short_story_needs_only_one_confirmed_flow_step_and_rule(self):
        document = self.agent._build_document({
            "User Story Refinada": "Como cliente, quero informar renda para analise de capacidade de pagamento.",
            "Requisitos Funcionais": "### RF-01\n- Descricao: permitir informar renda.",
            "Fluxo Principal": "1. Cliente informa renda na proposta.",
            "Fluxos Alternativos": "Nao se aplica.",
            "Fluxos de Excecao": "Nao se aplica.",
            "Regras de Negocio": "1. A proposta nao pode seguir para analise se houver dado obrigatorio incompleto.",
            "Estados da Interface e Feedback": "Nao se aplica.",
            "Validacoes e Dados": "- Renda: dado financeiro solicitado; formato pendente em Premissas.",
            "Permissoes e Auditoria": "Nao se aplica.",
            "Criterios de Aceite (BDD)": "DADO que um dado obrigatorio esta incompleto\nQUANDO a proposta tenta seguir para analise\nENTAO o sistema bloqueia o avanço.",
            "Premissas e Pontos a Validar": "- Definir quais dados financeiros sao obrigatorios.",
        })

        valid, reason = validate_requirements_output(document)
        self.assertTrue(valid, reason)

    def test_flow_accepts_bullets_or_a_substantive_narrative(self):
        sections = {
            "User Story Refinada": "Como cliente, quero enviar documentos obrigatorios da proposta.",
            "Requisitos Funcionais": "### RF-01\n- Descricao: permitir o envio dos documentos solicitados.",
            "Fluxos Alternativos": "Nao se aplica.",
            "Fluxos de Excecao": "Nao se aplica.",
            "Regras de Negocio": "- A proposta nao pode seguir com documento obrigatorio pendente.",
            "Estados da Interface e Feedback": "Nao se aplica.",
            "Validacoes e Dados": "- Os tipos de documento aceitos devem ser indicados.",
            "Permissoes e Auditoria": "Nao se aplica.",
            "Criterios de Aceite (BDD)": "DADO que o cliente possui documentos obrigatorios\nQUANDO envia os documentos\nENTAO o sistema registra o resultado basico da validacao.",
            "Premissas e Pontos a Validar": "- Definir a relacao de documentos obrigatorios.",
        }

        for flow in (
            "- Cliente envia os documentos obrigatorios da proposta.\n- Sistema indica pendencias e o resultado basico da validacao.",
            "O cliente envia os documentos obrigatorios e o sistema indica as pendencias e o resultado basico da validacao.",
        ):
            document = self.agent._build_document({**sections, "Fluxo Principal": flow})
            valid, reason = validate_requirements_output(document)
            self.assertTrue(valid, reason)

    def test_flow_rejects_only_a_template_instruction_or_placeholder(self):
        document = self.agent._build_document({
            "User Story Refinada": "Como cliente, quero enviar documentos obrigatorios da proposta.",
            "Requisitos Funcionais": "### RF-01\n- Descricao: permitir o envio dos documentos solicitados.",
            "Fluxo Principal": "Inclua somente os passos confirmados pela historia.",
            "Fluxos Alternativos": "Nao se aplica.",
            "Fluxos de Excecao": "Nao se aplica.",
            "Regras de Negocio": "- A proposta nao pode seguir com documento obrigatorio pendente.",
            "Estados da Interface e Feedback": "Nao se aplica.",
            "Validacoes e Dados": "- Os tipos de documento aceitos devem ser indicados.",
            "Permissoes e Auditoria": "Nao se aplica.",
            "Criterios de Aceite (BDD)": "DADO que o cliente possui documentos obrigatorios\nQUANDO envia os documentos\nENTAO o sistema registra o resultado basico da validacao.",
            "Premissas e Pontos a Validar": "- Definir a relacao de documentos obrigatorios.",
        })

        valid, reason = validate_requirements_output(document)
        self.assertFalse(valid)
        self.assertEqual("Fluxo principal sem passo confirmado ou indicacao de nao se aplica.", reason)

    def test_provider_failure_is_reported_as_an_agent_retry_reason(self):
        with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=RuntimeError("OpenRouter vazio")):
            with self.assertRaisesRegex(RuntimeError, "Falha de provider ao gerar contrato de requisitos: OpenRouter vazio"):
                self.agent.process(self.STORY, "Backlog de credito", project_context=self.context)

    def test_exhausted_router_does_not_repeat_the_full_provider_chain(self):
        error = RuntimeError("Nenhum modelo do router concluiu a solicitação. Tentativas: nvidia: timeout")
        with patch("agents.requirements_analyst.agent.generate_text_from_llm", side_effect=error) as mock_generate:
            with self.assertRaisesRegex(RuntimeError, "Falha de provider ao gerar contrato de requisitos"):
                self.agent.process(self.STORY, "Backlog de credito", project_context=self.context)

        self.assertEqual(1, mock_generate.call_count)

    def test_request_timeout_option_overrides_slow_provider_default(self):
        self.assertEqual(60, get_provider_timeout_seconds("nvidia", 180, {"request_timeout_seconds": 60}))
        self.assertEqual(30, get_provider_timeout_seconds("nvidia", 180, {"request_timeout_seconds": 1}))

    @patch("agents.requirements_analyst.agent.generate_text_from_llm", return_value="")
    def test_process_fails_instead_of_using_deterministic_fallback_when_ai_is_unusable(self, mock_generate):
        with self.assertRaisesRegex(RuntimeError, "nao conseguiu gerar"):
            self.agent.process(self.STORY, "Backlog de credito", project_context=self.context)

        self.assertEqual(2, mock_generate.call_count)

    def test_non_financial_story_keeps_generic_classification(self):
        non_financial_context = {
            "projectDna": {"project": {"primaryActor": "operador", "domainLanguage": ["visitante", "acesso"]}},
            "backlogContract": {"capabilities": [{"name": "Controle de acesso"}]},
        }
        contract = self.agent._build_refinement_contract(
            "Como operador, quero cadastrar um visitante para controlar o acesso.",
            "Linguagem do dominio: visitante, acesso",
            non_financial_context,
        )
        self.assertEqual("contextual", contract["domain"])
        self.assertEqual("register", contract["intent"])
        self.assertEqual([], contract["open_questions"])

    def test_story_that_mentions_simulation_but_starts_a_proposal_is_not_simulation_intent(self):
        contract = self.agent._build_refinement_contract(
            "Como Ana, cliente solicitante, eu quero iniciar uma solicitacao de credito a partir da simulacao, para registrar a proposta.",
            "Backlog de credito",
            self.context,
        )

        self.assertEqual("contextual", contract["domain"])
        self.assertEqual("record", contract["intent"])


if __name__ == "__main__":
    unittest.main()
