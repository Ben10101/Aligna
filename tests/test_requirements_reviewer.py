# -*- coding: utf-8 -*-
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.requirements_reviewer.agent import _canonicalize_section_titles, _restore_missing_history, _validate_markdown, _validate_scope_preservation


VALID_DOCUMENT = """# Requisito Refinado

## Historia e objetivo

Como administrador, eu quero consultar auditorias, para rastrear alteracoes.

## Comportamento e regras confirmadas

### Comportamento

- O administrador consulta o historico por periodo.

### Regras

- O periodo entre as datas inicial e final nao pode exceder 90 dias.

## Cenarios de aceite

### Cenario 1

**DADO** que o administrador informa um periodo valido
**QUANDO** consulta o historico
**ENTAO** o sistema exibe os registros correspondentes.

## Decisoes pendentes

- Nenhuma decisao pendente.

## Status

**PRONTO PARA VALIDACAO**
"""


class RequirementsReviewerTests(unittest.TestCase):
    def test_accepts_a_contextualized_decision(self):
        _validate_markdown(VALID_DOCUMENT, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_accepts_accented_section_titles_and_bdd_keywords(self):
        accented_document = (
            VALID_DOCUMENT
            .replace("## Historia e objetivo", "## História e objetivo:")
            .replace("## Cenarios de aceite", "## Cenários de aceite")
            .replace("**ENTAO**", "**ENTÃO**")
        )
        _validate_markdown(accented_document, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_normalizes_a_semantic_user_story_heading(self):
        variant = VALID_DOCUMENT.replace("## Historia e objetivo", "## Historia da User Story")
        normalized = _canonicalize_section_titles(variant)
        self.assertIn("## Historia e objetivo", normalized)
        _validate_markdown(normalized, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_normalizes_history_heading_at_level_three(self):
        variant = VALID_DOCUMENT.replace("## Historia e objetivo", "### Historia e objetivo")
        normalized = _canonicalize_section_titles(variant)
        self.assertIn("## Historia e objetivo", normalized)
        _validate_markdown(normalized, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_restores_history_from_current_artifact_when_omitted(self):
        generated = VALID_DOCUMENT.replace(
            "## Historia e objetivo\n\nComo administrador, eu quero consultar auditorias, para rastrear alteracoes.\n\n",
            "",
        )
        restored = _restore_missing_history(generated, VALID_DOCUMENT)
        self.assertIn("## Historia e objetivo", restored)
        self.assertIn("Como administrador, eu quero consultar auditorias", restored)
        _validate_markdown(restored, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_rejects_a_raw_decision_as_a_rule(self):
        raw_document = VALID_DOCUMENT.replace(
            "- O periodo entre as datas inicial e final nao pode exceder 90 dias.",
            "- 90 dias",
        )
        with self.assertRaisesRegex(ValueError, "copiada como regra sem contexto"):
            _validate_markdown(raw_document, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_rejects_bdd_without_a_scenario_heading(self):
        unstructured_document = VALID_DOCUMENT.replace("### Cenario 1\n\n", "")
        with self.assertRaisesRegex(ValueError, "BDD estruturado"):
            _validate_markdown(unstructured_document, [{"question": "Qual o limite?", "answer": "90 dias"}])

    def test_rejects_an_independent_export_journey(self):
        expanded_document = VALID_DOCUMENT.replace(
            "- O administrador consulta o historico por periodo.",
            "- O administrador consulta o historico por periodo.\n- O administrador exporta o historico em CSV.",
        )
        with self.assertRaisesRegex(ValueError, "jornada independente"):
            _validate_scope_preservation(
                VALID_DOCUMENT,
                "Como administrador, quero consultar auditorias.",
                expanded_document,
            )


if __name__ == "__main__":
    unittest.main()
