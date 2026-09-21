# -*- coding: utf-8 -*-
import os
import re
import unicodedata

from agents.developer.llm_service import generate_text_from_llm, is_error_text_response


def _normalize_text(value):
    text = (value or "").strip()
    normalized = unicodedata.normalize("NFD", text.lower())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return text, normalized


def has_truncated_ending(value):
    text = (value or "").rstrip()
    if not text:
        return True

    if text.count("```") % 2 != 0:
        return True

    last_line = text.splitlines()[-1].strip()
    if not last_line:
        return True

    if re.fullmatch(r"-{3,}", last_line):
        return False

    if re.fullmatch(r"\|.*\|", last_line):
        return False

    if re.fullmatch(r"\*\*.+\*\*", last_line):
        return False

    if re.fullmatch(r"#+\s+.+", last_line):
        return False

    if re.search(r"[A-Za-zÀ-ÿ0-9.!?)]$", last_line):
        return False

    if re.search(r"[:|*_\-/(\[{,;]$", last_line):
        return True

    return False


def _extract_backlog_story_blocks(text):
    stories = []
    current = []

    for raw_line in (text or "").splitlines():
        line = raw_line.rstrip()
        if re.search(
            r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?Como\b",
            line,
            re.IGNORECASE,
        ):
            if current:
                stories.append("\n".join(current).strip())
            current = [line.strip()]
            continue
        if current:
            current.append(line.strip())

    if current:
        stories.append("\n".join(current).strip())

    return [story for story in stories if story]


def _backlog_stories_section(text):
    """Return only the user-story section of a rendered backlog.

    Epics and release descriptions can legitimately mention a persona using
    "Como ...". They are not user stories and must not be fed to the story
    structure validator.
    """
    match = re.search(
        r"^\s*##\s+historias\s+de\s+usuario\s*$([\s\S]*)",
        str(text or ""),
        re.IGNORECASE | re.MULTILINE,
    )
    return match.group(1) if match else ""


def _backlog_story_has_complete_structure(story_block):
    lines = [line.strip() for line in (story_block or "").splitlines() if line.strip()]
    if len(lines) < 1:
      return False

    title_line = lines[0]
    if not re.search(r"^\s*Como\b.+\beu quero\b.+", title_line, re.IGNORECASE):
        return False

    if len(re.sub(r"\s+", " ", title_line).strip()) < 20:
        return False

    return True


