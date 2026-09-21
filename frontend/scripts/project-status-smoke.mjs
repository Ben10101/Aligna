import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const workspacePage = readSource('src/pages/WorkspacePage.jsx');
const projectsPage = readSource('src/pages/ProjectsPage.jsx');
const overviewPage = readSource('src/pages/ProjectOverviewPage.jsx');
const apiService = readSource('src/services/api.js');
const confirmDialog = readSource('src/components/ConfirmDialog.jsx');

const expectedTokens = [
  [workspacePage, 'ConfirmDialog'],
  [workspacePage, 'getProjectStatusMeta'],
  [workspacePage, 'updateProjectStatus'],
  [workspacePage, 'Status:'],
  [projectsPage, 'ConfirmDialog'],
  [projectsPage, 'openProjectStatusDialog'],
  [projectsPage, 'updateProjectStatus'],
  [projectsPage, 'getProjectStatusMeta'],
  [overviewPage, 'ConfirmDialog'],
  [overviewPage, 'requestProjectStatusChange'],
  [overviewPage, 'updateProjectStatus'],
  [apiService, 'export const updateProjectStatus = async'],
  [apiService, "apiClient.patch(`/projects/${projectUuid}/status`"],
  [confirmDialog, 'fixed inset-0 z-50 flex items-center justify-center'],
];

for (const [source, token] of expectedTokens) {
  assert(source.includes(token), `Token ausente no smoke de status: ${token}`);
}

console.log('project-status-smoke: ok');
