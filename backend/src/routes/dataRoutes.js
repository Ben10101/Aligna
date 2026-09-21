import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  bootstrapController,
  createTaskArtifactController,
  repairTaskArtifactController,
  reviewTaskArtifactController,
  createProjectController,
  createTaskCommentController,
  createTaskController,
  approveProjectArchitectureController,
  addProjectMemberController,
  ensurePipelineProjectController,
  generateProjectArchitectureController,
  generateProjectBacklogController,
  getProjectController,
  getProjectArchitectureStatusController,
  getProjectDocumentationBundleController,
  getWorkspaceTeamSummaryController,
  getTaskController,
  importBacklogTasksController,
  publishBacklogTasksController,
  revalidateBacklogController,
  consolidateBacklogStoriesController,
  moveBacklogAcceptanceCriterionController,
  updateBacklogStoryController,
  reviewBacklogStoryController,
  applyBacklogStoryReviewController,
  decideBacklogProposalController,
  answerBacklogQuestionController,
  applyBacklogProposalsController,
  listProjectsController,
  listProjectTasksController,
  listAllTasksController,
  deleteProjectController,
  removeProjectMemberController,
  updateProjectMemberController,
  updateProjectBriefController,
  updateProjectStatusController,
  updateTaskController,
} from '../controllers/projectDataController.js';

const router = Router();

router.post('/bootstrap', bootstrapController);
router.use(requireAuth);
router.post('/pipeline-project', ensurePipelineProjectController);
router.get('/workspace/team', getWorkspaceTeamSummaryController);
router.get('/projects', listProjectsController);
router.post('/projects', createProjectController);
router.get('/projects/:projectUuid', getProjectController);
router.delete('/projects/:projectUuid', deleteProjectController);
router.patch('/projects/:projectUuid/brief', updateProjectBriefController);
router.patch('/projects/:projectUuid/status', updateProjectStatusController);
router.post('/projects/:projectUuid/members', addProjectMemberController);
router.patch('/projects/:projectUuid/members/:memberUuid', updateProjectMemberController);
router.delete('/projects/:projectUuid/members/:memberUuid', removeProjectMemberController);
router.get('/projects/:projectUuid/documentation', getProjectDocumentationBundleController);
router.get('/projects/:projectUuid/architecture/status', getProjectArchitectureStatusController);
router.post('/projects/:projectUuid/architecture/approve', approveProjectArchitectureController);
router.get('/projects/:projectUuid/tasks', listProjectTasksController);
router.get('/tasks', listAllTasksController);
router.post('/projects/:projectUuid/generate-backlog', generateProjectBacklogController);
router.post('/projects/:projectUuid/generate-architecture', generateProjectArchitectureController);
router.post('/projects/:projectUuid/import-backlog', importBacklogTasksController);
router.post('/projects/:projectUuid/publish-backlog', publishBacklogTasksController);
router.post('/projects/:projectUuid/revalidate-backlog', revalidateBacklogController);
router.post('/projects/:projectUuid/backlog-stories/consolidate', consolidateBacklogStoriesController);
router.post('/projects/:projectUuid/backlog-stories/move-criterion', moveBacklogAcceptanceCriterionController);
router.patch('/projects/:projectUuid/backlog-stories/:storyId', updateBacklogStoryController);
router.post('/projects/:projectUuid/backlog-stories/:storyId/review', reviewBacklogStoryController);
router.patch('/projects/:projectUuid/backlog-stories/:storyId/review', applyBacklogStoryReviewController);
router.patch('/projects/:projectUuid/backlog-proposals/:proposalId', decideBacklogProposalController);
router.patch('/projects/:projectUuid/backlog-questions/:questionId', answerBacklogQuestionController);
router.post('/projects/:projectUuid/backlog-proposals/apply', applyBacklogProposalsController);
router.post('/projects/:projectUuid/tasks', createTaskController);
router.get('/tasks/:taskUuid', getTaskController);
router.patch('/tasks/:taskUuid', updateTaskController);
router.patch('/tasks/:taskUuid/status', updateTaskController);
router.post('/tasks/:taskUuid/comments', createTaskCommentController);
router.post('/tasks/:taskUuid/artifacts', createTaskArtifactController);
router.post('/tasks/:taskUuid/artifacts/:artifactUuid/review', reviewTaskArtifactController);
router.post('/tasks/:taskUuid/artifacts/:artifactUuid/repair', repairTaskArtifactController);

export default router;
