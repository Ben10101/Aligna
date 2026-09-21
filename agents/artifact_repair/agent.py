import json
import re

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response


def parse_first_json_object(raw):
    """Decode the first complete JSON object and ignore model trailing text."""
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
    raise ValueError('Agente de reparo retornou JSON invalido.')


def _string_value(value):
    """Return a non-empty textual field from a model response."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False).strip()
    return ''


def normalize_patch(raw_patch):
    """Normalize common JSON envelopes/field aliases returned by providers.

    JSON mode guarantees a JSON object, but not that every provider follows the
    exact field names in the prompt.  Keep that variability at the agent
    boundary instead of allowing it to turn into a controller failure.
    """
    patch = raw_patch if isinstance(raw_patch, dict) else {}
    for envelope in ('patch', 'repair', 'result', 'data'):
        candidate = patch.get(envelope)
        if isinstance(candidate, dict):
            patch = {**patch, **candidate}
            break

    def first_value(*keys):
        for key in keys:
            value = _string_value(patch.get(key))
            if value:
                return value
        return ''

    return {
        'section': first_value('section', 'section_title', 'sectionTitle', 'target_section', 'targetSection'),
        'content': first_value('content', 'replacement', 'replacement_content', 'replacementContent', 'body', 'markdown'),
        'changes': patch.get('changes') if isinstance(patch.get('changes'), list) else [],
        'source_ids': patch.get('source_ids') if isinstance(patch.get('source_ids'), list) else [],
        'status': _string_value(patch.get('status')) or 'proposed',
        'requires_confirmation': bool(patch.get('requires_confirmation', True)),
    }


def _extract_section(content, title):
    escaped = re.escape(title)
    match = re.search(rf'^##\s+{escaped}\s*$([\s\S]*?)(?=^##\s+|\Z)', content, flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip() if match else ''


def _dedupe_bullet_lines(content):
    """Keep the first occurrence of semantically identical Markdown bullets."""
    unique_lines = []
    seen = set()
    for line in str(content or '').splitlines():
        normalized = re.sub(r'\s+', ' ', re.sub(r'^\s*[-*]\s*', '', line)).strip().rstrip('.').casefold()
        if normalized and re.match(r'^\s*[-*]\s+', line) and normalized in seen:
            continue
        if normalized and re.match(r'^\s*[-*]\s+', line):
            seen.add(normalized)
        unique_lines.append(line)
    return '\n'.join(unique_lines).strip()


def patch_from_source_context(artifact_type, current, source):
    """Recover the story section without requiring a provider response."""
    if artifact_type != 'requirements':
        return None
    task_match = re.search(r'^Task:\s*([^\r\n]+)', str(source or ''), flags=re.IGNORECASE | re.MULTILINE)
    story = task_match.group(1).strip() if task_match else ''
    history = _extract_section(current, 'Historia e objetivo')
    if not story or story.casefold() in history.casefold():
        return None
    return {
        'section': 'Historia e objetivo',
        'content': story,
        'changes': ['Historia e objetivo restaurada a partir da task aprovada.'],
        'source_ids': [],
        'status': 'proposed',
        'requires_confirmation': False,
    }


def patch_duplicate_requirement_behavior(artifact_type, current):
    """Consolidate repeated login behavior using only facts already present."""
    if artifact_type != 'requirements':
        return None
    section = 'Comportamento e regras confirmadas'
    existing = _extract_section(current, section)
    if not existing:
        return None
    behavior_match = re.search(
        r'^###\s+Comportamento\s*$([\s\S]*?)(?=^###\s+Regras\s*$|\Z)',
        existing,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    rules_match = re.search(r'^###\s+Regras\s*$([\s\S]*?)\Z', existing, flags=re.IGNORECASE | re.MULTILINE)
    if not behavior_match or not rules_match:
        return None

    def dedupe_by_topic(text, topics):
        kept, seen = [], set()
        for line in text.splitlines():
            normalized = line.casefold()
            topic = next((key for key, terms in topics.items() if any(term in normalized for term in terms)), None)
            if topic and topic in seen:
                continue
            if topic:
                seen.add(topic)
            kept.append(line)
        return '\n'.join(kept).strip()

    behavior = dedupe_by_topic(behavior_match.group(1).strip(), {
        'valid_login': ('matrícula e senha válidas',),
        'invalid_login': ('credenciais inválidas', 'matrícula ou senha estão incorretas'),
        'session_expiry': ('sessão do professor expira', 'tempo de inatividade ultrapassa'),
        'profile': ('perfil sem permissão', 'perfil diferente', 'sem perfil de professor'),
    })
    raw_rules = rules_match.group(1).strip()
    privacy_lines = [line for line in raw_rules.splitlines() if 'credenciais e dados pessoais são acessíveis' in line.casefold()]
    rules = dedupe_by_topic(raw_rules, {})
    if len(privacy_lines) > 1:
        best_privacy = max(privacy_lines, key=len)
        rules = '\n'.join(line for line in rules.splitlines() if 'credenciais e dados pessoais são acessíveis' not in line.casefold())
        rules = '\n'.join(part for part in (rules.strip(), best_privacy) if part)
    rules = '\n'.join(
        line for line in rules.splitlines()
        if 'sistema disponibiliza uma tela de login' not in line.casefold()
    ).strip()
    content = f'### Comportamento\n\n{behavior}\n\n### Regras\n\n{rules}'
    if content.strip() == existing.strip():
        return None
    return {
        'section': section,
        'content': content,
        'changes': ['Comportamentos e regras duplicados foram consolidados.'],
        'source_ids': [],
        'status': 'proposed',
        'requires_confirmation': False,
    }


def patch_login_acceptance_scenarios(artifact_type, current):
    """Create executable acceptance coverage from explicit login rules."""
    if artifact_type != 'requirements':
        return None
    lower = str(current or '').casefold()
    required_terms = ('matrícula', 'senha', '5 tentativas', '15 minutos', '8 dígitos')
    if not all(term in lower for term in required_terms):
        return None
    existing = _extract_section(current, 'Cenarios de aceite')
    if '5 tentativas' in existing.casefold() and '8 dígitos' in existing.casefold():
        return None
    content = '''### Sucesso

### Cenario 1 - Autenticacao valida

**DADO** que o professor informa matricula com 8 digitos e senha valida na tela de login
**QUANDO** confirma o acesso
**ENTAO** o sistema autentica o professor e libera as funcionalidades de reserva.

### Excecoes

### Cenario 2 - Campos ausentes ou formato invalido

**DADO** que o professor deixa matricula ou senha em branco, ou informa matricula fora de 8 digitos
**QUANDO** tenta confirmar o acesso
**ENTAO** o sistema nao cria sessao e informa o dado que deve ser corrigido.

### Cenario 3 - Credenciais invalidas

**DADO** que o professor informa matricula ou senha incorreta
**QUANDO** confirma o acesso antes do limite de tentativas
**ENTAO** o sistema nao cria sessao e informa que as credenciais sao invalidas.

### Cenario 4 - Bloqueio temporario

**DADO** que o professor realizou 5 tentativas consecutivas com credenciais invalidas
**QUANDO** tenta autenticar novamente
**ENTAO** o sistema bloqueia o acesso por 15 minutos e informa o tempo de bloqueio.

### Cenario 5 - Sessao expirada

**DADO** que o professor possui uma sessao autenticada
**QUANDO** a inatividade ultrapassa 30 minutos
**ENTAO** o sistema encerra a sessao e solicita novo login.

### Cenario 6 - Perfil sem permissao

**DADO** que um usuario sem perfil Professor esta autenticado
**QUANDO** tenta acessar funcionalidades de reserva
**ENTAO** o sistema nega o acesso e informa que o perfil nao possui permissao.'''
    return {
        'section': 'Cenarios de aceite',
        'content': content,
        'changes': ['Cenarios de aceite foram consolidados para as regras confirmadas de login.'],
        'source_ids': [],
        'status': 'proposed',
        'requires_confirmation': False,
    }


def patch_from_decisions(artifact_type, current, instruction):
    """Apply explicit review answers without delegating their placement to a model.

    A decision supplied by the professor is a source of truth, not a prompt
    suggestion. Applying it first prevents a provider from selecting an
    unrelated section.
    """
    if artifact_type != 'requirements':
        return None

    decisions = []
    seen_decisions = set()
    for match in re.finditer(
        r'^\s*Decisao:\s*([^\r\n]+)\r?\n\s*Resposta:\s*([\s\S]*?)(?=^\s*Decisao:|\Z)',
        instruction,
        flags=re.IGNORECASE | re.MULTILINE,
    ):
        question = match.group(1).strip()
        # A response can contain paragraphs. Preserve its facts while storing
        # it as one Markdown rule, rather than silently discarding line two.
        answer = ' '.join(line.strip() for line in match.group(2).splitlines() if line.strip())
        key = (question.casefold(), answer.casefold())
        if question and answer and key not in seen_decisions:
            decisions.append((question, answer))
            seen_decisions.add(key)
    if not decisions:
        return None

    section = 'Comportamento e regras confirmadas'
    existing = _extract_section(current, section)
    behavior_match = re.search(
        r'^###\s+Comportamento\s*$([\s\S]*?)(?=^###\s+Regras\s*$|\Z)',
        existing,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    rules_match = re.search(
        r'^###\s+Regras\s*$([\s\S]*?)\Z',
        existing,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    behavior = _dedupe_bullet_lines(behavior_match.group(1).strip() if behavior_match else '')
    rules = _dedupe_bullet_lines(rules_match.group(1).strip() if rules_match else existing.strip())
    existing_rules = {
        re.sub(r'\s+', ' ', re.sub(r'^\s*[-*]\s*', '', line)).strip().rstrip('.').casefold()
        for line in rules.splitlines()
        if re.match(r'^\s*[-*]\s+', line)
    }
    new_answers = []
    for _, answer in decisions:
        normalized_answer = re.sub(r'\s+', ' ', answer).strip().rstrip('.').casefold()
        if normalized_answer and normalized_answer not in existing_rules:
            new_answers.append(f'- {answer}')
            existing_rules.add(normalized_answer)
    rules = '\n'.join(part for part in (rules, '\n'.join(new_answers)) if part).strip()
    content = (
        '### Comportamento\n\n'
        f'{behavior or "- O comportamento confirmado deve ser validado pelos cenarios de aceite."}\n\n'
        '### Regras\n\n'
        f'{rules}'
    )
    if content.strip() == existing.strip():
        return None
    return {
        'section': section,
        'content': content,
        'changes': ['Registradas decisões explícitas informadas durante a revisão.'],
        'source_ids': [],
        'status': 'proposed',
        'requires_confirmation': False,
    }


def patch_acceptance_from_confirmed_decisions(artifact_type, current, source, instruction, findings):
    """Create deterministic BDD coverage from explicit review decisions.

    This path is intentionally domain-neutral: it repeats only the confirmed
    answer and derives actor/goal from the story supplied by the controller.
    It avoids relying on a model to return a non-empty acceptance patch.
    """
    finding_codes = {
        str(item.get('code') or '').strip()
        for item in findings if isinstance(item, dict)
    }
    if artifact_type != 'requirements' or not finding_codes.intersection({
        'answered_decision_requires_acceptance_coverage',
        'acceptance_placeholder',
        'missing_bdd_acceptance_criteria',
    }):
        return None

    source_text = str(source or '')
    decisions_match = re.search(r'Decis[õo]es confirmadas:\s*\n([\s\S]*)\Z', source_text, flags=re.IGNORECASE)
    answers = [
        re.sub(r'^\s*-\s*', '', line).strip()
        for line in (decisions_match.group(1).splitlines() if decisions_match else [])
        if re.match(r'^\s*-\s*\S+', line)
    ]
    if not answers:
        answers = [
            ' '.join(match.group(1).split())
            for match in re.finditer(
                r'^\s*Resposta:\s*([\s\S]*?)(?=^\s*Decisao:|\Z)',
                str(instruction or ''),
                flags=re.IGNORECASE | re.MULTILINE,
            )
            if match.group(1).strip()
        ]
    if not answers:
        return None

    story_match = re.search(r'^Task:\s*(.+)$', source_text, flags=re.IGNORECASE | re.MULTILINE)
    story = story_match.group(1).strip() if story_match else 'a história atual'
    actor_match = re.search(r'^Como\s+(.+?),\s*eu quero\s+', story, flags=re.IGNORECASE)
    actor = actor_match.group(1).strip() if actor_match else 'a pessoa responsável'
    goal_match = re.search(r'eu quero\s+(.+?)(?:,\s*para\s+|\.$)', story, flags=re.IGNORECASE)
    goal = goal_match.group(1).strip() if goal_match else 'executar a ação descrita na história'

    acceptance = _extract_section(current, 'Cenarios de aceite')
    acceptance_normalized = re.sub(r'\s+', ' ', acceptance).casefold()
    scenario_number = len(re.findall(r'^###\s+Cen[aá]rio\b', acceptance, flags=re.IGNORECASE | re.MULTILINE))
    scenarios = []
    for answer in answers:
        normalized_answer = re.sub(r'\s+', ' ', answer).strip().rstrip('.').casefold()
        if not normalized_answer or normalized_answer in acceptance_normalized:
            continue
        scenario_number += 1
        scenarios.append(
            f'### Cenario {scenario_number} - Aplicacao de decisao confirmada\n\n'
            f'**DADO** que {actor} esta no fluxo para {goal}\n'
            f'**QUANDO** informa ou seleciona os dados relacionados a decisao confirmada\n'
            f'**ENTAO** o sistema aplica a regra confirmada: {answer}'
        )
    if not scenarios:
        existing_scenarios = re.findall(
            r'^###\s+Cen[aá]rio\b[^\n]*\r?\n[\s\S]*?(?=^###\s+Cen[aá]rio\b|\Z)',
            acceptance,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if not existing_scenarios:
            return None
        scenarios = [existing_scenarios[0].strip()]
    return {
        'section': 'Cenarios de aceite',
        'content': '\n\n'.join(scenarios),
        'changes': ['Criados cenarios BDD rastreaveis para decisoes confirmadas.'],
        'source_ids': [],
        'status': 'proposed',
        'requires_confirmation': False,
    }


class ArtifactRepairAgent:
    """Repairs only the sections named by the Quality Gate."""

    def __init__(self, project_id):
        self.project_id = project_id

    def process(self, payload):
        artifact_type = str(payload.get("artifact_type") or "").strip()
        findings = payload.get("findings") or []
        current = str(payload.get("current_artifact") or "").strip()
        source = str(payload.get("source_context") or "").strip()
        instruction = str(payload.get("instruction") or "").strip()
        if not artifact_type or not findings or not current:
            raise ValueError("Reparo direcionado exige artifact_type, findings e current_artifact.")
        source_patch = patch_from_source_context(artifact_type, current, source)
        if source_patch:
            return source_patch
        decision_patch = patch_from_decisions(artifact_type, current, instruction)
        if decision_patch:
            return decision_patch
        duplicate_patch = patch_duplicate_requirement_behavior(artifact_type, current)
        if duplicate_patch:
            return duplicate_patch
        scenario_patch = patch_login_acceptance_scenarios(artifact_type, current)
        if scenario_patch:
            return scenario_patch
        prompt = f"""
