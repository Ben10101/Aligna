# Aligna

O Aligna é uma plataforma de planejamento de software assistida por IA. Ela transforma um briefing em backlog, requisitos verificáveis e casos de validação, com revisões humanas, histórico de versões e Quality Gates antes da implementação.

## O que o produto resolve

Times perdem tempo implementando histórias ambíguas, regras implícitas e critérios de aceite que não podem ser testados. O Aligna torna essas decisões explícitas antes do código e mantém a rastreabilidade entre briefing, backlog, requisitos, QA e etapas técnicas.

## Fluxo principal

```text
Briefing do projeto
  → PM: backlog incremental e critérios iniciais
  → revisão humana do backlog
  → RA: requisito refinado e cenários BDD
  → revisão humana dos requisitos
  → QA: casos de validação rastreáveis
  → revisão humana de QA
  → arquitetura e implementação
```

Cada revisão cria uma nova versão pendente. Nenhum artefato é aprovado automaticamente.

## Capacidades

- Geração e revisão de backlog com PM Agent
- Refinamento de requisitos com regras de negócio, decisões pendentes e BDD
- Casos de QA rastreáveis aos critérios de aceite
- Correção assistida por agente, preservando conteúdo válido
- Quality Gates para estrutura, cobertura e rastreabilidade
- Board de tarefas com etapas de backlog, revisão, qualidade e conclusão
- Histórico de artefatos, decisões e execuções de agentes
- Roteamento entre provedores de IA e recuperação de execuções interrompidas

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React, Vite, Tailwind CSS, Framer Motion, Axios |
| Backend | Node.js, Express, Prisma |
| Banco de dados | MySQL |
| Agentes | Python, Pydantic e integrações com provedores de IA |
| Provedores suportados | Gemini, OpenAI, Anthropic, NVIDIA, DeepSeek, Groq, OpenRouter e Ollama |

## Estrutura do repositório

```text
agents/          Agentes de PM, RA, QA, arquitetura, desenvolvimento e revisão
backend/         API Express, Prisma, serviços, controllers e scripts de smoke test
frontend/        Aplicação React e telas de projeto, backlog, artefatos e governança
orchestrator/    Execução isolada de agentes Python
tests/           Testes de contratos e agentes
docs/            Documentação de instalação, API, arquitetura e operação
agent-evals/     Casos e resultados de avaliação dos agentes
scripts/         Utilitários de manutenção e suporte local
outputs/         Saídas locais geradas quando aplicável
```

Principais agentes em `agents/`:

- `project_manager`: gera e recupera o backlog incremental.
- `requirements_analyst` e `requirements_reviewer`: refinam e revisam requisitos.
- `qa_engineer` e `qa_reviewer`: geram e revisam os casos de validação.
- `architect`, `developer`, `developer_backend` e `developer_frontend`: apoiam as etapas técnicas posteriores.

## Executar localmente

### Pré-requisitos

- Node.js 20 ou superior
- Python 3.10 ou superior
- MySQL disponível localmente

### 1. Instale as dependências

```bash
cd backend
npm install

cd ../frontend
npm install

cd ..
python -m pip install -r requirements.txt
```

### 2. Configure o ambiente

Crie o arquivo `.env` a partir de `.env.example` e configure, no mínimo:

```dotenv
DATABASE_URL=mysql://usuario:senha@localhost:3306/ai_factory
AUTH_ACCESS_SECRET=uma-chave-longa-e-aleatoria
AI_SETTINGS_SECRET=outra-chave-longa-e-aleatoria
FRONTEND_ORIGIN=http://localhost:5173
```

Adicione ao menos uma chave de provedor de IA, como `GEMINI_API_KEY`, `OPENAI_API_KEY` ou `NVIDIA_API_KEY`, para executar os agentes.

### 3. Prepare o banco

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate:deploy
```

Para desenvolvimento local com novas migrações, use `npm run prisma:migrate:dev`.

### 4. Inicie os serviços

Em um terminal:

```bash
cd backend
npm run dev
```

Em outro terminal:

```bash
cd frontend
npm run dev
```

Abra `http://localhost:5173`. A API fica disponível em `http://localhost:3001/api` e o health check em `http://localhost:3001/health`.

> O `docker-compose.yml` atual ainda sobe PostgreSQL, enquanto a aplicação usa MySQL via Prisma. Use o setup local com MySQL até que o Compose seja alinhado à infraestrutura da aplicação.

## Qualidade e testes

### Frontend

```bash
cd frontend
npm run build
npm run test:smoke:core
```

### Backend

```bash
cd backend
npm run test:smoke:core
npm run test:pipeline-coherence:smoke
npm run test:project-manager-recovery:smoke
npm run test:requirements-recovery:smoke
npm run test:qa-recovery:smoke
```

### Agentes Python

```bash
python -m unittest tests.test_qa_validation_cases
python -m unittest tests.test_requirements_reviewer
```

## Endpoints de referência

- `GET /health`: health check do backend.
- `POST /api/alignment/analyze`: análise rápida de alinhamento de uma entrada.
- `POST /api/projects/:projectUuid/generate-backlog`: gera o backlog a partir do briefing.
- `POST /api/tasks/:taskUuid/artifacts/:artifactUuid/repair`: cria uma nova versão proposta por um agente revisor.

As rotas completas estão documentadas em [docs/API.md](docs/API.md).

## Documentação

- [Instalação](docs/INSTALL.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Engine de requisitos](docs/REQUIREMENT_ENGINE.md)
- [Modelo de roteamento de IA](docs/MODEL_ROUTER.md)
- [Checklist de prontidão para produção](docs/PRODUCTION_READINESS_CHECKLIST.md)
- [Runbook de incidentes](docs/RUNBOOK_INCIDENT_RESPONSE.md)
- [Runbook de release e rollback](docs/RUNBOOK_RELEASE_ROLLBACK.md)
- [Contribuição](docs/CONTRIBUTING.md)

## Princípios de operação

- A IA propõe; uma pessoa aprova.
- Decisões humanas são preservadas no histórico.
- Uma lacuna no QA não autoriza o QA a inventar uma regra de produto.
- Regras confirmadas devem ser formalizadas em critérios BDD no requisito antes de serem consideradas prontas para implementação.
