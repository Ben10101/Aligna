# Release And Rollback Runbook

## Objective

Padronizar como mudanças são promovidas e, quando necessário, revertidas com menor risco.

---

## Before Release

Confirmar:

- smoke de segurança passando
- baseline de segurança dos geradores passando
- build do frontend passando
- validação Python dos scripts críticos passando
- `.env` e segredos revisados
- mudanças sensíveis revisadas

## Release Steps

1. Congelar mudanças paralelas não relacionadas.
2. Validar branch e escopo da release.
3. Executar quality gates definidos.
4. Publicar backend e frontend.
5. Verificar:
   - `/health`
   - autenticação
   - governança de IA
   - fluxo crítico principal

## Rollback Triggers

Fazer rollback quando houver:

- falha crítica em autenticação
- erro em fluxo principal sem workaround aceitável
- degradação clara de disponibilidade
- regressão de segurança
- inconsistência severa em outputs gerados

## Rollback Steps

1. Parar rollout adicional.
2. Reverter para a última versão estável conhecida.
3. Revalidar health, smoke e fluxo principal.
4. Confirmar normalização operacional.
5. Registrar causa e evidência.

## Post-Release Verification

Após release ou rollback, verificar:

- `/health` respondendo corretamente
- logs sem explosão anormal de erro
- smoke de segurança ainda consistente
- frontend carregando normalmente
- auth refresh/logout funcionando

## Evidence To Record

- versão liberada
- horário de release
- horário de rollback, se houver
- motivo
- responsável
- checks executados
