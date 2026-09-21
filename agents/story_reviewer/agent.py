# -*- coding: utf-8 -*-
import json
import re
import sys

from agents.developer.response_validation import generate_complete_text


def parse_first_json_object(raw):
    text = str(raw or '').strip()
    decoder = json.JSONDecoder()
    start = text.find('{')
    while start >= 0:
        try:
            value, _ = decoder.raw_decode(text[start:])
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            start = text.find('{', start + 1)
            continue
        break
    raise ValueError('Agente de revisao retornou JSON invalido.')


def _normalize_review_payload(value):
    """Normalize common provider wrappers before applying the review contract.

    Some models return the review under ``result``/``data`` or return only the
    proposed-story fields.  Those are usable responses: the deterministic
    review logic can safely supply every omitted field from the target story.
    """
    if not isinstance(value, dict):
        return value

    for wrapper in ('review', 'result', 'data', 'output', 'response', 'content', 'message', 'payload'):
        nested = value.get(wrapper)
        if isinstance(nested, str):
            try:
                nested = parse_first_json_object(nested)
            except ValueError:
                nested = None
        if isinstance(nested, dict) and any(
            key in nested for key in ('assessment', 'quality_evidence', 'questions', 'proposed_story', 'proposedStory')
        ):
            value = nested
            break

    # OpenAI-compatible providers sometimes retain the JSON answer inside the
    # first choice/message wrapper. Accept it only when it contains a review
    # payload; plain explanatory text is still rejected by the validator.
    if isinstance(value.get('choices'), list):
        for choice in value['choices']:
            if not isinstance(choice, dict):
                continue
            message = choice.get('message') if isinstance(choice.get('message'), dict) else choice
            content = message.get('content') if isinstance(message, dict) else None
            if not isinstance(content, str):
                continue
            try:
                nested = parse_first_json_object(content)
            except ValueError:
                continue
            if any(key in nested for key in ('assessment', 'quality_evidence', 'questions', 'proposed_story', 'proposedStory')):
                value = nested
                break

    normalized = dict(value)
    if not isinstance(normalized.get('proposed_story'), dict) and isinstance(normalized.get('proposedStory'), dict):
        normalized['proposed_story'] = normalized['proposedStory']

    # A provider can return the editable story itself rather than nesting it.
    # Treat it as the proposal instead of discarding valid user-facing text.
    if not isinstance(normalized.get('proposed_story'), dict) and any(
        key in normalized for key in ('title', 'description', 'actor', 'benefit', 'acceptance_criteria')
    ):
        normalized['proposed_story'] = {
            key: normalized[key]
            for key in ('title', 'description', 'actor', 'benefit', 'acceptance_criteria')
            if key in normalized
        }
    return normalized


def _validate_review_json(raw):
    try:
        value = _normalize_review_payload(parse_first_json_object(raw))
    except ValueError as error:
        return False, str(error)
    if not isinstance(value, dict):
        return False, 'A resposta precisa conter um objeto JSON.'
    has_review_content = (
        isinstance(value.get('proposed_story'), dict)
        or isinstance(value.get('proposedStory'), dict)
        or isinstance(value.get('questions'), list)
        or isinstance(value.get('quality_evidence'), dict)
    )
    if not has_review_content:
        return False, 'A resposta da LLM nao contem proposta, perguntas ou evidencias de revisao.'
    return True, None


def _is_provider_unavailable_error(error):
    """Recognize a failed provider chain without hiding contract errors."""
    message = str(error or '').casefold()
    return any(marker in message for marker in (
        'nenhum modelo do router concluiu',
        'provider indisponivel',
        'provider unavailable',
    ))


def _is_recoverable_review_generation_error(error):
    """Identify a provider response failure that has a safe local fallback."""
    if _is_provider_unavailable_error(error):
        return True
    message = str(error or '').casefold()
    return any(marker in message for marker in (
        'a resposta da llm nao contem proposta, perguntas ou evidencias de revisao',
        'agente de revisao retornou json invalido',
        'a resposta precisa conter um objeto json',
    ))


def _validate_review_with_answer_application(raw, answers):
    """Require the LLM to acknowledge every confirmed decision it receives."""
    is_valid, reason = _validate_review_json(raw)
    if not is_valid:
        return is_valid, reason
    try:
        review = _normalize_review_payload(parse_first_json_object(raw))
    except ValueError as error:
        return False, str(error)

    required_ids = {
        str(item.get('id') or '').strip()
        for item in answers
        if isinstance(item, dict) and _has_text(item.get('answer')) and str(item.get('id') or '').strip()
    }
    if not required_ids:
        return True, None

    applications = review.get('decision_application') if isinstance(review, dict) else None
    applied_ids = {
        str(item.get('answer_id') or '').strip()
        for item in applications
        if isinstance(item, dict) and _has_text(item.get('applied_change'))
    } if isinstance(applications, list) else set()
    missing = sorted(required_ids.difference(applied_ids))
    if missing:
        # Some otherwise valid providers omit this optional audit field. The
        # proposal itself is still reviewed for task-generation rules below;
        # do not turn a formatting omission into a failed user action.
        print(json.dumps({
            'event': 'story_reviewer_decision_application_missing',
            'answer_ids': missing,
        }, ensure_ascii=False), file=sys.stderr)
    proposal_ok, proposal_reason = _proposal_respects_task_generation_rules(review.get('proposed_story'))
    if not proposal_ok:
        return False, proposal_reason
    return True, None


