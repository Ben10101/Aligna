import multer from 'multer';
import {
  MAX_REQUIREMENT_MODEL_IMPORT_BYTES,
  getRequirementModelsForUser,
  importRequirementModelFromFile,
  updateRequirementModelsForUser,
} from '../services/requirementModelService.js';

const requirementModelImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_REQUIREMENT_MODEL_IMPORT_BYTES,
    files: 1,
  },
});

export function importRequirementModelUploadMiddleware(req, res, next) {
  requirementModelImportUpload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const uploadError = new Error(
      error.code === 'LIMIT_FILE_SIZE'
        ? 'O arquivo excede o limite de 5 MB para importacao de modelo.'
        : 'Nao foi possivel processar o upload do arquivo.'
    );
    uploadError.statusCode = 400;
    next(uploadError);
  });
}

export async function getRequirementModelsController(req, res, next) {
  try {
    const requirementModels = await getRequirementModelsForUser(req.authUser.uuid);
    res.json(requirementModels);
  } catch (error) {
    next(error);
  }
}

export async function updateRequirementModelsController(req, res, next) {
  try {
    const requirementModels = await updateRequirementModelsForUser(req.authUser.uuid, req.body || {});
    res.json(requirementModels);
  } catch (error) {
    next(error);
  }
}

export async function importRequirementModelController(req, res, next) {
  try {
    const importedModel = await importRequirementModelFromFile(req.file);
    res.json(importedModel);
  } catch (error) {
    next(error);
  }
}
