# Eval Rubric

Score each dimension from `0` to `3`.

## 1. Task Completion

- `0`: failed to complete the requested task
- `1`: partially completed with major missing behavior
- `2`: completed but with notable cleanup needed
- `3`: completed correctly and coherently

## 2. Architectural Fit

- `0`: conflicts with repository structure or patterns
- `1`: works but introduces drift or ad hoc structure
- `2`: mostly aligned with minor inconsistencies
- `3`: strongly aligned with existing architecture

## 3. Security And Safety

- `0`: introduces unsafe defaults or regressions
- `1`: misses important safety expectations
- `2`: mostly safe with small gaps
- `3`: preserves or improves security baseline

## 4. Validation Readiness

- `0`: output is not realistically verifiable
- `1`: validation path unclear or incomplete
- `2`: can be validated with some manual work
- `3`: maps cleanly to repository checks or smokes

## 5. Diff Discipline

- `0`: broad unrelated churn
- `1`: too many files touched or noisy edits
- `2`: acceptable scope with some extra movement
- `3`: tight, focused blast radius

## 6. Manual Repair Cost

- `0`: heavy rewrite required
- `1`: several important fixes required
- `2`: minor follow-up needed
- `3`: little or no manual repair needed

## Overall Read

- `15-18`: strong candidate prompt or agent setup
- `11-14`: promising but needs refinement
- `7-10`: inconsistent, keep iterating
- `0-6`: poor fit for production use