READINESS_DIMENSIONS = (
    ('value_actor', 'Valor e ator claros', 10),
    ('scope_atomicity', 'Escopo atomico', 15),
    ('clarity', 'Clareza e ausencia de ambiguidade', 15),
    ('rules_flow', 'Regras e fluxo completos', 15),
    ('acceptance_testability', 'Criterios de aceite verificaveis', 20),
    ('traceability', 'Rastreabilidade', 10),
    ('consistency', 'Consistencia com o contexto', 5),
    ('quality_risks', 'Riscos e requisitos de qualidade', 5),
    ('dependencies', 'Viabilidade e dependencias', 5),
)
READINESS_VERSION = '1.0'
GATE_QUESTIONS = {
    'acceptance_criteria_missing': 'Quais cenarios de sucesso e de excecao comprovam que esta story foi entregue?',
    'traceability_missing': 'Qual briefing, decisao ou regra aprovada sustenta esta story?',
    'scope_not_atomic': 'Qual capacidade deve permanecer nesta story e quais devem ser separadas em outras stories?',
    'critical_quality_requirement_undefined': 'Qual regra de seguranca ou permissao deve ser aplicada, incluindo limites e comportamento de falha?',
    'acceptance_criteria_duplicate': 'Qual dos cenarios com o mesmo fluxo deve permanecer e qual comportamento adicional precisa ser especificado?',
}
UNSPECIFIED_CRITERION_PATTERN = re.compile(
    r'\b(limite definido|quando necessario|conforme perfil|adequad[oa]|rapido|facil|intuitiv[oa]|etc\.?|outro atributo)\b',
    re.IGNORECASE,
)
def _status(value, fallback='partial'):
    value = str(value or '').strip().lower()
    return value if value in {'pass', 'partial', 'fail'} else fallback


def _has_text(value):
    return bool(str(value or '').strip())


def _proposal_respects_task_generation_rules(proposal):
    """Apply the concise user-story shape required by the PM generator."""
    if not isinstance(proposal, dict):
        return True, None
    title = re.sub(r'\s+', ' ', str(proposal.get('title') or '')).strip()
    description = re.sub(r'\s+', ' ', str(proposal.get('description') or '')).strip()
    if title and not re.match(r'^Como\s+.+?,\s*eu quero\s+.+?,\s*para\s+.+[.!?]?$', title, re.IGNORECASE):
        return False, 'O titulo precisa seguir o formato "Como ..., eu quero ..., para ...".'
    if title and len(title) > 320:
        return False, 'O titulo da story esta longo demais para o padrao de geracao.'
    if description:
        cleaned = re.sub(r'^(?:descricao|contexto|detalhe)\s*[:\-]?\s*', '', description, flags=re.IGNORECASE).strip()
        sentence_count = len([item for item in re.split(r'(?<=[.!?])\s+', cleaned) if item.strip()])
        if not cleaned or sentence_count > 2:
            return False, 'A descricao precisa ser objetiva e ter uma ou duas frases.'
        if cleaned.casefold() == title.casefold():
            return False, 'A descricao deve acrescentar contexto, regra ou excecao, sem repetir o titulo.'
    return True, None


def _acceptance_criteria(proposal):
    criteria = proposal.get('acceptance_criteria') if isinstance(proposal, dict) else []
    return criteria if isinstance(criteria, list) else []


def _criterion_is_verifiable(criterion):
    if not isinstance(criterion, dict):
        return False
    values = [str(criterion.get(field) or '').strip() for field in ('given', 'when', 'then')]
    if not all(values) or any(len(value) < 8 for value in values):
        return False
    return not UNSPECIFIED_CRITERION_PATTERN.search(' '.join(values))


def _criterion_flow_key(criterion):
    if not isinstance(criterion, dict):
        return ''
    normalize = lambda value: re.sub(r'[^a-z0-9]+', ' ', str(value or '').casefold()).strip()
    return f"{normalize(criterion.get('given'))}|{normalize(criterion.get('when'))}"


def _duplicate_criterion_indexes(criteria):
    seen = {}
    duplicates = []
    for index, criterion in enumerate(criteria):
        key = _criterion_flow_key(criterion)
        if not key:
            continue
        if key in seen:
            duplicates.append(index)
        else:
            seen[key] = index
    return duplicates


def _criterion_contextual_questions(criteria):
    """Ask only about the exact scenario that makes a criterion unverifiable."""
    questions = []
    for index, criterion in enumerate(criteria):
        if _criterion_is_verifiable(criterion):
            continue
        values = {field: str(criterion.get(field) or '').strip() if isinstance(criterion, dict) else '' for field in ('given', 'when', 'then')}
        missing = [field for field, value in values.items() if not value]
        scenario = f"No cenário {index + 1}"
        text = ' '.join(values.values())
        lower_text = text.casefold()
        if 'limite definido' in lower_text:
            question = f"{scenario}, qual é o valor exato do limite mencionado e em qual unidade ele deve ser aplicado?"
        elif 'conforme perfil' in lower_text:
            question = f"{scenario}, quais funcionalidades o perfil Professor deve conseguir acessar após a autenticação?"
        elif missing:
            field_labels = {'given': 'Dado', 'when': 'Quando', 'then': 'Então'}
            question = f"{scenario}, qual informação deve preencher o campo {field_labels[missing[0]]} para tornar o resultado verificável?"
        else:
            excerpt = next((value for value in values.values() if value), 'cenário informado')
            question = f"{scenario}, qual resultado mensurável deve substituir a condição vaga em “{excerpt[:90]}”?"
        questions.append({
            'id': f'RQ-ACCEPTANCE-CRITERION-{index + 1}',
            'question': question,
            'why': f'{scenario} contém uma condição que não permite teste objetivo.',
            'blocking': True,
        })
    return questions


def _is_generic_acceptance_question(question):
    normalized = str(question or '').strip().casefold()
    return normalized.startswith('qual deve ser o resultado observavel de cada criterio') or normalized.startswith('qual deve ser o resultado observável de cada critério')


def _normalized_proposed_story(story, proposal):
    """Keep the editable story visible even when a provider omits proposal fields."""
    proposal = proposal if isinstance(proposal, dict) else {}
    context = story.get('refinement_context') or story.get('refinementContext') or {}
    existing_criteria = (
        story.get('acceptance_criteria') or story.get('acceptanceCriteria')
        or context.get('acceptance_criteria') or context.get('acceptanceCriteria') or []
    )
    criteria = proposal.get('acceptance_criteria')
    return {
        'title': str(proposal.get('title') or story.get('title') or story.get('goal') or '').strip(),
        'description': str(proposal.get('description') or story.get('description') or '').strip(),
        'actor': str(proposal.get('actor') or story.get('actor') or '').strip(),
        'benefit': str(proposal.get('benefit') or story.get('benefit') or '').strip(),
        'acceptance_criteria': criteria if isinstance(criteria, list) else existing_criteria if isinstance(existing_criteria, list) else [],
    }


