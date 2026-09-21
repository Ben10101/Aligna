import json
import unittest
from unittest.mock import patch

from agents.project_manager.agent import ProjectManager


class ProjectManagerClarificationsTests(unittest.TestCase):
    def test_project_objective_answers_the_generic_business_outcome_question(self):
        evidence = {
            "briefing.1": "objective: Centralizar a reserva de salas, reduzir conflitos de horário e dar visibilidade sobre a ocupação.",
        }

        self.assertTrue(ProjectManager._has_project_business_outcome_evidence(evidence))

    def test_requirements_preflight_accepts_null_findings_from_provider(self):
        manager = ProjectManager("project-test")
        with patch.dict("os.environ", {"PROJECT_MANAGER_REQUIREMENTS_PREFLIGHT_ENABLED": "1"}), \
             patch("agents.project_manager.agent.RequirementEngineAgent") as requirement_engine:
            requirement_engine.return_value.process.return_value = {"findings": None, "semantic_context": None}
            contract = manager._analyze_requirements_contract("Professores reservam salas de aula.")

        self.assertEqual([], contract["findings"])
        self.assertEqual([], contract["questions"])
        self.assertEqual("READY", contract["decision"])

    def test_model_open_questions_do_not_block_backlog_synthesis_by_default(self):
        manager = ProjectManager("project-test")
        questions = manager._collect_backlog_clarifications({
            "evidence": {"facts": [{"id": "briefing.1", "text": "Reserva e manutenção de salas."}]},
            "stories": [{
                "id": "US-07",
                "actor": "administrador",
                "goal": "bloquear salas e notificar reservas afetadas",
                "benefit": "evitar conflitos de agenda",
                "description": "Controla indisponibilidade para manutenção.",
                "source_ids": ["briefing.1"],
                "open_questions": [
                    "Separar as acoes independentes desta historia ou confirmar que devem ser entregues e aceitas como uma unica capacidade."
                ],
                "refinement_context": {"open_questions": []},
            }],
        })

        self.assertEqual([], questions)

    def test_real_time_is_not_treated_as_an_unconfirmed_sla_policy(self):
        unsupported = ProjectManager._unsupported_sensitive_details(
            {
                "source_ids": ["briefing.1"],
                "goal": "Alterar o horário de uma reserva existente",
                "description": "Permitir a modificação da reserva, validando conflitos em tempo real.",
            },
            {"briefing.1": "Professores podem alterar reservas de salas."},
        )

        self.assertNotIn("compromisso_de_tempo", unsupported)

    def test_authenticated_access_is_supported_by_an_authenticated_user_rule(self):
        unsupported = ProjectManager._unsupported_sensitive_details(
            {
                "source_ids": ["briefing.1"],
                "goal": "autenticar-se no sistema",
                "description": "Fornece controle de acesso autenticado antes de alterar reservas.",
            },
            {"briefing.1": "Somente usuários autenticados podem criar ou alterar reservas."},
        )

        self.assertNotIn("solucao_de_seguranca", unsupported)

    def test_operational_usage_rate_is_not_a_financial_calculation(self):
        unsupported = ProjectManager._unsupported_sensitive_details(
            {
                "source_ids": ["briefing.1"],
                "goal": "acompanhar a ocupação das salas",
                "description": "Painel com a taxa de uso e ocupação das salas.",
            },
            {"briefing.1": "A equipe administrativa acompanha a ocupação das salas."},
        )

        self.assertNotIn("calculo_financeiro", unsupported)

    def test_cancelling_a_reservation_is_not_data_retention_or_audit_policy(self):
        unsupported = ProjectManager._unsupported_sensitive_details(
            {
                "source_ids": ["briefing.1"],
                "goal": "Visualizar o histórico de alterações e cancelamentos de reservas",
                "description": "Registro detalhado das ações de criação, alteração e cancelamento.",
            },
            {"briefing.1": "A equipe administrativa consulta o histórico de reservas."},
        )

        self.assertNotIn("retencao_ou_exclusao", unsupported)
        self.assertNotIn("auditoria_regulatoria", unsupported)

    def test_subjective_quality_is_reviewed_without_a_blocking_question(self):
        manager = ProjectManager("project-test")
        tags, questions = [], []
        manager._apply_story_quality_guardrails(
            {"goal": "consultar disponibilidade", "description": "A consulta deve ser rápida e intuitiva.", "actor": "professor"},
            tags,
            questions,
            {"open_questions": []},
        )

        self.assertIn("REVIEW_TESTABILITY", tags)
        self.assertEqual([], questions)

    def test_nested_provider_aliases_preserve_acceptance_criteria(self):
        manager = ProjectManager("project-test")
        normalized = manager._normalize_backlog_contract_aliases({
            "stories": [{
                "id": "US-01",
                "refinementContext": {
                    "acceptanceCriteria": [{
                        "precondition": "A sala está disponível",
                        "action": "O professor confirma a reserva",
                        "outcome": "A reserva é registrada",
                        "sourceIds": ["briefing.1"],
                    }],
                },
            }],
        })

        criterion = normalized["stories"][0]["refinement_context"]["acceptance_criteria"][0]
        self.assertEqual("A sala está disponível", criterion["given"])
        self.assertEqual("O professor confirma a reserva", criterion["when"])
        self.assertEqual("A reserva é registrada", criterion["then"])
        self.assertEqual(["briefing.1"], criterion["source_ids"])

    def test_incremental_generation_repairs_only_missing_acceptance_criteria(self):
        manager = ProjectManager("project-test")
        manager._requirements_contract = {"requirements": []}
        manager._build_evidence_contract = lambda _idea: {"facts": [{"id": "briefing.1", "text": "Reservar salas."}]}
        manager._compact_briefing = lambda _idea: "Reservar salas"
        manager._validate_backlog_contract = lambda contract, _evidence: contract
        manager._collect_backlog_clarifications = lambda _contract: []
        manager._review_backlog_contract = lambda *_args: {"decision": "PASS", "domain": "generic", "score": 100, "threshold": 80, "dimensions": {}, "proposals": [], "questions": []}
        manager._render_backlog_contract = lambda _contract: "backlog"

        def story(number, criterion=True):
            item = {
                "id": f"US-{number:02d}", "actor": "professor", "goal": f"reservar sala {number}",
                "benefit": "organizar reservas", "description": "Reserva de sala", "lane": "operation",
                "priority": "medium", "release": "MVP", "source_ids": ["briefing.1"],
                "capability_ids": ["CAP-01"], "status": "confirmed", "review_tags": [], "open_questions": [],
                "refinement_context": {"acceptance_criteria": []},
            }
            if criterion:
                item["refinement_context"]["acceptance_criteria"] = [{"given": "sala livre", "when": "confirmar", "then": "reserva registrada"}]
            return item

        responses = [
            {"overview": "Reservas", "capabilities": [{"id": f"CAP-{number:02d}", "name": f"Capacidade {number}", "source_ids": ["briefing.1"]} for number in range(1, 6)], "epics": ["Reservas"], "releases": [{"name": "MVP", "focus": "Reservas", "deferred": "Depois"}]},
            {"stories": [story(number) for number in range(1, 5)]},
            {"stories": [story(number, criterion=False) for number in range(5, 9)]},
            {"stories": [{"id": f"US-{number:02d}", "refinement_context": {"acceptance_criteria": [{"given": "sala livre", "when": "confirmar", "then": "reserva registrada"}]}} for number in range(5, 9)]},
            {"stories": [story(number) for number in range(9, 13)]},
            {"stories": [story(number) for number in range(13, 17)]},
            {"stories": [story(number) for number in range(17, 21)]},
        ]
        # Gemini may serialize an omitted optional array as JSON null. The
        # batch must request the focused acceptance repair instead of failing
        # while checking for the missing criterion.
        responses[2]["stories"][0]["refinement_context"]["acceptance_criteria"] = None
        # The provider can also omit the fixed transport IDs. The PM assigns
        # the IDs declared by the batch envelope before it requests repair.
        for item in responses[2]["stories"]:
            item.pop("id")
        with patch("agents.project_manager.agent.generate_text_from_llm", side_effect=[json.dumps(item) for item in responses]) as generate:
            result = manager._generate_incremental_backlog("Reserva de salas")

        self.assertEqual("backlog", result["markdown"])
        self.assertEqual(7, generate.call_count)
        self.assertEqual(20, len(result["backlog_contract"]["stories"]))
        self.assertEqual([f"US-{number:02d}" for number in range(5, 9)], [story["id"] for story in result["backlog_contract"]["stories"][4:8]])
        repaired = result["backlog_contract"]["stories"][4:]
        self.assertTrue(all(story["refinement_context"]["acceptance_criteria"] for story in repaired))

    def test_incremental_coverage_plan_scales_from_16_to_24_stories(self):
        manager = ProjectManager("project-test")
        evidence = {"facts": [{"id": "briefing.1", "text": "Evidencia confirmada."}]}

        for capability_count, expected_batches in ((4, 4), (5, 5), (6, 6)):
            plan = {"capabilities": [
                {"id": f"CAP-{number:02d}", "name": f"Capacidade {number}", "source_ids": ["briefing.1"]}
                for number in range(1, capability_count + 1)
            ]}
            coverage = manager._build_incremental_coverage_plan(plan, evidence)

            self.assertEqual(expected_batches, len(coverage))
            self.assertEqual(expected_batches * 4, len([story_id for batch in coverage for story_id in batch["story_ids"]]))
            self.assertEqual("briefing.1", coverage[-1]["evidence"][0]["id"])

    def test_incremental_coverage_plan_accepts_null_source_ids_from_provider(self):
        manager = ProjectManager("project-test")
        plan = {"capabilities": [
            {"id": f"CAP-{number:02d}", "name": f"Capacidade {number}", "source_ids": None}
            for number in range(1, 5)
        ]}

        coverage = manager._build_incremental_coverage_plan(
            plan,
            {"facts": [{"id": "briefing.1", "text": "Evidencia confirmada."}]},
        )

        self.assertEqual(4, len(coverage))
        self.assertTrue(all(batch["evidence"] for batch in coverage))

    def test_contract_validation_normalizes_null_optional_lists_from_provider(self):
        manager = ProjectManager("project-test")
        contract = {
            "overview": "Reserva de salas para professores.",
            "capabilities": [
                {"id": f"CAP-{number:02d}", "name": f"Capacidade {number}", "source_ids": None, "story_ids": None}
                for number in range(1, 5)
            ],
            "epics": ["Cadastro", "Consulta", "Reserva", "Administracao"],
            "releases": [
                {"name": "MVP", "focus": "Reservar salas", "deferred": "Evolucoes"},
                {"name": "Fase 2", "focus": "Administrar salas", "deferred": "Evolucoes"},
                {"name": "Fase 3", "focus": "Acompanhar reservas", "deferred": "Nenhuma"},
            ],
            "stories": [
                {
                    "id": f"US-{number:02d}", "actor": "professor", "goal": f"reservar sala {number}",
                    "benefit": "organizar aulas", "description": "Reserva de sala para aula.",
                    "lane": "foundation" if number <= 2 else "operation", "priority": "medium",
                    "release": "MVP", "source_ids": None, "capability_ids": None,
                    "review_tags": None, "open_questions": None, "refinement_context": None,
                }
                for number in range(1, 17)
            ],
        }

        normalized = manager._validate_backlog_contract(
            contract,
            {"facts": [{"id": "briefing.1", "text": "Professores reservam salas para aulas."}]},
        )

        self.assertEqual([], normalized["capabilities"][0]["source_ids"])
        self.assertEqual([], normalized["stories"][0]["source_ids"])
        self.assertIsInstance(normalized["stories"][0]["review_tags"], list)

    def test_default_story_is_proposed_even_when_its_evidence_and_criterion_exist(self):
        manager = ProjectManager("project-test")
        contract = {
            "overview": "Reserva de salas.",
            "capabilities": [{"id": "CAP-01", "name": "Reserva de salas", "source_ids": ["briefing.1"]}],
            "epics": ["Reservas"],
            "releases": [
                {"name": "MVP", "focus": "Reservas", "deferred": "Depois"},
                {"name": "Fase 2", "focus": "Gestao", "deferred": "Depois"},
                {"name": "Fase 3", "focus": "Visibilidade", "deferred": "Nenhuma"},
            ],
            "stories": [
                {
                    "id": f"US-{number:02d}", "actor": "professor", "goal": f"reservar sala {number}",
                    "benefit": "organizar aulas", "description": "Reservar uma sala para aula.",
                    "lane": "foundation" if number <= 2 else "operation", "priority": "medium", "release": "MVP",
                    "source_ids": ["briefing.1"], "capability_ids": ["CAP-01"],
                    "status": "confirmed", "review_tags": ["PROPOSED_DEFAULT"] if number == 1 else [], "open_questions": [],
                    "refinement_context": {"acceptance_criteria": [{"given": "sala livre", "when": "confirmar", "then": "reserva registrada", "source_ids": ["briefing.1"]}]},
                }
                for number in range(1, 17)
            ],
        }
        normalized = manager._validate_backlog_contract(
            contract,
            {"facts": [{"id": "briefing.1", "text": "Professores podem reservar salas para aulas."}]},
        )

        self.assertEqual("proposed", normalized["stories"][0]["status"])
        self.assertIn("REVIEW_REQUIRED", normalized["stories"][0]["review_tags"])

    def test_maintenance_booking_rule_overlap_is_reviewable(self):
        manager = ProjectManager("project-test")
        stories = [
            {"id": "US-12", "actor": "administrador", "goal": "Bloquear sala para manutencao", "description": "Impede novas reservas durante a manutencao.", "review_tags": [], "source_ids": []},
            {"id": "US-20", "actor": "professor", "goal": "Impedir reserva de sala em manutencao", "description": "Nega a reserva durante o bloqueio de manutencao.", "review_tags": [], "source_ids": []},
        ]

        findings = manager._lint_backlog_contract({"stories": stories}, {})

        self.assertTrue(any(item["story_id"] == "US-20" and item["code"] == "duplicate_operational_rule" for item in findings))

    def test_quality_repair_prompt_requires_named_actor_for_generic_actor_finding(self):
        prompt = ProjectManager("project-test")._build_story_repair_prompt(
            {"stories": [{"id": "US-05", "actor": "usuario", "goal": "consultar salas"}]},
            {"facts": [{"id": "briefing.1", "text": "Professores consultam salas."}]},
            [{"story_id": "US-05", "code": "generic_actor", "reason": "Ator generico."}],
        )

        self.assertIn("ator generico", prompt)
        self.assertIn("persona de negocio nomeada", prompt)

    def test_duplicate_repair_reserves_uncovered_evidence_first(self):
        evidence = {"facts": [
            {"id": "briefing.1", "text": "Cadastrar salas."},
            {"id": "briefing.2", "text": "Reservar uma sala."},
            {"id": "briefing.3", "text": "Bloquear sala para manutencao."},
        ]}
        contract = {"stories": [
            {"id": "US-01", "source_ids": ["briefing.1"]},
            {"id": "US-02", "source_ids": ["briefing.2"]},
            {"id": "US-03", "source_ids": ["briefing.2"]},
        ]}

        reserved = ProjectManager._select_duplicate_repair_evidence(contract, evidence, ["US-03"])

        self.assertEqual(["briefing.3"], [item["id"] for item in reserved])

    def test_optional_defaults_do_not_open_a_clarification_and_context_uses_requirements_evidence(self):
        manager = ProjectManager("project-test")
        manager._requirements_contract = {
            "evidence": {"facts": [{"id": "briefing.1", "text": "Professores reservam salas conforme capacidade e recursos."}]},
        }
        base_story = {
            "id": "US-01", "actor": "professor", "goal": "reservar sala", "benefit": "organizar aulas",
            "description": "Consulta disponibilidade e reserva uma sala.", "source_ids": [], "refinement_context": {"open_questions": []},
        }
        defaults = [
            "Quais tipos de recursos tecnicos devem ser listados (ex: projetor)?",
            "Devemos exibir salas com capacidade inferior a solicitada?",
            "O sistema deve permitir reservas recorrentes nesta fase?",
            "Qual o formato de visualizacao ideal: lista ou calendario?",
        ]
        self.assertTrue(all(manager._is_nonblocking_product_default_question(question) for question in defaults))
        self.assertTrue(manager._is_nonblocking_product_default_question(
            "Deve haver limite de reservas por professor? PROPOSED_DEFAULT: Sem limite inicial."
        ))
        self.assertTrue(manager._is_nonblocking_product_default_question(
            "O bloqueio deve cancelar reservas existentes? PROPOSED_DEFAULT: Nao, apenas impede novas reservas."
        ))
        generated_default_questions = [
            "Devemos permitir o bloqueio de salas que ja possuem reservas futuras?",
            "Qual o nivel de detalhe necessario para o registro de alteracoes?",
            "Deve haver um prazo minimo de antecedencia para cancelamento?",
            "A alteracao deve permitir mudanca de sala ou apenas de horario?",
            "Definir se a visualizacao sera por lista ou mapa de calor",
            "Definir formato de exibicao da agenda diaria",
            "Devemos tornar o campo de justificativa obrigatorio para todas as alteracoes administrativas?",
            "Qual o nivel de detalhe necessario para o historico (apenas data/autor ou campos alterados)?",
        ]
        self.assertTrue(all(manager._is_nonblocking_product_default_question(question) for question in generated_default_questions))

        story = {**base_story, "open_questions": ["Qual regra de prioridade deve ser aplicada quando houver conflito?"]}
        with patch.dict("os.environ", {"PROJECT_MANAGER_BACKLOG_BLOCKING_CLARIFICATIONS_ENABLED": "1"}):
            questions = manager._collect_backlog_clarifications({"stories": [story]})
        self.assertEqual(1, len(questions))
        self.assertEqual(["Professores reservam salas conforme capacidade e recursos."], questions[0]["story_context"][0]["evidence"])

    def test_integralmente_is_not_mistaken_for_external_integration(self):
        unsupported = ProjectManager._unsupported_sensitive_details(
            {
                "source_ids": ["briefing.1"],
                "goal": "visualizar alertas de capacidade",
                "description": "Destacar salas que nao atendem integralmente aos recursos solicitados.",
            },
            {"briefing.1": "Professores consultam salas por capacidade e recursos."},
        )

        self.assertNotIn("integracao_externa", unsupported)

    def test_uncovered_capability_proposals_fail_the_quality_gate(self):
        manager = ProjectManager("project-test")
        manager._lint_backlog_contract = lambda *_args: []
        challenger_output = {
            "findings": [], "proposals": [{"type": "story"}], "questions": [{"question": "Confirmar escopo?"}],
            "domain": "contextual", "score": 92, "threshold": 80, "dimensions": {"coverage": 25},
        }
        with patch("agents.project_manager.agent.BacklogChallenger") as challenger, patch("agents.project_manager.agent.BacklogJudge") as judge:
            challenger.return_value.process.return_value = challenger_output
            judge.return_value.process.return_value = {"decision": "PASS", "findings": [], "advisories": []}
            review = manager._review_backlog_contract({"stories": []}, {"facts": []}, {})

        self.assertEqual("REVISE", review["decision"])
        self.assertTrue(review["advisory_recommendations"])
        self.assertEqual(challenger_output["proposals"], review["proposals"])


if __name__ == "__main__":
    unittest.main()
