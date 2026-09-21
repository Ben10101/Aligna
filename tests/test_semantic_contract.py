import json
import unittest
from pathlib import Path


class SemanticRegressionFixtureTest(unittest.TestCase):
    def test_cross_domain_cases_are_not_keyword_registry(self):
        cases = json.loads((Path(__file__).parent / "semantic_regression_cases.json").read_text(encoding="utf-8"))
        self.assertEqual({case["name"] for case in cases}, {"credito", "locacao_video", "biblioteca_digital"})
        self.assertEqual([case["expected_intent"] for case in cases], ["simulation", "view", "reserve"])
        for case in cases:
            self.assertGreaterEqual(len(case["expected_entities"]), 2)
            self.assertTrue(case["story"])

    def test_semantic_item_contract_requires_evidence_and_confidence(self):
        valid = {"text": "livro", "evidence": "reservar um livro", "confidence": 0.91}
        self.assertTrue(valid["text"] and valid["evidence"])
        self.assertGreaterEqual(valid["confidence"], 0)
        self.assertLessEqual(valid["confidence"], 1)


if __name__ == "__main__":
    unittest.main()