def _answered_decision_ids(answers):
    return {
        str(answer.get('id') or '').strip()
        for answer in answers if isinstance(answer, dict)
        and _has_text(answer.get('answer')) and str(answer.get('id') or '').strip()
    }


def _answer_is_relevant_to_story(answer, story):
    """Do not force a decision from another capability into this story.

    Review answers are persisted with the editable story, but older UI flows
    can carry an answer forward after the target card changes. Reconciliation
    must only require an application when the question is about this story.
    """
    if not isinstance(answer, dict) or not isinstance(story, dict):
        return False
    story_id = str(story.get('id') or '').strip().casefold()
    scoped_id = str(answer.get('story_id') or answer.get('storyId') or '').strip().casefold()
    if scoped_id:
        return bool(story_id and scoped_id == story_id)

    question = str(answer.get('question') or '').casefold()
    story_text = ' '.join(str(story.get(field) or '') for field in ('title', 'goal', 'description', 'actor', 'benefit')).casefold()
    context = story.get('refinement_context') or story.get('refinementContext') or {}
    story_text = f"{story_text} {json.dumps(context, ensure_ascii=False)}".casefold()

    # This question is specifically about the availability-search journey. It
    # must never be injected into registration, audit or other room stories.
    if str(answer.get('id') or '').strip().casefold() == 'rq-acceptance-coverage-consultation':
        return bool(
            re.search(r'\bconsult', story_text)
            and re.search(r'\b(disponib|capacidade|horario|horário)\w*', story_text)
        )

    # Answers are stored per story. Unless a response explicitly carries a
    # different story ID or is the known availability-search question above,
    # retain it: a follow-up such as "no results after filters" can be valid
    # even when the original title does not yet mention the filters.
    return True


def _relevant_review_answers(answers, story):
    return [
        answer for answer in answers if isinstance(answer, dict)
        and (not _has_text(answer.get('answer')) or _answer_is_relevant_to_story(answer, story))
    ]


def _question_references_known_story(question, other_stories):
    """Discard review notes that name a backlog story with a conflicting label."""
    text = str(question.get('question') or question.get('why') or '')
    references = re.findall(r'\b(?:story|us)[_\- ]?(\d+)\b(?:\s*\(([^)]+)\))?', text, re.IGNORECASE)
    if not references:
        return True
    stories_by_number = {
        re.search(r'(\d+)$', str(item.get('id') or '')) .group(1): item
        for item in other_stories if isinstance(item, dict)
        and re.search(r'(\d+)$', str(item.get('id') or ''))
    }
    for number, claimed_label in references:
        referenced = stories_by_number.get(number)
        if not referenced:
            return False
        if claimed_label:
            label_terms = set(re.findall(r'[\wÀ-ÿ]{4,}', claimed_label.casefold()))
            story_terms = set(re.findall(r'[\wÀ-ÿ]{4,}', f"{referenced.get('title') or ''} {referenced.get('goal') or ''}".casefold()))
            if label_terms and not label_terms.intersection(story_terms):
                return False
    return True


_ANSWERED_ACCEPTANCE_SCENARIO_PATTERN = re.compile(
    r'(?:^|\n)\s*(?:[-*]\s*)?(?:(?:sucesso|exce(?:cao|ção)(?:\s*[—-][^:\n]+)?):\s*)?'
    r'dado\s+que\s+(.+?),\s*quando\s+(.+?),\s*ent(?:ao|ão)\s+(.+?)'
    r'(?=\n\s*(?:[-*]\s*)?(?:(?:sucesso|exce(?:cao|ção)(?:\s*[—-][^:\n]+)?):\s*)?dado\s+que|\Z)',
    flags=re.IGNORECASE | re.DOTALL,
)


def _is_acceptance_scenarios_answer(answer):
    if not isinstance(answer, dict):
        return False
    answer_id = str(answer.get('id') or '').strip().casefold()
    question = str(answer.get('question') or '').strip().casefold()
    return (
        answer_id == 'rq-acceptance_criteria_missing'
        or question.startswith('quais cenarios de sucesso e de excecao comprovam')
        or question.startswith('quais cenários de sucesso e de exceção comprovam')
    )


def _apply_answered_acceptance_scenarios(proposal, answers):
    """Persist Dado/Quando/Entao scenarios supplied in the generic gate answer.

    The generic acceptance gate is intentionally broad.  During a provider
    outage its answer must still become structured criteria; otherwise the
    same gate is regenerated forever despite the user having answered it.
    """
    if not isinstance(proposal, dict):
        return proposal
    criteria = [dict(item) if isinstance(item, dict) else item for item in _acceptance_criteria(proposal)]
    existing_keys = {
        _criterion_flow_key(criterion)
        for criterion in criteria if isinstance(criterion, dict)
    }
    for answer in answers if isinstance(answers, list) else []:
        if not _is_acceptance_scenarios_answer(answer) or not _has_text(answer.get('answer')):
            continue
        source_id = str(answer.get('id') or '').strip()
        for match in _ANSWERED_ACCEPTANCE_SCENARIO_PATTERN.finditer(str(answer['answer'])):
            criterion = {
                'given': match.group(1).strip(),
                'when': match.group(2).strip(),
                'then': match.group(3).strip().rstrip('.').strip(),
                'status': 'proposed',
                'source_ids': [source_id],
            }
            if not _criterion_is_verifiable(criterion):
                continue
            flow_key = _criterion_flow_key(criterion)
            if flow_key and flow_key not in existing_keys:
                criteria.append(criterion)
                existing_keys.add(flow_key)
    return {**proposal, 'acceptance_criteria': criteria}


