# Eval Result

- date: 2026-04-02
- evaluator: Codex
- prompt_version: v2-claude-agents
- case_id: aligna-platform-flow
- target_agent_or_flow: Aligna real platform flow
- model: manual-e2e

## Score

- task_completion: 3
- architectural_fit: 3
- security_and_safety: 3
- validation_readiness: 3
- diff_discipline: 3
- manual_repair_cost: 3
- total: 18

## Notes

- what went well:
  - the real authenticated platform flow of Aligna executed successfully end to end
  - the run covered health, auth gating, registration, session use, alignment analysis, project creation, task creation, comments, observability, readiness, governance, and audit trail
  - the result confirms that the current product is operational beyond isolated unit-style checks
- what broke:
  - nothing broke in the validated run
- what had to be corrected manually:
  - no code correction was needed for this execution
- whether the result should replace the current baseline:
  - yes, this should become the current real-product baseline for Aligna flow validation

## Automated Validation

- `npm --prefix backend run test:e2e:platform`: passed
  summary: > ai-software-factory-backend@1.0.0 test:e2e:platform | > node scripts/platform-e2e.mjs | Platform E2E concluido com sucesso.

## Evidence

- command: `npm --prefix backend run test:e2e:platform`
- runtime target: local Aligna backend responding on `/health`
- scenario exercised by: `backend/scripts/platform-e2e.mjs`
