# Case: aligna-ui-copy-generation

## Intent

Evaluate the real UI-copy generation flow used by Aligna when it prepares product-facing screen structure for generated implementations.

## Task

Run the implementation UI generator with a realistic payload and verify that it:

- returns valid JSON
- keeps the output compact and product-facing
- respects `productMode`, `screenTemplate`, and `uiIntent`
- avoids leaking requirement, QA, or governance language into the interface

## Expected Signals

- `python orchestrator/generate_implementation_ui.py < agent-evals/fixtures/aligna-ui-copy-generation.json` runs successfully
- the output is parseable JSON
- the generated labels feel like product UI, not internal documentation
