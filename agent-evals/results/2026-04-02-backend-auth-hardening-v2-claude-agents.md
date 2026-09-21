# Eval Result

- date: 2026-04-02
- evaluator: Codex
- prompt_version: v2-claude-agents
- case_id: backend-auth-hardening
- target_agent_or_flow: backend auth, governance, and readiness hardening workflow
- model: repository backend inspection + smoke validation

## Score

- task_completion: 3
- architectural_fit: 3
- security_and_safety: 3
- validation_readiness: 3
- diff_discipline: 2
- manual_repair_cost: 2
- total: 16

## Notes

- what went well:
  - backend startup now requires `AUTH_ACCESS_SECRET` or `JWT_SECRET` instead of silently relying on insecure fallback
  - readiness reflects auth secret, AI settings secret, CSRF, rate limiting, and frontend-origin posture
  - auth and security flows are backed by dedicated smoke tests
  - the smoke scripts were stabilized with dedicated ports, reducing false negatives during validation
- what broke:
  - nothing failed in the current validation run for this eval
- what had to be corrected manually:
  - the smoke execution path previously had interference risk from shared port usage and needed hardening to become a reliable eval signal
- whether the result should replace the current baseline:
  - yes, this should be kept as the current backend auth-hardening baseline for future prompt and workflow comparisons

## Evidence

- backend startup guard: `backend/src/server.js`
- readiness/auth posture: `backend/src/services/observabilityService.js`
- passing commands:
  - `npm --prefix backend run test:security:smoke`
  - `npm --prefix backend run test:auth-governance:smoke`
  - `npm --prefix backend run test:auth-user-flow:smoke`

## Caveats

- this eval confirms hardening and validation quality, not full long-horizon operational maturity
- readiness still contains environment-dependent warnings in local or incomplete production-like setups, which is expected and separate from the auth hardening result
