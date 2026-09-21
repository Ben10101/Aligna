# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e dinheiro gerindo eventos corporativos em planilhas, e-mails e ferramentas desconectadas. Criar uma plataforma única que centralize planejamento, aprovação, execução e acompanhamento de eventos corporativos. A primeira versão permitirá criar um evento, aprovar orçamento, convidar participantes e acompanhar status em tempo real.

## Capacidades do Produto

- Gestão de Eventos**: Criar, editar e arquivar eventos corporativos com informações básicas, cronograma e orçamento
- Fluxo de Aprovação**: Submeter eventos para aprovação hierárquica com rastreamento de decisões e justificativas
- Gestão de Convidados**: Importar listas, enviar convites, confirmar presenças e gerar credenciais digitais
- Acompanhamento em Tempo Real**: Visualizar status de eventos, tarefas pendentes e alertas de atraso via dashboard
- Relatórios Gerenciais**: Gerar relatórios de custos, participação, fornecedores e ROI por evento ou período

## Epicos Recomendados

- EP01 - Cadastro e Configuração Inicial**: Estrutura de empresas, usuários, perfis de acesso e templates de evento
- EP02 - Ciclo de Vida do Evento**: Criação, edição, submissão, aprovação e cancelamento de eventos corporativos
- EP03 - Gestão de Convidados e Credenciamento**: Importação de listas, envio de convites, confirmações e check-in digital
- EP04 - Orçamento e Fornecedores**: Cadastro de fornecedores, itens de orçamento, aprovações e controle de pagamentos
- EP05 - Dashboards e Relatórios**: Visualizações gerenciais de eventos ativos, custos acumulados e performance de fornecedores
- EP06 - Auditoria e Compliance**: Log de alterações, histórico de aprovações e relatórios para auditoria interna

## Fatias de Release

- MVP: foco na espinha dorsal do produto, Foco:** permitir que um PME corporativo crie um evento, defina orçamento simplificado, convide fornecedores, aprove propostas, confirme presenças via e-mail e gere credencial digital. O que fica para depois:** gestão multi-evento simultâneo, integrações financeiras, dashboards avançados, aprovações em workflow customizável, múltiplos níveis de permissão, app mobile nativo, métricas de ROI pós-evento.
- Fase 2: Foco:** suportar múltiplos eventos em paralelo, permissões granulares, aprovação em workflow configurável, integração contábil/financeira e painel executivo de KPIs. O que fica para depois:** marketplace de fornecedores, gamificação, IA para recomendação de fornecedores, app mobile completo, integração com CRM corporativo, módulo de pesquisa pós-evento com NPS.
- Fase 3: Foco:** marketplace aberto de fornecedores, IA para otimização de orçamento e roteirização, app mobile 100 % funcional, integrações com CRM/ERP, pesquisa pós-evento com análise de sentimento e geração automática de relatório executivo. O que fica para depois:** blockchain para rastreabilidade de contratos, recursos de realidade aumentada para visitas guiadas, expansão internacional com compliance local.

## Historias de Usuario

- US-01 | Como Beatriz, assistente de eventos, eu quero cadastrar a lista inicial de participantes do evento, para preparar convites e credenciamento sem depender de planilhas.

- US-02 | Como Carlos, analista financeiro, eu quero registrar o orcamento inicial do evento por categorias principais, para ter uma referencia financeira antes da aprovacao.

- US-03 | Como Felipe, assistente de eventos, eu quero cadastrar um fornecedor com nome, contato e tipo de servico, para vincular parceiros essenciais ao evento.

- US-04 | Como Mariana, coordenadora de eventos, eu quero criar um novo evento informando nome, objetivo, data e local, para iniciar o planejamento em um fluxo estruturado.

- US-05 | Como Mariana, coordenadora de eventos, eu quero definir o escopo basico do evento com publico estimado, formato e duracao, para dimensionar os recursos iniciais corretamente.

- US-06 | Como Roberto, diretor financeiro, eu quero aprovar ou reprovar o orcamento inicial do evento com justificativa, para liberar a execucao com controle financeiro.

