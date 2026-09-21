import express from 'express';
import { analyzeAlignmentController, analyzeVisualAlignmentController, getAlignmentSessionController, submitAlignmentClarificationsController, visualRequirementUploadMiddleware } from '../controllers/alignmentController.js';

const router = express.Router();

router.post('/alignment/analyze', analyzeAlignmentController);
router.post('/alignment/analyze-visual', visualRequirementUploadMiddleware, analyzeVisualAlignmentController);
router.get('/alignment/sessions/:sessionUuid', getAlignmentSessionController);
router.post('/alignment/sessions/:sessionUuid/clarifications', submitAlignmentClarificationsController);

export default router;
