# Incident Response Runbook

## Objective

Padronizar a resposta inicial a incidentes do produto para reduzir improviso, tempo de diagnóstico e risco operacional.

---

## Incident Triggers

Abrir incidente quando houver:

- indisponibilidade do backend
- falha severa de autenticação
- erro persistente de geração ou execução de agentes
- aumento anormal de falhas em produção
- suspeita de vazamento de segredo ou abuso
- corrupção ou inconsistência operacional relevante

## Immediate Response

1. Confirmar se o incidente é real e reproduzível.
2. Identificar escopo:
   - backend
   - frontend
   - banco
   - providers de IA
   - outputs gerados
3. Registrar horário de início, sintomas e impacto.
4. Suspender qualquer mudança de release em andamento.

## First Checks

1. Verificar `/health` e readiness.
2. Verificar logs recentes e trilha de auditoria.
3. Confirmar se há erro de segredo, CORS, CSRF ou provider.
4. Verificar se houve mudança recente em:
   - `.env`
   - templates
   - geradores
   - autenticação
   - pipeline de execução

## Severity Guide

- `SEV-1`: sistema principal indisponível ou risco sério de segurança
- `SEV-2`: funcionalidade crítica degradada com workaround parcial
- `SEV-3`: falha importante, mas contornada
- `SEV-4`: problema localizado ou não crítico

## Containment Actions

- bloquear releases
- reverter mudança recente se necessário
- desabilitar funcionalidade específica
- reduzir escopo de uso do provider afetado
- rotacionar segredos se houver suspeita de exposição

## Recovery

1. Aplicar correção ou rollback.
2. Revalidar:
   - smoke de segurança
   - baseline dos geradores
   - frontend build
3. Confirmar estabilidade por janela mínima de observação.
4. Atualizar status do incidente com causa, impacto e decisão.

## Post-Incident

Após recuperação:

- registrar causa raiz
- registrar ação corretiva
- registrar ação preventiva
- atualizar checklist ou automação correspondente

## Minimum Evidence To Close

- causa documentada
- impacto documentado
- ação aplicada documentada
- validação pós-correção registrada
