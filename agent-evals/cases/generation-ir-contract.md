# Generation IR Contract

## Goal

Validate whether the modernized generation pipeline produces a minimally valid intermediate contract for frontend and backend.

## Task

Run the Generation IR validator and confirm that:

- frontend `screenSpec` contains route, sections, states and layout signals
- backend `moduleSpec` contains files, contracts and route base
- the contract is valid without manual repair

## Expected Good Signals

- `valid = true`
- `frontend.screenSpec.route` present
- `frontend.screenSpec.sections` populated
- `backend.moduleSpec.routeBase` present
- `backend.moduleSpec.files` populated

## Failure Signals

- missing frontend route or sections
- missing backend files or route base
- validation errors in the IR contract
