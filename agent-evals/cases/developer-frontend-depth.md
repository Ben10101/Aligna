# Case: developer-frontend-depth

## Intent

Evaluate whether `developer_frontend` produces a frontend plan that is specific enough to guide real UI implementation instead of only listing pages at a generic level.

## Task

Run the frontend developer agent with a realistic support-domain idea, architecture summary, and backend output. Verify that it:

- preserves the entity coming from backend
- suggests concrete frontend modules
- exposes routes, states, and UI sections
- describes interaction rules and test recommendations
- keeps legacy compatibility through the `code` field

## Expected Signals

- the output is valid JSON
- `artifact_version` is present
- `modules` is non-empty
- `experience` is present
- `delivery_summary` is present
- the markdown plan is clearly more product- and implementation-aware than the previous generic structure
