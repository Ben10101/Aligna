import { analyzeAlignmentInput } from '../services/alignmentService.js';
import { isSemanticAlignmentEnabled } from '../services/alignmentSemanticService.js';
import { buildRuntimeAiEnvForUser } from '../services/aiSettingsService.js';
import { isRequirementEngineLlmEnabled } from '../services/requirementEngineService.js';
import { appendAlignmentVersion, createAlignmentSession, getAlignmentSession } from '../services/alignmentClarificationService.js';
import { analyzeVisualRequirement } from '../services/visualRequirementService.js';
import multer from 'multer';

const visualUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(null, /^image\/(png|jpeg|webp|gif)$/i.test(file.mimetype)) });
export function visualRequirementUploadMiddleware(req, res, next) {
  visualUpload.single('image')(req, res, (error) => {
    if (error) { error.statusCode = 400; return next(error); }
    if (!req.file) { const missing = new Error('Envie uma imagem PNG, JPEG, WEBP ou GIF de até 8 MB.'); missing.statusCode = 400; return next(missing); }
    next();
  });
}

async function getAnalysisOptions(req) {
  const semanticEnabled = isSemanticAlignmentEnabled();
  const requirementEngineLlmEnabled = isRequirementEngineLlmEnabled();
  const semanticEnvOverrides = semanticEnabled && req.authUser?.uuid
    ? await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'alignment_semantic' })
    : {};
  const requirementEngineEnvOverrides = requirementEngineLlmEnabled && req.authUser?.uuid
    ? await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'requirement_engine' })
    : {};
  return { semanticEnabled, requirementEngineLlmEnabled, semanticEnvOverrides, requirementEngineEnvOverrides };
}

export async function analyzeAlignmentController(req, res, next) {
  try {
    const input = req.body?.input || req.body?.idea || '';
    if (!String(input || '').trim()) {
      return res.status(400).json({ message: 'input é obrigatório para analisar clareza e ambiguidade.' });
    }

    const result = await analyzeAlignmentInput(input, await getAnalysisOptions(req));
    const session = await createAlignmentSession({ input, result, userId: req.authUser?.id || null });
    res.json({ ...result, alignment_session: { session_uuid: session.sessionUuid, version: session.version, ...session.clarification } });
  } catch (error) {
    next(error);
  }
}

export async function submitAlignmentClarificationsController(req, res, next) {
  try {
    const sessionUuid = req.params.sessionUuid;
    const outcome = await appendAlignmentVersion({
      sessionUuid,
      answers: req.body?.answers,
      analyze: async (input, visualRequirementModel) => analyzeAlignmentInput(input, { ...(await getAnalysisOptions(req)), visualRequirementModel }),
      userId: req.authUser?.id || null,
    });
    res.json({ ...outcome.result, alignment_session: { session_uuid: outcome.sessionUuid, version: outcome.version, ...outcome.clarification } });
  } catch (error) { next(error); }
}

export async function analyzeVisualAlignmentController(req, res, next) {
  try {
    const input = String(req.body?.input || req.body?.idea || '').trim();
    const visualRequirementModel = await analyzeVisualRequirement({
      imageBase64: req.file.buffer.toString('base64'), mimeType: req.file.mimetype, fileName: req.file.originalname,
      textualRequirement: input, envOverrides: req.authUser?.uuid ? await buildRuntimeAiEnvForUser(req.authUser.uuid, { agentName: 'visual_requirement_analyst' }) : {},
    });
    const result = await analyzeAlignmentInput(input || 'Análise baseada exclusivamente na interface visual.', { ...(await getAnalysisOptions(req)), visualRequirementModel });
    const session = await createAlignmentSession({ input: input || 'Análise baseada exclusivamente na interface visual.', result, userId: req.authUser?.id || null });
    res.json({ ...result, alignment_session: { session_uuid: session.sessionUuid, version: session.version, ...session.clarification } });
  } catch (error) { next(error); }
}

export async function getAlignmentSessionController(req, res, next) {
  try { res.json(await getAlignmentSession(req.params.sessionUuid)); }
  catch (error) { next(error); }
}

export default { analyzeAlignmentController };
