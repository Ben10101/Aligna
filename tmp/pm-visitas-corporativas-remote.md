# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e segurança ao gerenciar visitas em áreas restritas com planilhas, e-mails e portarias desconectadas. A plataforma centraliza pré-cadastro, aprovação, recepção e rastreabilidade em um único workspace, garantindo que cada visitante entre autorizado, registrado e monitorado. A primeira versão entrega o fluxo completo de solicitação → aprovação → check-in/out para uma unidade piloto.

## Capacidades do Produto

- Cadastro & Configuração** – Criar unidades, áreas, tipos de visita, formulários dinâmicos e regras de aprovação.
- Fluxo de Visita** – Solicitar, aprovar, agendar, receber, liberar e encerrar visitas com QR/OTP e foto.
- Gestão em Tempo Real** – Painel de visitas ativas, filas de recepção, alertas de atraso e mapa de presença.
- Relatórios & Auditoria** – Histórico detalhado, dashboards de SLA, export para compliance e integração com SIEM.
- Segurança & Permissões** – RBAC, políticas de acesso, assinatura digital de NDA e logs imutáveis.

## Epicos Recomendados

- EPIC-001: Fundação da Plataforma** – Estrutura multitenancy, cadastro de unidades/áreas, perfis de segurança e APIs base.
- EPIC-002: Workflow de Visita** – Do pedido ao encerramento, incluindo aprovações em cadeia, convites eletrônicos e check-in biométrico.
- EPIC-003: Operação de Recepção** – Fila de chegada, validação de documentos, emissão de crachá e notificações ao anfitrião.
- EPIC-004: Visibilidade Gerencial** – Dashboard executivo, KPIs de segurança, relatórios exportáveis e alertas configuráveis.
- EPIC-005: Governança & Compliance** – Auditoria completa, políticas de retenção, LGPD e integração com AD/LDAP.

## Fatias de Release

- MVP: foco na espinha dorsal do produto, Foco: viabilizar o ciclo mínimo de visita corporativa (pré-cadastro → aprovação → check-in → check-out) para um único visitante em uma única unidade, com identificação básica, termo de acesso digital e registro de entrada/saída. Fica para depois: múltiplas unidades, acompanhantes, integrações com sistemas de RH/terceiros, dashboards analíticos, políticas avançadas de segurança, notificações em tempo real, anexos de documentos adicionais e gestão de crachás físicos.
- Fase 2: Foco: expandir para várias unidades/áreas restritas, permitir cadastro de acompanhantes, fluxo de aprovação em níveis (segurança, área técnica, diretoria), anexo de documentos obrigatórios e histórico de acesso consultável. Fica para depois: integração com controle de ponto, BI avançado, API aberta, políticas dinâmicas de segurança por perfil, visitas recorrentes automatizadas e módulo de auditoria completa.
- Fase 3: Foco: automação de visitas recorrentes, integração nativa com sistemas de SSO, RH, controle de ponto e CCTV, dashboards preditivos de lotação, políticas de segurança adaptativas, API pública para parceiros e auditoria completa com assinatura digital de relatórios. Fica para depois: funcionalidades de marketplace de serviços, chatbot de autoatendimento, reconhecimento facial opcional e expansão internacional com compliance regional.

## Historias de Usuario

- US-01 | Como Patricia, supervisora de recepcao, eu quero definir o escopo basico da visita com volume estimado, formato e parametros principais, para dimensionar os recursos iniciais corretamente.

- US-02 | Como Bruno, assistente de recepcao, eu quero cadastrar o fornecedor com nome, contato e tipo de suporte, para vincular os recursos essenciais da visita.

- US-03 | Como Rafael, gestor da unidade, eu quero aprovar ou reprovar os dados iniciais de autorizacao da visita com justificativa, para liberar a execucao com controle minimo.

- US-04 | Como Patricia, supervisora de recepcao, eu quero visualizar o resumo da visita, com escopo, base operacional e status atual, para confirmar se o planejamento inicial esta completo.