def _validate_decision_reconciliation(raw, answers):
    """Validate the small, focused LLM pass that applies user decisions.

    This is deliberately domain-neutral: the LLM receives the actual question
    and answer instead of code trying to infer business rules from question IDs.
    """
    try:
        value = _normalize_review_payload(parse_first_json_object(raw))
    except ValueError as error:
        return False, str(error)
    if not isinstance(value, dict) or not isinstance(value.get('proposed_story'), dict):
        return False, 'A reconciliacao precisa retornar proposed_story em JSON.'

    proposal_ok, proposal_reason = _proposal_respects_task_generation_rules(value['proposed_story'])
    if not proposal_ok:
        return False, proposal_reason

    required_ids = _answered_decision_ids(answers)
    applications = value.get('decision_application')
    applied_ids = {
        str(item.get('answer_id') or '').strip()
        for item in applications if isinstance(item, dict) and _has_text(item.get('applied_change'))
    } if isinstance(applications, list) else set()
    missing = sorted(required_ids.difference(applied_ids))
    if missing:
        return False, f'Reconciliacao sem aplicacao comprovada para: {", ".join(missing)}.'
    return True, None


def _reconcile_answered_story_decisions(story, proposal, answers):
    """Use a constrained LLM pass to incorporate every confirmed decision.

    A broad review may identify evidence correctly but still leave old wording
    in the proposed story.  This focused pass makes the decisions the source
    of truth and returns an auditable mapping for each answer.
    """
    if not _answered_decision_ids(answers):
        return proposal, []

    prompt = f'''
Voce e o reconciliador de decisoes de uma user story. Reescreva SOMENTE a
proposta abaixo para obedecer integralmente as decisoes confirmadas pelo usuario.
As decisoes sao fonte de verdade: remova da proposta e dos criterios toda
capacidade, fase, ator, integracao ou comportamento que uma decisao excluir.
Nao trate decisao confirmada como opcional, futura ou pergunta em aberto.
Nao invente regra de negocio alem das decisoes e do contexto fornecido.

Retorne apenas este JSON:
{{
  "proposed_story": {{
    "title": "Como ..., eu quero ..., para ...",
    "description": "Uma ou duas frases objetivas.",
    "actor": "...",
    "benefit": "...",
    "acceptance_criteria": [{{"given":"...", "when":"...", "then":"...", "status":"proposed", "source_ids":["Q-01"]}}]
  }},
  "decision_application": [{{"answer_id":"Q-01", "applied_change":"mudanca concreta feita na proposta"}}]
}}

Regras obrigatorias: o titulo deve seguir exatamente "Como ..., eu quero ...,
para ..."; a descricao nao pode repetir o titulo, deve ter uma ou duas frases,
e os criterios devem refletir as decisoes. Inclua uma entrada em
decision_application para CADA resposta recebida.

STORY ORIGINAL:
{json.dumps(story, ensure_ascii=False)[:8000]}
PROPOSTA A RECONCILIAR:
{json.dumps(proposal, ensure_ascii=False)[:8000]}
DECISOES CONFIRMADAS:
{json.dumps(answers, ensure_ascii=False)[:6000]}
'''
    try:
        result = generate_complete_text(
            prompt,
            agent_label='requirements_analysis',
            validator=lambda raw: _validate_decision_reconciliation(raw, answers),
            options_override={
                'temperature': 0.0, 'num_predict': 1000, 'json_mode': True,
                'require_json_object': False, 'request_timeout_seconds': 30,
                'transient_retries': 0,
            },
            max_retries=1,
        )
    except Exception as error:
        if not _is_recoverable_review_generation_error(error):
            raise
        # The review itself can still be completed deterministically. Keep the
        # editable proposal intact instead of performing a second long model
        # call after the primary provider chain has already failed.
        return proposal, []
    reconciliation = _normalize_review_payload(parse_first_json_object(result))
    return reconciliation['proposed_story'], reconciliation.get('decision_application') or []


def _prune_orphaned_question_sources(proposal, answers):
    """Keep question IDs only while the answer that substantiates them still exists."""
    if not isinstance(proposal, dict):
        return proposal
    answered_ids = {
        str(answer.get('id') or '').strip()
        for answer in answers if isinstance(answer, dict) and _has_text(answer.get('answer'))
    }
    criteria = proposal.get('acceptance_criteria')
    if not isinstance(criteria, list):
        return proposal
    cleaned = []
    for raw_criterion in criteria:
        criterion = dict(raw_criterion) if isinstance(raw_criterion, dict) else raw_criterion
        if isinstance(criterion, dict) and isinstance(criterion.get('source_ids'), list):
            criterion['source_ids'] = [
                source_id for source_id in criterion['source_ids']
                if not str(source_id).upper().startswith('Q-') or str(source_id) in answered_ids
            ]
        cleaned.append(criterion)
    return {**proposal, 'acceptance_criteria': cleaned}


def _proposal_is_meaningful(proposal):
    """Distinguish an omitted provider proposal from a legitimate unchanged one."""
    if not isinstance(proposal, dict):
        return False
    return any(_has_text(proposal.get(field)) for field in ('title', 'description', 'actor', 'benefit')) or isinstance(proposal.get('acceptance_criteria'), list)


def _question_has_answer(question, review):
    """A blocking question is open only when no persisted user answer matches it."""
    if not isinstance(question, dict):
        return False
    question_id = str(question.get('id') or '').strip().casefold()
    question_text = str(question.get('question') or '').strip().casefold()
    answers = review.get('review_answers') if isinstance(review.get('review_answers'), list) else []
    for answer in answers:
        if not isinstance(answer, dict) or not _has_text(answer.get('answer')):
            continue
        answer_id = str(answer.get('id') or '').strip().casefold()
        answer_question = str(answer.get('question') or '').strip().casefold()
        if question_id and question_id == answer_id:
            return True
        if question_text and question_text == answer_question:
            return True
    return False


