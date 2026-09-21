# BACKLOG DO PROJETO

## Visao Geral

Empresas perdem tempo e segurança com visitas corporativas manuais, planilhas descentralizadas e falta de rastreabilidade. A plataforma unifica pré-cadastro, aprovação, credenciamento e histórico de acesso em um workspace operacional, garantindo compliance e reduzindo o tempo de check-in em 70%. A primeira versão entrega fluxo completo de visita: solicitação → aprovação → credenciamento → entrada/saída.

## Capacidades do Produto

- Cadastro & Configuração** – CRUD de unidades, áreas restritas, tipos de visita, regras de acesso e formulários dinâmicos.
- Fluxo de Visita** – Solicitação, aprovação em níveis, credenciamento (QR/badge), check-in/out com biometria ou código.
- Gestão em Tempo Real** – Dashboard de visitas ativas, filas de recepção, alertas de atraso e relatórios gerenciais.
- Governança & Auditoria** – Log completo de ações, políticas de retenção, export para compliance e API de integração com sistemas legados.

## Epicos Recomendados

- EPIC-01: Modelagem de Domínio e Permissões** – Estruturar entidades (visitante, visita, área, anfitrião) e matriz de permissões baseada em função e unidade.
- EPIC-02: Fluxo de Solicitação e Aprovação** – Criar jornada do solicitante, motor de regras de aprovação (multi-nível) e notificações por e-mail/app.
- EPIC-03: Credenciamento e Controle de Acesso** – Gerar credencial digital/QR, integrar com leitor de entrada e registrar eventos de acesso em tempo real.
- EPIC-04: Dashboards e Relatórios** – Painéis de visitas ativas, histórico filtrável, KPIs de SLA de aprovação e mapa de calor de áreas mais visitadas.
- EPIC-05: Auditoria e Compliance** – Log imutável, retenção configurável, exportação em CSV/PDF e certificação de conformidade LGPD/SOX.

## Fatias de Release

- MVP: foco na espinha dorsal do produto, Foco: fluxo completo de visita corporativa (pré-cadastro → aprovação → recepção → acesso → saída) para visitantes individuais em uma única unidade, com autenticação simples via e-mail e registro básico de histórico. Fica para depois: acompanhantes, múltiplas unidades, integração com sistemas corporativos, políticas avançadas de segurança, dashboards analíticos, notificações push, multilíngue, LGPD completa.
- Fase 2: Foco: suporte nativo a várias unidades/áreas restritas, cadastro de acompanhantes, catálogo de documentos obrigatórios por tipo de visita, workflow de aprovação em níveis e primeiros relatórios de governança. Fica para depois: integração com sistemas de RH/SSO, políticas dinâmicas de segurança, BI avançado, aplicativo móvel para segurança, LGPD automatizada, API aberta.
- Fase 3: Foco: integrações bidirecionais com sistemas corporativos (RH, SSO, controle de acesso físico), automação de políticas de segurança via regras dinâmicas, BI avançado com alertas proativos, API pública para terceiros, LGPD automatizada e aplicativo móvel para visitantes e segurança. Fica para depois: funcionalidades de marketplace de visitas, blockchain para auditoria, IA para previsão de risco, expansão internacional.

## Historias de Usuario

- US-01 | Como Mariana, coordenadora de eventos, eu quero criar o evento informando nome, objetivo, data e contexto inicial, para iniciar o fluxo principal de forma estruturada.

- US-02 | Como Mariana, coordenadora de eventos, eu quero definir o escopo basico do evento com volume estimado, formato e parametros principais, para dimensionar os recursos iniciais corretamente.

- US-03 | Como Carlos, analista financeiro, eu quero registrar o registro operacional inicial do evento, para ter uma referencia operacional antes da aprovacao.

- US-04 | Como Felipe, assistente de eventos, eu quero cadastrar o recurso essencial com nome, contato e tipo de suporte, para vincular os recursos essenciais do evento.

- US-05 | Como Felipe, assistente de eventos, eu quero cadastrar a lista inicial de visitantes do evento, para preparar a operacao sem depender de planilhas.

- US-06 | Como Roberto, diretor financeiro, eu quero aprovar ou reprovar o registro operacional inicial do evento com justificativa, para liberar a execucao com controle minimo.

- US-07 | Como Mariana, coordenadora de eventos, eu quero visualizar o resumo do evento, com escopo, base operacional e status atual, para confirmar se o planejamento inicial esta completo.

