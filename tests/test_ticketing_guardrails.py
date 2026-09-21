import unittest

from agents.backlog_challenger.agent import BacklogChallenger
from agents.qa_engineer.agent import QAEngineer


class TicketingGuardrailTests(unittest.TestCase):
    def test_backlog_surfaces_ticketing_decisions_without_inventing_them(self):
        report = BacklogChallenger().process(
            {
                "stories": [{
                    "id": "US-01",
                    "actor": "comprador",
                    "goal": "reservar assentos",
                    "description": "Reserva ingressos durante o checkout.",
                    "source_ids": ["briefing.1"],
                    "refinement_context": {"acceptance_criteria": [{"id": "CA-01"}]},
                }]
            },
            {"facts": [{"id": "briefing.1", "text": "Plataforma de compra de ingressos."}]},
        )

        self.assertIn("inventory_concurrency", {item["code"] for item in report["questions"]})
        self.assertIn("payment_idempotency", {item["code"] for item in report["questions"]})

    def test_qa_reports_risk_gap_instead_of_creating_an_unsupported_case(self):
        gaps = QAEngineer._ticketing_risk_gaps(
            {"acceptanceCriteria": [{"id": "CA-01", "text": "DADO setor disponivel QUANDO reservar ENTÃO mostra confirmacao."}]},
            [{"id": "CA-01", "text": "DADO setor disponivel QUANDO reservar ENTÃO mostra confirmacao."}],
            "Reserva de ingressos por setor.",
        )

        self.assertEqual(1, len(gaps))
        self.assertIn("concorrente", gaps[0])


if __name__ == "__main__":
    unittest.main()
