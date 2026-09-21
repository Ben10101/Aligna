# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e dinheiro gerindo eventos corporativos em planilhas, e-mails e ferramentas desconectadas. A plataforma centraliza todo o ciclo de vida do evento — planejamento, aprovação, execução e acompanhamento — em um workspace único, garantindo visibilidade em tempo real, controle orçamentário e compliance. A primeira versão entrega criação de eventos, aprovação simples, gestão de fornecedores e credenciamento básico.

## Capacidades do Produto

- Gestão de Eventos Corporativos** – Criar, editar, aprovar e acompanhar eventos com cronograma, orçamento e escopo.
- Gestão de Fornecedores e Materiais** – Cadastrar, avaliar e vincular fornecedores, produtos e serviços ao evento.
- Credenciamento e Controle de Acesso** – Emitir convites, confirmar presenças e liberar entrada via QR ou lista.
- Aprovação e Compliance** – Fluxo de aprovação configurável, trilha de auditoria e conformidade com políticas internas.
- Dashboards e Relatórios** – Visão gerencial de status, orçamento, KPIs e resultados pós-evento.

## Epicos Recomendados

- EP01 – Cadastro e Configuração Inicial da Empresa
- EP02 – Criação e Aprovação de Eventos
- EP03 – Gestão de Fornecedores e Contratações
- EP04 – Credenciamento e Check-in de Convidados
- EP05 – Dashboard Executivo e Relatórios
- EP06 – Auditoria e Controle de Mudanças

## Fatias de Release

- MVP: foco na espinha dorsal do produto, Foco: permitir que um PM corporativo crie um evento, defina orçamento básico, convide participantes via e-mail, confirme presença, credencie no dia e registre feedback pós-evento. O que fica para depois: gestão avançada de fornecedores, múltiplos eventos simultâneos, permissões granulares, integrações financeiras, dashboards analíticos, app mobile, automação de comunicação e white-label.
- Fase 2: Foco: permitir que a empresa gerencie múltiplos eventos em paralelo, com papéis e permissões refinados, aprovação em workflow, catálogo de fornecedores, comparação de orçamentos e relatórios gerenciais. O que fica para depois: automação de compras, marketplace de fornecedores, IA de recomendação, gamificação, integrações profundas com ERP/CRM, app mobile nativo e APIs públicas.
- Fase 3: Foco: transformar a plataforma em um ecossistema de eventos corporativos com marketplace de fornecedores, automação de compras via contratos, IA para sugestão de layouts e cronogramas, APIs abertas, app mobile completo e white-label para clientes externos. O que fica para depois: expansão internacional, blockchain de contratos, recursos de realidade aumentada para montagem de espaços e módulos verticais específicos (feiras, congressos, incentivos).

## Historias de Usuario

- US-01 | Como Rodrigo, diretor de operações, eu quero aprovar ou rejeitar em lote todos os eventos pendentes de minha área com um único clique, para liberar ou barrar a execução sem precisar abrir cada solicitação individualmente.

- US-02 | Como Roberto, diretor financeiro da holding, eu quero visualizar um painel consolidado com o status de aprovação de todos os eventos em andamento da empresa, para garantir que nenhum orçamento ultrapasse o limite mensal aprovado pelo board.

- US-03 | Como Elisa, gerente de eventos, eu quero visualizar em tempo real um painel de status do evento ao vivo mostrando taxa de check-in, consumo de coffee-break e alertas de segurança, para tomar decisões rápidas durante a execução sem depender de relatórios manuais.

- US-04 | Como Thiago, coordenador de eventos externos, eu quero registrar justificativas para alterações de última hora no orçamento (ex: troca de fornecedor por falha), para manter histórico auditável de decisões tomadas sob pressão.

- US-05 | Como Amanda, administradora de contratos, eu quero cadastrar cláusulas de compliance obrigatórias por tipo de evento, para que o sistema valide automaticamente se todos os fornecedores atendem aos requisitos legais antes da aprovação.

- US-06 | Como Ricardo, supervisor de facilities, eu quero registrar ocorrências durante o evento (falta de cadeiras, problemas de ar condicionado, etc) com foto e descrição, para criar um histórico de problemas recorrentes e melhorar futuros eventos.

- US-07 | Como Larissa, supervisora de eventos, eu quero pausar temporariamente todas as atividades de um evento em andamento e registrar o motivo (ex: chuva, falha de som), para que o cronograma seja recalculado automaticamente e os stakeholders sejam informados sem retrabalho.

- US-08 | Como Patricia, coordenadora de eventos, eu quero definir limites de orçamento por categoria (alimentação, decoração, tecnologia) e receber alertas quando 80% do valor for atingido, para ev

- US-09 | Como Camila, gerente de RH internacional, eu quero definir idiomas padrão para os e-mails de convite e credenciamento por região, para garantir que todos os convidados recebam comunicações no seu idioma nativo.

- US-10 | Como Leonardo, gerente de segurança corporativa, eu quero configurar níveis de acesso diferenciados por área do evento (palestras, salas VIP, estandes), para garantir que apenas pessoas autorizadas entrem em locais restritos.

- US-11 | Como Juliana, gerente de marketing, eu quero configurar templates de e-mail personalizados para confirmação de presença, lembretes e agradecimentos pós-evento, para manter a identidade visual da empresa consistente em todas as comunicações.

- US-12 | Como Alexandre, gerente de vendas, eu quero receber no meu e-mail um resumo executivo do evento de lançamento de produto assim que ele for finalizado, incluindo número de participantes, custos reais e feedback médio, para apresentar ao board sem precisar acessar o sistema.

- US-13 | Como Felipe, responsável pelo credenciamento no dia do evento, eu quero imprimir crachás personalizados com QR code e foto do participante direto do sistema, para evitar filas e confusão na entrada do auditório.

- US-14 | Como Beatriz, assistente executiva que organiza eventos para a diretoria, eu quero poder duplicar um evento anterior com todos os fornecedores e estrutura mantidos, para agilizar o planejamento de reuniões recorrentes sem recriar tudo do zero.

- US-15 | Como Gustavo, membro do comitê de governança, eu quero receber notificação imediata sempre que um evento tiver orçamento reajustado acima de 10%, para convocar reunião de validação e garantir conformidade com as diretrizes financeiras da empresa.

- US-16 | Como Simone, analista de RH, eu quero gerar automaticamente uma lista de participantes que não compareceram após confirmar presença, para aplicar a política interna de no-shows e cobrar custos quando necessário.

- US-17 | Como Mariana, coordenadora de compliance, eu quero que o sistema bloqueie automaticamente a contratação de fornecedores que estejam com certidões fiscais vencidas, para evitar multas e problemas legais durante auditoria.

- US-18 | Como Diego, responsável pelo suporte técnico, eu quero receber alertas quando houver falhas no sistema de check-in via QR code, para acionar o plano de contingência com lista impressa antes que os participantes criem filas.

- US-19 | Como Carlos, gerente de TI, eu quero exportar um relatório completo de logs de acesso e alterações realizadas em cada evento, para atender requisitos de segurança da informação e auditoria interna.

- US-20 | Como Fernanda, analista de controladoria, eu quero consolidar automaticamente todos os gastos de um evento em uma planilha compatível com o ERP da empresa, para agilizar o fechamento contábil sem retrabalho manual.

- US-21 | Como Ana Paula, gerente de RH responsável pelo evento de integração de novos colaboradores, eu quero receber alertas automáticos sempre que um convidado confirma ou cancela presença, para ajustar catering e material de boas-vindas sem precisar ficar verificando planilhas.

FIM_DO_BACKLOG