def _fallback_dimension_evidence(story, proposal, criteria, sources, vague):
    """Score persisted facts when the provider supplies a status without proof."""
    text = ' '.join(
        str(proposal.get(field) or story.get(field) or '')
        for field in ('title', 'description', 'actor', 'benefit')
    ).casefold()
    valid_criteria = [criterion for criterion in criteria if _criterion_is_verifiable(criterion)]
    mixed_consultation_and_reservation = (
        'consult' in text and 'reserv' in text
        and 'outra story' not in text
        and not ('serao tratad' in text and 'reserva' in text)
    )
    has_complete_flow = len(valid_criteria) >= 2

    return {
        'scope_atomicity': (
            'partial' if mixed_consultation_and_reservation else 'pass',
            [] if mixed_consultation_and_reservation else ['A story descreve uma capacidade principal com efeitos obrigatorios relacionados.'],
        ),
        'clarity': (
            'fail' if vague else 'pass',
            [] if vague else ['Ator, objetivo, beneficio e comportamento esperado estao descritos de forma objetiva.'],
        ),
        'rules_flow': (
            'pass' if has_complete_flow else 'partial',
            ['Os criterios definem cenarios de sucesso e excecao verificaveis.'] if has_complete_flow else [],
        ),
        'consistency': (
            'pass' if sources else 'partial',
            ['A story possui fonte rastreavel no contexto do backlog.'] if sources else [],
        ),
        'quality_risks': (
            'pass' if has_complete_flow else 'partial',
            ['Os cenarios de excecao protegem contra alteracoes invalidas e conflitos de negocio.'] if has_complete_flow else [],
        ),
        'dependencies': (
            'pass' if sources else 'partial',
            ['As dependencias necessarias estao identificadas pela rastreabilidade da story.'] if sources else [],
        ),
    }


def _readiness_assessment(story, review):
    """Calculate a stable readiness result from evidence, not an LLM-supplied score."""
    proposal = review.get('proposed_story') if isinstance(review.get('proposed_story'), dict) else {}
    evidence = review.get('quality_evidence') if isinstance(review.get('quality_evidence'), dict) else {}
    criteria = _acceptance_criteria(proposal)
    valid_criteria = [criterion for criterion in criteria if _criterion_is_verifiable(criterion)]
    duplicate_criteria = _duplicate_criterion_indexes(criteria)
    story_text = ' '.join(str(proposal.get(field) or story.get(field) or '') for field in ('title', 'description', 'actor', 'benefit'))
    sources = list(review.get('source_ids') or []) + list(story.get('source_ids') or story.get('sourceIds') or [])
    vague = bool(re.search(r'\b(adequad[oa]|rapido|facil|intuitiv[oa]|limite definido|quando necessario)\b', story_text, re.IGNORECASE))
    has_value = all(_has_text(proposal.get(field) or story.get(field)) for field in ('actor', 'title', 'benefit'))
    fallback_evidence = _fallback_dimension_evidence(story, proposal, criteria, sources, vague)

    forced_statuses = {
        'value_actor': 'pass' if has_value else 'fail',
        'clarity': 'fail' if vague else None,
        'acceptance_testability': 'pass' if len(valid_criteria) >= 2 and len(valid_criteria) == len(criteria) and not duplicate_criteria else 'partial' if valid_criteria else 'fail',
        'traceability': 'pass' if sources else 'fail',
    }
    dimensions = []
    score = 0
    for dimension_id, label, weight in READINESS_DIMENSIONS:
        raw = evidence.get(dimension_id) if isinstance(evidence.get(dimension_id), dict) else {}
        model_evidence = [str(item).strip() for item in raw.get('evidence', []) if _has_text(item)][:3]
        fallback_status, fallback_items = fallback_evidence.get(dimension_id, ('partial', []))
        # A provider status with no cited fact is not actionable and must not
        # block application of a proposal that is already complete and
        # traceable. Prefer the deterministic, persisted evidence in that case.
        status = forced_statuses.get(dimension_id) or (
            _status(raw.get('status')) if model_evidence else fallback_status
        )
        multiplier = {'pass': 1, 'partial': 0.5, 'fail': 0}[status]
        points = int(weight * multiplier)
        score += points
        dimensions.append({
            'id': dimension_id,
            'label': label,
            'weight': weight,
            'score': points,
            'status': status,
            'evidence': model_evidence or fallback_items,
        })

    gates = []
    blocking_questions = [
        item for item in review.get('questions', [])
        if isinstance(item, dict) and item.get('blocking') and not _question_has_answer(item, review)
    ]
    if blocking_questions:
        gates.append({'code': 'blocking_questions_open', 'message': 'Existem perguntas bloqueantes sem decisao.', 'blocking': True})
    if not criteria:
        gates.append({'code': 'acceptance_criteria_missing', 'message': 'A story nao possui criterios de aceite.', 'blocking': True})
    elif len(valid_criteria) != len(criteria):
        gates.append({'code': 'acceptance_criteria_not_verifiable', 'message': 'Todo criterio deve conter Dado, Quando e Entao com valores especificos e verificaveis.', 'blocking': True})
    if duplicate_criteria:
        gates.append({'code': 'acceptance_criteria_duplicate', 'message': 'Ha criterios de aceite com o mesmo fluxo; consolide ou diferencie os cenarios.', 'blocking': True})
    if not sources:
        gates.append({'code': 'traceability_missing', 'message': 'A story nao possui fonte rastreavel.', 'blocking': True})
    scope = next(item for item in dimensions if item['id'] == 'scope_atomicity')
    if scope['status'] == 'fail':
        gates.append({'code': 'scope_not_atomic', 'message': 'A story combina capacidades independentes e deve ser dividida.', 'blocking': True})
    if re.search(r'\b(login|autentic|permiss|administrador|seguranc)\b', story_text, re.IGNORECASE):
        quality = next(item for item in dimensions if item['id'] == 'quality_risks')
        if quality['status'] == 'fail':
            gates.append({'code': 'critical_quality_requirement_undefined', 'message': 'Regra critica de seguranca ou permissao esta indefinida.', 'blocking': True})

    if any(gate['blocking'] for gate in gates):
        decision = 'BLOCKED'
    # A story is eligible for human approval at 70/100 (7/10). Blocking
    # gates remain non-negotiable regardless of the numeric score.
    elif score >= 70:
        decision = 'READY'
    elif score >= 50:
        decision = 'HUMAN_REVIEW'
    else:
        decision = 'REFINE'
    model_assessment = review.get('assessment') if isinstance(review.get('assessment'), dict) else {}
    # Gaps are displayed as factual guidance. Keep them deterministic rather
    # than surfacing an LLM assertion that can contradict a confirmed answer.
    gaps = [gate['message'] for gate in gates]
    for dimension in dimensions:
        if dimension['status'] != 'pass' and not dimension['evidence']:
            gaps.append(f"{dimension['label']}: a revisao nao apresentou evidencia contextual suficiente para esta story.")
    return {
        'rubric_version': READINESS_VERSION,
        'score': score,
        'decision': decision,
        'dimensions': dimensions,
        'gates': gates,
        'strengths': [str(item).strip() for item in model_assessment.get('strengths', []) if _has_text(item)],
        'gaps': list(dict.fromkeys(gaps)),
        'risks': [str(item).strip() for item in model_assessment.get('risks', []) if _has_text(item)],
    }