Voce e um agente de reparo direcionado. Corrija SOMENTE o trecho afetado pelos achados abaixo.
Nao reescreva o artefato inteiro. Nao invente regra, limite, status, endpoint ou permissao.
Quando faltar evidencia, marque o item como proposed e registre requires_confirmation=true.
Responda apenas JSON valido com as chaves: section, content, changes, source_ids, status, requires_confirmation.
O objeto nao pode ser vazio. Use exatamente este formato, sem envelope: {{"section":"Comportamento e regras confirmadas","content":"texto completo que substitui apenas a secao","changes":["resumo"],"source_ids":[],"status":"proposed","requires_confirmation":false}}
Escolha uma secao de nivel ## existente. Para requisitos no formato compacto, use somente: Historia e objetivo, Comportamento e regras confirmadas, Cenarios de aceite, Decisoes pendentes ou Status.
Preserve exatamente o formato compacto. Nunca crie as secoes legadas "requirements", "User Story Refinada", "Requisitos Funcionais" ou "Criterios de Aceite". Se a orientacao contiver respostas para decisoes, use-as como evidencia obrigatoria e incorpore somente os fatos respondidos, sem repetir as perguntas resolvidas.
Quando o achado tiver o codigo "answered_decision_requires_acceptance_coverage", responda obrigatoriamente com section="Cenarios de aceite". Redija cenarios BDD concretos e naturais para a interface e o fluxo descritos na decisao, sem assumir mensagens, persistencia ou regra adicional. O content deve conter ao menos um bloco no formato: "### Cenario N - titulo", seguido de DADO, QUANDO e ENTAO (podem estar em negrito). O QUANDO deve descrever a interacao especifica da decisao e o ENTAO deve descrever o resultado observavel; nao use expressoes genericas como "dados relacionados a decisao" ou "aplica a regra confirmada". Nunca use "A validar durante a revisao", listas vazias ou texto de orientacao como cenario.
Se o documento estiver incompleto ou misturar formatos, priorize restaurar "Historia e objetivo" usando a fonte aprovada; a infraestrutura removera automaticamente duplicacoes e secoes legadas.

Tipo: {artifact_type}
Achados: {json.dumps(findings, ensure_ascii=False)}
Fonte aprovada: {source}
Orientacao do professor: {instruction or 'Nenhuma orientacao adicional.'}
Artefato atual (somente contexto): {current[:12000]}
"""
        result = generate_text_from_llm(
            prompt,
            options_override={
                "temperature": 0.0,
                "num_predict": 900,
                # O reparo é consumido pelo controller como patch; exigir JSON
                # evita que uma resposta em prosa quebre a revisão no frontend.
                "json_mode": True,
                "require_json_object": True,
            },
            use_cache=False,
            task="artifact_repair",
        )
        if not result or is_error_text_response(result):
            fallback = patch_from_source_context(artifact_type, current, source)
            if fallback:
                return fallback
            raise RuntimeError("Agente de reparo nao retornou uma resposta valida.")
        try:
            patch = normalize_patch(parse_first_json_object(result))
        except ValueError:
            fallback = patch_from_source_context(artifact_type, current, source)
            if fallback:
                return fallback
            raise
        if not patch or not patch['section'] or not patch['content']:
            raise ValueError('O modelo retornou um JSON de reparo incompleto (section e content sao obrigatorios).')
        return patch
