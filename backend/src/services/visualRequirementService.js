import { runSingleAgent } from './orchestratorService.js';

const ELEMENT_TYPES = new Set(['field', 'button', 'label', 'table', 'menu', 'navigation', 'message', 'state', 'container']);
function text(value, max = 500) { return String(value || '').replace(/\r/g, '').trim().slice(0, max); }
function words(value) { return text(value, 10000).toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]{3,}/gu) || []; }

export function validateVisualRequirementModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('Visual Requirement Model inválido.');
  for (const key of ['visual_elements', 'observed_behaviors', 'visual_ambiguities']) if (!Array.isArray(model[key])) throw new Error(`Visual Requirement Model inválido: ${key}.`);
  model.visual_elements.forEach((item, index) => {
    if (!item || !ELEMENT_TYPES.has(item.type) || !text(item.label || item.description)) throw new Error(`Elemento visual inválido em visual_elements[${index}].`);
  });
  return {
    visual_elements: model.visual_elements.map((item, index) => ({ id: text(item.id || `VE-${index + 1}`, 120), type: item.type, label: text(item.label || item.description), evidence: text(item.evidence || item.label || item.description), location: text(item.location, 200) || null })),
    observed_behaviors: model.observed_behaviors.map((item) => text(item)).filter(Boolean),
    visual_ambiguities: model.visual_ambiguities.map((item) => text(item)).filter(Boolean),
  };
}

export async function analyzeVisualRequirement({ imageBase64, mimeType, fileName, textualRequirement = '', envOverrides = {} }) {
  const result = await runSingleAgent('visual_requirement_analyst', {
    idea: textualRequirement || 'Análise visual sem requisito textual.',
    image_base64: imageBase64,
    mime_type: mimeType,
    file_name: fileName,
  }, { envOverrides });
  return validateVisualRequirementModel(result?.visual_requirement_model ?? result);
}

export function compareRequirementWithVisual(textualRequirement, visualModel, businessRules = []) {
  const model = validateVisualRequirementModel(visualModel);
  const normalizedText = text(textualRequirement, 20000).toLocaleLowerCase('pt-BR');
  const visualElements = model.visual_elements;
  const conflicts = [];
  const missingRequirements = [];
  const visualTerms = new Set(visualElements.flatMap((item) => words(item.label)));
  const relevantTextTerms = [...new Set(words(textualRequirement))].filter((word) => word.length >= 4);
  const fieldHints = ['nome', 'email', 'e-mail', 'senha', 'cpf', 'telefone', 'data', 'valor', 'status', 'endereço'];
  for (const field of fieldHints.filter((word) => normalizedText.includes(word) && !visualTerms.has(word.replace('-', '')))) {
    conflicts.push({ type: 'described_field_absent', message: `O requisito descreve o campo "${field}", mas ele não foi observado na interface.`, evidence: field });
  }
  for (const element of visualElements) {
    const elementWords = words(element.label);
    const mentioned = elementWords.some((word) => normalizedText.includes(word));
    if ((element.type === 'field' || element.type === 'button' || element.type === 'message') && !mentioned) {
      missingRequirements.push({ type: `${element.type}_not_specified`, message: `${element.type === 'field' ? 'Campo' : element.type === 'button' ? 'Botão' : 'Mensagem'} visível não está especificado no requisito: ${element.label}.`, evidence: element.evidence });
    }
    if (element.type === 'button' && !businessRules.some((rule) => words(rule).some((word) => elementWords.includes(word)))) {
      conflicts.push({ type: 'button_without_rule', message: `O botão "${element.label}" não possui regra de negócio associada no requisito.`, evidence: element.evidence });
    }
  }
  for (const element of visualElements.filter((item) => item.type === 'state' || item.type === 'message')) {
    if (!words(element.label).some((word) => normalizedText.includes(word))) conflicts.push({ type: 'visual_state_not_specified', message: `Estado ou mensagem visual não especificado: ${element.label}.`, evidence: element.evidence });
  }
  return {
    visual_elements: visualElements,
    observed_behaviors: model.observed_behaviors,
    missing_requirements: missingRequirements,
    visual_ambiguities: model.visual_ambiguities,
    requirement_visual_conflicts: conflicts,
  };
}