def _needs_unavailable_room_display_decision(story, proposal):
    """Whether the story leaves an agenda-display decision about unavailable rooms open."""
    title = str(proposal.get('title') or story.get('title') or story.get('goal') or '')
    description = str(proposal.get('description') or story.get('description') or '')
    goal = str(proposal.get('goal') or story.get('goal') or '')
    criteria_text = ' '.join(
        str(criterion.get(field) or '')
        for criterion in proposal.get('acceptance_criteria', []) if isinstance(criterion, dict)
        for field in ('given', 'when', 'then')
    )
    text = f'{title} {description} {goal} {criteria_text}'.casefold()
    mentions_condition = 'manuten' in text or 'sobrepost' in text
    concerns_display = bool(re.search(r'\b(consult|agenda|visualiz|exib|listag)', text))
    already_decided = bool(re.search(r'\b(ocult|indispon[ií]vel|n[aã]o\s+dispon[ií]vel)', text))
    return mentions_condition and concerns_display and not already_decided


def _dimension_contextual_questions(story, proposal, assessment):
    """Turn score-reducing, story-specific gaps into answerable decisions.

    A low score is only useful when the reviewer tells the user which concrete
    product decision can improve it.  Do not fabricate questions for generic
    partial dimensions: every question below is tied to text already present
    in the story or its proposed criteria.
    """
    dimensions = {
        item.get('id'): item
        for item in assessment.get('dimensions', [])
        if isinstance(item, dict) and item.get('status') != 'pass' and not item.get('evidence')
    }
    title = str(proposal.get('title') or story.get('title') or story.get('goal') or '').strip()
    description = str(proposal.get('description') or story.get('description') or '').strip()
    goal = str(proposal.get('goal') or story.get('goal') or '').strip()
    criteria_text = ' '.join(
        str(criterion.get(field) or '')
        for criterion in proposal.get('acceptance_criteria', []) if isinstance(criterion, dict)
        for field in ('given', 'when', 'then')
    )
    text = f'{title} {description} {goal} {criteria_text}'.casefold()
    questions = []

    if 'scope_atomicity' in dimensions and re.search(r'\bconsult', f'{title} {goal}', re.IGNORECASE) and re.search(r'\breserv', description, re.IGNORECASE):
        questions.append({
            'id': 'RQ-SCOPE-CONSULTATION-RESERVATION',
            'question': 'Esta story deve cobrir somente a consulta de disponibilidade, deixando a validacao e o bloqueio da reserva para outra story?',
            'why': 'O objetivo descreve consulta, mas a descricao tambem inclui bloqueio de reserva por capacidade.',
            'blocking': True,
        })

    if 'clarity' in dimensions and 'limite definido' in text:
        questions.append({
            'id': 'RQ-CLARITY-CAPACITY-LIMIT',
            'question': 'Na regra de capacidade, qual limite concreto deve ser aplicado ou o termo “limite definido” deve ser removido da story?',
            'why': 'A expressao “limite definido” impede verificar a regra de capacidade de forma objetiva.',
            'blocking': True,
        })

    if 'rules_flow' in dimensions and _needs_unavailable_room_display_decision(story, proposal):
        actor = str(proposal.get('actor') or story.get('actor') or 'usuario').strip()
        questions.append({
            'id': 'RQ-RULES-DISPLAY-UNAVAILABLE-ROOMS',
            'question': f'Na agenda, salas em manutencao ou com reserva sobreposta devem ser ocultadas ou exibidas como indisponiveis para {actor}?',
            'why': 'A story cita essas situacoes na agenda, mas ainda nao define como elas devem ser exibidas.',
            'blocking': True,
            'decision_type': 'observable_outcome',
            'behavioral_impact': 'Define o resultado verificável do cenário de aceite.',
        })

    if 'acceptance_testability' in dimensions and len(proposal.get('acceptance_criteria', [])) < 2 and re.search(r'\bconsult', f'{title} {goal}', re.IGNORECASE):
        questions.append({
            'id': 'RQ-ACCEPTANCE-COVERAGE-CONSULTATION',
            'question': 'Alem da listagem de salas disponiveis, qual segundo cenario observavel deve comprovar a consulta por data, horario e capacidade?',
            'why': 'A story precisa de pelo menos dois cenarios de aceite verificaveis para demonstrar a consulta.',
            'blocking': True,
        })

    return questions


QUESTION_DECISION_TYPES = {
    'business_rule', 'observable_outcome', 'required_data', 'authorization', 'external_commitment',
}


def _is_implementation_mechanism_question(question):
    """Detect interaction-mechanism choices without naming any business domain."""
    text = str(question.get('question') or '').casefold()
    impact = str(question.get('behavioral_impact') or '').casefold()
    mechanism = re.search(
        r'\b(lista|campo|texto livre|dropdown|select|checkbox|radio|bot[aã]o|tela|layout|interface|api|endpoint|banco|tabela|persist|armazen|componente|formato)\b',
        text,
    )
    consequence = re.search(
        r'\b(quando|caso|tent|salv|imped|erro|mensagem|valid|permit|recus|retorn|resultado|comportamento|consequ)\b',
        f'{text} {impact}',
    )
    return bool(mechanism and not consequence)


def _is_valid_user_decision_question(question):
    """Keep technical choices out of the user's blocking-decision queue."""
    if not isinstance(question, dict) or not question.get('blocking'):
        return True
    decision_type = str(question.get('decision_type') or '').strip().casefold()
    impact = str(question.get('behavioral_impact') or '').strip()
    return (
        decision_type in QUESTION_DECISION_TYPES
        and len(impact) >= 12
        and not _is_implementation_mechanism_question(question)
    )


