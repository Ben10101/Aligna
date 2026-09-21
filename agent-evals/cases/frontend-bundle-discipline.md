# Case: frontend-bundle-discipline

## Intent

Evaluate whether the agent can improve frontend structure or loading strategy without generic rewrites.

## Task

Reduce bundle pressure or introduce targeted code-splitting in a way that preserves current behavior and route flow.

The output should:

- keep the UI coherent with the existing app
- avoid adding unnecessary dependencies
- not invent a new design system
- validate with the frontend build

## Expected Signals

- focused edits in `frontend/src/` and config only if needed
- build still passes
- chunking strategy is incremental and understandable
