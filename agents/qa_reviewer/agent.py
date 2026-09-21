import json
import re
import unicodedata

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response
from agents.developer.response_validation import validate_qa_output
from agents.qa_engineer.agent import QAEngineer


def _first_json_object(raw):
    text = str(raw or '').strip()
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != '{':
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            continue
    raise ValueError('O revisor de QA retornou JSON inválido.')


def _normalized(value):
    return ' '.join(str(value or '').casefold().split())


class QAReviewer:
    """Regenerates the full QA artifact from the approved Requirement Spec."""

    def __init__(self, project_id):
        self.project_id = project_id

    @staticmethod
    def _document_gaps(markdown):
        section = QAEngineer._extract_section(markdown, 'Lacunas de qualidade')
        return [
            QAEngineer._clean(line.lstrip('-* ').strip())
            for line in section.splitlines()
            if QAEngineer._clean(line.lstrip('-* ').strip())
            and not _normalized(line).startswith('nenhuma lacuna')
        ]

    @staticmethod
    def _decision_criteria(decisions):
        """Turn confirmed QA-review decisions into a traceable test basis.

        DQ identifiers are intentionally distinct from CA identifiers: they
        document behavior confirmed during QA review, while keeping its source
        visible instead of pretending the decision already existed in RA.
        """
        criteria = []
        for index, decision in enumerate(decisions, start=1):
            answer = QAEngineer._clean(decision.get('answer'))
            question = QAEngineer._clean(decision.get('question'))
            normalized = _normalized(f'{question} {answer}')
            if 'log' in normalized and 'auditor' in normalized and ('imut' in normalized or 'editar' in normalized or 'excluir' in normalized):
                text = (
                    'DADO que existe um log de auditoria registrado e um perfil operacional autenticado '
                    'QUANDO tentar editar ou excluir esse log '
                    f'ENTAO {answer}'
                )
            elif any(term in normalized for term in ('retenc', 'anonimiz', 'exclus', 'descarte')):
                text = (
                    'DADO que existem dados pessoais de um comprador e o prazo de retenção aplicável foi encerrado '
                    'QUANDO o processo de retenção executar a anonimização ou exclusão do registro '
                    f'ENTAO {answer}'
                )
            elif any(term in normalized for term in ('cartao', 'cartão', 'cvv', 'pagamento')):
                text = (
                    'DADO que uma compra foi aprovada por um provedor de pagamento externo '
                    'QUANDO a plataforma registrar o resultado do pagamento do pedido '
                    f'ENTAO {answer}'
                )
            else:
                text = (
                    f'DADO o contexto descrito na decisão de QA "{question}" '
                    'QUANDO o usuário realizar a operação explicitamente descrita na decisão '
                    f'ENTAO {answer}'
                )
            criteria.append({'id': f'DQ-{index:02d}', 'text': text, 'decision_question': question, 'decision_answer': answer})
        return criteria

    @staticmethod
    def _keywords(value):
        """Return behavior-bearing words for a lightweight DQ consistency check."""
        normalized = unicodedata.normalize('NFD', str(value or ''))
        normalized = normalized.encode('ascii', 'ignore').decode('ascii').lower()
        ignored = {
            'dado', 'quando', 'entao', 'com', 'para', 'pela', 'pelo', 'uma',
            'que', 'dos', 'das', 'nos', 'nas', 'este', 'essa', 'esse', 'sistema',
            'usuario', 'usuario', 'registro', 'processo', 'dados', 'deve', 'apos',
        }
        return {
            word for word in re.findall(r'[a-z]{4,}', normalized)
            if word not in ignored
        }

    @classmethod
    def _decision_cases_are_aligned(cls, markdown, decision_criteria):
        """Reject a provider draft when a DQ action was paired with another DQ result.

        A common provider failure is retaining the CT identifier while moving its
        pre-condition/action to the neighboring decision.  The document still
        looks complete, but it no longer tests the human decision that it cites.
        """
        if not decision_criteria:
            return True
        cases = {}
        pattern = re.compile(
            r'^###\s*CT[-\s]*\d+\b[^\n]*$([\s\S]*?)(?=^###\s*CT[-\s]*\d+\b|^##\s+|\Z)',
            re.IGNORECASE | re.MULTILINE,
        )
        for match in pattern.finditer(str(markdown or '')):
            body = match.group(1)
            fields = {}
            for field in ('critério relacionado', 'criterio relacionado', 'ação', 'acao', 'resultado esperado'):
                found = re.search(rf'^\s*{re.escape(field)}\s*:\s*(\S.*)$', body, re.IGNORECASE | re.MULTILINE)
                if found:
                    fields[field] = QAEngineer._clean(found.group(1))
            criterion_id = fields.get('critério relacionado') or fields.get('criterio relacionado')
            if criterion_id:
                cases[re.sub(r'\s+', '', criterion_id).upper()] = fields

        for criterion in decision_criteria:
            criterion_id = criterion['id'].upper()
            case = cases.get(criterion_id)
            if not case:
                return False
            _given, expected_action, expected_result = QAEngineer._parse_bdd_criterion(criterion['text'])
            actual_action = case.get('ação') or case.get('acao') or ''
            actual_result = case.get('resultado esperado') or ''
            action_overlap = cls._keywords(expected_action) & cls._keywords(actual_action)
            result_overlap = cls._keywords(expected_result) & cls._keywords(actual_result)
            # One decisive action term and two result terms are enough to allow
            # wording changes, while catching a swapped neighboring decision.
            if len(action_overlap) < 1 or len(result_overlap) < min(2, len(cls._keywords(expected_result))):
                return False
        return True

    def process(self, payload):
        current = str(payload.get('current_artifact') or '').strip()
        requirement_summary = str(payload.get('requirement_summary') or payload.get('source_context') or '').strip()
        requirement_spec = payload.get('requirement_spec') or {}
        findings = payload.get('findings') or []
        instruction = str(payload.get('instruction') or '').strip()
        idea = str(payload.get('idea') or '').strip()
        if not current or not requirement_summary:
            raise ValueError('A revisão de QA exige o artefato atual e o requisito aprovado.')

        criteria = QAEngineer._criteria(requirement_spec, requirement_summary)
        if not criteria:
            raise ValueError('O revisor de QA não pode gerar casos sem critérios de aceite aprovados.')
        gaps = list(dict.fromkeys(
            self._document_gaps(current)
            + QAEngineer._extract_lacunas(requirement_spec)
            + QAEngineer._critical_rule_gaps(requirement_spec, criteria)
        ))
        decisions = [
            {'question': str(item.get('question') or '').strip(), 'answer': str(item.get('answer') or '').strip()}
            for item in (payload.get('decisions') or [])
            if isinstance(item, dict) and str(item.get('question') or '').strip() and str(item.get('answer') or '').strip()
        ]
        decision_criteria = self._decision_criteria(decisions)
        traceable_criteria = criteria + decision_criteria
        answered_gaps = {_normalized(item['question']) for item in decisions}
        unresolved_gaps = [gap for gap in gaps if _normalized(gap) not in answered_gaps]
        # A DQ records a decision collected during QA.  It makes the resulting
        # case traceable, but cannot promote that decision to an approved RA
        # criterion.  Keep the handoff explicit and prevent a false "ready".
        ra_followup_gaps = [
            f"{item['id']}: decisão confirmada em QA deve ser formalizada em critério BDD no requisito antes da liberação para implementação."
            for item in decision_criteria
        ]
        quality_gaps = unresolved_gaps + ra_followup_gaps
        prompt = f"""
Você é um revisor sênior de QA. Regenere o documento COMPLETO de Casos de Validação para uma única story.

Objetivo: corrigir os achados sem perder casos válidos, usando exclusivamente o requisito aprovado como fonte de comportamento.

Regras prioritárias:
1. Preserve casos válidos do documento atual, mas remova duplicações, texto fora do contrato e conteúdo anexado após FIM_DOS_CASOS_DE_VALIDACAO.
2. Todo CT deve apontar para um CA ou DQ existente. Cubra todos os CAs e DQs; CA identifica o requisito aprovado e DQ identifica uma decisão humana confirmada nesta revisão.
3. Separe resultados observáveis independentes em CTs distintos quando puderem falhar separadamente.
4. Não invente endpoint, tela, integração, mensagem, persistência, limite, permissão ou cenário técnico ausente.
5. Cada resposta humana abaixo é uma decisão confirmada de QA. Crie ao menos um CT para seu DQ correspondente e mantenha no conteúdo da decisão apenas o comportamento informado, sem ampliar escopo.
6. O DQ não substitui o requisito: ele mantém a origem da decisão rastreável e deve ser levado ao RA em uma evolução posterior do requisito.
7. Toda lacuna sem resposta deve permanecer aberta. Não invente comportamento além da resposta humana.
8. Use exatamente as seções: Cobertura dos critérios de aceite; Casos de validação; Lacunas de qualidade; Decisão de preparação. Termine exatamente com FIM_DOS_CASOS_DE_VALIDACAO.

Retorne APENAS JSON válido: {{"markdown":"documento Markdown completo", "changes":["resumo"]}}.

Story: {idea}
Requisito aprovado:
{requirement_summary}

Requirement Spec:
{json.dumps(QAEngineer._parse_spec(requirement_spec), ensure_ascii=False)}

Critérios e decisões autorizados:
{json.dumps(traceable_criteria, ensure_ascii=False)}

Lacunas ainda sem decisão:
{json.dumps(unresolved_gaps, ensure_ascii=False)}

Decisões humanas sobre lacunas:
{json.dumps(decisions, ensure_ascii=False)}

Achados do Quality Gate:
{json.dumps(findings, ensure_ascii=False)}

Orientação humana:
{instruction or 'Nenhuma.'}

QA atual:
{current[:16000]}
""".strip()
        result = generate_text_from_llm(
            prompt,
            options_override={'temperature': 0.0, 'num_predict': 1800, 'json_mode': True, 'require_json_object': True},
            use_cache=False,
            task='qa_generation',
        )
        if not result or is_error_text_response(result):
            raise RuntimeError('O revisor de QA não retornou uma resposta válida.')
        parsed = _first_json_object(result)
        markdown = str(parsed.get('markdown') or '').strip()
        canonical = QAEngineer._canonicalize_case_document(markdown, traceable_criteria, quality_gaps)
        used_deterministic_fallback = False
        if not canonical or not self._decision_cases_are_aligned(canonical, decision_criteria):
            # Providers can satisfy the outer JSON contract while varying the
            # inner Markdown labels. The approved BDD criteria remain the
            # source of truth, so recover with the same deterministic QA
            # generator used on provider failure rather than discard a safe
            # repair request.
            # `traceable_criteria` contains one DQ for every confirmed human
            # answer. The deterministic generator creates a DQ -> CT mapping,
            # so only unanswered gaps remain open in the fallback document.
            canonical = QAEngineer._fallback(traceable_criteria, quality_gaps)
            used_deterministic_fallback = True
        expected_ids = [item['id'] for item in traceable_criteria]
        valid, reason = validate_qa_output(canonical, expected_criteria_ids=expected_ids)
        if not valid or not QAEngineer._has_complete_case_contract(canonical):
            raise ValueError(f'A revisão de QA produziu contrato inválido: {reason or "campos incompletos"}.')
        return {
            'markdown': canonical,
            'changes': (
                ['A resposta do revisor foi normalizada deterministicamente a partir dos critérios BDD aprovados.']
                if used_deterministic_fallback
                else (parsed.get('changes') if isinstance(parsed.get('changes'), list) else [])
            ),
            'status': 'proposed',
        }
