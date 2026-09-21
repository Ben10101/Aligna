# Case: pipeline-coherence-observability

## Goal

Measure whether the platform can expose contract adoption and coherence drift across the full delivery pipeline.

## What To Evaluate

- project-level adoption of `project-dna`, backlog contract, requirement spec, test spec and solution blueprint
- implementation-level adoption of `implementation-manifest` and `coherence-report`
- blocked and warning coherence states are surfaced
- drift flags are aggregated into actionable signals

## Pass Signals

- the overview reports contract coverage percentages
- blocked implementations appear in summary and alerts
- drift flags are aggregated into a top list
- at least one project score can be computed

## Failure Signals

- no pipeline-level summary exists
- contract coverage is invisible
- coherence gate output is not surfaced after implementation planning
- alerts do not reflect blocked coherence states
