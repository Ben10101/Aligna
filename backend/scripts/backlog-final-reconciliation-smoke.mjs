import assert from 'node:assert/strict';
import { validateBacklogFinalReconciliation } from '../src/services/projectDataService.js';

const registration = {
  id: 'story_1',
  title: 'Como administrador, eu quero cadastrar uma sala, para disponibilizar o espaco.',
  refinementContext: { acceptanceCriteria: [{
    given: 'que estou no cadastro de sala', when: 'eu salvar os dados', then: 'a sala deve ser criada',
  }, {
    given: 'que consulto salas por data e horario', when: 'nao houver sala compativel', then: 'o sistema informa indisponibilidade',
  }] },
};
const availability = {
  id: 'story_9',
  title: 'Como professor, eu quero consultar disponibilidade de salas por data horario e capacidade, para encontrar uma sala.',
  refinementContext: { acceptanceCriteria: [{
    given: 'que consulto salas por data e horario', when: 'nao houver sala compativel', then: 'o sistema informa indisponibilidade',
  }] },
};
const history = {
  id: 'story_8',
  title: 'Como administrador, eu quero consultar historico de alteracoes de reservas, para manter rastreabilidade.',
};
const audit = {
  id: 'story_13',
  title: 'Como administrador, eu quero visualizar historico de alteracoes de reservas, para manter rastreabilidade.',
};

const findings = validateBacklogFinalReconciliation([registration, availability, history, audit]);
assert(findings.some((finding) => finding.code === 'criterion_outside_story_scope' && finding.storyId === 'story_1'));
assert(findings.some((finding) => finding.code === 'duplicate_story_scope' && finding.storyId === 'story_8' && finding.relatedStoryId === 'story_13'));
console.log('Backlog final reconciliation smoke passed.');