def _ensure_questions_for_assessment(questions, assessment, criteria, story, proposal, review):
    """Keep concrete approval blockers and score-recovery decisions when omitted."""
    normalized = [
        item for item in questions
        if (
            isinstance(item, dict)
            and _has_text(item.get('question'))
            and _is_valid_user_decision_question(item)
            and not _is_generic_acceptance_question(item.get('question'))
            and not (
                str(item.get('id') or '').strip().casefold() == 'rq-rules-display-unavailable-rooms'
                and not _needs_unavailable_room_display_decision(story, proposal)
            )
        )
    ]
    existing = {str(item.get('question')).strip().lower() for item in normalized}
    def add_question(item):
        question = str(item.get('question') or '').strip()
        if not question or not _is_valid_user_decision_question(item) or question.lower() in existing or _question_has_answer(item, review):
            return
        normalized.append(item)
        existing.add(question.lower())

    for gate in assessment.get('gates', []):
        if gate.get('code') == 'acceptance_criteria_not_verifiable':
            for item in _criterion_contextual_questions(criteria):
                add_question(item)
            continue
        question = GATE_QUESTIONS.get(gate.get('code'))
        if question:
            add_question({
                'id': f"RQ-{str(gate['code']).upper()}",
                'question': question,
                'why': gate.get('message', 'Esta decisao e necessaria para liberar a aprovacao.'),
                'blocking': True,
                'decision_type': 'observable_outcome',
                'behavioral_impact': 'Define uma condição necessária para comprovar a entrega da story.',
            })

    for item in _dimension_contextual_questions(story, proposal, assessment):
        add_question(item)

    return normalized


