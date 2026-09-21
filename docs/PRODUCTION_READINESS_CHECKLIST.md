# Production Readiness Checklist

## Objective

Checklist minima para considerar o produto pronto para um ambiente mais profissional, com foco em seguranca, operacao e previsibilidade.

---

## Environment

- [ ] `AUTH_ACCESS_SECRET` definido e forte
- [ ] `AI_SETTINGS_SECRET` definido e diferente do segredo de auth quando possivel
- [ ] `FRONTEND_ORIGIN` definido para o dominio real do frontend
- [ ] `DATABASE_URL` apontando para banco controlado
- [ ] `.env` local nao versionado
- [x] `.env.example` alinhado com os requisitos atuais

## Security

- [x] CSRF ativo e validado para refresh/logout
- [x] smoke test de seguranca passando
- [x] validacao da baseline de seguranca dos geradores passando
- [x] permissoes do arquivo `.env` restritas
- [x] permissoes de `backend/runtime` revisadas
- [ ] logs e artefatos sensiveis nao expostos indevidamente

## Backend

- [x] backend sobe sem fallback inseguro de segredo
- [x] CORS restrito por origem configurada
- [x] `express.json` com limite explicito
- [x] rate limit ativo
- [x] health/readiness respondendo corretamente

## Frontend

- [x] build de producao concluindo sem erro
- [ ] `VITE_API_URL` configurado para o backend correto
- [x] fluxo de autenticacao testado automaticamente
- [x] fluxo de governanca de IA testado automaticamente

## Generated Baseline

- [x] templates principais sem `cors()` aberto
- [x] geradores sem fallback previsivel de segredo
- [x] novos apps gerados com body limit explicito
- [x] outputs legados identificados para hardening ou regeneracao

## Operations

- [x] trilha de auditoria funcionando
- [ ] readiness sem alertas criticos conhecidos
- [x] procedimento de rollback documentado
- [x] procedimento de incidente documentado

## Quality Gates

- [x] `npm run test:security:baseline` em [backend/package.json](/c:/Users/bleao/ai-software-factory/backend/package.json) passando
- [x] `npm run test:security:smoke` em [backend/package.json](/c:/Users/bleao/ai-software-factory/backend/package.json) passando
- [x] `npm run test:auth-governance:smoke` em [backend/package.json](/c:/Users/bleao/ai-software-factory/backend/package.json) passando
- [x] `npm run test:auth-user-flow:smoke` em [backend/package.json](/c:/Users/bleao/ai-software-factory/backend/package.json) passando
- [x] `python -m py_compile` para scripts principais passando
- [x] build do frontend passando

## Current Checkpoint

Data: `2026-04-02`

- quality workflow atualizado para rodar todos os smokes criticos ja previstos neste checklist
- validacao local repetida com sucesso para baseline, smokes de seguranca/auth e build
- build do frontend ainda emite warning de chunk principal acima de 500 kB
- pendencias restantes continuam concentradas em configuracao real de producao, readiness operacional e tuning de frontend

---

## Go / No-Go Rule

So considerar release seria quando:

- nenhum check critico estiver pendente
- segredos estiverem definidos corretamente
- smoke de seguranca e baseline dos geradores estiverem verdes
- owner responsavel tiver revisado o checklist completo