def _backlog_story_has_description(story_block):
    lines = [line.strip() for line in (story_block or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return False

    # A user story title already has its mandatory actor, goal and benefit.
    # Providers frequently add concise, but useful, details such as
    # "Descricao: validar conflito". Reject only an empty label; imposing a
    # word count turns harmless formatting variance into a failed backlog.
    detail_text = re.sub(
        r"^(?:descricao|contexto|detalhe)\s*[:\-]?\s*",
        "",
        " ".join(lines[1:]).strip(),
        flags=re.IGNORECASE,
    ).strip()
    if not detail_text:
        return False

    return True


def _story_similarity_key(title_line):
    normalized = re.sub(
        r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
        "",
        title_line or "",
        flags=re.IGNORECASE,
    ).strip().lower()
    normalized = unicodedata.normalize("NFD", normalized)
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    normalized = re.sub(r"\b(como|eu quero|para|um|uma|o|a|de|do|da|dos|das)\b", " ", normalized)
    normalized = re.sub(r"[^a-z0-9 ]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return " ".join(normalized.split()[:8])


def parse_bullets_from_section(section_text):
    bullet_items = [
        re.sub(r"^\s*(?:[-*]\s*|\d+[\.\)]\s*)", "", line).strip()
        for line in (section_text or "").splitlines()
        if re.match(r"^\s*(?:[-*]\s+|\d+[\.\)]\s+).+", line.strip())
    ]
    # A release plan may legitimately contain only MVP. Do not discard a
    # well-formed bullet merely because the old roadmap template expected
    # three phases.
    if bullet_items:
        return bullet_items

    slices = []
    current_title = ""
    current_lines = []

    def flush_current():
        if not current_title:
            return
        body = " ".join(line.strip(" -*") for line in current_lines if line.strip()).strip()
        if body:
            slices.append(f"{current_title}: {body}")
        else:
            slices.append(current_title)

    for raw_line in (section_text or "").splitlines():
        line = raw_line.strip()
        heading_match = re.match(r"^#{1,6}\s*(MVP|Fase\s+2|Fase\s+3)\b[:\-\s]*", line, re.IGNORECASE)
        if heading_match:
            flush_current()
            current_title = re.sub(r"\s+", " ", heading_match.group(1)).strip()
            current_lines = []
            continue

        if current_title and line:
            current_lines.append(line)

    flush_current()
    return slices


def _count_meaningful_bullets(section_match, *, min_words=4):
    if not section_match:
        return 0

    bullets = [
        re.sub(r"^\s*[-*]\s+", "", line).strip()
        for line in section_match.group(1).splitlines()
        if re.search(r"^\s*[-*]\s+", line)
    ]
    return sum(1 for bullet in bullets if len(bullet.split()) >= min_words)


def _flow_has_confirmed_content_or_na(flow_body):
    """Accept a real flow independently of the list format chosen by the LLM.

    The requirements prompt asks for confirmed steps, but numbered lists are a
    presentation choice. Rejecting a valid bullet list or a concise narrative
    makes a formatting variation consume an entire generation attempt.
    """
    body = (flow_body or "").strip()
    if not body:
        return False
    if re.search(r"\bnao\s+se\s+aplica\b", body, re.IGNORECASE):
        return True
    if re.search(r"(?:^|\n)\s*(?:\d+[\.\)]|[-*])\s+\S+", body):
        return True

    # A prose flow is valid when it is substantive.  Do not accept template
    # instructions or an unresolved placeholder as evidence of a real flow.
    normalized_body = _normalize_text(body)[1]
    rejected_markers = (
        "inclua somente",
        "descreva somente",
        "ponto a validar",
        "a definir",
        "pendente",
        "preencher",
    )
    return len(body.split()) >= 5 and not any(marker in normalized_body for marker in rejected_markers)


def validate_requirements_output(result):
    text, normalized = _normalize_text(result)
    required_sections = [
        "user story refinada",
        "requisitos funcionais",
        "fluxo principal",
        "fluxos alternativos",
        "fluxos de excecao",
        "regras de negocio",
        "estados da interface e feedback",
        "validacoes e dados",
        "permissoes e auditoria",
        "criterios de aceite",
    ]

    missing = [section for section in required_sections if section not in normalized]
    if missing:
        return False, f"Secoes ausentes: {', '.join(missing)}"

    if not re.search(r"\bdado\b", normalized) or not re.search(r"\bquando\b", normalized) or not re.search(r"\bentao\b", normalized):
        return False, "Criterios de aceite sem estrutura BDD completa."

    rf_matches = re.findall(r"###\s*rf[-\s]?\d+", normalized, re.IGNORECASE)
    if len(rf_matches) < 1:
        return False, "Requisitos funcionais sem RFs estruturados."

    generic_markers = [
        "informa os dados necessarios",
        "acessa a funcionalidade",
        "o sistema valida e registra a operacao",
        "comportamento esperado da funcionalidade",
    ]
    if any(marker in normalized for marker in generic_markers):
        return False, "Requisito usa passos genericos sem entradas, processamento ou resultado observavel."

    if re.search(r"permissoes e auditoria[\s\S]{0,180}nao se aplica", normalized) and re.search(r"\b(controle de acesso|acesso autorizado|protecao contra compartilhamento|permiss)\w*", normalized):
        return False, "Controle de acesso foi citado, mas a secao de permissoes foi marcada como nao se aplica."

    if re.search(r'\beu quero\s+(cadastrar|criar|registrar|aprovar|atualizar)\b', normalized):
        has_secondary_rf = len(rf_matches) > 1
        derived_expansion_terms = [
            "vincular",
            "associar",
            "painel",
            "dashboard",
            "consultar",
            "visualizar",
            "listar",
            "relatorio",
            "exportar",
        ]
        if has_secondary_rf and any(term in normalized for term in derived_expansion_terms):
            return False, "Escopo expandido com funcionalidade derivada."

    flow_section = re.search(r"##\s+fluxo principal([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    if not flow_section:
        return False, "Fluxo principal ausente."
    flow_body = flow_section.group(1).strip()
    if not _flow_has_confirmed_content_or_na(flow_body):
        return False, "Fluxo principal sem passo confirmado ou indicacao de nao se aplica."

    rules_section = re.search(r"##\s+regras de negocio([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    if not rules_section:
        return False, "Regras de negocio ausentes."
    rules_body = rules_section.group(1).strip()
    if "nao se aplica" not in rules_body and len(re.findall(r"(?:^|\n)\s*(?:\d+[\.\)]|[-*]\s+)", rules_body)) < 1:
        return False, "Regras de negocio sem comportamento confirmado ou indicacao de nao se aplica."

    interface_section = re.search(r"##\s+estados da interface e feedback([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    validations_section = re.search(r"##\s+validacoes e dados([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    permissions_section = re.search(r"##\s+permissoes e auditoria([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)

    def _section_has_content_or_na(section_match):
        if not section_match:
            return False
        body = section_match.group(1).strip()
        if not body:
            return False
        if re.search(r"nao se aplica", body, re.IGNORECASE):
            return True
        return len(re.findall(r"(?:^|\n)\s*(?:\d+[\.\)]|[-*]\s+)", body)) >= 1 or len(body.split()) >= 6

    if not _section_has_content_or_na(interface_section):
        return False, "Estados da interface e feedback sem detalhe suficiente."

    if not _section_has_content_or_na(validations_section):
        return False, "Validacoes e dados sem detalhe suficiente."

    validations_body = validations_section.group(1).strip() if validations_section else ""
    if validations_body and not re.search(
        r"(formato|obrigator|limite|valor controlado|consist|tipo|tamanho|regex|ponto a validar|nao se aplica)",
        validations_body,
        re.IGNORECASE,
    ):
        return False, "Validacoes e dados sem detalhes operacionais suficientes."

    if not _section_has_content_or_na(permissions_section):
        return False, "Permissoes e auditoria sem detalhe suficiente."

    if "fim_do_refinamento" not in normalized:
        return False, "Marcador final do refinamento nao foi encontrado."

    if has_truncated_ending(text):
        return False, "Resposta aparenta ter sido cortada no final."

    user_story_section = re.search(r"##\s+user story refinada([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    validations_section_body = validations_section.group(1) if validations_section else ""
    assumptions_section = re.search(r"##\s+premissas e pontos a validar([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    assumptions_body = assumptions_section.group(1) if assumptions_section else ""

    core_story_terms = [
        "cadastrar",
        "criar",
        "registrar",
        "responsavel operacional",
        "visitante",
        "visita",
        "autorizacao",
        "escopo",
        "contato",
        "tipo de suporte",
    ]
    has_core_story = any(term in normalized for term in core_story_terms)
    central_field_markers = [
        "contato",
        "tipo de suporte",
        "nome",
        "data",
        "objetivo",
        "visitante",
        "responsavel",
        "autorizacao",
    ]

    if has_core_story:
        # A central field named by the story must keep its meaning in the
        # refinement, but its format, limits and policy are not facts merely
        # because they are normally useful.  Those unknown details belong in
        # Premissas e Pontos a Validar.  Reject only when the field itself is
        # hidden behind a generic placeholder in Validacoes e Dados.
        unresolved_validations = [
            line.strip()
            for line in validations_section_body.splitlines()
            if re.search(
                rf"\b(?:{'|'.join(re.escape(marker) for marker in central_field_markers)})\b\s*:\s*ponto a validar",
                line,
                re.IGNORECASE,
            )
        ]
        if unresolved_validations:
            return False, "Campo central sem significado definido em Validacoes e Dados."

        if "visita" in normalized and (
            "formato do evento" in normalized
            or "evento corporativo" in normalized
            or re.search(r"\bevento\b", normalized)
        ):
            return False, "Bleed de dominio: historia de visita trouxe linguagem de evento."

        if "escopo" in normalized and (
            "status inicial" in normalized
            or 'status "escopo definido"' in normalized
            or "status escopo definido" in normalized
            or "pendente de aprovacao" in normalized
            or "numero sequencial" in normalized
            or "identificador unico sequencial" in normalized
            or "identificador unico" in normalized
                or "identificador gerado" in normalized
            or "uuid" in normalized
            or "guid" in normalized
            or "timestamp" in normalized
            or "protocolo" in normalized
        ):
            return False, "Story de escopo expandiu para workflow ou identificacao indevida."

        if "escopo" in normalized and (
            "duracao estimada" in normalized
            or "dura??o estimada" in normalized
            or "areas da empresa" in normalized
            or "?reas da empresa" in normalized
            or "acesso especial" in normalized
            or "estimativa de recursos" in normalized
            or "salvar como rascunho" in normalized
        ):
            return False, "Story de escopo expandiu para parametros nao pedidos pela task."

        if (
            ("eu quero criar" in normalized or "eu quero registrar" in normalized)
            and ("contexto inicial" in normalized or "dados iniciais" in normalized)
            and (
                "status inicial" in normalized
                or "aguardando aprovacao" in normalized
                or "aguardando aprova??o" in normalized
                or "status registrado" in normalized
                or "status pendente" in normalized
                or "pendente de analise" in normalized
                or "pendente de an?lise" in normalized
                or "numero sequencial" in normalized
                or "identificador unico" in normalized
                or "identificador gerado" in normalized
                or "timestamp de criacao" in normalized
                or "timestamp de cria??o" in normalized
                or "data/hora de criacao" in normalized
                or "data/hora de cria??o" in normalized
                or "protocolo" in normalized
            )
        ):
            return False, "Story de cadastro inicial antecipou workflow ou identificacao sem base explicita."

    return True, None


def validate_legacy_qa_output(result):
    text, normalized = _normalize_text(result)
    section_aliases = {
        "Estrategia de testes": [
            "estrategia de testes",
            "estrategia de teste",
            "estrategia",
        ],
        "Dados de teste": [
            "dados de teste",
            "dados testes",
        ],
        "Riscos e metricas": [
            "riscos e metricas",
            "riscos e sinais",
            "riscos e metricas operacionais",
            "riscos",
        ],
        "Qualidade nao funcional": [
            "qualidade nao funcional",
            "qualidade nao funcional e operacao",
            "qualidade nao funcional / operacao",
            "qualidade operacional",
            "nfr",
        ],
        "Rastreabilidade dos Criterios de Aceite": [
            "rastreabilidade dos criterios de aceite",
            "rastreabilidade de criterios de aceite",
            "rastreabilidade criterios de aceite",
            "rastreabilidade dos criterios aceite",
            "rastreabilidade de criterios aceite",
            "traceabilidade dos criterios de aceite",
        ],
        "Smoke Minimo da Feature": [
            "smoke minimo da feature",
            "smoke minimo",
            "smoke da feature",
            "smoke feature",
        ],
        "Cenarios de teste": [
            "cenarios de teste",
            "cenarios",
        ],
        "Casos de teste funcionais": [
            "casos de teste funcionais",
            "casos funcionais",
            "casos de teste",
        ],
        "Usabilidade e acessibilidade": [
            "usabilidade e acessibilidade",
            "usabilidade",
            "acessibilidade",
        ],
    }

    def _is_heading_line(line, aliases):
        stripped = line.strip()
        if not stripped:
            return None

        match = re.match(r"^#{1,6}\s+(.+?)\s*$", stripped)
        if not match:
            return None

        title = match.group(1).strip()
        for alias in aliases:
            if title == alias:
                return alias
            if title.startswith(f"{alias} "):
                return alias
            if title.startswith(f"{alias}:"):
                return alias
            if title.startswith(f"{alias} -"):
                return alias
            if title.startswith(f"{alias} /"):
                return alias
        return None

    def _parse_sections(source):
        sections = {}
        current_name = None
        current_lines = []

        for raw_line in source.splitlines():
            matched_name = None
            for canonical_name, aliases in section_aliases.items():
                if _is_heading_line(raw_line, aliases):
                    matched_name = canonical_name
                    break

            if matched_name:
                if current_name and current_name not in sections:
                    sections[current_name] = "\n".join(current_lines).strip()
                current_name = matched_name
                current_lines = []
                continue

            if current_name:
                current_lines.append(raw_line)

        if current_name and current_name not in sections:
            sections[current_name] = "\n".join(current_lines).strip()

        for canonical_name, aliases in section_aliases.items():
            if canonical_name in sections:
                continue
            for alias in aliases:
                heading_pattern = re.compile(rf"^#+\s+{re.escape(alias)}(?:\s*[:\-/].*)?$", re.IGNORECASE | re.MULTILINE)
                if heading_pattern.search(source):
                    sections[canonical_name] = ""
                    break

        return sections

    sections_by_name = _parse_sections(normalized)
    missing = [name for name in section_aliases if not sections_by_name.get(name, "").strip()]
    if missing:
        return False, f"Secoes ausentes: {', '.join(missing)}"

    def count_numbered_items(section_text):
        return len(
            re.findall(
                r"(?:^|\n)\s*(?:[-*]\s+)?(?:ct\s*0*\d+|\d+[\.\)])",
                section_text,
                re.IGNORECASE,
            )
        )

    happy_match = re.search(r"caminho feliz(.+?)(?:excecao|limite|resiliencia|$)", normalized, re.DOTALL)
    exception_match = re.search(r"excecao(.+?)(?:limite|resiliencia|casos de teste funcionais|$)", normalized, re.DOTALL)
    limit_match = re.search(r"limite(.+?)(?:resiliencia|casos de teste funcionais|$)", normalized, re.DOTALL)
    resilience_match = re.search(r"resiliencia(.+?)(?:casos de teste funcionais|$)", normalized, re.DOTALL)
    functional_cases_section = sections_by_name.get("Casos de teste funcionais", "")
    traceability_section = sections_by_name.get("Rastreabilidade dos Criterios de Aceite", "")
    smoke_section = sections_by_name.get("Smoke Minimo da Feature", "")
    scenarios_section = sections_by_name.get("Cenarios de teste", "")
    non_functional_section = sections_by_name.get("Qualidade nao funcional", "")
    cases_match = re.search(r"ct\s*0*1", functional_cases_section)

    happy_count = len(re.findall(r"(?:^|\n)\s*(?:[-*]\s+)?(?:[1-5]\.|\d+\.)", happy_match.group(1))) if happy_match else 0
    exception_count = len(re.findall(r"(?:^|\n)\s*(?:[-*]\s+)?(?:[1-5]\.|\d+\.)", exception_match.group(1))) if exception_match else 0
    limit_count = len(re.findall(r"(?:^|\n)\s*(?:[-*]\s+)?(?:[1-5]\.|\d+\.)", limit_match.group(1))) if limit_match else 0
    resilience_count = len(re.findall(r"(?:^|\n)\s*(?:[-*]\s+)?(?:[1-5]\.|\d+\.)", resilience_match.group(1))) if resilience_match else 0
    if happy_count == 0 and happy_match:
        happy_count = len(re.findall(r"caminho feliz", happy_match.group(1), re.IGNORECASE))
    if exception_count == 0 and exception_match:
        exception_count = len(re.findall(r"excecao", exception_match.group(1), re.IGNORECASE))
    if happy_count < 3 and scenarios_section:
        happy_count = max(happy_count, len(re.findall(r"caminho feliz", scenarios_section, re.IGNORECASE)))
    if exception_count < 3 and scenarios_section:
        exception_count = max(exception_count, len(re.findall(r"excecao", scenarios_section, re.IGNORECASE)))
    if limit_count < 2 and scenarios_section:
        limit_count = max(limit_count, len(re.findall(r"limite", scenarios_section, re.IGNORECASE)))
    if resilience_count < 2 and scenarios_section:
        resilience_count = max(resilience_count, len(re.findall(r"resiliencia", scenarios_section, re.IGNORECASE)))
    functional_cases_count = count_numbered_items(functional_cases_section)
    action_count = len(re.findall(r"\bacao\b", functional_cases_section))
    expected_result_count = len(re.findall(r"resultado esperado", functional_cases_section))
    if functional_cases_count == 0:
        functional_cases_count = min(action_count, expected_result_count)

    # A cobertura nao deve ser artificialmente preenchida por uma quantidade
    # fixa de cenarios. Exigimos apenas um fluxo positivo e um negativo quando
    # o requisito possuir tratamento de erro; limites/resiliencia sao opcionais
    # e entram somente quando sustentados pela evidencia do requisito.
    scenario_count = count_numbered_items(scenarios_section)
    if scenario_count < 3:
        return False, "Menos de 3 cenarios executaveis."
    if not all(token in scenarios_section.lower() for token in ("dado:", "acao:", "resultado esperado:", "ca relacionado:")):
        return False, "Cenarios sem estrutura executavel e rastreabilidade para criterio de aceite."
    if happy_count < 1:
        return False, "Cenario de caminho feliz ausente."
    if exception_count < 1 and re.search(r"valid|erro|falha|obrigat|inval", normalized):
        return False, "Cenario negativo ausente para comportamento de validacao ou falha."

    has_structured_functional_cases = (
        functional_cases_count >= 3 and action_count >= 3 and expected_result_count >= 3
    )
    non_functional_keywords = ["performance", "seguranca", "confiabilidade", "observabilidade"]
    covered_non_functional_topics = sum(
        1 for keyword in non_functional_keywords if keyword in non_functional_section
    )

    if not cases_match and not has_structured_functional_cases:
        return False, "Casos de teste funcionais nao foram gerados."

    if covered_non_functional_topics < 3:
        return False, "Cobertura nao funcional insuficiente."

    if re.search(r"acompanhar\s+falhas\b", non_functional_section) or re.search(r"acompanhar\s+falhas\b", normalized):
        return False, "Metricas genericas demais."

    risks_section = sections_by_name.get("Riscos e metricas", "")
    if re.search(r"sinal:\s*nenhum", risks_section):
        return False, "Riscos sem sinal operacional verificavel."

    risk_count = len(re.findall(r"(?:^|\n)\s*[-*]\s*\*?\*?risco", risks_section, re.IGNORECASE))
    if risk_count < 2:
        return False, "Menos de 2 riscos distintos."

    traceability_count = len(re.findall(r"(?:^|\n)\s*[-*]\s*ca[\s\-]*0*\d+\b", traceability_section, re.IGNORECASE))
    if traceability_count < 3 and "ponto a validar" not in traceability_section:
        return False, "Rastreabilidade dos criterios de aceite insuficiente."

    if "ponto a validar" in traceability_section:
        return False, "Rastreabilidade ainda depende de ponto a validar."

    test_data_section = sections_by_name.get("Dados de teste", "")
    if re.search(r"ponto a verificar", test_data_section) or re.search(r"ponto a validar", test_data_section):
        return False, "Dados de teste ainda abrem lacunas em vez de provar o requisito."

    smoke_items = len(re.findall(r"(?:^|\n)\s*[-*]\s+", smoke_section))
    if smoke_items < 3 and "nao se aplica" not in smoke_section:
        return False, "Smoke minimo da feature insuficiente."

    limit_lines = [line.strip() for line in scenarios_section.splitlines() if "limite" in line.lower()]
    weak_limit_markers = ["vazia", "vazio", "null", "nulo", "em branco", "\"\"", "''"]
    if any(any(marker in line.lower() for marker in weak_limit_markers) for line in limit_lines):
        return False, "Cenario de limite fraco ou confundido com excecao."

    if "fim_do_plano_de_testes" not in normalized:
        return False, "Marcador final do plano de testes nao foi encontrado."

    if has_truncated_ending(text):
        return False, "Resposta aparenta ter sido cortada no final."

    return True, None


# QA now prepares validation cases, not a speculative test plan.  Keep this
# definition after the legacy validator so existing imports use the evidence
# driven contract below.
def validate_qa_output(result, expected_criteria_ids=None):
    text, normalized = _normalize_text(result)
    if not text:
        return False, "Casos de validacao vazios."

    required_sections = [
        "casos de validacao",
        "cobertura dos criterios de aceite",
        "lacunas de qualidade",
        "decisao de preparacao",
    ]
    missing = [title for title in required_sections if title not in normalized]
    if missing:
        return False, f"Secoes ausentes: {', '.join(missing)}"

    case_blocks = re.findall(r"^###\s*(CT[-\s]*\d+)\b([\s\S]*?)(?=^###\s*CT[-\s]*\d+\b|^##\s+|\Z)", text, re.IGNORECASE | re.MULTILINE)
    if not case_blocks:
        return False, "Nenhum caso de validacao CT-xx foi gerado."

    criterion_refs = set()
    for case_id, body in case_blocks:
        lowered = _normalize_text(body)[1]
        for field in ("criterio relacionado:", "pre-condicao:", "dados:", "acao:", "resultado esperado:", "tipo:", "status:", "evidencia:"):
            if field not in lowered:
                return False, f"{case_id.upper()} sem campo obrigatorio: {field.rstrip(':')}."
            field_name = field.rstrip(':')
            if not re.search(rf"^\s*{re.escape(field_name)}\s*:\s*\S+", lowered, re.IGNORECASE | re.MULTILINE):
                return False, f"{case_id.upper()} possui campo obrigatorio vazio: {field_name}."
        action_match = re.search(r"^\s*acao\s*:\s*(.+)$", lowered, re.IGNORECASE | re.MULTILINE)
        if action_match and re.search(r"\b(executar o comportamento|dados relacionados|aplicar a regra|selecionar dados|acao definida nessa decisao|acao indicada na decisao|acao e processada)\b", action_match.group(1), re.IGNORECASE):
            return False, f"{case_id.upper()} usa uma acao generica; descreva a interacao observavel."
        if re.search(r"#{1,6}\s+cenario\b", body, re.IGNORECASE):
            return False, f"{case_id.upper()} contém heading de cenário dentro de um campo de caso."
        match = re.search(r"criterio\s+relacionado\s*:\s*((?:CA|DQ)[-\s]*\d+)", lowered, re.IGNORECASE)
        if not match:
            return False, f"{case_id.upper()} sem critério ou decisão rastreável."
        criterion_refs.add(re.sub(r"\s+", "", match.group(1)).upper())
        if not re.search(r"status\s*:\s*nao executado", lowered, re.IGNORECASE):
            return False, f"{case_id.upper()} nao pode afirmar execucao nesta etapa."

    expected = {re.sub(r"\s+", "", str(item)).upper() for item in (expected_criteria_ids or []) if str(item).strip()}
    unknown = criterion_refs - expected if expected else set()
    uncovered = expected - criterion_refs
    if unknown:
        return False, f"Casos referenciam criterios inexistentes: {', '.join(sorted(unknown))}."
    if uncovered:
        return False, f"Criterios sem caso de validacao: {', '.join(sorted(uncovered))}."
    if "fim_dos_casos_de_validacao" not in normalized:
        return False, "Marcador final dos casos de validacao nao foi encontrado."
    if has_truncated_ending(text):
        return False, "Resposta aparenta ter sido cortada no final."
    return True, None


def validate_backlog_output(result):
    text, normalized = _normalize_text(result)
    required_sections = [
        "backlog do projeto",
        "visao geral",
        "capacidades do produto",
        "epicos recomendados",
        "fatias de release",
        "historias de usuario",
    ]

    missing = [section for section in required_sections if section not in normalized]
    if missing:
        return False, f"Secoes ausentes: {', '.join(missing)}"

    stories_section = _backlog_stories_section(text)
    story_lines = [
        line.strip()
        for line in stories_section.splitlines()
        if re.search(r"^(?:[-*]\s*)?(?:(?:us|story)-\d+\s*\|\s*|\d+[\.\)]\s*)?como\b", line.strip(), re.IGNORECASE)
    ]

    if has_truncated_ending(text):
        return False, "Resposta aparenta ter sido cortada no final."

    if len(story_lines) < 8:
        return False, "Foram geradas poucas historias de usuario. O minimo esperado e 8."

    if len(story_lines) > 25:
        return False, "Foram geradas historias demais. O maximo esperado e 25."

    normalized_story_lines = [
        re.sub(
            r"^\s*(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?",
            "",
            line,
            flags=re.IGNORECASE,
        ).strip()
        for line in story_lines
    ]

    invalid_titles = [
        title for title in normalized_story_lines if not re.search(r"^\s*Como\b.+\beu quero\b.+", title, re.IGNORECASE)
    ]
    if invalid_titles:
        return False, "Existe historia com estrutura incompleta ou aparencia de truncamento."

    story_blocks = _extract_backlog_story_blocks(stories_section)
    if len(story_blocks) < len(story_lines):
        return False, "Historias com bloco estrutural incompleto."

    # A complete user story already carries actor, goal and benefit in its
    # title. Descriptions add useful context when supplied, but free/agentic
    # models sometimes omit the optional second line. Do not discard a valid
    # backlog for that formatting variance; still reject a malformed detail
    # when the model starts one but leaves it empty or uninformative.
    incomplete_blocks = [
        block for block in story_blocks
        if len([line for line in block.splitlines() if line.strip()]) > 1
        and not _backlog_story_has_description(block)
    ]
    if incomplete_blocks:
        return False, "Historias sem descricao contextual suficiente."

    similarity_keys = [_story_similarity_key(title) for title in normalized_story_lines]
    duplicate_count = len(similarity_keys) - len(set(key for key in similarity_keys if key))
    if duplicate_count > 0:
        return False, "Foram detectadas historias muito parecidas ou duplicadas."

    technical_story_titles = [
        title
        for title in normalized_story_lines
        if re.search(r"\b(entidade|numero sequencial|identificador unico|chave primaria|tabela|api|endpoint|schema|modelo de dados|crud)\b", title, re.IGNORECASE)
    ]
    if technical_story_titles:
        return False, "Foram detectadas historias tecnicas demais para um backlog de usuario."

    personas = set()
    generic_user_count = 0
    for line in story_lines:
        match = re.search(r"como\s+([^,|]+)", line, re.IGNORECASE)
        if match:
            persona = match.group(1).strip().lower()
            personas.add(persona)
            if re.search(r"\b(um|uma)\s+usuario\b", persona):
                generic_user_count += 1

    if len(story_lines) >= 3 and len(personas) < 2:
        return False, "Historias com pouca diversidade de personas."

    if len(story_lines) >= 3 and generic_user_count > max(1, len(story_lines) // 3):
        return False, 'Historias ainda estao genericas demais ("Como um usuario").'

    capabilities_section = re.search(r"##\s+capacidade[s]?\s+do\s+produto([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    epics_section = re.search(r"##\s+epicos\s+recomendados([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    release_section = re.search(r"##\s+fatias\s+de\s+release([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)

    def _count_bullets(section_match):
        if not section_match:
            return 0
        return len(re.findall(r"(?:^|\n)\s*[-*]\s+", section_match.group(1)))

    capabilities_count = _count_bullets(capabilities_section)
    epics_count = _count_bullets(epics_section)

    if capabilities_count < 4:
        return False, "Capacidades do produto insuficientes."

    if epics_count < 4:
        return False, "Epicos recomendados insuficientes."

    if capabilities_count > 6:
        return False, "Capacidades do produto em excesso."

    if epics_count > 6:
        return False, "Epicos recomendados em excesso."

    for section_name, section_match in [("capacidades", capabilities_section), ("epicos", epics_section)]:
        if section_match:
            bullet_lines = [
                re.sub(r"^\s*[-*]\s+", "", line).strip()
                for line in section_match.group(1).splitlines()
                if re.search(r"^\s*[-*]\s+", line)
            ]
            short_lines = [line for line in bullet_lines if len(line.split()) < 3]
            if short_lines:
                return False, f"{section_name.capitalize()} do produto com itens curtos ou genericos demais."
            generic_lines = [
                line for line in bullet_lines if re.search(r"\b(melhorar|gerenciar|visualizar dados|fluxo|dados)\b", line, re.IGNORECASE)
            ]
            if len(generic_lines) > max(1, len(bullet_lines) // 2):
                return False, f"{section_name.capitalize()} do produto ainda está generica demais."

    release_text = release_section.group(1) if release_section else ""
    release_items = parse_bullets_from_section(release_text)
    release_joined = " ".join(release_items)
    if "mvp" not in release_joined:
        return False, "Fatias de release sem MVP explicito."

    if len(release_items) < 1:
        return False, "Fatias de release insuficientes."

    meaningful_release_items = _count_meaningful_bullets(release_section, min_words=4)
    if meaningful_release_items < 1:
        return False, "Fatias de release com itens curtos ou genericos demais."

    release_bodies = [item.lower() for item in release_items]
    if any(not re.search(r"\b(foco|depois|posterior|nao agora|fase seguinte)\b", item) for item in release_bodies):
        return False, "Fatias de release sem foco e diferimento suficiente."

    mvp_line = next((item for item in release_items if "mvp" in item.lower()), "")
    if not re.search(r"\b(fundacao|espinha|fluxo principal|primeira versao|base)\b", mvp_line, re.IGNORECASE):
        return False, "MVP sem foco explicito na fundacao do produto."

    if any(
        re.search(r"\b(agora|imediato|tudo|completo|total)\b", item, re.IGNORECASE) and not re.search(r"\b(depois|posterior|fase seguinte|nao agora)\b", item, re.IGNORECASE)
        for item in release_bodies
    ):
        return False, "Fatias de release sem diferimento operacional suficiente."

    # Do not infer the product backbone from a fixed Portuguese verb list.
    # Valid domains have different flows (for example, credit commonly uses
    # "simular -> enviar -> analisar -> decidir", none of which needs CRUD
    # vocabulary).  The structured backlog contract validates story count,
    # fields, evidence and foundation stories before Markdown is rendered;
    # this legacy Markdown validation remains focused on format and quality.

    # O marcador final continua sendo desejavel, mas nao deve derrubar um backlog
    # estruturalmente completo quando o modelo apenas esquece a linha final.

    return True, None


def validate_architecture_output(result):
    text, normalized = _normalize_text(result)
    required_sections = [
        "arquitetura do projeto",
        "visao geral",
        "stack tecnologico",
        "modulos e responsabilidades",
        "diagrama de arquitetura",
        "estrutura de diretorios",
        "modelo de dados",
        "contratos e integracoes",
        "observabilidade e operacao",
        "riscos tecnicos e trade-offs",
        "sequencia recomendada de implementacao",
    ]

    missing = [section for section in required_sections if section not in normalized]

    has_design_section = any(
        marker in normalized
        for marker in [
            "padroes de design",
            "padroes arquiteturais",
            "boas praticas arquiteturais",
        ]
    )
    if not has_design_section:
        missing.append("padroes de design")

    has_combined_deploy_security_section = "estrategia de deploy e seguranca" in normalized
    has_deploy_section = has_combined_deploy_security_section or "estrategia de deploy" in normalized
    has_security_section = has_combined_deploy_security_section or "seguranca" in normalized

    if not has_deploy_section:
        missing.append("estrategia de deploy")

    if not has_security_section:
        missing.append("seguranca")

    if missing:
        return False, f"Secoes ausentes: {', '.join(missing)}"

    if "fim_da_arquitetura" not in normalized:
        return False, "Marcador final da arquitetura nao foi encontrado."

    if has_truncated_ending(text):
        return False, "Resposta aparenta ter sido cortada no final."

    observability_section = re.search(r"##\s+observabilidade e operacao([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    observability_body = observability_section.group(1) if observability_section else ""
    if observability_body:
        if not re.search(r"\b(log|logs|observabil|metric|alert|recuper|recovery|health)\b", observability_body, re.IGNORECASE):
            return False, "Observabilidade e operacao sem sinais operacionais suficientes."
        if len(re.findall(r"(?:^|\n)\s*[-*]\s+", observability_body)) < 3 and len(observability_body.split()) < 18:
            return False, "Observabilidade e operacao sem densidade minima."

    risks_section = re.search(r"##\s+riscos tecnicos e trade-offs([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    risks_body = risks_section.group(1) if risks_section else ""
    if risks_body and len(re.findall(r"(?:^|\n)\s*[-*]\s+", risks_body)) < 3:
        return False, "Riscos tecnicos e trade-offs sem 3 riscos distintos."

    if risks_body and not re.search(r"\b(impacto|mitig|trade-off|risco)\b", risks_body, re.IGNORECASE):
        return False, "Riscos tecnicos e trade-offs sem impacto e mitigacao claros."

    sequence_section = re.search(r"##\s+sequencia recomendada de implementacao([\s\S]*?)(?=\n##\s+|$)", normalized, re.IGNORECASE)
    sequence_body = sequence_section.group(1) if sequence_section else ""
    if sequence_body and len(re.findall(r"(?:^|\n)\s*(?:\d+[\.\)]|[-*]\s+)", sequence_body)) < 3:
        return False, "Sequencia recomendada de implementacao insuficiente."

    advanced_stack_markers = [
        "react native",
        "graphql",
        "kubernetes",
        "eks",
        "keycloak",
        "firebase",
        "launchdarkly",
        "terraform",
        "helm",
        "pagerduty",
        "grafana",
        "prometheus",
        "event sourcing",
        "cqrs",
    ]
    advanced_hits = [marker for marker in advanced_stack_markers if marker in normalized]
    if len(advanced_hits) >= 5:
        return False, "Arquitetura ambiciosa demais para o estagio atual do backlog."

    if "cqrs" in normalized:
        return False, "Arquitetura ainda usa CQRS, o que foge da simplicidade esperada para o MVP atual."

    if "react native" in normalized and "mobile" in normalized and "web" in normalized:
        return False, "Arquitetura abriu frente mobile sem necessidade explicita suficiente."

    if re.search(r"(?:^|\n)\s*get\s+/api\s*(?:\n|$)", normalized, re.IGNORECASE):
        return False, "Contratos e integracoes contem endpoint incompleto."

    if "fase 3" in normalized and re.search(r"fase 3[\s\S]{0,80}gestao de polit\s*$", normalized, re.IGNORECASE):
        return False, "Fatias de implementacao aparentam truncadas."

    if "nestjs" in normalized and re.search(r"\.java\b|localdatetime\b", normalized, re.IGNORECASE):
        return False, "Arquitetura misturou stack Node/Nest com convencoes Java."

    if "nestjs" in normalized and re.search(r"\btypeorm\b|\bterminus\b", normalized, re.IGNORECASE):
        return False, "Arquitetura desviou da stack-base da factory com Nest/TypeORM/Terminus."

    if re.search(r"\bserilog\b|\.net\b|dotnet\b", normalized, re.IGNORECASE):
        return False, "Arquitetura misturou referencias de .NET/Serilog com stack Node."

    if re.search(r"\bsendgrid\b|\bgoogle oauth\b|\bprometheus\b|/metrics\b", normalized, re.IGNORECASE):
        return False, "Arquitetura ainda traz integracoes ou observabilidade alem do necessario para o MVP."

    if re.search(r"\|\.\s*$", text, re.MULTILINE):
        return False, "Arquitetura contem artefato editorial malformado."

    if re.search(r"\"scheduleddate\"\s*:\s*\"20\d?$", normalized, re.IGNORECASE | re.MULTILINE):
        return False, "Exemplo de request/response aparenta truncado."

    if re.search(r"```json\s*\{[\s\S]{0,240}```", text, re.IGNORECASE) and not re.search(r"```json\s*\{[\s\S]{0,240}\}\s*```", text, re.IGNORECASE):
        return False, "Exemplo JSON em contratos aparenta truncado ou sem fechamento."

    if re.search(r"^\s*-\s*`[^`\n]*$", text, re.MULTILINE):
        return False, "Lista de endpoints contem linha truncada ou com backtick sem fechamento."

    return True, None


def generate_complete_text(prompt, *, agent_label, validator, model=None, options_override=None, max_retries=3):
    base_options = dict(options_override or {})
    base_num_predict = int(base_options.get("num_predict", 1200))
    retry_count = max(1, int(max_retries))
    last_reason = "sem detalhes"

    for attempt in range(1, retry_count + 1):
        current_options = {
            **base_options,
            "num_predict": int(base_num_predict * (1.4 ** (attempt - 1))),
        }
        current_prompt = prompt

        if attempt > 1:
            current_prompt = (
                f"{prompt}\n\n"
                "IMPORTANTE: sua resposta anterior foi considerada incompleta. "
                f"Motivo detectado: {last_reason}. "
                "Gere novamente do zero, entregando TODAS as secoes completas, sem interromper no meio."
            )

        result = generate_text_from_llm(
            current_prompt,
            model=model,
            options_override=current_options,
            use_cache=False,
            task=agent_label if agent_label in {
                "requirements_analysis", "requirements_challenge", "requirements_judge",
                "text_extraction", "visual_analysis", "classification", "code_generation", "qa_generation",
                "artifact_repair",
            } else None,
        )
        if not result or is_error_text_response(result):
            last_reason = "Resposta vazia ou invalida."
            continue

        is_complete, reason = validator(result)
        if is_complete:
            return result

        last_reason = reason or "Resposta considerada incompleta."

    raise RuntimeError(
        f"O agente {agent_label} nao conseguiu gerar uma resposta completa apos {retry_count} tentativas. "
        f"Ultimo motivo: {last_reason}"
    )
