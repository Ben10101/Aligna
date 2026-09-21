import json
import re
import unicodedata

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response


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
    raise ValueError('O revisor de requisitos retornou JSON inválido.')


def _normalized(text):
    """Lowercase, accent-insensitive representation used by deterministic guards."""
    decomposed = unicodedata.normalize('NFD', str(text or '').casefold())
    return ''.join(char for char in decomposed if not unicodedata.combining(char))


def _canonical_section_title(title):
    normalized = re.sub(r'^\d+[.)]\s*', '', _normalized(title)).strip(' :')
    if normalized.startswith('historia') or 'user story' in normalized:
        return 'Historia e objetivo'
    if 'comportamento' in normalized and ('regra' in normalized or 'confirmad' in normalized):
        return 'Comportamento e regras confirmadas'
    if 'cenario' in normalized and ('aceite' in normalized or 'aceitacao' in normalized):
        return 'Cenarios de aceite'
    if ('decis' in normalized and ('pendent' in normalized or 'abert' in normalized)) or 'pendencia' in normalized:
        return 'Decisoes pendentes'
    if normalized in {'status', 'situacao'}:
        return 'Status'
    return None


def _canonicalize_section_titles(markdown):
    def replace(match):
        canonical = _canonical_section_title(match.group(1))
        return f'## {canonical}' if canonical else match.group(0)

    # Some providers return top-level sections as # or ### despite the
    # requested ## convention. Convert only headings that map to our known
    # contract; BDD headings such as "### Cenario 1" are left untouched.
    return re.sub(r'^#{1,3}\s+(.+?)\s*$', replace, str(markdown or ''), flags=re.MULTILINE)


def _sections(markdown):
    return {
        _normalized(item).strip(' :')
        for item in re.findall(r'^##\s+(.+?)\s*$', _canonicalize_section_titles(markdown), re.MULTILINE)
    }


def _section_content(markdown, title):
    canonical = _canonicalize_section_titles(markdown)
    match = re.search(
        rf'^##\s+{re.escape(title)}\s*$\n([\s\S]*?)(?=^##\s+|\Z)',
        canonical,
        re.MULTILINE,
    )
    return match.group(1).strip() if match else ''


def _restore_missing_history(markdown, current):
    """Keep the established story section when a provider omits its heading."""
    normalized = _canonicalize_section_titles(markdown)
    if 'historia e objetivo' in _sections(normalized):
        return normalized
    history = _section_content(current, 'Historia e objetivo')
    if not history:
        return normalized
    first_section = re.search(r'^##\s+', normalized, re.MULTILINE)
    restored = f'## Historia e objetivo\n\n{history}'
    if not first_section:
        return f'{normalized.rstrip()}\n\n{restored}'.strip()
    before = normalized[:first_section.start()].rstrip()
    after = normalized[first_section.start():].lstrip()
    return f'{before}\n\n{restored}\n\n{after}'.strip()


def _validate_scope_preservation_base(current, source, markdown):
    """Reject independent journeys that were not part of the reviewed story."""
    established_scope = _normalized(f'{current}\n{source}')
    proposed_scope = _normalized(markdown)
    independent_journeys = {
        'exportação ou download de dados': ('export', 'csv', 'pdf', 'download'),
        'integração externa': ('webhook', 'api externa', 'integracao externa'),
    }
    # PDF is a document format; it does not, by itself, imply exporting or downloading data.
    independent_journeys = {
        label: tuple(cue for cue in cues if cue != 'pdf')
        for label, cues in independent_journeys.items()
    }
    introduced = [
        label
        for label, cues in independent_journeys.items()
        if any(cue in proposed_scope for cue in cues)
        and not any(cue in established_scope for cue in cues)
    ]
    if introduced:
        raise ValueError(
            'A revisão introduz uma jornada independente fora do escopo da task '
            f'({", ".join(introduced)}). Registre essa decisão para o PM/backlog.'
        )


def _validate_scope_preservation(current, source, markdown, decisions=None):
    """Add the triggering decision to scope-guard failures when available."""
    try:
        _validate_scope_preservation_base(current, source, markdown)
    except ValueError as error:
        established_scope = _normalized(f'{current}\n{source}')
        proposed_scope = _normalized(markdown)
        cues = ('export', 'csv', 'pdf', 'download', 'webhook', 'api externa', 'integracao externa')
        detected = next((cue for cue in cues if cue in proposed_scope and cue not in established_scope), None)
        if not detected:
            raise
        question = next((
            str(item.get('question') or '').strip()
            for item in (decisions or [])
            if detected in _normalized(f"{item.get('question', '')}\n{item.get('answer', '')}")
        ), None)
        detail = f' Termo detectado: "{detected}".'
        if question:
            detail += f' Pergunta relacionada: "{question}".'
        raise ValueError(f'{error}{detail}') from error


def _count_structured_bdd_scenarios(markdown):
    normalized = _normalized(markdown)
    headers = list(re.finditer(r'^###\s+cenario\b[^\n]*$', normalized, re.MULTILINE))
    count = 0
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(normalized)
        scenario = normalized[header.start():end]
        if all(re.search(rf'\b{keyword}\b', scenario) for keyword in ('dado', 'quando', 'entao')):
            count += 1
    return count


