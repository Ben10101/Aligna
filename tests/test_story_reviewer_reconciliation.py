# -*- coding: utf-8 -*-
import unittest
from unittest.mock import patch

from agents.story_reviewer.agent import StoryReviewer, _is_valid_user_decision_question, _question_references_known_story, _relevant_review_answers


class StoryReviewerReconciliationTests(unittest.TestCase):
    def test_question_with_conflicting_story_label_is_discarded(self):
        question = {"question": "A story_5 (Registro de histórico) deve ser declarada como dependência?"}
        other_stories = [{"id": "story_5", "title": "Como professor, eu quero reservar uma sala."}]

        self.assertFalse(_question_references_known_story(question, other_stories))

    def test_question_with_matching_story_label_is_kept(self):
        question = {"question": "A story_8 (Histórico de alterações) deve ser declarada como dependência?"}
        other_stories = [{"id": "story_8", "title": "Como equipe administrativa, eu quero consultar o histórico de alterações."}]

        self.assertTrue(_question_references_known_story(question, other_stories))

    def test_technical_interface_choice_is_not_a_blocking_decision(self):
        question = {
            "question": "Os recursos devem usar lista pre-definida ou campo de texto livre?",
            "blocking": True,
            "decision_type": "required_data",
            "behavioral_impact": "Define a forma de interação para informar recursos.",
        }

        self.assertFalse(_is_valid_user_decision_question(question))

    def test_required_data_with_save_validation_is_a_valid_blocker(self):
        question = {
            "question": "Quais dados são obrigatórios e o que ocorre quando o usuário tenta salvar sem eles?",
            "blocking": True,
            "decision_type": "required_data",
            "behavioral_impact": "Define quais dados precisam ser validados antes de o registro ser salvo.",
        }

        self.assertTrue(_is_valid_user_decision_question(question))

    def test_observable_business_outcome_remains_a_blocking_decision(self):
        question = {
            "question": "Qual mensagem deve ser exibida quando nao houver salas disponiveis?",
            "blocking": True,
            "decision_type": "observable_outcome",
            "behavioral_impact": "Define o resultado apresentado quando a consulta não encontra disponibilidade.",
        }

        self.assertTrue(_is_valid_user_decision_question(question))

    def test_consultation_decision_is_ignored_for_an_audit_story(self):
        answers = [{
            "id": "RQ-ACCEPTANCE-COVERAGE-CONSULTATION",
            "question": "Alem da listagem de salas disponiveis, qual segundo cenario observavel deve comprovar a consulta por data, horario e capacidade?",
            "answer": "Quando nao houver sala compativel, informar indisponibilidade.",
        }]
        story = {
            "id": "story_8",
            "title": "Como equipe administrativa, eu quero consultar o historico de alteracoes de reservas, para manter a rastreabilidade.",
            "description": "Exibe alteracoes e cancelamentos.",
        }

        self.assertEqual([], _relevant_review_answers(answers, story))

    def test_consultation_decision_is_kept_for_an_availability_story(self):
        answers = [{
            "id": "RQ-ACCEPTANCE-COVERAGE-CONSULTATION",
            "question": "Alem da listagem de salas disponiveis, qual segundo cenario observavel deve comprovar a consulta por data, horario e capacidade?",
            "answer": "Quando nao houver sala compativel, informar indisponibilidade.",
        }]
        story = {
            "id": "story_9",
            "title": "Como professor, eu quero consultar disponibilidade de salas por data e horario, para encontrar uma sala.",
            "description": "A consulta considera capacidade.",
        }

        self.assertEqual(answers, _relevant_review_answers(answers, story))

    def test_generic_no_results_decision_is_kept_for_a_history_story(self):
        answers = [{
            "id": "Q-03",
            "question": "Como o sistema deve se comportar quando nenhum registro for encontrado após a aplicação dos filtros de busca?",
            "answer": "Exibir uma mensagem sem resultados e manter os filtros visíveis.",
        }]
        story = {
            "id": "story_8",
            "title": "Como equipe administrativa, eu quero consultar o histórico de alterações de reservas, para manter a rastreabilidade.",
        }

        self.assertEqual(answers, _relevant_review_answers(answers, story))

    @patch("agents.story_reviewer.agent.generate_complete_text")
    def test_invalid_llm_review_uses_deterministic_fallback(self, generate_text):
        generate_text.side_effect = RuntimeError(
            "A resposta da LLM nao contem proposta, perguntas ou evidencias de revisao."
        )
        result = StoryReviewer("project-test").process({
            "story": {
                "id": "story_5",
                "title": "Como professor, eu quero reservar uma sala, para realizar uma aula.",
                "actor": "professor",
                "description": "Registra a reserva confirmada.",
                "refinement_context": {
                    "acceptance_criteria": [{
                        "given": "que a sala esta disponivel",
                        "when": "o professor confirmar a reserva",
                        "then": "o sistema deve registrar a reserva",
                    }],
                },
            },
            "review_answers": [],
        })

        self.assertTrue(result["generation_degraded"])
        self.assertIn("assessment", result)


if __name__ == "__main__":
    unittest.main()
