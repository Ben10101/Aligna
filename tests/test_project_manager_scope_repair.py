import unittest

from agents.project_manager.agent import ProjectManager


class ProjectManagerScopeRepairTests(unittest.TestCase):
    def test_isolated_scope_repair_is_explicitly_limited_to_one_action(self):
        manager = ProjectManager("scope-repair-test")
        prompt = manager._build_isolated_story_repair_prompt(
            {
                "id": "US-01",
                "actor": "doador",
                "goal": "buscar campanhas, doar e acompanhar impacto",
                "description": "Jornada completa.",
            },
            {"facts": [{"id": "briefing.1", "text": "Doadores encontram campanhas e realizam doacoes."}]},
            [{"story_id": "US-01", "code": "needs_split_or_scope"}],
        )

        self.assertIn("needs_split_or_scope", prompt)
        self.assertIn("um unico verbo de negocio", prompt)
        self.assertIn("Mantenha o mesmo ID", prompt)

    def test_single_action_repair_passes_scope_lint(self):
        findings = ProjectManager("scope-repair-test")._lint_backlog_contract(
            {"stories": [{"id": "US-01", "actor": "doador", "goal": "realizar uma doacao", "description": "Confirma a contribuicao para uma campanha selecionada."}]},
            {},
        )

        self.assertNotIn("needs_split_or_scope", {item["code"] for item in findings})


if __name__ == "__main__":
    unittest.main()