def _validate_markdown(markdown, decisions):
    required = {
        'historia e objetivo', 'comportamento e regras confirmadas',
        'cenarios de aceite', 'decisoes pendentes', 'status',
    }
    sections = _sections(markdown)
    missing = required.difference(sections)
    if missing:
        raise ValueError(
            f'Revisão de requisitos sem seções obrigatórias: {", ".join(sorted(missing))}. '
            f'Títulos recebidos: {", ".join(sorted(sections)) or "nenhum"}.'
        )
    normalized = _normalized(markdown)
    if not all(token in normalized for token in ('dado', 'quando', 'entao')):
        raise ValueError('Revisão de requisitos sem cenário BDD verificável.')
    if not _count_structured_bdd_scenarios(markdown):
        raise ValueError('Revisão de requisitos sem cenário BDD estruturado como "### Cenario N".')
    for decision in decisions:
        answer = str(decision.get('answer') or '').strip()
        if answer and re.search(rf'^\s*[-*]\s*{re.escape(answer)}\s*\.?\s*$', markdown, re.IGNORECASE | re.MULTILINE):
            question = str(decision.get('question') or '').strip()
            raise ValueError(
                'Uma resposta de decisão foi copiada como regra sem contexto.'
                f' Pergunta relacionada: "{question}". Resposta copiada: "{answer}".'
            )


class RequirementsReviewer:
    """Regenerates the complete RA artifact from confirmed review decisions."""

    def __init__(self, project_id):
        self.project_id = project_id

    def process(self, payload):
        current = str(payload.get('current_artifact') or '').strip()
        source = str(payload.get('source_context') or '').strip()
        decisions = [
            {'question': str(item.get('question') or '').strip(), 'answer': str(item.get('answer') or '').strip()}
            for item in (payload.get('decisions') or [])
            if isinstance(item, dict) and str(item.get('question') or '').strip() and str(item.get('answer') or '').strip()
        ]
        if not current or not decisions:
            raise ValueError('A regeneração de requisitos exige artefato atual e decisões respondidas.')
        prompt = f"""
Você é um revisor sênior de requisitos. Regenere o documento de requisitos COMPLETO.

Objetivo: incorporar as decisões humanas abaixo sem perder fatos, regras e cenários válidos do documento atual.

Regras prioritárias:
1. Cada decisão é uma fonte de verdade, mas resposta curta nunca pode aparecer isolada como bullet. Combine pergunta e resposta em uma regra completa, com sujeito, condição e efeito observável.
2. Preserve o escopo e todo comportamento válido já documentado. Remova somente perguntas resolvidas, duplicações e contradições.
3. Para cada decisão que altera comportamento, crie ou atualize um cenário BDD concreto. Todo cenário DEVE ter um subtítulo no formato exato "### Cenario N - titulo" e, logo abaixo, conter DADO, QUANDO e ENTAO.
4. Não invente mensagens, permissões, limites, integrações ou fatos ausentes.
5. Se uma decisão pedir uma jornada independente do objetivo atual, como exportação, download, integração ou novo fluxo, NÃO a incorpore. Registre-a em scope_escalations para o PM/backlog.
Um PDF enviado pelo comprador como anexo é um formato de documento, não uma jornada de exportação ou download.
6. Use exatamente as seções: Historia e objetivo; Comportamento e regras confirmadas; Cenarios de aceite; Decisoes pendentes; Status.
7. Não retorne respostas cruas como "90 dias", "não" ou "somente essas informações". Contextualize-as.

Responda APENAS JSON válido: {{"markdown":"documento Markdown completo", "changes":["resumo"], "scope_escalations":[{{"question":"decisão fora de escopo", "reason":"motivo"}}]}}.
Se houver scope_escalations, não tente acomodar essa decisão no documento.

Fonte da task:
{source}

Decisões humanas confirmadas:
{json.dumps(decisions, ensure_ascii=False)}

Documento atual:
{current[:16000]}
"""
        result = generate_text_from_llm(
            prompt,
            options_override={'temperature': 0.0, 'num_predict': 1800, 'json_mode': True, 'require_json_object': True},
            use_cache=False,
            task='requirements_analysis',
        )
        if not result or is_error_text_response(result):
            raise RuntimeError('O revisor de requisitos não retornou uma resposta válida.')
        parsed = _first_json_object(result)
        markdown = _restore_missing_history(str(parsed.get('markdown') or '').strip(), current)
        scope_escalations = parsed.get('scope_escalations')
        if isinstance(scope_escalations, list) and scope_escalations:
            reason = str((scope_escalations[0] or {}).get('reason') or '').strip()
            decisions_text = _normalized('\n'.join(
                f"{item.get('question', '')}\n{item.get('answer', '')}" for item in decisions
            ))
            reason_text = _normalized(reason)
            is_pdf_format_false_positive = (
                'pdf' in reason_text
                and not any(cue in decisions_text for cue in ('export', 'download', 'csv'))
            )
            if not is_pdf_format_false_positive:
                raise ValueError(
                    'Uma decisão amplia o escopo da task e precisa seguir para o PM/backlog.'
                    + (f' Motivo informado: {reason}' if reason else '')
                )
        _validate_scope_preservation(current, source, markdown, decisions)
        _validate_markdown(markdown, decisions)
        return {
            'markdown': markdown,
            'changes': parsed.get('changes') if isinstance(parsed.get('changes'), list) else [],
            'status': 'proposed',
        }
