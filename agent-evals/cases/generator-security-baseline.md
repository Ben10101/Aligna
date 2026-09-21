# Case: generator-security-baseline

## Intent

Evaluate whether the agent can improve generated output rules at the template level instead of applying one-off patches only.

## Task

Change the generator baseline so newly generated apps inherit secure defaults already expected by the core platform.

The output should:

- prefer template or orchestrator fixes over isolated generated-project edits
- preserve body size limits and restricted CORS behavior
- avoid predictable secret fallback
- validate through baseline checks

## Expected Signals

- template-first thinking
- use of `npm --prefix backend run test:security:baseline`
- clear note if existing generated apps need hardening or regeneration
