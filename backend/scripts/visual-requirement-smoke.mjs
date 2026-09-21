import assert from 'node:assert/strict';
import { compareRequirementWithVisual, validateVisualRequirementModel } from '../src/services/visualRequirementService.js';

const model = validateVisualRequirementModel({
  visual_elements: [
    { id: 'VE-01', type: 'field', label: 'E-mail', evidence: 'Campo E-mail' },
    { id: 'VE-02', type: 'button', label: 'Entrar', evidence: 'Botão Entrar' },
    { id: 'VE-03', type: 'message', label: 'Conta temporariamente suspensa', evidence: 'Mensagem Conta temporariamente suspensa' },
  ],
  observed_behaviors: ['Botão Entrar visível.'],
  visual_ambiguities: ['Não é possível observar o comportamento após o envio.'],
});
const report = compareRequirementWithVisual('Como usuário, preciso informar e-mail e senha para acessar. O sistema deve validar credenciais.', model, ['O sistema deve validar credenciais.']);
assert.equal(report.visual_elements.length, 3);
assert.ok(report.missing_requirements.some((item) => item.type === 'button_not_specified'));
assert.ok(report.missing_requirements.some((item) => item.type === 'message_not_specified'));
assert.ok(report.visual_ambiguities.length > 0);
assert.throws(() => validateVisualRequirementModel({ visual_elements: [{ type: 'api', label: 'x' }], observed_behaviors: [], visual_ambiguities: [] }), /inválido/i);
console.log('Visual Requirement smoke concluído com sucesso.');
