# UI Archetype Generalization

## Goal
Validar se o resolvedor de archetypes consegue classificar domínios desconhecidos em padrões de tela úteis sem depender de um caso já conhecido do catálogo.

## Inputs
- fixtures em `agent-evals/fixtures/ui-archetype-generalization.json`
- cenários fora do domínio clássico já trabalhado no Aligna

## Pass criteria
- cada fixture resolve `pageArchetype` esperado
- cada fixture resolve `fallbackPattern` esperado
- a resposta inclui score e alternativas para auditoria

## Failure signals
- colapso de todos os casos para `record-management`
- escolha de pattern visual incompatível com o tipo de problema
- ausência de sinalização de confiança e alternativas
