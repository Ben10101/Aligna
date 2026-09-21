import path from 'path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { prisma } from '../lib/prisma.js';

const MAX_MODELS_PER_USER = 20;
const MAX_MODEL_NAME_LENGTH = 120;
export const MAX_MODEL_CONTENT_LENGTH = 20000;
export const MAX_REQUIREMENT_MODEL_IMPORT_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_REQUIREMENT_MODEL_IMPORT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function createRequirementModelError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeImportedContent(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getRequirementModelImportKind(file = {}) {
  const extension = String(path.extname(file.originalname || '') || '')
    .trim()
    .toLowerCase();
  const mimeType = String(file.mimetype || '').trim().toLowerCase();

  if (mimeType === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === '.docx'
  ) {
    return 'docx';
  }

  return '';
}

function normalizeRequirementModelEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const id = normalizeText(entry.id);
  const name = normalizeText(entry.name);
  const content = normalizeText(entry.content);
  const createdAt = normalizeText(entry.createdAt) || new Date().toISOString();

  if (!id || !name || !content) {
    return null;
  }

  return {
    id,
    name: name.slice(0, MAX_MODEL_NAME_LENGTH),
    content: content.slice(0, MAX_MODEL_CONTENT_LENGTH),
    createdAt,
  };
}

export function normalizeRequirementModelState(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const modelsSource = Array.isArray(source.models) ? source.models : [];
  const models = [];
  const seenIds = new Set();

  for (const item of modelsSource) {
    const normalized = normalizeRequirementModelEntry(item);
    if (!normalized || seenIds.has(normalized.id)) {
      continue;
    }

    seenIds.add(normalized.id);
    models.push(normalized);
  }

  const activeModelId = normalizeText(source.activeModelId);
  return {
    activeModelId: models.some((model) => model.id === activeModelId) ? activeModelId : '',
    models,
  };
}

function validateRequirementModelState(state) {
  if (state.models.length > MAX_MODELS_PER_USER) {
    throw createRequirementModelError(`E permitido salvar no maximo ${MAX_MODELS_PER_USER} modelos por usuario.`);
  }

  for (const model of state.models) {
    if (model.name.length > MAX_MODEL_NAME_LENGTH) {
      throw createRequirementModelError(`O nome do modelo ${model.id} excede o limite de ${MAX_MODEL_NAME_LENGTH} caracteres.`);
    }

    if (model.content.length > MAX_MODEL_CONTENT_LENGTH) {
      throw createRequirementModelError(`O conteudo do modelo ${model.id} excede o limite de ${MAX_MODEL_CONTENT_LENGTH} caracteres.`);
    }
  }
}

async function readStoredRequirementModelsForUser(userUuid) {
  const user = await prisma.user.findUnique({
    where: { uuid: userUuid },
    select: { requirementModels: true },
  });

  return normalizeRequirementModelState(user?.requirementModels || {});
}

export async function getRequirementModelsForUser(userUuid) {
  return readStoredRequirementModelsForUser(userUuid);
}

export async function importRequirementModelFromFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw createRequirementModelError('Envie um arquivo PDF ou DOCX para importar o modelo.');
  }

  const importKind = getRequirementModelImportKind(file);
  if (!importKind) {
    throw createRequirementModelError('Formato nao suportado. Envie um arquivo PDF ou DOCX.');
  }

  let extractedContent = '';
  if (importKind === 'pdf') {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      extractedContent = result?.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    extractedContent = result?.value || '';
  }

  const normalizedContent = normalizeImportedContent(extractedContent);
  if (!normalizedContent) {
    throw createRequirementModelError('Nao foi possivel extrair texto util do arquivo enviado.');
  }

  const suggestedName = normalizeText(path.parse(file.originalname || '').name) || 'Modelo importado';
  const content = normalizedContent.slice(0, MAX_MODEL_CONTENT_LENGTH);

  return {
    name: suggestedName.slice(0, MAX_MODEL_NAME_LENGTH),
    content,
    truncated: normalizedContent.length > MAX_MODEL_CONTENT_LENGTH,
    sourceFileName: String(file.originalname || '').trim(),
    sourceMimeType: String(file.mimetype || '').trim(),
  };
}

export async function updateRequirementModelsForUser(userUuid, input = {}) {
  const current = await readStoredRequirementModelsForUser(userUuid);
  const patch = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const next = normalizeRequirementModelState({
    models: Array.isArray(patch.models) ? patch.models : current.models,
    activeModelId: patch.activeModelId !== undefined ? patch.activeModelId : current.activeModelId,
  });

  validateRequirementModelState(next);

  await prisma.user.update({
    where: { uuid: userUuid },
    data: { requirementModels: next },
  });

  return next;
}
