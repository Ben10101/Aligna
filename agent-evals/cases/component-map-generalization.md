# Component Map Generalization

## Goal

Verificar se o `Generation IR` consegue escolher um `componentMap` coerente com o `pageArchetype` em cenarios diferentes, incluindo dashboard, approval flow e settings.

## What to check

- `pageArchetype` compatível com o dominio
- `componentMap.recordsLead` coerente com o tipo de tela
- `componentMap.summary` e `componentMap.activity` presentes quando o fluxo pede isso
- consistencia entre `sections` e `componentMap`

## Expected outcome

- dashboard executivo usa `insightStrip`
- approval flow usa `approvalSteps`
- settings usa `settingsSnapshot`
- quando houver atividade prevista na tela, o mapa inclui `activityTimeline`
