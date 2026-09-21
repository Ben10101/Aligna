# Security Best Practices Report

## Executive Summary

O projeto tem uma base melhor que o comum em apps internos: refresh token em cookie `HttpOnly`, hash de senha com `scrypt`, hash de refresh token no banco, controle de acesso em rotas principais e alguns headers de segurança já aplicados.

Os riscos mais importantes estão em quatro áreas:

1. O backend aceita um segredo JWT previsível quando a variável de ambiente não está configurada.
2. O rate limiting confia diretamente em `X-Forwarded-For`, o que permite bypass por spoofing.
3. As chaves de provedores de IA são armazenadas e devolvidas em texto puro.
4. O gerador de projetos continua produzindo APIs inseguras por padrão.

---

## Critical / High

### Finding 1
- Rule ID: EXPRESS-AUTH-SECRET-001
- Severity: Critical
- Location: `backend/src/services/authService.js` lines 17-22
- Evidence:

```js
function getAccessSecret() {
  const secret = process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    return 'dev-auth-secret-change-me';
  }
  return secret;
}
```

- Impact: Se a aplicação subir sem `AUTH_ACCESS_SECRET` ou `JWT_SECRET`, qualquer pessoa que conheça esse fallback consegue forjar access tokens válidos e assumir contas.
- Fix: Falhar no bootstrap quando o segredo não estiver configurado, em vez de usar fallback previsível.
- Mitigation: Adicionar health/readiness com status crítico e bloquear startup em produção e staging.
- False positive notes: Só deixa de ser explorável se houver garantia operacional forte de que o backend nunca sobe sem segredo, o que não aparece no código.

### Finding 2
- Rule ID: EXPRESS-RATELIMIT-001
- Severity: High
- Location: `backend/src/middleware/securityMiddleware.js` lines 3-8 and 51-70
- Evidence:

```js
function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
```

```js
const key = `${getClientKey(req)}:${matchesSensitiveRoute(req) ? 'sensitive' : 'default'}`;
```

- Impact: Um atacante pode enviar valores arbitrários em `X-Forwarded-For` e trocar o identificador do bucket a cada requisição, burlando limites em login, refresh e execuções custosas de IA.
- Fix: Não confiar diretamente em `X-Forwarded-For`; configurar `app.set('trust proxy', ...)` com a topologia real e usar apenas `req.ip`, ou aceitar o header somente atrás de proxy confiável.
- Mitigation: Mover rate limiting para um proxy/gateway confiável e usar store centralizado.
- False positive notes: Se um proxy de borda sempre remover e reescrever `X-Forwarded-For`, o risco cai, mas isso não está configurado nem validado no app.

### Finding 3
- Rule ID: EXPRESS-SECRETS-AT-REST-001
- Severity: High
- Location: `backend/src/controllers/aiSettingsController.js` lines 4-7 and 12-15; `backend/src/services/aiSettingsService.js` lines 20-54, 115-137 and 187-193
- Evidence:

```js
export async function getAiSettingsController(req, res, next) {
  try {
    const settings = await getAiSettingsForUser(req.authUser.uuid);
    res.json(settings);
```

```js
gemini: {
  enabled: false,
  apiKey: '',
  model: 'gemini-2.0-flash',
},
```

```js
await prisma.user.update({
  where: { uuid: userUuid },
  data: { aiSettings: nextSettings },
});
```

```js
if (settings.gemini?.enabled && settings.gemini?.apiKey) env.GEMINI_API_KEY = settings.gemini.apiKey;
```

- Impact: Chaves de OpenAI, Anthropic, Gemini e similares ficam legíveis no banco e são devolvidas integralmente ao frontend autenticado. Qualquer XSS, sequestro de sessão no browser, acesso indevido ao banco ou abuso de rota interna expõe segredos reutilizáveis e faturáveis.
- Fix: Criptografar credenciais em repouso com chave do servidor, nunca retornar o valor completo ao cliente e expor apenas flags como `configured: true` ou no máximo valor mascarado.
- Mitigation: Rotacionar chaves periodicamente e segregar provedores por workspace/ambiente.
- False positive notes: Se o produto exigir reexibir a chave para edição, ainda assim o retorno deveria ser mascarado e a descriptografia limitada ao momento de uso no backend.

---

## Medium

### Finding 4
- Rule ID: EXPRESS-GENERATOR-DEFAULTS-001
- Severity: Medium
- Location: `backend/src/templates/fullstack/react-express-prisma/apps/api/src/server.ts.tpl` lines 4-6; `backend/src/services/implementationService.js` line 4619; `orchestrator/backendGenerator.py` lines 64-70 and 372-373
- Evidence:

```ts
const app = express()
app.use(cors())
app.use(express.json())
```

```js
const content = `import express from 'express'\nimport cors from 'cors'\n...app.use(cors())\napp.use(express.json())\n...`;
```

```js
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-prod'
app.use(express.json())
app.use(cors())
```

```env
JWT_SECRET=your-secret-key-change-this-in-production
```

- Impact: O produto principal pode estar parcialmente endurecido, mas o gerador continua emitindo serviços com CORS aberto, sem limite explícito de body parser e com fallback previsível de segredo. Isso multiplica dívida de segurança em cada app gerado.
- Fix: Atualizar templates e geradores para usar CORS allowlist, `express.json({ limit })`, headers de segurança e falha obrigatória quando segredo não estiver configurado.
- Mitigation: Marcar projetos já gerados como “insecure baseline” e aplicar migração de hardening.
- False positive notes: O risco recai sobre projetos gerados e templates, não necessariamente sobre todas as rotas do backend principal.

---

## Positive Notes

- `backend/src/utils/crypto.js` usa `scrypt` para senhas e `timingSafeEqual` na verificação.
- `backend/src/services/authService.js` armazena somente hash do refresh token no banco.
- `backend/src/routes/dataRoutes.js` e `backend/src/routes/authRoutes.js` protegem a maior parte das rotas sensíveis com `requireAuth`.
- `frontend/src/components/ResultTabs.jsx` usa `react-markdown` sem `rehypeRaw`, o que reduz risco de XSS por HTML bruto.
- `frontend/src/utils/projectDocumentationExport.js` faz escape de HTML antes de montar o documento.

## Recommended Next Steps

1. Remover imediatamente o fallback de segredo JWT e fazer o backend falhar ao iniciar sem segredo válido.
2. Corrigir o identificador do rate limiter para não confiar em `X-Forwarded-For` sem proxy confiável.
3. Criptografar e mascarar as chaves de IA, com ajuste das rotas `GET/PUT /auth/ai-settings`.
4. Hardenizar os templates e o gerador para parar de propagar defaults inseguros.
