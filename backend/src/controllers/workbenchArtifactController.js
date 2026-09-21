import { getWorkbenchArtifactsForUser } from '../services/workbenchArtifactService.js';

export async function getWorkbenchArtifactsController(req, res, next) {
  try {
    const artifacts = await getWorkbenchArtifactsForUser(req.authUser.uuid);
    res.json(artifacts);
  } catch (error) {
    next(error);
  }
}
