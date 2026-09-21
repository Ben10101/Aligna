# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e dinheiro gerindo eventos corporativos em planilhas, e-mails e ferramentas desconectadas. A plataforma centraliza todo o ciclo de vida de um evento — planejamento, aprovação, execução e acompanhamento — em um único workspace colaborativo. A primeira versão entrega o fluxo completo de criação, aprovação e execução de um evento piloto com orçamento, cronograma e credenciamento básico.

## Capacidades do Produto

- Gestão de Eventos** – criar, editar, aprovar e arquivar eventos com metadados essenciais (objetivo, data, local, público-alvo).
- Orçamento & Aprovação** – montar planilha de custos, submeter para aprovação em workflow configurável e rastrear versões.
- Credenciamento & Check-in** – gerar lista de convidados, enviar credenciais digitais e realizar check-in via QR-Code no dia do evento.
- Fornecedores & Tarefas** – cadastrar fornecedores, vincular serviços, distribuir tarefas e acompanhar status em Kanban.
- Dashboard Executivo** – visão consolidada de orçamento vs. realizado, status de entregas e NPS do evento.

## Epicos Recomendados

- EP01 – Fundação: Configuração Inicial da Conta e Workspace
- EP02 – Criação e Aprovação de Evento
- EP03 – Credenciamento e Check-in
- EP04 – Gestão de Fornecedores e Tarefas Operacionais
- EP05 – Dashboards e Relatórios Gerenciais
- EP06 – Auditoria, Compliance e Controle de Mudanças

## Fatias de Release

- MVP: foco na espinha dorsal do produto, Foco: permitir que um PM de eventos crie um evento, submeta à aprovação interna, convide participantes, credencie na entrada e registre despesas básicas. Fica para depois: múltiplos eventos simultâneos, templates reutilizáveis, integrações financeiras ERP, dashboards analíticos, gestão avançada de fornecedores, permissões granulares, notificações customizáveis, app mobile nativo, automação de e-mails, avaliação pós-evento, API pública.
- Fase 2: Foco: permitir que a empresa gerencie múltiplos eventos em paralelo, compartilhe templates, convide fornecedores externos ao workspace e extraia relatórios financeiros e de presença consolidados. Fica para depois: IA para recomendação de fornecedores, gamificação de participantes, integração com CRM/HR, marketplace de fornecedores, single sign-on corporativo, compliance LGPD completa, white-label, orçamento multicurrency, BI avançado.
- Fase 3: Foco: governança corporativa (auditoria, LGPD, SOX), API pública para integrações, marketplace de fornecedores certificados, dashboards preditivos de ROI e engajamento, e app mobile completo para organizadores e participantes. Fica para depois: blockchain para rastreabilidade de contratos, metaverso de eventos, integração com wearables, carbon calculator de eventos, assistente virtual de eventos, expansão internacional com localização total.

## Historias de Usuario

- US-01 | Como Roberto, diretor de TI, eu quero configurar quais colaboradores têm permissão para criar, editar ou aprovar eventos, para garantir que apenas pessoas autorizadas movimentem valores.

- US-02 | Como Amanda, gerente de eventos, eu quero visualizar um resumo inicial com data, local estimado e número de participantes do evento, para validar se está dentro das diretrizes corporativas.

- US-03 | Como Rafael, gerente de eventos, eu quero visualizar um painel simples com o status atual do evento (rascunho, em aprovação, aprovado, executado), para saber em que fase meu projeto está.

- US-04 | Como Rafael, gerente de eventos, eu quero criar um novo evento preenchendo nome, objetivo, data, local e público-alvo, para dar início ao planejamento.

- US-05 | Como Thiago, coordenador logístico, eu quero cadastrar um fornecedor como inativo quando ele não atender mais aos critérios da empresa, para evitar novas contratações.

- US-06 | Como Daniela, analista financeira, eu quero cadastrar as categorias de despesa padrão da empresa (alimentação, espaço, tecnologia, material promocional), para estruturar o orçamento de forma consistente.

- US-07 | Como Priscila, coordenadora de eventos, eu quero marcar um evento como "aprovado" após revisar o orçamento, para liberar a execução.

- US-08 | Como Daniela, analista financeira, eu quero inserir os custos estimados de buffet, espaço e material dentro do evento, para montar o orçamento inicial.

- US-09 | Como Patrícia, gerente de RH, eu quero gerar um relatório de presença por departamento após o evento, para validar horas de treinamento dos colaboradores.

- US-10 | Como Mariana, coordenadora de RH, eu quero receber um alerta sempre que um evento incluir colaboradores da minha área, para validar se há conflito com políticas internas de treinamento.

- US-11 | Como Priscilla, coordenadora de eventos, eu quero revisar e aprovar o escopo inicial do evento antes de iniciar o planejamento detalhado, para garantir alinhamento com os objetivos corporativos.

- US-12 | Como Rafael, gerente de eventos, eu quero definir o escopo básico do evento (número estimado de participantes, duração e tipo de formato presencial/online), para dimensionar corretamente os recursos necessários.

- US-13 | Como Eduardo, supervisor de recepção, eu quero registrar no sistema quando um convidado VIP chegar, para acionar protocolo de boas-vindas sem atraso.

- US-14 | Como Beatriz, assistente de eventos, eu quero alterar o status do evento de "rascunho" para "em planejamento", para sinalizar que o projeto foi oficialmente iniciado.

- US-15 | Como Thiago, coordenador logístico, eu quero cadastrar os fornecedores recorrentes da empresa com dados básicos (nome, contato, categoria de serviço), para agilizar futuras contratações.

- US-16 | Como Bruno, auxiliar de logística, eu quero alterar o status de uma tarefa de "pendente" para "em andamento", para mostrar que comecei o serviço.

- US-17 | Como Gustavo, coordenador de TI, eu quero visualizar um log de acessos ao sistema por usuário e horário, para identificar comportamentos suspeitos.

- US-18 | Como Felipe, gerente de segurança, eu quero visualizar todos os eventos que envolvam visitantes externos no mês, para programar protocolos de segurança.

- US-19 | Como Amanda, gerente de eventos, eu quero ver na tela inicial o nome, data e status de todos os meus eventos em andamento, para saber o que precisa de atenção.

- US-20 | Como Camila, analista de dados, eu quero filtrar eventos por status (planejado, aprovado, executado, cancelado) em um período específico, para gerar indicadores mensais.

- US-21 | Como Carlos, analista financeiro, eu quero bloquear a edição do orçamento após a aprovação, para evitar desvios não autorizados antes da execução.

- US-22 | Como Beatriz, assistente de eventos, eu quero reabrir um evento já finalizado para incluir uma despesa esquecida, para manter o fechamento contábil correto.

- US-23 | Como Larissa, assiste de compras, eu quero anexar a nota fiscal de um fornecedor diretamente à despesa correspondente, para facilitar a conferência contábil.

- US-24 | Como Renata, gerente de branding, eu quero aplicar a identidade visual da empresa em todos os materiais do evento automaticamente, para garantir consistência.

- US-25 | Como André, gerente de facilities, eu quero receber um aviso 48h antes do evento caso o local reservado tenha conflito de agenda, para providenciar alternativa.

FIM_DO_BACKLOG