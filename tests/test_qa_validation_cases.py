import importlib.util
import sys
import types
import unittest
from pathlib import Path


# Load the QA units without importing the repository-wide agents package, whose
# production bootstrap reads local provider credentials.
ROOT = Path(__file__).resolve().parents[1]
agents_package = types.ModuleType('agents')
agents_package.__path__ = [str(ROOT / 'agents')]
developer_package = types.ModuleType('agents.developer')
developer_package.__path__ = [str(ROOT / 'agents' / 'developer')]
llm_service = types.ModuleType('agents.developer.llm_service')
llm_service.generate_text_from_llm = lambda *_args, **_kwargs: ''
llm_service.is_error_text_response = lambda _value: False
sys.modules.update({
    'agents': agents_package,
    'agents.developer': developer_package,
    'agents.developer.llm_service': llm_service,
})

validation_spec = importlib.util.spec_from_file_location('agents.developer.response_validation', ROOT / 'agents' / 'developer' / 'response_validation.py')
validation_module = importlib.util.module_from_spec(validation_spec)
sys.modules[validation_spec.name] = validation_module
validation_spec.loader.exec_module(validation_module)

qa_spec = importlib.util.spec_from_file_location('agents.qa_engineer.agent', ROOT / 'agents' / 'qa_engineer' / 'agent.py')
qa_module = importlib.util.module_from_spec(qa_spec)
sys.modules[qa_spec.name] = qa_module
qa_spec.loader.exec_module(qa_module)

qa_reviewer_spec = importlib.util.spec_from_file_location('agents.qa_reviewer.agent', ROOT / 'agents' / 'qa_reviewer' / 'agent.py')
qa_reviewer_module = importlib.util.module_from_spec(qa_reviewer_spec)
sys.modules[qa_reviewer_spec.name] = qa_reviewer_module
qa_reviewer_spec.loader.exec_module(qa_reviewer_module)

validate_qa_output = validation_module.validate_qa_output
QAEngineer = qa_module.QAEngineer
QAReviewer = qa_reviewer_module.QAReviewer


SPEC = {
    "acceptanceCriteria": [
        {"id": "CA-01", "text": "Dado um administrador, quando informar dados válidos, então a sala é cadastrada."},
        {"id": "CA-02", "text": "Dado um campo obrigatório ausente, quando tentar salvar, então o sistema bloqueia o cadastro."},
    ],
    "assumptions": [],
}

PRIVACY_SPEC_WITH_UNCOVERED_RULES = {
    "acceptanceCriteria": [
        {"id": "CA-01", "text": "Dado a portaria autorizada, quando consultar o ingresso, entao visualiza somente nome e validade."},
        {"id": "CA-02", "text": "Dado um perfil nao autorizado, quando tentar consultar dados pessoais, entao o acesso e negado."},
        {"id": "CA-03", "text": "Dado uma consulta autorizada, quando ela for processada, entao o sistema gera um log de auditoria."},
    ],
    "businessRules": [
        "Os dados devem ter retencao de 12 meses e depois ser anonimizados ou excluidos com descarte seguro.",
        "Dados de cartao nao sao armazenados pela plataforma.",
        "Toda tentativa de acesso negado deve ser registrada em auditoria.",
        "Logs de auditoria sao imutaveis para perfis operacionais.",
        "O suporte possui acesso temporario e minimo necessario.",
    ],
}


