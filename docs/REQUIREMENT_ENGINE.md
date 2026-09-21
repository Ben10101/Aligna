# Requirement Engine

O Requirement Engine adiciona um modelo estruturado incremental ao resultado de `POST /api/alignment/analyze`. Os campos legados de alignment continuam inalterados; os campos novos são `requirement_model` e `requirement_engine`.

## Pipeline

1. Análise determinística do Alignment.
2. Requirements Analyst, opcional por LLM.
3. Modelo estruturado validado.
4. Requirements Challenger, opcional por LLM.
5. Requirements Judge, opcional por LLM.
6. Score determinístico existente.
7. Alignment Report compatível.

O modelo possui `requirement`, `user_story`, `actor`, `goal`, `action`, `object`, `context`, requisitos funcionais, regras, fluxos, critérios BDD, ambiguidades, lacunas, suposições, dependências, escopo, perguntas de clarificação e riscos.

Campos sem evidência são `null`, listas vazias ou achados explícitos em `missing_information`; eles nunca são completados pelo LLM. O backend valida tipo, campos obrigatórios, enums, evidências e critérios antes de aceitar qualquer resultado.

`ALIGNMENT_REQUIREMENT_ENGINE_LLM_ENABLED=true` habilita os estágios semânticos. Esses estágios retornam somente candidatos de achado e usam o Model Router existente. O modelo estruturado, regras, critérios de aceite e score continuam sob controle determinístico.

## Requirement Challenger

O Challenger retorna `challenge_report.problems` como JSON estruturado. Cada problema tem `type`, `evidence`, `explanation`, `impact`, `severity`, `clarification_question` e `source`. Os tipos permitidos são `AMBIGUITY`, `MISSING_INFORMATION`, `CONTRADICTION`, `UNTESTABLE`, `SCOPE_RISK`, `ASSUMPTION`, `BUSINESS_RULE_GAP` e `EDGE_CASE`.

O diagnóstico determinístico executa sempre. Com a configuração LLM habilitada, o agente `requirement_challenger` acrescenta apenas problemas que tenham evidência literal rastreável na entrada. O resultado da etapa registra modelo, provider, duração, resultado, total de problemas e retry em `requirement_engine.stages`.

Para execução vinculada a projeto, use `POST /api/agents/run` com `agent: "requirement_challenger"`, `payload.idea`, `payload.requirement_model` e `payload.project_id`. O fluxo existente cria um `AgentRun` e persiste o diagnóstico como artefato JSON. O endpoint livre de Alignment não persiste dados nem cria projeto implicitamente.