- US-07 | Como Mariana, coordenadora de eventos, eu quero visualizar um resumo do evento com escopo, orcamento e status atual, para confirmar se o planejamento inicial esta completo.

- US-08 | Como Felipe, assistente de eventos, eu quero atualizar o status do evento entre rascunho, em planejamento, em aprovacao e aprovado, para acompanhar o andamento operacional do trabalho.

- US-09 | Como **Luciana, gerente de eventos**, eu quero **visualizar um resumo simples do evento com data, local, número estimado de participantes e valor total aprovado**, para **compartilhar rapidamente em reuniões de alinhamento sem abrir o sistema completo**.

- US-10 | Como **Carlos, analista financeiro**, eu quero **registrar a moeda e forma de pagamento preferida para o evento (BRL, USD, cartão corporativo, boleto)**, para **evitar retrabalho na hora de fechar contratos**.

- US-11 | Como **Luciana, gerente de eventos**, eu quero **criar um novo evento corporativo preenchendo nome, data, local e tipo**, para **dar início ao planejamento de um workshop de liderança para 80 gerentes**.

- US-12 | Como **Rafael, estagiário de eventos**, eu quero **registrar o responsável principal pelo evento (PME designado)**, para **saber quem acionar em caso de dúvidas operacionais**.

- US-13 | Como **Carlos, gerente de TI**, eu quero **definir quais campos de orçamento são obrigatórios por tipo de evento**, para **garantir que todas as estimativas incluam os itens críticos de custo**.

- US-14 | Como **Luciana, gerente de eventos**, eu quero **definir o número máximo de participantes permitidos no evento**, para **dimensionar corretamente espaço e materiais desde o início**.

- US-15 | Como **Mariana, coordenadora de eventos**, eu quero **definir o local do evento selecionando entre salas já cadastradas da empresa**, para **garantir disponibilidade sem precisar confirmar por e-mail separado**.

- US-16 | Como **Sandra, coordenadora administrativa**, eu quero **definir o orçamento base do evento com itens essenciais (alimentação, espaço, material e palestrantes)**, para **ter uma estimativa inicial de custos antes de convidar fornecedores**.

- US-17 | Como **Sandra, coordenadora administrativa**, eu quero **definir templates de mensagem de convite por tipo de evento (palestra, treinamento, festa)**, para **manter a consistência da comunicação corporativa**.

- US-18 | Como **Patrícia, gerente de marketing**, eu quero **cadastrar os três fornecedores principais (buffet, locação de sala e gráfica rápida) com contato e categoria**, para **disponibilizar aos demais membros da equipe durante o planejamento**.

- US-19 | Como **Roberto, diretor financeiro**, eu quero **visualizar o comparativo entre orçamento proposto e orçamentos de eventos similares anteriores**, para **validar se os valores estão alinhados com o histórico da empresa**.

- US-20 | Como **Rafael, estagiário de eventos**, eu quero **visualizar o status atual do evento (criado, aguardando aprovação, aprovado ou reprovado)**, para **saber se posso iniciar as próximas tarefas**.

- US-21 | Como **Thiago, controller**, eu quero **visualizar um dashboard consolidado com o total de eventos em andamento, valores comprometidos e valores pagos por centro de custo**, para **acompanhar o desembolso real versus orçado em tempo real**.

- US-22 | Como **Juliana, assistente de eventos**, eu quero **atualizar o status do evento para "em planejamento" após aprovação**, para **informar à equipe que podemos começar a fechar contratos com fornecedores**.

- US-23 | Como **Amanda, assistente de diretoria**, eu quero **gerar um PDF executivo de até duas páginas com status, orçamento e principais riscos de todos os eventos do mês**, para **incluir na pasta de reunião do comitê semanal**.

- US-24 | Como **Rafael, estagiário de eventos**, eu quero **visualizar todos os eventos que precisam de minha ação em uma única lista ordenada por prioridade**, para **não esquecer tarefas pendentes**.

- US-25 | Como **Felipe, assistente de eventos**, eu quero **anexar o briefing inicial do evento em PDF ou Word**, para **centralizar a documentação de requisitos junto ao cadastro**.

FIM_DO_BACKLOG