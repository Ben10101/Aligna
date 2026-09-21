import {
  getActiveAlerts,
  getAiOperationsOverview,
  getAuditTrail,
  getGovernanceOverview,
  getOperationalHistory,
  getOperationalHealth,
  getPipelineCoherenceOverview,
  getPipelineQualityOverview,
  getRuntimeOperationsStatus,
  getProductionReadiness,
} from '../services/observabilityService.js';
import { serializeBigInts } from '../utils/serialize.js';

export async function healthController(_req, res, next) {
  try {
    const health = await getOperationalHealth();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  } catch (error) {
    next(error);
  }
}

export async function aiOperationsOverviewController(req, res, next) {
  try {
    const overview = await getAiOperationsOverview(req.authUser.uuid, req.query.projectUuid || null);
    res.json(serializeBigInts(overview));
  } catch (error) {
    next(error);
  }
}

export async function runtimeOperationsController(req, res, next) {
  try {
    const runtime = await getRuntimeOperationsStatus(req.authUser?.uuid || null, {
      projectUuid: req.query.projectUuid || null,
      lookbackHours: req.query.lookbackHours || 24,
    });
    res.json(serializeBigInts(runtime));
  } catch (error) {
    next(error);
  }
}

export async function productionReadinessController(req, res, next) {
  try {
    const readiness = await getProductionReadiness(req.authUser.uuid, req.query.projectUuid || null);
    res.json(serializeBigInts(readiness));
  } catch (error) {
    next(error);
  }
}

export async function auditTrailController(req, res, next) {
  try {
    const auditTrail = await getAuditTrail(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
      limit: req.query.limit || 30,
    });
    res.json(serializeBigInts(auditTrail));
  } catch (error) {
    next(error);
  }
}

export async function governanceOverviewController(req, res, next) {
  try {
    const overview = await getGovernanceOverview(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
    });
    res.json(serializeBigInts(overview));
  } catch (error) {
    next(error);
  }
}

export async function operationalHistoryController(req, res, next) {
  try {
    const history = await getOperationalHistory(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
      days: req.query.days || 7,
    });
    res.json(serializeBigInts(history));
  } catch (error) {
    next(error);
  }
}

export async function activeAlertsController(req, res, next) {
  try {
    const alerts = await getActiveAlerts(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
    });
    res.json(serializeBigInts(alerts));
  } catch (error) {
    next(error);
  }
}

export async function pipelineCoherenceController(req, res, next) {
  try {
    const overview = await getPipelineCoherenceOverview(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
    });
    res.json(serializeBigInts(overview));
  } catch (error) {
    next(error);
  }
}

export async function pipelineQualityController(req, res, next) {
  try {
    const overview = await getPipelineQualityOverview(req.authUser.uuid, {
      projectUuid: req.query.projectUuid || null,
    });
    res.json(serializeBigInts(overview));
  } catch (error) {
    next(error);
  }
}