- US-05 | Como Bruno, assistente de recepcao, eu quero atualizar o status da visita entre rascunho, em planejamento, em aprovacao e aprovado, para acompanhar o andamento operacional do trabalho.

- US-06 | Como Bruno, assistente de recepcao, eu quero cadastrar a lista inicial de visitantes da visita, para preparar a operacao sem depender de planilhas.

- US-07 | Como Luciana, analista administrativa, eu quero registrar os dados iniciais de autorizacao da visita, para ter uma referencia operacional antes da aprovacao.

- US-08 | Como Patricia, supervisora de recepcao, eu quero criar a visita informando nome, objetivo, data e contexto inicial, para iniciar o fluxo principal de forma estruturada.

- US-09 | Como Luciana, analista administrativa, eu quero registrar o orçamento estimado da visita piloto (valor e centro de custo), para controlar os gastos operacionais desde o início.

- US-10 | Como Patricia, supervisora de recepção, eu quero cadastrar o primeiro fornecedor de crachás com nome e contato, para ter pronto o parceiro que emitirá os passes de visita.

- US-11 | Como Simone, assistente administrativa, eu quero fazer o primeiro pré-cadastro de visitante com nome, empresa, CPF e telefone, para validar o formulário antes de abrir para os demais colaboradores.

- US-12 | Como Ricardo, responsável de segurança da unidade, eu quero visualizar o resumo de segurança da visita (visitantes, áreas autorizadas, horários), para validar se tudo está dentro das regras antes da liberação.

- US-13 | Como Bruno, gerente de segurança, eu quero aprovar a primeira visita teste com um único clique, para confirmar que o fluxo mínimo de aprovação está funcionando.

- US-14 | Como Amanda, gerente de projeto piloto, eu quero cadastrar a primeira unidade com nome, endereço e horário de funcionamento, para iniciar o teste real da plataforma.

- US-15 | Como Amanda, gerente de projeto piloto, eu quero cadastrar o primeiro responsável pela segurança da unidade com nome, e-mail e telefone, para designar quem fará as aprovações iniciais.

- US-16 | Como Ana Paula, gerente de segurança da unidade, eu quero cadastrar regras de aprovação por tipo de visita (ex: visita técnica exige OK de engenharia), para garantir que cada solicitação passe pelos responsáveis corretos antes da liberação.

- US-17 | Como Diego, segurança patrimonial, eu quero registrar ocorrências durante visita (ex: acesso não autorizado a área restrita), para documentar incidentes vinculados ao registro do visitante.

- US-18 | Como Fernanda, assistente de RH, eu quero reativar uma visita cancelada sem precisar criar nova solicitação, para corrigir erros de agendamento sem perder histórico original.

- US-19 | Como Juliana, assistente de facilities, eu quero cadastrar feriados e dias de manutenção no calendário da unidade, para que o sistema bloqueie agendamentos automaticamente nesses períodos.

- US-20 | Como Patricia, recepcionista noturna, eu quero registrar visita emergencial fora do horário comercial com aprovação via OTP do plantonista, para garantir segurança mesmo em horários não regulares.

- US-21 | Como Paula, analista de facilities, eu quero cadastrar os tipos de visita disponíveis (ex: visita técnica, reunião executiva, manutenção), para padronizar as solicitações desde o início.

- US-22 | Como Ricardo, responsável de segurança da unidade, eu quero cadastrar as áreas restritas dentro da unidade (ex: sala de servidores, laboratório químico), para delimitar onde cada visitante pode ou não entrar.

- US-23 | Como Tatiane, analista de segurança, eu quero reabrir uma visita já encerrada para adicionar novas ocorrências descobertas posteriormente, para garantir que incidentes sejam registrados no histórico correto sem criar duplicatas.

- US-24 | Como Ricardo, responsável de segurança da unidade, eu quero definir o horário de funcionamento padrão da unidade (abertura e fechamento), para que o sistema bloqueie agendamentos fora desse período.

- US-25 | Como Sandra, gerente de TI, eu quero definir política de retenção de dados (ex: excluir registros após 5 anos), para cumprir LGPD e reduzir custos de armazenamento.

FIM_DO_BACKLOG