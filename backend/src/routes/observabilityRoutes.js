import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  activeAlertsController,
  aiOperationsOverviewController,
  auditTrailController,
  governanceOverviewController,
  healthController,
  operationalHistoryController,
  pipelineCoherenceController,
  pipelineQualityController,
  productionReadinessController,
  runtimeOperationsController,
} from '../controllers/observabilityController.js';

const router = Router();

router.get('/health', healthController);
router.get('/observability/ai', requireAuth, aiOperationsOverviewController);
router.get('/observability/runtime', requireAuth, runtimeOperationsController);
router.get('/observability/readiness', requireAuth, productionReadinessController);
router.get('/observability/audit', requireAuth, auditTrailController);
router.get('/observability/governance', requireAuth, governanceOverviewController);
router.get('/observability/history', requireAuth, operationalHistoryController);
router.get('/observability/alerts', requireAuth, activeAlertsController);
router.get('/observability/pipeline', requireAuth, pipelineCoherenceController);
router.get('/observability/pipeline-quality', requireAuth, pipelineQualityController);

export default router;