- US-08 | Como Felipe, assistente de eventos, eu quero atualizar o status do evento entre rascunho, em planejamento, em aprovacao e aprovado, para acompanhar o andamento operacional do trabalho.

- US-09 | Como **Eduardo, supervisor de manutenção da Siemens**, eu quero registrar uma visita técnica de emergência fora do horário comercial com justificativa e aprovação única do plantão, para autorizar entrada imediata do técnico sem quebrar SLA.

- US-10 | Como **André, recepcionista do edifício JK**, eu quero visualizar no dashboard inicial quantas visitas estão agendadas para hoje e quantas já chegaram, para organizar a fila de atendimento sem sobrecarregar a recepção.

- US-11 | Como **Diego, operador de logística da Cosan**, eu quero registrar o motivo de recusa de uma visita em campo obrigatório, para manter histórico transparente e evitar solicitações repetidas.

- US-12 | Como **Patrícia, assistente de diretoria da Vale**, eu quero cadastrar uma lista VIP de executivos que façam check-in expresso sem aprovação prévia, para agilizar a entrada de conselheiros e acionistas.

- US-13 | Como **Vanessa, analista de segurança da Suzano**, eu quero cadastrar os primeiros 50 visitantes recorrentes (fornecedores, auditores, técnicos) com nome, CPF, empresa e foto, para agilizar futuras solicitações sem repetir cadastro.

- US-14 | Como **Juliana, coordenadora de facilities do edifício JK**, eu quero cadastrar horários de pico (07h-09h, 12h-13h30) nos quais o sistema limite automaticamente novas solicitações, para evitar filas na recepção e atrasar colaboradores.

- US-15 | Como **Rodrigo, coordenador de facilities da fábrica da JBS em Lins**, eu quero cadastrar tipos de visita (técnica, comercial, auditoria, manutenção) com duração padrão e áreas permitidas, para padronizar as solicitações desde o início.

- US-16 | Como **Renata, gerente de segurança da unidade Campinas da Embraer**, eu quero cadastrar minha unidade com nome, endereço e zonas de acesso (recepção, área técnica, escritórios), para que o sistema reconheça onde cada visita será realizada.

- US-17 | Como **Luciana, gerente de segurança da Gerdau**, eu quero configurar que visitantes de fornecedores críticos sejam obrigados a anexar

- US-18 | Como **Helena, gerente de segurança da Suzano**, eu quero configurar regras de aprovação em cadeia (ex.: segurança → área → diretoria) com prazo de 2 horas por nível, para cumprir política interna sem gargalos.

- US-19 | Como **Felipe, supervisor de portaria da Cosan em Paulínia**, eu quero configurar horário de funcionamento da unidade (06h-22h) e dias úteis, para que o sistema bloqueie visitas fora desse período automaticamente.

- US-20 | Como **Cláudia, gerente de segurança da Gerdau Ouro Branco**, eu quero aprovar a primeira visita teste de um técnico da Siemens ao setor de caldeiraria, para validar se todo o fluxo (solicitação → aprovação → credencial → entrada) funciona corretamente.

- US-21 | Como **Ana Paula, gerente de compliance da PetroFarma**, eu quero configurar políticas de retenção de dados por tipo de visita (ex.: visita técnica 90 dias, auditoria 5 anos), para garantir conformidade com a LGPD e normas ANVISA sem apagar registros antes do prazo legal.

- US-22 | Como **Rafael, administrador de sistema da Tivit**, eu quero definir templates de formulário dinâmico por tipo de visita (ex.: auditoria exige número de processo, visita técnica exige EPI), para garantir que cada solicitação colete exatamente as informações obrigatórias sem retrabalho.

- US-23 | Como **Sandra, analista de segurança da Embraer**, eu quero visualizar um mapa de calor das áreas mais visitadas nos últimos 30 dias, para identificar pontos de risco e ajustar rotas de evacuação.

- US-24 | Como **Patrícia, assistente de diretoria da Vale**, eu quero alterar o status de uma visita de "agendada" para "em andamento" quando o visitante chegar, para manter o controle em tempo real sem depender de planilhas paralelas.

- US-25 | Como **Thiago, estagiário de RH da Natura**, eu quero ser notificado por e-mail quando um visitante entregar documento vencido, para solicitar a atualização antes da data agendada.

FIM_DO_BACKLOG