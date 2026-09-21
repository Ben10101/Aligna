# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e dinheiro gerindo eventos corporativos em planilhas, e-mails e ferramentas desconectadas. Criaremos uma plataforma única que centraliza planejamento, aprovação, execução e acompanhamento de eventos corporativos, desde a definição do briefing até a medição de resultados. A primeira versão permitirá criar um evento, orçamentar, aprovar e acompanhar a execução com credenciamento básico.

## Capacidades do Produto

- Gestão de Eventos** – Criação, edição e versionamento de eventos com informações essenciais (objetivo, público, datas, local).
- Orçamento & Aprovação** – Montagem de orçamentos detalhados por categoria, fluxo de aprovação em etapas e controle de versões.
- Execução Operacional** – Check-list de tarefas, atribuição de responsáveis, controle de status e comunicação com fornecedores.
- Credenciamento & Presença** – Importação de listas de convidados, geração de credenciais, check-in digital e relatório de presença.
- Dashboard Gerencial** – Visão consolidada de orçamento vs. realizado, status de tarefas, NPS do evento e indicadores-chave.

## Epicos Recomendados

- Cadastro Inicial & Configuração** – Estrutura de empresas, usuários, perfis de permissão e templates de evento.
- Fluxo Completo do Evento** – Criação do evento, orçamento, aprovação, liberação para execução e publicação de cronograma.
- Gestão de Fornecedores & Contratos** – Cadastro de fornecedores, vinculação a itens de orçamento, upload de contratos e alertas de vencimento.
- Credenciamento & Check-in** – Importação de convidados, geração de QR codes, aplicativo ou web para check-in e emissão de relatórios.
- Auditoria & Compliance** – Log de alterações, aprovações por etapas, bloqueio de edições pós-aprovacao e exportação para auditoria.
- Dashboard Executivo** – Painel com KPIs de eventos (ROI, satisfação, aderência orçamentária) e exportação de relatórios.

## Fatias de Release

- MVP: Foco: viabilizar o ciclo mínimo de planejamento → aprovação → execução → acompanhamento de um único evento corporativo, garantindo que o PM e stakeholders consigam criar o evento, montar o orçamento-base, convidar participantes e gerar credenciais. O que fica para depois: gestão de múltiplos eventos simultâneos, catálogo de fornecedores, automação de aprovações complexas, dashboards avançados, integrações financeiras, gamificação e funcionalidades de pós-evento (pesquisa de satisfação, ROI).
- Fase 2: Foco: escalar a plataforma para operar vários eventos em paralelo, incluir catálogo gerenciável de fornecedores, fluxo de aprovação parametrizável e permissões granulares por papel (PM, financeiro, jurídico, etc.). O que fica para depois: marketplace aberto de fornecedores, IA para recomendação de fornecedores, contratos inteligentes, integrações com ERPs corporativos, BI avançado e funcionalidades de comunidade/colaboração entre PMs.
- Fase 3: Foco: transformar a plataforma em um ecossistema inteligente com automação de tarefas operacionais (ex.: follow-ups, lembretes, geração de relatórios), análise preditiva de orçamento e engajamento, integrações bidirecionais com sistemas legados e APIs públicas para parceiros. O que fica para depois: expansão para eventos híbridos e virtuais, blockchain para rastreabilidade de contratos, tokenização de incentivos e funcionalidades B2C para eventos externos.

## Historias de Usuario

- US-01 | Como Ana Paula, gerente de RH, eu quero registrar o orçamento total estimado do evento em um campo único, para ter o valor central de referência antes de detalhar as categorias.

- US-02 | Como Carlos, gerente de facilities, eu quero cadastrar salas e áreas de eventos com capacidade máxima e recursos disponíveis, para que PMs saibam onde podem realizar cada tipo de evento.

- US-03 | Como Renata, PM de eventos, eu quero duplicar um evento já executado para criar nova versão com mesmas configurações, para agilizar planejamento de eventos recorrentes.

- US-04 | Como Ana Paula, gerente de RH, eu quero montar um orçamento simples com valores estimados por categoria (alimentação, espaço, material), para ter visão inicial dos custos antes de submeter à aprovação.

- US-05 | Como Felipe, assistente de eventos, eu quero cadastrar o fornecedor de buffet com nome, telefone e e-mail, para poder entrar em contato quando precisar confirmar os detalhes do serviço.

- US-06 | Como Roberto, diretor financeiro, eu quero aprovar ou reprovar o orçamento de um evento com justificativa, para garantir o alinhamento financeiro antes da execução.

- US-07 | Como Ana Paula, gerente de RH, eu quero visualizar o status do evento como "Planejamento", "Aguardando Aprovação", "Aprovado" ou "Executado", para saber em qual fase está o projeto.

- US-08 | Como Juliana, gerente de eventos, eu quero visualizar dashboard com todos os eventos do mês e seus status de aprovação, para equilibrar carga de trabalho da equipe.

- US-09 | Como Ana Paula, gerente de RH, eu quero criar um novo evento de integração informando objetivo, público-alvo, data e local, para dar início ao planejamento sem depender de planilhas.

- US-10 | Como Felipe, assistente de eventos, eu quero gerar credenciais com QR code para cada convidado, para agilizar o check-in no dia do evento.

- US-11 | Como Patricia, gerente jurídica, eu quero revisar e aprovar digitalmente contratos de fornecedores antes do início da execução, para garantir conformidade legal.

- US-12 | Como Ana Paula, gerente de RH, eu quero visualizar um dashboard com orçamento planejado vs. realizado e taxa de comparecimento, para acompanhar o resultado do evento de integração.

- US-13 | Como Camila, PM de eventos, eu quero atualizar o status de uma tarefa para "Em andamento" quando começar a negociar com o fornecedor de espaço, para saber que já iniciou aquela etapa do planejamento.

- US-14 | Como Beatriz, assistente administrativa, eu quero configurar templates de e-mail para comunicação padrão com convidados, para manter consistência da marca.

- US-15 | Como Sandra, coordenadora de eventos, eu quero configurar lembretes automáticos para vencimento de contratos de fornecedores, para evitar multas por atraso.

- US-16 | Como Roberto, diretor financeiro, eu quero visualizar relatório consolidado de eventos com risco de estouro orçamentário, para priorizar ações corretivas.

- US-17 | Como Camila, PM de eventos, eu quero bloquear edição de informações críticas do evento após aprovação do board, para evitar desvios não autorizados.

- US-18 | Como Diego, fornecedor de buffet, eu quero receber notificação automática quando houver alteração no número final de convidados, para ajustar quantidade de refeições.

- US-19 | Como Mariana, gerente de compliance, eu quero acessar log detalhado de alterações no orçamento com data, hora e responsável, para auditoria interna trimestral.

- US-20 | Como Thiago, segurança corporativo, eu quero realizar check-in digital dos convidados no dia do evento, para controlar presença em tempo real.

- US-21 | Como Felipe, assistente de eventos, eu quero adicionar manualmente nome, e-mail e departamento de cada convidado, para construir a lista de participantes sem depender de importações complexas.

- US-22 | Como Felipe, assistente de eventos, eu quero marcar tarefas como "Concluída" quando confirmo buffet e outros serviços, para saber o que já está garantido.

- US-23 | Como Felipe, assistente de eventos, eu quero adicionar um convidado digitando nome completo e e-mail, para construir a lista de participantes do evento de integração.

- US-24 | Como Lucas, analista de marketing, eu quero gerar relatório pós-evento com número de participantes, taxa de comparecimento e custo por pessoa, para justificar o ROI ao CMO.

FIM_DO_BACKLOG