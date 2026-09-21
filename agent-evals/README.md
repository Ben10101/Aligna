# Agent Evals

This folder defines a lightweight evaluation loop for code-generation agents in AI Software Factory.

## Goal

Measure whether prompt, subagent, and workflow changes actually improve code generation quality instead of only sounding better.

## How To Use

1. Pick one eval case from `cases/`.
2. Run the target agent or agent workflow with the provided task.
3. Save the produced output or diff.
4. Score the result using `rubric.md`.
5. Write the result in `results/` using `result-template.md`.

You can also scaffold a new result file with:

- `node scripts/agent-evals/run-eval.mjs <case-id> --prompt-version <version>`
- `node scripts/agent-evals/run-eval.mjs <case-id> --prompt-version <version> --run`

With `--run`, the script executes the default validation commands mapped to that case and appends a short automated validation section to the result file.

Provider comparison is also supported for cases that depend on LLM runtime:

- `node scripts/agent-evals/run-eval.mjs aligna-ui-copy-generation --prompt-version v3-claude-cookbook-ui --provider-order anthropic --disable-ollama-fallback --run`
- `node scripts/agent-evals/run-eval.mjs aligna-ui-copy-generation --prompt-version v3-claude-cookbook-ui --provider-order gemini --disable-ollama-fallback --run`
- `node scripts/agent-evals/run-eval.mjs aligna-ui-copy-generation --prompt-version v3-claude-cookbook-ui --provider-order nvidia --disable-ollama-fallback --run`

Supported runtime override flags:

- `--provider-order <csv>`
- `--llm-provider <value>`
- `--disable-ollama-fallback`

When a mapped command prints JSON, the runner also captures lightweight runtime metadata such as:

- `meta.source`
- `meta.providerHint`
- `artifact_version`
- `primary_entity`
- short structural signals from modules, operations, or UI sections

## What To Measure

- task completion
- architectural fit
- security baseline alignment
- validation readiness
- diff discipline
- need for manual repair

## Suggested Process

Use the same cases repeatedly when prompts or agent structure changes.

Recommended comparison:

- baseline prompt/version
- new prompt/version
- notes on what changed

This repository already records prompt version metadata in runtime flows, so keep eval naming aligned with `AI_PROMPT_VERSION` where possible.

## Current Baseline

Initial recorded baseline:

- `2026-04-02`
- case: `generator-security-baseline`
- prompt version: `v2-claude-agents`
- result file: `results/2026-04-02-generator-security-baseline-v2-claude-agents.md`

Additional recorded baseline:

- `2026-04-02`
- case: `backend-auth-hardening`
- prompt version: `v2-claude-agents`
- result file: `results/2026-04-02-backend-auth-hardening-v2-claude-agents.md`

Additional recorded baseline:

- `2026-04-02`
- case: `frontend-bundle-discipline`
- prompt version: `v2-claude-agents`
- result file: `results/2026-04-02-frontend-bundle-discipline-v2-claude-agents.md`

## Initial Eval Set

The initial comparison set is now complete for three high-value scenarios:

- generated-code security baseline
- backend auth hardening
- frontend bundle discipline

Additional real-product scenario available:

- aligna platform flow
- aligna ui copy generation
- developer backend depth
- developer frontend depth
- generation ir contract
- project manager backlog quality
- pipeline coherence observability

Recorded real-product baseline:

- `2026-04-02`
- case: `aligna-platform-flow`
- prompt version: `v2-claude-agents`
- result file: `results/2026-04-02-aligna-platform-flow-v2-claude-agents.md`

Recorded UI-generator baseline:

- `2026-04-02`
- case: `aligna-ui-copy-generation`
- prompt version: `v3-claude-cookbook-ui`
- result file: `results/2026-04-02-aligna-ui-copy-generation-v3-claude-cookbook-ui.md`

Recorded Sprint 5 comparison outputs:

- `2026-04-02`
- case: `developer-backend-depth`
- prompt version: `v5-evals`
- result file: `results/2026-04-02-developer-backend-depth-v5-evals.md`

- `2026-04-02`
- case: `developer-frontend-depth`
- prompt version: `v5-evals`
- result file: `results/2026-04-02-developer-frontend-depth-v5-evals.md`

- `2026-04-02`
- case: `aligna-ui-copy-generation`
- prompt version: `v5-evals`
- result file: `results/2026-04-02-aligna-ui-copy-generation-v5-evals.md`

Project Manager backlog quality check available:

- `node scripts/agent-evals/run-eval.mjs project-manager-backlog-quality --prompt-version <version> --run`

Pipeline coherence observability check available:

- `node scripts/agent-evals/run-eval.mjs pipeline-coherence-observability --prompt-version <version> --run`
