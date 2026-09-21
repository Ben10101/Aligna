# Case: aligna-platform-flow

## Intent

Evaluate the real authenticated platform flow of Aligna, not only isolated generator or smoke fragments.

## Task

Run the main platform flow end to end and verify that Aligna can:

- answer health correctly
- reject unauthenticated access where expected
- register and restore an authenticated session
- analyze alignment input
- create project and task records
- expose observability, audit, governance, and readiness data

## Expected Signals

- `npm --prefix backend run test:e2e:platform` passes
- the result exercises the main product surface, not only helper utilities
- the output demonstrates that the current product experience is operational end to end