class QaValidationCasesTest(unittest.TestCase):
    def test_fallback_covers_each_persisted_criterion_without_execution_claim(self):
        criteria = QAEngineer._criteria(SPEC)
        result = QAEngineer._fallback(criteria, [])
        valid, reason = validate_qa_output(result, expected_criteria_ids=[item["id"] for item in criteria])
        self.assertTrue(valid, reason)
        self.assertIn("Status: não executado", result)
        self.assertIn("CA-01 -> CT-01", result)
        self.assertIn("CA-02 -> CT-02", result)

    def test_validator_rejects_unknown_or_uncovered_criterion(self):
        result = QAEngineer._fallback(QAEngineer._criteria(SPEC), [])
        result = result.replace("Critério relacionado: CA-02", "Critério relacionado: CA-99")
        valid, reason = validate_qa_output(result, expected_criteria_ids=["CA-01", "CA-02"])
        self.assertFalse(valid)
        self.assertIn("inexistentes", reason)

    def test_validator_rejects_bdd_heading_leaked_into_case_field(self):
        result = QAEngineer._fallback(QAEngineer._criteria(SPEC), [])
        result = result.replace(
            "Resultado esperado: a sala",
            "Resultado esperado: a sala ### Cenario 2 - Vazamento de criterio",
            1,
        )
        valid, reason = validate_qa_output(result, expected_criteria_ids=["CA-01", "CA-02"])
        self.assertFalse(valid)
        self.assertIn("heading de cenário", reason)

    def test_fallback_keeps_real_lacunas_as_review_not_product_behavior(self):
        result = QAEngineer._fallback(QAEngineer._criteria(SPEC), ["Definir política de remoção de salas com reservas futuras."])
        self.assertIn("Status: precisa de revisão", result)
        self.assertIn("Definir política", result)
        self.assertNotIn("falha do backend", result.lower())


    def test_privacy_rules_without_bdd_coverage_block_qa_readiness(self):
        criteria = QAEngineer._criteria(PRIVACY_SPEC_WITH_UNCOVERED_RULES)
        gaps = QAEngineer._critical_rule_gaps(PRIVACY_SPEC_WITH_UNCOVERED_RULES, criteria)
        result = QAEngineer._fallback(criteria, gaps)
        self.assertGreaterEqual(len(gaps), 5)
        self.assertTrue(any("Regra confirmada" in gap for gap in gaps))
        self.assertTrue(any("Tentativa de acesso negado" in gap for gap in gaps))
        self.assertIn("precisa de revis", result.lower())

    def test_reviewer_recovers_when_provider_markdown_cannot_be_canonicalized(self):
        original_generate = qa_reviewer_module.generate_text_from_llm
        qa_reviewer_module.generate_text_from_llm = lambda *_args, **_kwargs: '{"markdown":"# formato invalido"}'
        try:
            result = QAReviewer('project-test').process({
                'current_artifact': '# Casos de validação',
                'requirement_summary': 'Como portaria, quero validar o ingresso.',
                'requirement_spec': SPEC,
                'findings': [],
                'idea': 'Validar ingresso',
            })
        finally:
            qa_reviewer_module.generate_text_from_llm = original_generate

        self.assertIn('CT-01', result['markdown'])
        self.assertIn('CT-02', result['markdown'])
        self.assertIn('normalizada deterministicamente', result['changes'][0])

    def test_reviewer_generates_traceable_case_for_confirmed_qa_decision(self):
        original_generate = qa_reviewer_module.generate_text_from_llm
        qa_reviewer_module.generate_text_from_llm = lambda *_args, **_kwargs: '{"markdown":"# formato invalido"}'
        try:
            result = QAReviewer('project-test').process({
                'current_artifact': '# Casos de validação\n\n## Lacunas de qualidade\n- Imutabilidade dos logs de auditoria sem critério BDD verificável.',
                'requirement_summary': 'Como organizador, quero proteger dados pessoais.',
                'requirement_spec': SPEC,
                'findings': [],
                'decisions': [{
                    'question': 'Imutabilidade dos logs de auditoria sem critério BDD verificável.',
                    'answer': 'Os perfis operacionais não podem editar ou excluir logs; a tentativa é bloqueada e auditada.',
                }],
                'idea': 'Proteger dados pessoais',
            })
        finally:
            qa_reviewer_module.generate_text_from_llm = original_generate

        self.assertIn('Critério relacionado: DQ-01', result['markdown'])
        self.assertIn('editar ou excluir', result['markdown'])
        self.assertIn('Tipo: excecao', result['markdown'])
        self.assertNotIn('Imutabilidade dos logs de auditoria sem critério BDD verificável.', result['markdown'])
        self.assertIn('Status: precisa de revisão', result['markdown'])
        self.assertIn('DQ-01: decisão confirmada em QA deve ser formalizada', result['markdown'])

    def test_reviewer_turns_retention_decision_into_concrete_dq_action(self):
        original_generate = qa_reviewer_module.generate_text_from_llm
        qa_reviewer_module.generate_text_from_llm = lambda *_args, **_kwargs: '{"markdown":"# formato invalido"}'
        try:
            result = QAReviewer('project-test').process({
                'current_artifact': '# Casos de validação',
                'requirement_summary': 'Como comprador, quero consultar pedidos.',
                'requirement_spec': SPEC,
                'findings': [],
                'decisions': [{
                    'question': 'Regra confirmada de retenção sem critério BDD verificável.',
                    'answer': 'Ao fim de 12 meses após o evento, os dados são anonimizados ou excluídos e o processo é auditado.',
                }],
                'idea': 'Consultar pedidos',
            })
        finally:
            qa_reviewer_module.generate_text_from_llm = original_generate

        self.assertIn('processo de retenção executar a anonimização ou exclusão', result['markdown'])
        self.assertNotIn('ação definida nessa decisão', result['markdown'])

    def test_reviewer_rejects_dq_cases_with_action_from_another_decision(self):
        decisions = [
            {
                'question': 'Regra de retenção sem BDD.',
                'answer': 'Os dados expirados são anonimizados ou excluídos e a operação é auditada.',
            },
            {
                'question': 'Regra de cartão sem BDD.',
                'answer': 'A plataforma não armazena número, CVV, validade ou titular do cartão.',
            },
        ]
        criteria = QAReviewer._decision_criteria(decisions)
        swapped_document = QAEngineer._fallback(criteria, []).replace(
            'Ação: o processo de retenção executar a anonimização ou exclusão do registro',
            'Ação: a plataforma registrar o resultado do pagamento do pedido',
            1,
        )
        self.assertFalse(QAReviewer._decision_cases_are_aligned(swapped_document, criteria))


if __name__ == "__main__":
    unittest.main()
