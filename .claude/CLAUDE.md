# AI Software Factory

This repository is an AI-assisted software factory with a multi-agent workflow.

## Mission

When working in this repository:

- preserve the existing product architecture instead of inventing a parallel one
- prefer incremental, production-minded changes over broad rewrites
- optimize for reliable code generation, verifiable outputs, and low-regression edits
- keep generated code aligned with the same security and readiness expectations used by the core product

## Repository Shape

Key areas:

- `frontend/`: React + Vite application
- `backend/`: Express API, auth, governance, observability, templates
- `agents/`: Python agents for project planning, requirements, architecture, development, QA
- `orchestrator/`: workflow coordination for the Python agent pipeline
- `generated-projects/`: emitted project outputs that must follow secure baseline rules
- `docs/`: operating docs, roadmaps, runbooks, architecture, scorecards

## Working Rules

- read the surrounding code before editing
- preserve existing naming, structure, and patterns unless there is a clear benefit in changing them
- do not weaken security defaults
- do not add open CORS, predictable secret fallbacks, or unbounded payload handling
- prefer targeted edits over touching many unrelated files
- when changing generated baselines, consider impact on `generated-projects/` and template validation
- when changing auth, governance, observability, or readiness behavior, keep the smoke tests aligned
- when changing frontend architecture, keep build health in mind and avoid making bundle size worse

## Output Style

For coding tasks:

- first decide whether the task is primarily planning, backend, frontend, testing, or review
- use the matching specialized subagent whenever that will improve focus
- make changes directly when the path is obvious; do not over-plan simple tasks
- when a task is ambiguous, produce a short implementation plan before editing

## Validation Defaults

After meaningful code changes, prefer the smallest relevant validation set:

- backend security and auth changes:
  - `npm --prefix backend run test:security:smoke`
  - `npm --prefix backend run test:auth-governance:smoke`
  - `npm --prefix backend run test:auth-user-flow:smoke`
- generator baseline changes:
  - `npm --prefix backend run test:security:baseline`
- frontend changes:
  - `npm --prefix frontend run build`
- Python orchestrator changes:
  - `python -m py_compile orchestrator/backendGenerator.py orchestrator/projectBuilder.py`

## Definition Of Good Output

Good output in this repository is:

- correct enough to run or validate immediately
- aligned with the multi-agent product model already present in `agents/` and `orchestrator/`
- explicit about tradeoffs and assumptions
- small in blast radius
- backed by tests, smokes, or a clear note explaining what was not verified
