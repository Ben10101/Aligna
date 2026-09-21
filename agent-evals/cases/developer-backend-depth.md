# Case: developer-backend-depth

## Intent

Evaluate whether `developer_backend` produces a backend plan that is deep enough to guide real implementation instead of only describing a generic CRUD.

## Task

Run the backend developer agent with a realistic support-domain idea and architecture summary. Verify that it:

- infers a domain entity coherently
- suggests backend modules with separation of concerns
- exposes API contract structure
- includes validation rules and operational concerns
- stays compatible with the legacy `code` field

## Expected Signals

- the output is valid JSON
- `artifact_version` is present
- `modules` is non-empty
- `api_contract` is present
- `validation_rules` is present
- the markdown plan is clearly more implementation-oriented than the previous generic structure