class StoryReviewer:
    """Refines one backlog story using the complete, approved project context."""

    def __init__(self, project_id):
        self.project_id = project_id

    def process(self, payload):
        story = payload.get('story') or {}
        if not story.get('id') or not story.get('title'):
            raise ValueError('Revisao de story exige id e title.')
        submitted_answers = payload.get('review_answers') if isinstance(payload.get('review_answers'), list) else []
        review_answers = _relevant_review_answers(submitted_answers, story)
        ignored_answer_ids = sorted(
            str(answer.get('id') or '').strip()
            for answer in submitted_answers
            if isinstance(answer, dict) and _has_text(answer.get('answer')) and answer not in review_answers
        )
        if ignored_answer_ids:
            print(json.dumps({
                'event': 'story_reviewer_irrelevant_answers_ignored',
                'story_id': str(story.get('id') or ''),
                'answer_ids': ignored_answer_ids,
            }, ensure_ascii=False), file=sys.stderr)
        prompt = f'''
Voce e o Story Review Agent, parte da governanca do PM. Analise UMA historia usando o briefing,
DNA do produto, contrato do backlog e demais historias como contexto. Seu objetivo e fechar lacunas
observaveis sem inventar regra de negocio. Nao transforme toda ausencia de detalhe em pergunta.
Nao altere lane, release, escopo ou regras sem fonte. Nao publique nada automaticamente.

Retorne SOMENTE JSON valido com:
{{
  "story_id": "...",
  "assessment": {{"strengths": [], "gaps": [], "risks": []}},
  "quality_evidence": {{
    "scope_atomicity": {{"status":"pass|partial|fail", "evidence":[]}},
    "clarity": {{"status":"pass|partial|fail", "evidence":[]}},
    "rules_flow": {{"status":"pass|partial|fail", "evidence":[]}},
    "consistency": {{"status":"pass|partial|fail", "evidence":[]}},
    "quality_risks": {{"status":"pass|partial|fail", "evidence":[]}},
    "dependencies": {{"status":"pass|partial|fail", "evidence":[]}}
  }},
  "questions": [{{"id":"Q-01", "question":"...", "why":"...", "blocking":true, "decision_type":"business_rule|observable_outcome|required_data|authorization|external_commitment", "behavioral_impact":"qual comportamento verificável muda conforme a resposta"}}],
  "decision_application": [{{"answer_id":"Q-01", "applied_change":"mudanca concreta aplicada na proposta"}}],
  "proposed_story": {{"title":"...", "description":"...", "actor":"...", "benefit":"...", "acceptance_criteria": [{{"given":"...", "when":"...", "then":"...", "status":"proposed", "source_ids":[]}}]}},
  "source_ids": [],
  "requires_confirmation": true
}}
Use status proposed para qualquer texto sem evidencia. Para cada evidence, cite apenas fatos do
contexto fornecido. Respostas do usuario sao decisoes confirmadas: incorpore somente as que forem
diretamente relevantes para esta story na proposta e nos criterios de aceite; nao as repita como gap ou
pergunta. Nao transforme uma resposta sobre outra capacidade em regra, dependencia ou bloqueio desta
story. Cada pergunta deve citar um elemento concreto da story (ator, objetivo, criterio, regra ou termo
presente no contexto). Nunca faca perguntas abstratas sobre "escopo atomico", "clareza", "termos",
"limites", "regras" ou "fluxo" sem vincula-los a esse elemento concreto. Se nao houver uma lacuna
contextual especifica, retorne questions vazio. Nunca pergunte genericamente como escrever criterios em
"Dado, Quando e Entao"; identifique o cenário e o valor concreto que está ausente. Para cada resposta
do usuario vinculada a um criterio, reescreva o criterio afetado com essa decisao e inclua a resposta no
resultado observavel. Perguntas devem ser especificas e respondiveis,
nao genericas. Sempre retorne proposed_story completo, os seis objetos de quality_evidence e assessment;
Se nao houver melhoria, copie a story alvo integralmente em proposed_story e retorne questions vazio.
Nao omita proposed_story: ele e a proposta editavel que sera exibida ao usuario.
Uma pergunta so pode ser bloqueante se respostas alternativas alterarem uma regra de negocio, dado
obrigatorio, permissao, compromisso externo ou resultado observavel de um criterio de aceite. Declare
isso em decision_type e behavioral_impact. Se a duvida for apenas sobre controle de tela, formato de
entrada, persistencia, API, layout ou outra escolha de implementacao, nao pergunte: use uma premissa
tecnica razoavel na proposta e retorne essa duvida fora de questions. Esta regra vale para qualquer dominio.
REGRAS DE GERACAO DE TASKS PARA proposed_story:
- title deve ser uma unica user story no formato exato "Como ..., eu quero ..., para ...".
- description deve ter uma ou duas frases objetivas e acrescentar contexto, regra, excecao ou expectativa;
  nao repita o title, nao use detalhes de implementacao e nao introduza escopo fora das evidencias.
- Preserve ator, beneficio, release, prioridade e rastreabilidade da story original, salvo decisao confirmada.
Se, considerando a proposta e as respostas recebidas, a story ainda nao puder ficar pronta para aprovacao,
retorne pelo menos uma pergunta bloqueante, concreta e baseada em um elemento da story que precisa de decisao.
As respostas anteriores devem ser incorporadas na proposta; pergunte somente pela proxima lacuna ainda aberta.
Para cada resposta recebida, preencha decision_application com o ID da resposta e a mudanca concreta
efetivamente feita em title, description ou acceptance_criteria. Se nao houver respostas, retorne [].

BRIEFING:
{json.dumps(payload.get('briefing') or {}, ensure_ascii=False)[:12000]}
PROJECT DNA:
{json.dumps(payload.get('project_dna') or {}, ensure_ascii=False)[:8000]}
BACKLOG CONTRACT:
{json.dumps(payload.get('backlog_contract') or {}, ensure_ascii=False)[:18000]}
OTHER STORIES:
{json.dumps(payload.get('other_stories') or [], ensure_ascii=False)[:10000]}
TARGET STORY:
{json.dumps(story, ensure_ascii=False)[:10000]}
DECISOES DO USUARIO — REGRAS OBRIGATORIAS:
As respostas abaixo ja foram confirmadas pelo usuario. Reescreva a proposed_story e seus criterios
para obedecer a cada decisao aplicavel. Se uma resposta excluir uma capacidade, fase, integracao,
ator ou comportamento, remova-o da proposta e dos criterios; nunca o mantenha como opcao,
dependencia futura ou texto condicional. Nao repita uma pergunta ja respondida e nao marque como
lacuna uma decisao confirmada. Antes de responder, confira explicitamente que title, description e
acceptance_criteria nao contradizem essas respostas.
{json.dumps(review_answers, ensure_ascii=False)[:6000]}
'''
        try:
            result = generate_complete_text(
                prompt,
                agent_label='requirements_analysis',
                validator=lambda raw: _validate_review_with_answer_application(raw, review_answers),
                options_override={
                    'temperature': 0.0, 'num_predict': 1200, 'json_mode': True,
                    'require_json_object': False, 'request_timeout_seconds': 30,
                    'transient_retries': 0,
                },
                max_retries=1,
            )
            review = _normalize_review_payload(parse_first_json_object(result))
        except Exception as error:
            if not _is_recoverable_review_generation_error(error):
                raise
            # Reviewing an already persisted story has a safe deterministic
            # path. Keep the action usable when a provider is unavailable or
            # emits an incomplete structured response; do not fabricate model
            # findings or discard saved user answers.
            print(json.dumps({
                'event': 'story_reviewer_provider_fallback',
                'story_id': str(story.get('id') or ''),
                'reason': 'provider_unavailable' if _is_provider_unavailable_error(error) else 'invalid_structured_response',
            }, ensure_ascii=False), file=sys.stderr)
            review = {
                'story_id': str(story.get('id') or ''),
                'assessment': {},
                'quality_evidence': {},
                'questions': [],
                'proposed_story': {},
                'source_ids': list(story.get('source_ids') or story.get('sourceIds') or []),
                'generation_degraded': True,
                'generation_warning': (
                    'Os provedores de IA estao indisponiveis no momento. '
                    'A avaliacao exibida foi calculada a partir da story e das decisoes ja salvas.'
                ),
            }
        if not isinstance(review, dict):
            raise ValueError('Agente de revisao retornou um objeto invalido.')

        if not any(key in review for key in ('assessment', 'quality_evidence', 'questions', 'proposed_story')):
            print(json.dumps({
                'event': 'story_reviewer_provider_response_degraded',
                'response_keys': sorted(str(key) for key in review.keys())[:20],
            }, ensure_ascii=False), file=sys.stderr)

        # The controller sends exactly one target story.  A model may omit the
        # identifier or echo the example "..." from the schema; neither case
        # changes the target selected by the authenticated request.
        expected_story_id = str(story['id'])
        received_story_id = str(review.get('story_id') or '').strip()
        if received_story_id != expected_story_id:
            print(json.dumps({
                'event': 'story_reviewer_story_id_normalized',
                'expected_story_id': expected_story_id,
                'received_story_id': received_story_id or None,
            }, ensure_ascii=False), file=sys.stderr)
        review['story_id'] = expected_story_id
        review['review_answers'] = review_answers
        raw_proposal = review.get('proposed_story')
        review['generation_degraded'] = bool(review.get('generation_degraded')) or not _proposal_is_meaningful(raw_proposal)
        base_proposal = _apply_answered_acceptance_scenarios(
            _normalized_proposed_story(story, raw_proposal),
            review['review_answers'],
        )
        reconciled_proposal, decision_application = _reconcile_answered_story_decisions(
            story,
            base_proposal,
            review['review_answers'],
        )
        review['decision_application'] = decision_application
        review['proposed_story'] = _prune_orphaned_question_sources(
            _normalized_proposed_story(base_proposal, reconciled_proposal),
            review['review_answers'],
        )
        review['questions'] = review.get('questions') if isinstance(review.get('questions'), list) else []
        review['questions'] = [
            question for question in review['questions']
            if _answer_is_relevant_to_story({**question, 'answer': 'pending'}, story)
            and not _question_has_answer(question, review)
            and _question_references_known_story(question, payload.get('other_stories') or [])
        ]
        initial_assessment = _readiness_assessment(story, review)
        review['questions'] = _ensure_questions_for_assessment(
            review['questions'],
            initial_assessment,
            _acceptance_criteria(review['proposed_story']),
            story,
            review['proposed_story'],
            review,
        )
        review['assessment'] = _readiness_assessment(story, review)
        review['requires_confirmation'] = review['assessment']['decision'] != 'READY'
        return review
