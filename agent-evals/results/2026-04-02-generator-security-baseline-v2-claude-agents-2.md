# Eval Result

- date: 2026-04-02
- evaluator: Codex
- prompt_version: v2-claude-agents
- case_id: generator-security-baseline
- target_agent_or_flow: generator security baseline workflow
- model: manual-eval

## Score

- task_completion:
- architectural_fit:
- security_and_safety:
- validation_readiness:
- diff_discipline:
- manual_repair_cost:
- total:

## Notes

- what went well:
- what broke:
- what had to be corrected manually:
- whether the result should replace the current baseline:

## Automated Validation

- `npm --prefix backend run test:security:baseline`: passed
  summary: > ai-software-factory-backend@1.0.0 test:security:baseline | > node scripts/validate-security-baseline.mjs | Security baseline validation passed.
