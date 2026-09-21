# -*- coding: utf-8 -*-
import unittest
import json
import os
from unittest.mock import patch

from agents.developer.response_validation import validate_backlog_output
from agents.backlog_challenger.agent import BacklogChallenger
from agents.backlog_judge.agent import BacklogJudge
from agents.project_manager.agent import ProjectManager
from agents.developer import llm_service
from agents.developer.llm_service import validate_structured_response


class ProjectManagerCreditBacklogTests(unittest.TestCase):
    @staticmethod
    def backlog_contract(story_count=8):
        return {
            "overview": "Backlog para uma jornada de credito.",
            "capabilities": [
                "Permitir que o cliente simule condicoes de credito antes de registrar uma proposta.",
                "Registrar propostas digitais com dados e documentos necessarios para analise.",
                "Permitir o acompanhamento do andamento e das pendencias da proposta.",
                "Manter rastreabilidade das decisoes e alteracoes realizadas pela operacao.",
            ],
            "epics": [
                "Epic 1: Simulacao de credito e escolha inicial de condicoes.",
                "Epic 2: Registro da proposta, dados e documentos do solicitante.",
                "Epic 3: Analise operacional, pendencias e encaminhamento da decisao.",
                "Epic 4: Governanca, rastreabilidade e acompanhamento da proposta.",
            ],
            "releases": [
                {"name": "MVP", "focus": "Simulacao, proposta e analise inicial com acompanhamento do cliente", "deferred": "integracoes externas e automacao avancada"},
                {"name": "Fase 2", "focus": "Pendencias, filas operacionais e regras configuraveis para a equipe", "deferred": "analiticos avancados e integracoes complexas"},
                {"name": "Fase 3", "focus": "Integracoes futuras e refinamento de controles apos estabilizar o fluxo", "deferred": "novas evolucoes fora do escopo atual"},
            ],
            "stories": [
                {
                    "id": f"US-{index:02d}", "actor": ["Ana, cliente", "Carlos, analista", "Roberto, gestor", "Fernanda, atendente"][(index - 1) % 4],
                    "goal": f"realizar a etapa {index}", "benefit": "acompanhar sua solicitacao",
                    "description": "A etapa deve informar o resultado observavel ao cliente.",
                    "lane": "foundation" if index <= 4 else "operation",
                    "refinement_context": {"acceptance_criteria": [{
                        "id": f"US-{index:02d}-CA-01", "given": "dados disponiveis",
                        "when": f"realizar a etapa {index}", "then": "resultado informado",
                    }]},
                }
                for index in range(1, story_count + 1)
            ],
        }

    def test_lint_blocks_compound_administration_story_and_duplicate_cancellation(self):
        manager = ProjectManager("scope-lint-test")
        contract = {
            "stories": [
                {
                    "id": "US-01", "actor": "administrador",
                    "goal": "acessar o painel, cadastrar, editar ou bloquear salas e gerenciar reservas",
                    "description": "Administrar recursos e reservas.", "review_tags": [],
                    "refinement_context": {"dependencies": []}, "release": "MVP",
                },
                {
                    "id": "US-02", "actor": "professor", "goal": "cancelar uma reserva com registro de motivo",
                    "description": "Libera a sala para outro uso.", "review_tags": [],
                    "refinement_context": {"dependencies": []}, "release": "MVP",
                },
                {
                    "id": "US-03", "actor": "professor", "goal": "cancelar uma reserva com registro obrigatório de motivo",
                    "description": "Libera a sala imediatamente.", "review_tags": [],
                    "refinement_context": {"dependencies": []}, "release": "MVP",
                },
            ],
        }

        findings = manager._lint_backlog_contract(contract, {})

        self.assertIn(("US-01", "needs_split_or_scope"), {(item["story_id"], item["code"]) for item in findings})
        self.assertIn(("US-03", "duplicate_story"), {(item["story_id"], item["code"]) for item in findings})

    def test_pm_handoff_keeps_only_evidence_backed_policies_and_related_scope(self):
        manager = ProjectManager("pm-handoff-test")
        contract = {
            "stories": [
                {
                    "id": "US-01", "goal": "selecionar ingressos", "description": "Exibe a disponibilidade por setor.",
                    "source_ids": ["briefing.1"], "capability_ids": ["CAP-01"],
                    "refinement_context": {"dependencies": []},
                },
                {
                    "id": "US-02", "goal": "concluir o pagamento", "description": "Confirma a compra selecionada.",
                    "source_ids": ["briefing.1", "briefing.2"], "capability_ids": ["CAP-01"],
                    "refinement_context": {"dependencies": ["US-01"]},
                },
            ],
        }
        evidence = {"facts": [
            {"id": "briefing.1", "text": "A disponibilidade e a capacidade dos assentos devem evitar venda duplicada."},
            {"id": "briefing.2", "text": "O pagamento deve respeitar privacidade dos dados pessoais."},
        ]}

        enriched = manager._enrich_backlog_handoff(contract, evidence)

        self.assertEqual("pm-handoff/v1", enriched["handoff"]["version"])
        self.assertTrue(enriched["policy_registry"])
        self.assertIn("availability_and_capacity", {item["area"] for item in enriched["policy_registry"]})
        self.assertIn("payment_and_financial", {item["area"] for item in enriched["policy_registry"]})
        handoff = enriched["stories"][0]["refinement_context"]["pm_handoff"]
        self.assertEqual(["briefing.1"], handoff["source_ids"])
        self.assertIn("US-02", {item["story_id"] for item in handoff["related_stories"]})

    def test_incremental_checkpoint_resumes_only_complete_bdd_batches(self):
        manager = ProjectManager("checkpoint-test")
        idea = "Plataforma de compra de ingressos para shows."
        complete_batch = [
            {
                "id": f"US-{index:02d}", "goal": f"executar jornada {index}",
                "refinement_context": {"acceptance_criteria": [{
                    "given": "contexto valido", "when": "realizar a acao", "then": "resultado verificavel",
                }]},
            }
            for index in range(1, 5)
        ]
        plan = {"overview": "Compra de ingressos"}
        coverage = [{"batch_index": 1, "capability": {"id": "CAP-01"}}]

        checkpoint = manager._save_incremental_checkpoint(idea, plan, coverage, [complete_batch])
        manager._incremental_checkpoint = checkpoint

        restored = manager._load_incremental_checkpoint(idea)

        self.assertEqual(plan, restored["plan"])
        self.assertEqual(complete_batch, restored["batches"][0])
        self.assertIsNone(manager._load_incremental_checkpoint("Briefing diferente"))

    def test_renderer_keeps_multiline_model_description_from_becoming_a_story(self):
        manager = ProjectManager("renderer-inline-test")
        manager.STORY_RANGE = (8, 8)
        contract = self.backlog_contract()
        contract["stories"][0]["description"] = "Mostra eventos disponiveis.\nComo contexto adicional, mantem a jornada de compra clara."
        contract["epics"][0] = "Como organizador, planejamento do evento e das vendas."

        rendered = manager._render_backlog_contract(manager._validate_backlog_contract(contract))
        valid, reason = validate_backlog_output(rendered)

        self.assertTrue(valid, reason)
        self.assertIn("Mostra eventos disponiveis. Como contexto adicional", rendered)

    def test_epic_blocks_remove_semantic_duplicate_before_contract_review(self):
        manager = ProjectManager("epic-dedup-test")
        blocks = [
            "Como administrador, eu quero bloquear uma sala para manutenção, para impedir reservas durante o período de serviço.\nDescrição: marca a sala como indisponível.",
            "Como administrador, eu quero bloquear uma sala para manutenção programada, definindo um período de início e fim, para impedir novas reservas nesse intervalo.\nDescrição: impede novos agendamentos.",
            "Como professor, eu quero consultar a disponibilidade de salas, para escolher um espaço adequado.\nDescrição: mostra salas compatíveis.",
        ]

        filtered, removed = manager._deduplicate_epic_story_blocks(blocks)

        self.assertEqual(2, len(filtered))
        self.assertEqual(1, len(removed))
        self.assertIn("consultar a disponibilidade", filtered[1])

    def test_epic_blocks_without_explicit_acceptance_criteria_are_blocked(self):
        manager = ProjectManager("epic-quality-gate-test")
        manager.STORY_RANGE = (8, 9)
        batch_one = [
            "Como administrador, eu quero cadastrar uma sala, para manter o catálogo.\nDescrição: registra capacidade e recursos.",
            "Como administrador, eu quero editar uma sala, para atualizar seus dados.\nDescrição: altera capacidade e recursos.",
            "Como professor, eu quero visualizar as salas, para escolher um ambiente.\nDescrição: lista capacidade e recursos.",
            "Como administrador, eu quero arquivar uma sala, para retirar espaços inativos.\nDescrição: preserva o histórico.",
        ]
        batch_two = [
            "Como professor, eu quero reservar uma sala, para garantir o espaço.\nDescrição: confirma o agendamento.",
            "Como professor, eu quero cancelar uma reserva, para liberar a sala.\nDescrição: registra o cancelamento.",
            "Como professor, eu quero cancelar uma reserva com registro obrigatório, para liberar a sala.\nDescrição: registra o cancelamento.",
            "Como administrador, eu quero bloquear uma sala para manutenção, para impedir reservas.\nDescrição: marca a indisponibilidade.",
            "Como professor, eu quero visualizar minha agenda, para acompanhar minhas reservas.\nDescrição: exibe reservas futuras.",
            "Como administrador, eu quero gerar um relatório de ocupação, para analisar o uso das salas.\nDescrição: consolida reservas por período.",
        ]
        with patch.object(manager, "_generate_backlog_blueprint", return_value=("Visão", ["Salas"], ["Catálogo", "Reservas"], [])), \
             patch.object(manager, "_generate_thematic_stories", side_effect=[batch_one, batch_two]), \
             patch.object(manager, "_build_full_backlog_with_structure", return_value="backlog"), \
             patch("agents.project_manager.agent.validate_backlog_output", return_value=(True, None)):
            with self.assertRaisesRegex(RuntimeError, "Quality Gate"):
                manager._generate_epic_block_backlog("Sistema de reserva de salas")

    def test_lint_blocks_typo_duplicate_and_contaminated_or_malformed_story(self):
        manager = ProjectManager("contract-safety-test")
        contract = {
            "stories": [
                {"id": "US-01", "actor": "professor", "goal": "cancelar uma reserva", "description": "Registra o motivo.", "review_tags": [], "refinement_context": {"dependencies": []}, "release": "MVP"},
                {"id": "US-02", "actor": "profesor", "goal": "cancelar uma reserva", "description": "Registra o motivo.", "review_tags": [], "refinement_context": {"dependencies": []}, "release": "MVP"},
                {"id": "US-03", "actor": "Usuario autorizado", "goal": "Como administrador, eu quero alterar uma reserva", "description": "</think>## Historias de Usuario", "review_tags": [], "refinement_context": {"dependencies": []}, "release": "MVP"},
            ],
        }

        findings = {(item["story_id"], item["code"]) for item in manager._lint_backlog_contract(contract, {})}

        self.assertIn(("US-02", "duplicate_story"), findings)
        self.assertIn(("US-03", "generic_actor"), findings)
        self.assertIn(("US-03", "malformed_story_goal"), findings)
        self.assertIn(("US-03", "contaminated_story_content"), findings)

    def test_quality_gate_blocks_missing_acceptance_criteria(self):
        report = BacklogChallenger().process({"stories": [{
            "id": "US-01", "actor": "professor", "goal": "consultar salas", "description": "Exibe salas.",
            "source_ids": ["briefing.1"], "refinement_context": {"acceptance_criteria": []},
        }]})

        self.assertEqual(0, report["dimensions"]["testability"])
        self.assertLess(report["score"], report["threshold"])
        self.assertIn("missing_acceptance_criteria", {item["code"] for item in report["findings"]})

    def test_epic_title_parser_accepts_supported_alternate_connector(self):
        parsed = ProjectManager("title-parser-test")._parse_story_title(
            "Como administrador, eu quero alterar o horário de uma reserva, garantindo que não haja conflitos."
        )

        self.assertEqual(
            ("administrador", "alterar o horário de uma reserva", "que não haja conflitos"),
            parsed,
        )

    def test_epic_contract_does_not_infer_dependencies_or_acceptance_criteria(self):
        manager = ProjectManager("no-inference-test")
        contract = manager._build_epic_backlog_contract([
            "Como professor autenticado, eu quero reservar uma sala, para garantir o espaço.\nDescrição: reserva vinculada ao usuário.",
            "Como administrador, eu quero definir permissões por perfil, para controlar o acesso.\nDescrição: somente administradores configuram permissões.",
        ], ["Reservas"])

        self.assertEqual([], contract["stories"][0]["refinement_context"]["dependencies"])
        self.assertEqual([], contract["stories"][0]["refinement_context"]["acceptance_criteria"])

    def test_credit_briefing_generates_credit_domain_backlog(self):
        briefing = """
        Plataforma web para clientes solicitarem credito com simulacao, dados pessoais e financeiros,
        documentos, acompanhamento da analise e decisao. Analistas revisam propostas e podem aprovar,
        reprovar ou solicitar complementos. A operacao deve observar LGPD, prevencao a fraude,
        politicas de elegibilidade e futura integracao com bureaus de score.
        """

        backlog = ProjectManager("credit-backlog-test")._build_deterministic_backlog(briefing)
        valid, reason = validate_backlog_output(backlog)

        self.assertTrue(valid, reason)
        for expected_term in (
            "simular",
            "proposta",
            "documentos",
            "analise de credito",
            "aprovar, reprovar ou solicitar complementos",
            "lgpd",
            "fraude",
        ):
            self.assertIn(expected_term, backlog.lower())
        self.assertNotIn("item principal", backlog.lower())

    def test_ai_generation_is_the_only_runtime_source_of_backlog_stories(self):
        manager = ProjectManager("credit-backlog-test")
        ai_backlog = {"markdown": "backlog estruturado", "backlog_contract": {"stories": []}}

        with patch.object(manager, "_analyze_requirements_contract", return_value={"blocking_questions": []}), \
             patch.object(manager, "_generate_ai_backlog", return_value=ai_backlog) as generate_ai, \
             patch.object(manager, "_build_deterministic_backlog") as fallback:
            result = manager.process("plataforma de credito")

        self.assertEqual(ai_backlog["markdown"], result["markdown"])
        generate_ai.assert_called_once()
        fallback.assert_not_called()

    def test_provider_failure_is_not_replaced_by_a_deterministic_backlog(self):
        manager = ProjectManager("credit-backlog-test")
        with patch.object(manager, "_analyze_requirements_contract", return_value={"blocking_questions": []}), \
             patch.object(manager, "_generate_ai_backlog", side_effect=RuntimeError("provider indisponivel")), \
             patch.object(manager, "_build_deterministic_backlog") as fallback:
            with self.assertRaisesRegex(RuntimeError, "provider indisponivel"):
                manager.process("plataforma de credito")

        fallback.assert_not_called()

    def test_json_parser_accepts_prose_code_fence_and_trailing_text(self):
        manager = ProjectManager("credit-backlog-test")
        contract = {"overview": "Backlog", "capabilities": [], "epics": [], "releases": [], "stories": []}
        response = f"Aqui esta o contrato:\n```json\n{json.dumps(contract)}\n```\nFim da resposta."

        self.assertEqual(contract, manager._extract_json_object(response))

    def test_json_parser_accepts_common_contract_envelope(self):
        manager = ProjectManager("credit-backlog-test")
        contract = {"overview": "Backlog", "capabilities": [], "epics": [], "releases": [], "stories": []}

        self.assertEqual(contract, manager._extract_json_object(json.dumps({"data": contract})))

    def test_second_attempt_explicitly_repairs_json_format(self):
        manager = ProjectManager("credit-backlog-test")
        prompt = manager._build_single_pass_backlog_prompt(
            "Criar uma plataforma.",
            {"facts": []},
            repair_reason="A IA deve responder um objeto JSON valido.",
        )

        self.assertIn("CORRECAO OBRIGATORIA DE FORMATO", prompt)
        self.assertIn("Comece a resposta diretamente com {", prompt)

    def test_short_non_json_response_is_rejected_before_router_marks_success(self):
        error = validate_structured_response(
            "Nao consigo agora.",
            {"min_response_chars": 256, "require_json_object": True},
        )

        self.assertIn("Resposta curta", error)

    def test_json_with_prose_is_accepted_by_structured_response_gate(self):
        error = validate_structured_response(
            "Contrato: {\"stories\": []} fim.",
            {"min_response_chars": 10, "require_json_object": True},
        )

        self.assertIsNone(error)

    def test_structured_response_rejects_nested_object_inside_truncated_contract(self):
        error = validate_structured_response(
            '{"overview":"Backlog","releases":{"name":"MVP"}',
            {"min_response_chars": 10, "require_json_object": True},
        )

        self.assertEqual("Resposta JSON incompleta ou invalida.", error)

    def test_validation_derives_missing_epics_from_explicit_capabilities(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        expected_epics = list(contract["capabilities"])
        del contract["epics"]

        validated = manager._validate_backlog_contract(contract)

        self.assertEqual(expected_epics, validated["epics"])

    def test_validation_inferrs_unsupported_lane_from_story_action(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0].update({"lane": "workspace", "goal": "consultar disponibilidade de salas"})

        validated = manager._validate_backlog_contract(contract)

        self.assertEqual("visibility", validated["stories"][0]["lane"])

    def test_validation_normalizes_empty_last_release_without_inventing_scope(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["releases"][2].update({"focus": "", "deferred": ""})

        validated = manager._validate_backlog_contract(contract)

        self.assertEqual("Nenhuma entrega foi classificada para esta fase.", validated["releases"][2]["focus"])
        self.assertEqual("Nenhuma entrega posterior foi definida no briefing.", validated["releases"][2]["deferred"])

    def test_validation_maps_requirement_id_to_its_briefing_evidence(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0]["source_ids"] = ["REQ-01"]
        evidence = {"facts": [{"id": "briefing.1", "text": "Professor consulta salas disponíveis.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)

        self.assertEqual(["briefing.1"], validated["stories"][0]["source_ids"])

    @patch("agents.developer.llm_service.http_post_json")
    def test_nemotron_super_disables_thinking_for_structured_backlog_output(self, http_post_json):
        http_post_json.return_value = (200, {
            "choices": [{"message": {"content": "{\"stories\": []}"}}],
        }, {})

        llm_service.generate_text_with_openai_compatible(
            "nvidia",
            "gere o contrato",
            "nvidia/nemotron-3-super-120b-a12b",
            "test-key",
            {"json_mode": True, "num_predict": 300},
        )

        sent_payload = http_post_json.call_args.args[1]
        self.assertEqual({"enable_thinking": False}, sent_payload["chat_template_kwargs"])
        self.assertNotIn("response_format", sent_payload)

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_single_pass_generation_has_bounded_provider_call(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        generate_text.return_value = __import__("json").dumps(self.backlog_contract(story_count=8))

        with patch.dict(os.environ, {"PROJECT_MANAGER_BACKLOG_STRATEGY": "single_pass"}), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertIn("evidence", result["backlog_contract"])
        generate_text.assert_called_once()
        self.assertEqual(4000, generate_text.call_args.kwargs["options_override"]["num_predict"])
        _, kwargs = generate_text.call_args
        self.assertEqual("requirements_analysis", kwargs["task"])
        self.assertFalse(kwargs["use_cache"])
        self.assertEqual(60, kwargs["options_override"]["request_timeout_seconds"])
        self.assertEqual(0, kwargs["options_override"]["transient_retries"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_incremental_generation_uses_plan_and_two_story_batches(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        full_contract = self.backlog_contract(story_count=8)
        plan = {key: full_contract[key] for key in ("overview", "capabilities", "epics", "releases")}
        first_batch = {"stories": full_contract["stories"][:4]}
        second_batch = {"stories": full_contract["stories"][4:]}
        generate_text.side_effect = [json.dumps(plan), json.dumps(first_batch), json.dumps(second_batch)]
        passing_review = {"decision": "PASS", "domain": "generic", "score": 100, "threshold": 80, "dimensions": {}, "proposals": [], "questions": []}

        with patch.dict(os.environ, {"PROJECT_MANAGER_BACKLOG_STRATEGY": "incremental"}), \
             patch.object(manager, "_review_backlog_contract", return_value=passing_review), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(3, generate_text.call_count)
        self.assertEqual([1200, 1800, 1800], [call.kwargs["options_override"]["num_predict"] for call in generate_text.call_args_list])

    @patch("agents.project_manager.agent.RequirementEngineAgent")
    def test_provider_failure_in_advisory_requirements_analysis_does_not_abort_pm(self, engine_class):
        engine_class.return_value.process.side_effect = RuntimeError(
            "Nenhum modelo do router concluiu a solicitação."
        )

        with patch.dict(os.environ, {"PROJECT_MANAGER_REQUIREMENTS_PREFLIGHT_ENABLED": "1"}):
            contract = ProjectManager("credit-backlog-test")._analyze_requirements_contract(
                "Plataforma para reservar salas de aula."
            )

        self.assertEqual("degraded", contract["analysis_status"])
        self.assertTrue(contract["requirements"])

    def test_requirements_preflight_is_skipped_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            contract = ProjectManager("credit-backlog-test")._analyze_requirements_contract(
                "Plataforma para reservar salas de aula."
            )

        self.assertEqual("skipped", contract["analysis_status"])
        self.assertTrue(contract["requirements"])

    def test_single_pass_prompt_puts_releases_before_verbose_story_payload(self):
        prompt = ProjectManager("credit-backlog-test")._build_single_pass_backlog_prompt(
            "Criar uma plataforma.", {"facts": []},
        )

        self.assertLess(prompt.index('"releases"'), prompt.index('"stories"'))
        self.assertIn("Mantenha o contrato compacto", prompt)

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_returns_clarifications_instead_of_publishing_questions_in_stories(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        contract["stories"][0].update({
            "goal": "simular credito",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
        })
        generate_text.return_value = json.dumps(contract)

        with patch.object(manager, "_analyze_requirements_contract", return_value={"blocking_questions": []}):
            result = manager.process("plataforma de credito")

        self.assertTrue(result["clarification_required"])
        self.assertTrue(result["clarifications"])
        self.assertNotIn("markdown", result)

    def test_answered_clarifications_do_not_remain_in_story_output(self):
        manager = ProjectManager("credit-backlog-test")
        manager._clarifications_answered = True
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0].update({
            "goal": "simular credito",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
        })

        validated = manager._validate_backlog_contract(contract, {"facts": [{"id": "briefing.1", "text": "Taxa de 2% e prazo de 12 meses para simulacao de credito.", "type": "briefing"}]})

        self.assertEqual([], validated["stories"][0]["open_questions"])
        self.assertEqual([], validated["stories"][0]["review_tags"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_repairs_challenger_findings_without_undefined_findings_variable(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        replacement = dict(contract["stories"][0])
        generate_text.side_effect = [
            json.dumps(contract),
            json.dumps({"replacements": [{"replace_ids": ["US-01"], "stories": [replacement]}]}),
        ]
        review_results = [
            {"decision": "REVISE", "findings": [{"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo composto."}]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(2, generate_text.call_count)
        self.assertEqual("PASS", result["backlog_contract"]["quality_review"]["decision"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_repairs_new_finding_for_a_story_already_repaired(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        replacement = dict(contract["stories"][5])
        generate_text.side_effect = [
            json.dumps(contract),
            json.dumps({"replacements": [{"replace_ids": ["US-06"], "stories": [replacement]}]}),
            json.dumps({"replacements": [{"replace_ids": ["US-06"], "stories": [replacement]}]}),
        ]
        review_results = [
            {"decision": "REVISE", "findings": [{"story_id": "US-06", "code": "needs_split_or_scope", "reason": "Escopo composto."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-06", "code": "missing_confirmed_flow", "reason": "Fluxo ausente."}]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(3, generate_text.call_count)
        self.assertEqual(2, result["backlog_contract"]["quality_review"]["repair_attempts"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_retries_a_finding_when_the_first_repair_does_not_fix_it(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        replacement = dict(contract["stories"][5])
        generate_text.side_effect = [
            json.dumps(contract),
            json.dumps({"replacements": [{"replace_ids": ["US-06"], "stories": [replacement]}]}),
            json.dumps({"replacements": [{"replace_ids": ["US-06"], "stories": [replacement]}]}),
        ]
        review_results = [
            {"decision": "REVISE", "findings": [{"story_id": "US-06", "code": "needs_split_or_scope", "reason": "Escopo composto."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-06", "code": "needs_split_or_scope", "reason": "Escopo ainda composto."}]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(3, generate_text.call_count)
        self.assertEqual(2, result["backlog_contract"]["quality_review"]["repair_attempts"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_has_a_fifth_repair_round_for_the_last_story_in_a_large_contract(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        generate_text.side_effect = [
            json.dumps(contract),
            *[
                json.dumps({"replacements": [{"replace_ids": [story_id], "stories": [dict(contract["stories"][int(story_id[-2:]) - 1])]}]})
                for story_id in ("US-01", "US-02", "US-03", "US-04", "US-04")
            ],
        ]
        review_results = [
            {"decision": "REVISE", "findings": [{"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-02", "code": "needs_split_or_scope", "reason": "Escopo."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-03", "code": "needs_split_or_scope", "reason": "Escopo."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-04", "code": "needs_split_or_scope", "reason": "Escopo."}]},
            {"decision": "REVISE", "findings": [{"story_id": "US-04", "code": "needs_split_or_scope", "reason": "Escopo persistente."}]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(6, generate_text.call_count)
        self.assertEqual(5, result["backlog_contract"]["quality_review"]["repair_attempts"])

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_batches_independent_story_repairs(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        generate_text.side_effect = [
            json.dumps(contract),
            json.dumps({"replacements": [
                {"replace_ids": ["US-01"], "stories": [dict(contract["stories"][0])]},
                {"replace_ids": ["US-06"], "stories": [dict(contract["stories"][5])]},
            ]}),
        ]
        review_results = [
            {"decision": "REVISE", "findings": [
                {"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo composto."},
                {"story_id": "US-06", "code": "needs_split_or_scope", "reason": "Escopo composto."},
            ]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(2, generate_text.call_count)
        repair_prompt = generate_text.call_args_list[1].args[0]
        self.assertIn("US-01", repair_prompt)
        self.assertIn("US-06", repair_prompt)

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_provider_failure_during_repair_retries_the_full_contract(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        generate_text.side_effect = [
            json.dumps(contract),
            RuntimeError("todos os providers falharam"),
            json.dumps(contract),
        ]
        review_results = [
            {"decision": "REVISE", "findings": [{"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo composto."}]},
            {"decision": "PASS", "findings": []},
        ]

        with patch.object(manager, "_review_backlog_contract", side_effect=review_results), \
             patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(3, generate_text.call_count)

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_generation_completes_only_missing_stories(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        partial = self.backlog_contract(story_count=5)
        additions = {"stories": self.backlog_contract(story_count=8)["stories"][5:]}
        generate_text.side_effect = [__import__("json").dumps(partial), __import__("json").dumps(additions)]

        with patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(2, generate_text.call_count)
        repair_prompt = generate_text.call_args_list[1].args[0]
        self.assertIn("SOMENTE 3 historias novas", repair_prompt)

    @patch("agents.project_manager.agent.generate_text_from_llm")
    def test_invalid_story_completion_retries_the_full_ai_contract(self, generate_text):
        manager = ProjectManager("credit-backlog-test")
        partial = self.backlog_contract(story_count=5)
        generate_text.side_effect = [
            __import__("json").dumps(partial),
            '{"stories":[}',
            __import__("json").dumps(self.backlog_contract()),
        ]

        with patch.object(manager, "_render_backlog_contract", return_value="rendered"):
            result = manager._generate_ai_backlog("plataforma de credito")

        self.assertEqual("rendered", result["markdown"])
        self.assertEqual(3, generate_text.call_count)
        retry_prompt = generate_text.call_args_list[2].args[0]
        self.assertIn("no minimo 8 e no maximo 25", retry_prompt)

    def test_eight_well_formed_stories_are_accepted_without_a_fixed_target(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)

        validated = manager._validate_backlog_contract(contract)

        self.assertEqual(8, len(validated["stories"]))
        self.assertIn("coverage", validated)

    def test_credit_backbone_is_not_rejected_for_not_using_crud_verbs(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        credit_goals = [
            "simular uma condicao de credito", "iniciar uma solicitacao digital", "preencher dados cadastrais",
            "enviar a proposta para analise", "anexar documentos obrigatorios", "consultar o andamento da proposta",
            "analisar uma proposta recebida", "decidir sobre a proposta analisada", "corrigir uma pendencia informada",
            "reenviar uma proposta corrigida", "informar um complemento documental", "avaliar documentos recebidos",
            "comunicar a decisao ao cliente", "revisar uma decisao operacional", "consultar o historico da proposta",
            "encerrar uma solicitacao cancelada",
        ]
        for story, goal in zip(contract["stories"], credit_goals):
            story["goal"] = goal

        markdown = manager._render_backlog_contract(manager._validate_backlog_contract(contract))
        valid, reason = validate_backlog_output(markdown)

        self.assertTrue(valid, reason)

    def test_project_dna_is_not_business_evidence(self):
        manager = ProjectManager("credit-backlog-test")
        evidence = manager._build_evidence_contract(
            "Cliente envia documentos obrigatorios.\n\nProject DNA:\n- Familias de tela permitidas: executive-cockpit, settings-console"
        )

        self.assertEqual(["Cliente envia documentos obrigatorios"], [fact["text"] for fact in evidence["facts"]])

    def test_briefing_section_label_is_not_business_evidence(self):
        manager = ProjectManager("credit-backlog-test")
        evidence = manager._build_evidence_contract(
            "Respostas-chave:\n- Cliente envia documentos obrigatorios."
        )

        self.assertEqual(["Cliente envia documentos obrigatorios"], [fact["text"] for fact in evidence["facts"]])

    def test_unsupported_policy_detail_is_downgraded_to_review(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        story = contract["stories"][0]
        story.update({
            "goal": "parametrizar criterios e limites de elegibilidade",
            "description": "Console para configurar margens e valores maximos da politica de credito.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": [],
            "open_questions": [],
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Regras de elegibilidade devem ser observadas.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)
        reviewed_story = validated["stories"][0]

        self.assertEqual("proposed", reviewed_story["status"])
        self.assertIn("REVIEW_HIGH_IMPACT", reviewed_story["review_tags"])
        self.assertTrue(reviewed_story["open_questions"])
        rendered = manager._render_backlog_contract(validated)
        self.assertIn("REVIEW_HIGH_IMPACT", rendered)
        self.assertIn("REVIEW_SCOPE", rendered)
        self.assertIn("Ponto a validar:", rendered)

    def test_unsupported_security_solution_is_downgraded_to_review(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract()
        story = contract["stories"][0]
        story.update({
            "goal": "proteger dados pessoais e financeiros",
            "description": "Aplicar criptografia e controle de acesso aos dados sensiveis.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": [],
            "open_questions": [],
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Proteger dados pessoais e financeiros conforme a LGPD.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)
        reviewed_story = validated["stories"][0]

        self.assertEqual("proposed", reviewed_story["status"])
        self.assertIn("REVIEW_HIGH_IMPACT", reviewed_story["review_tags"])

    def test_credit_simulation_carries_required_financial_gaps_to_refinement_context(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][0]
        story.update({
            "actor": "Cliente solicitante de credito",
            "goal": "simular e iniciar uma solicitacao de credito",
            "description": "O cliente solicita uma simulacao antes de iniciar a proposta.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": [],
            "open_questions": [],
            "refinement_context": {"inputs": ["valor desejado"]},
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Cliente simula e inicia uma solicitacao de credito.", "type": "briefing"}]}

        reviewed_story = manager._validate_backlog_contract(contract, evidence)["stories"][0]

        self.assertIn("REVIEW_SCOPE", reviewed_story["review_tags"])
        self.assertIn("REVIEW_HIGH_IMPACT", reviewed_story["review_tags"])
        questions = " ".join(reviewed_story["open_questions"]).lower()
        self.assertIn("precificacao", questions)
        self.assertIn("arredondamento", questions)
        self.assertIn("prazo e numero de parcelas", questions)
        self.assertEqual(reviewed_story["open_questions"], reviewed_story["refinement_context"]["open_questions"])
        self.assertEqual("high", reviewed_story["priority"])
        self.assertEqual("MVP", reviewed_story["release"])

    def test_human_actor_is_reviewed_when_story_describes_automatic_system_behavior(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][0]
        story.update({
            "actor": "Operador principal",
            "goal": "validar dados da proposta",
            "description": "O sistema valida os dados e registra automaticamente a proposta.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": [],
            "open_questions": [],
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "O sistema valida dados e registra a proposta.", "type": "briefing"}]}

        reviewed_story = manager._validate_backlog_contract(contract, evidence)["stories"][0]

        self.assertIn("REVIEW_ROLE", reviewed_story["review_tags"])
        self.assertIn("ator responsavel", " ".join(reviewed_story["open_questions"]).lower())

    def test_human_review_story_can_describe_system_feedback_without_role_conflict(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][0]
        story.update({
            "actor": "Analista de credito",
            "goal": "revisar a proposta",
            "description": "O sistema apresenta os documentos recebidos para apoiar a revisao.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": [],
            "open_questions": [],
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Analista revisa a proposta e seus documentos.", "type": "briefing"}]}

        reviewed_story = manager._validate_backlog_contract(contract, evidence)["stories"][0]

        self.assertNotIn("REVIEW_ROLE", reviewed_story["review_tags"])

    def test_stale_role_tag_is_recalculated_after_ai_repair(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][0]
        story.update({
            "actor": "Analista de credito",
            "goal": "validar a proposta",
            "description": "O sistema apresenta os dados recebidos para apoiar a validacao.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
            "review_tags": ["REVIEW_ROLE"],
            "open_questions": [],
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Analista valida a proposta recebida.", "type": "briefing"}]}

        reviewed_story = manager._validate_backlog_contract(contract, evidence)["stories"][0]

        self.assertNotIn("REVIEW_ROLE", reviewed_story["review_tags"])

    def test_lint_detects_release_dependency_and_unconfirmed_bureau_context(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        first, second = contract["stories"][:2]
        first.update({"id": "US-01", "release": "MVP", "goal": "consultar dados de bureau", "source_ids": ["briefing.1"], "refinement_context": {"inputs": ["Dados de bureau"], "dependencies": ["US-02"]}})
        second.update({"id": "US-02", "release": "Fase 2"})
        evidence = {"briefing.1": "Cliente consulta proposta de credito."}

        findings = manager._lint_backlog_contract(contract, evidence)

        codes = {item["code"] for item in findings}
        self.assertIn("unconfirmed_context", codes)
        self.assertIn("release_dependency_conflict", codes)

    def test_validation_normalizes_decision_outcomes_into_one_story_action(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][5]
        story.update({
            "goal": "aprovar, reprovar ou solicitar complementos para a proposta",
            "description": "O analista conclui a analise.",
            "source_ids": ["briefing.1"],
            "status": "confirmed",
        })
        evidence = {"facts": [{"id": "briefing.1", "text": "Analista decide sobre a proposta e pode solicitar complementos.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)

        self.assertEqual("registrar a decisao da proposta", validated["stories"][5]["goal"])
        self.assertNotIn("needs_split_or_scope", {item["code"] for item in manager._lint_backlog_contract(validated, {"briefing.1": evidence["facts"][0]["text"]})})

    def test_validation_aligns_a_dependent_story_with_its_prerequisite_release(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0].update({"release": "MVP", "refinement_context": {"dependencies": ["US-02"]}})
        contract["stories"][1]["release"] = "Fase 2"

        validated = manager._validate_backlog_contract(contract)

        self.assertEqual("Fase 2", validated["stories"][0]["release"])

    def test_validation_derives_mvp_slice_from_completed_stories_when_plan_omits_it(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=15)
        contract["releases"] = [release for release in contract["releases"] if release["name"] != "MVP"]
        for story in contract["stories"]:
            story["release"] = "Fase 2"

        validated = manager._validate_backlog_contract(contract)

        self.assertIn("mvp", {release["name"].lower() for release in validated["releases"]})
        self.assertGreaterEqual(
            sum(1 for story in validated["stories"] if story["release"] == "MVP"),
            2,
        )

    def test_repair_accepts_a_complete_story_list_from_the_model(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        repaired = self.backlog_contract(story_count=8)
        repaired["stories"][0]["goal"] = "simular uma condicao de credito"

        result = manager._apply_story_repairs(original, {"stories": repaired["stories"]})

        self.assertEqual("simular uma condicao de credito", result["stories"][0]["goal"])
        self.assertIsNone(result["coverage"])

    def test_repair_accepts_nested_partial_story_list_with_existing_ids(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        replacement = dict(original["stories"][0])
        replacement["goal"] = "simular uma condicao de credito"

        result = manager._apply_story_repairs(original, {"result": {"corrected_stories": [replacement]}})

        self.assertEqual(8, len(result["stories"]))
        self.assertEqual("simular uma condicao de credito", result["stories"][0]["goal"])

    def test_repair_accepts_a_single_nested_story_object(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        replacement = dict(original["stories"][0])
        replacement["goal"] = "simular uma condicao de credito"

        result = manager._apply_story_repairs(original, {"replacement": replacement})

        self.assertEqual(8, len(result["stories"]))
        self.assertEqual("simular uma condicao de credito", result["stories"][0]["goal"])

    def test_repair_accepts_nested_replacement_groups(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        replacement = dict(original["stories"][0])
        replacement["goal"] = "simular uma condicao de credito"

        result = manager._apply_story_repairs(
            original,
            {"result": {"replacement": {"replace_ids": ["US-01"], "stories": [replacement]}}},
            affected_story_ids=["US-01"],
        )

        self.assertEqual("simular uma condicao de credito", result["stories"][0]["goal"])

    def test_scoped_repair_accepts_unenveloped_partial_split(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        first, second = dict(original["stories"][0]), dict(original["stories"][0])
        first["goal"] = "simular uma condicao de credito"
        second["id"] = "US-09"
        second["goal"] = "iniciar uma solicitacao"

        result = manager._apply_story_repairs(
            original,
            {"result": {"stories": [first, second]}},
            affected_story_ids=["US-01"],
        )

        self.assertEqual(9, len(result["stories"]))
        self.assertEqual("iniciar uma solicitacao", result["stories"][1]["goal"])

    def test_story_repair_prompt_supports_splitting_a_single_story(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)

        prompt = manager._build_story_repair_prompt(
            contract,
            {"facts": [{"id": "briefing.1", "text": "Cliente inicia uma solicitacao.", "type": "briefing"}]},
            [{"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo composto."}],
        )

        self.assertIn('"replacements"', prompt)
        self.assertIn('"replace_ids":["US-01"]', prompt)

    def test_scoped_repair_preserves_unrelated_stories_from_a_full_model_response(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        original["stories"][0]["goal"] = "simular uma condicao de credito"
        model_contract = self.backlog_contract(story_count=8)
        model_contract["stories"][0]["goal"] = "regressao indevida"
        model_contract["stories"][1]["goal"] = "acompanhar a proposta"

        result = manager._apply_story_repairs(
            original,
            {"stories": model_contract["stories"]},
            affected_story_ids=["US-02"],
        )

        self.assertEqual("simular uma condicao de credito", result["stories"][0]["goal"])
        self.assertEqual("acompanhar a proposta", result["stories"][1]["goal"])

    def test_overview_repair_prompt_is_a_small_ai_only_contract(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract.pop("overview", None)

        prompt = manager._build_overview_repair_prompt(
            contract,
            {"facts": [{"id": "briefing.1", "text": "Cliente inicia uma solicitacao de credito.", "type": "briefing"}]},
        )

        self.assertIn("Corrija SOMENTE o campo overview", prompt)
        self.assertIn('{"overview":"', prompt)
        self.assertIn("Nao invente funcionalidades", prompt)

    def test_invalid_model_coverage_is_rebuilt_from_validated_story_sources(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        for story in contract["stories"]:
            story["source_ids"] = ["briefing.1"]
        contract["coverage"] = [{"source_id": "briefing.99", "story_ids": ["US-99"]}]
        evidence = {"facts": [{"id": "briefing.1", "text": "Etapa da jornada de credito.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)

        self.assertEqual([{"source_id": "briefing.1", "story_ids": [f"US-{index:02d}" for index in range(1, 9)]}], validated["coverage"])

    def test_lint_requires_repair_when_system_is_used_as_user_story_actor(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0]["actor"] = "Sistema"

        findings = manager._lint_backlog_contract(contract, {})

        self.assertIn("system_actor", {item["code"] for item in findings})

    def test_backlog_challenger_flags_missing_confirmed_complement_flow(self):
        contract = self.backlog_contract(story_count=8)
        contract["stories"][5]["goal"] = "registrar a decisao da proposta"
        evidence = {"facts": [{"id": "briefing.1", "text": "Analista aprova, reprova ou solicitar complementos.", "type": "briefing"}]}

        report = BacklogChallenger().process(contract, evidence)

        finding = next(item for item in report["findings"] if item["code"] == "missing_confirmed_flow")
        self.assertEqual("US-06", finding["story_id"])
        self.assertEqual("REVISE", BacklogJudge().process(report["findings"])["decision"])

    def test_backlog_challenger_accepts_mirrored_open_questions(self):
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0].update({
            "open_questions": ["Qual politica deve ser aplicada?"],
            "refinement_context": {"open_questions": ["Qual política deve ser aplicada?"]},
        })

        report = BacklogChallenger().process(contract)

        self.assertNotIn("duplicate_open_questions", {item["code"] for item in report["findings"]})

    def test_backlog_challenger_accepts_explicit_capability_traceability(self):
        contract = self.backlog_contract(story_count=8)
        contract["capabilities"] = [{"id": "CAP-01", "name": "Gestao de Infraestrutura de Salas"}]
        contract["stories"][0]["capability_ids"] = ["CAP-01"]

        report = BacklogChallenger().process(contract)

        self.assertEqual([], report["proposals"])

    def test_backlog_judge_requires_scope_findings_to_be_repaired(self):
        decision = BacklogJudge().process([
            {"story_id": "US-01", "code": "needs_split_or_scope", "reason": "Escopo composto."},
            {"story_id": "US-09", "code": "unplanned_confirmed_integration", "reason": "Planejamento pendente."},
        ])

        self.assertEqual("REVISE", decision["decision"])
        self.assertEqual(2, len(decision["findings"]))
        self.assertEqual([], decision["advisories"])

    @patch("agents.project_manager.agent.RequirementEngineAgent")
    def test_requirements_gate_returns_blocking_questions_before_backlog_generation(self, engine_class):
        manager = ProjectManager("credit-backlog-test")
        engine_class.return_value.process.return_value = {"findings": [{
            "category": "missing_information", "severity": "high",
            "message": "A politica de precificacao nao foi definida.",
            "recommendation": "Qual politica de precificacao deve ser aplicada?",
        }]}

        with patch.object(manager, "_generate_ai_backlog") as generate_backlog:
            result = manager.process("Plataforma para solicitar credito.")

        self.assertTrue(result["clarification_required"])
        self.assertEqual("CQ-01", result["clarifications"][0]["id"])
        self.assertEqual("BLOCK", result["requirements_contract"]["decision"])
        generate_backlog.assert_not_called()

    @patch("agents.project_manager.agent.RequirementEngineAgent")
    def test_requirements_gate_converts_a_vague_recommendation_into_a_clear_question(self, engine_class):
        manager = ProjectManager("credit-backlog-test")
        engine_class.return_value.process.return_value = {"findings": [{
            "category": "missing_information", "severity": "high",
            "message": "A politica de precificacao nao foi definida.",
            "recommendation": "Definir a politica de precificacao.",
        }]}

        contract = manager._analyze_requirements_contract("Plataforma para solicitar credito.")

        question = contract["blocking_questions"][0]
        self.assertTrue(question["question"].endswith("?"))
        self.assertIn("politica de precificacao", question["question"].lower())
        self.assertTrue(question["answer_hint"])

    @patch("agents.project_manager.agent.RequirementEngineAgent")
    def test_answered_requirements_questions_do_not_block_backlog_generation(self, engine_class):
        manager = ProjectManager("credit-backlog-test")
        engine_class.return_value.process.return_value = {"findings": [{
            "category": "ambiguity", "severity": "high", "message": "Taxa nao definida.",
        }]}
        generated = {"markdown": "backlog", "backlog_contract": {"stories": []}}

        with patch.object(manager, "_generate_ai_backlog", return_value=generated) as generate_backlog, \
             patch.object(manager, "_is_backlog_aligned_with_briefing", return_value=True):
            result = manager.process("Credito. Clarificacoes respondidas: taxa fixa de 2%.")

        self.assertEqual(generated, result)
        self.assertEqual("user_briefing", result["backlog_contract"].get("requirements_contract", {}).get("questions", [{}])[0].get("resolved_by"))
        generate_backlog.assert_called_once()

    @patch("agents.project_manager.agent.RequirementEngineAgent")
    def test_invalid_requirements_analyzer_json_degrades_without_aborting_backlog_generation(self, engine_class):
        manager = ProjectManager("credit-backlog-test")
        engine_class.return_value.process.side_effect = ValueError("Resposta sem JSON válido.")
        generated = {"markdown": "backlog", "backlog_contract": {"stories": []}}

        with patch.object(manager, "_generate_ai_backlog", return_value=generated), \
             patch.object(manager, "_is_backlog_aligned_with_briefing", return_value=True):
            result = manager.process("Plataforma para solicitar credito.")

        self.assertEqual("degraded", result["backlog_contract"]["requirements_contract"]["analysis_status"])

    def test_apply_repairs_discards_dependencies_that_do_not_exist_after_renumbering(self):
        manager = ProjectManager("credit-backlog-test")
        original = self.backlog_contract(story_count=8)
        original["stories"][3]["refinement_context"] = {"dependencies": ["US-99"]}
        replacement = dict(original["stories"][0])

        repaired = manager._apply_story_repairs(
            original,
            {"replacements": [{"replace_ids": ["US-01"], "stories": [replacement]}]},
            affected_story_ids=["US-01"],
        )

        self.assertEqual([], repaired["stories"][3]["refinement_context"]["dependencies"])

    def test_validation_deduplicates_accent_equivalent_open_questions(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        contract["stories"][0].update({
            "source_ids": ["briefing.1"],
            "open_questions": [
                "Qual política deve ser aplicada?",
                "Qual politica deve ser aplicada?",
            ],
            "refinement_context": {"open_questions": ["Qual politica deve ser aplicada?"]},
        })

        validated = manager._validate_backlog_contract(contract, {"facts": [{"id": "briefing.1", "text": "Cliente inicia uma solicitacao.", "type": "briefing"}]})

        self.assertEqual(["Qual política deve ser aplicada?"], validated["stories"][0]["open_questions"])

    def test_traceability_marks_unspecified_output_as_derived(self):
        manager = ProjectManager("credit-backlog-test")
        contract = self.backlog_contract(story_count=8)
        story = contract["stories"][0]
        story.update({"source_ids": ["briefing.1"], "refinement_context": {"outputs": ["Painel executivo consolidado"]}})
        evidence = {"facts": [{"id": "briefing.1", "text": "Cliente realiza a etapa da jornada.", "type": "briefing"}]}

        validated = manager._validate_backlog_contract(contract, evidence)

        self.assertEqual("derived", validated["stories"][0]["refinement_context"]["traceability"]["outputs"][0]["status"])


if __name__ == "__main__":
    unittest.main()
