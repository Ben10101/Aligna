import axios from 'axios'

function normalizeApiBaseUrl(rawUrl) {
  const fallback = 'http://localhost:3001/api'
  const value = String(rawUrl || '').trim()
  if (!value) return fallback

  const normalized = value.replace(/\/+$/, '')
  if (normalized.endsWith('/api')) {
    return normalized
  }

  return `${normalized}/api`
}

export const API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL)
export const API_ORIGIN = API_URL.replace(/\/api$/, '')
export const AGENT_RUN_CONFLICT_MESSAGE = 'Já existe uma execução em andamento para esta tarefa. Aguarde a conclusão antes de tentar novamente.'
export const RESOURCE_CONFLICT_MESSAGE = 'Há um conflito com o estado atual deste recurso. Tente novamente em instantes.'

let accessToken = null
let refreshPromise = null

function readCookie(name) {
  const cookies = String(typeof document !== 'undefined' ? document.cookie || '' : '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const item of cookies) {
    const separatorIndex = item.indexOf('=')
    if (separatorIndex === -1) continue

    const key = decodeURIComponent(item.slice(0, separatorIndex))
    if (key === name) {
      return decodeURIComponent(item.slice(separatorIndex + 1))
    }
  }

  return ''
}

function attachCsrfHeader(config) {
  const method = String(config.method || 'get').toUpperCase()
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || config.url?.includes('/auth/refresh')
  if (!needsCsrf) return config

  const csrfToken = readCookie('factory_csrf_token')
  if (!csrfToken) return config

  config.headers = config.headers || {}
  config.headers['X-CSRF-Token'] = csrfToken
  return config
}

export function setApiAccessToken(nextToken) {
  accessToken = nextToken || null
}

export function clearApiAccessToken() {
  accessToken = null
}

export function getApiErrorMessage(error, fallback = 'Não foi possível concluir a solicitação.') {
  const status = error?.response?.status
  const data = error?.response?.data
  const isAgentRunConflict = data?.code === 'AGENT_RUN_CONFLICT' || Boolean(data?.existingRunUuid)

  if (error?.code === 'ERR_NETWORK' || error?.message === 'Network Error') {
    return 'Não foi possível conectar ao backend. Verifique se a API está ativa e se a URL configurada está correta.'
  }

  if (status === 404) {
    return 'O recurso solicitado não foi encontrado ou pode ter sido removido.'
  }

  if (status === 401) {
    return 'Sua sessão expirou. Entre novamente para continuar.'
  }

  if (status === 403) {
    return 'Você não tem permissão para acessar este recurso.'
  }

  if (status === 409 && isAgentRunConflict) {
    return data?.message?.trim() || AGENT_RUN_CONFLICT_MESSAGE
  }

  if (status === 409) {
    return typeof data?.message === 'string' && data.message.trim()
      ? data.message
      : RESOURCE_CONFLICT_MESSAGE
  }

  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message
  }

  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error
  }

  return error?.message || fallback
}

async function refreshAuthSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${API_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: {
            'X-CSRF-Token': readCookie('factory_csrf_token'),
          },
        }
      )
      .then((response) => {
        setApiAccessToken(response.data.accessToken)
        window.dispatchEvent(new CustomEvent('factory:session-refreshed', { detail: response.data }))
        return response.data
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

apiClient.interceptors.request.use((config) => {
  attachCsrfHeader(config)
  if (accessToken) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const status = error.response?.status

    if (!originalRequest || originalRequest._retry || status !== 401) {
      return Promise.reject(error)
    }

    if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register') || originalRequest.url?.includes('/auth/refresh')) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      const session = await refreshAuthSession()
      originalRequest.headers = originalRequest.headers || {}
      originalRequest.headers.Authorization = `Bearer ${session.accessToken}`
      return apiClient(originalRequest)
    } catch (refreshError) {
      clearApiAccessToken()
      const status = refreshError?.response?.status
      if (status === 401 || status === 403 || status === 429) {
        window.dispatchEvent(new Event('factory:session-invalid'))
      }
      return Promise.reject(refreshError)
    }
  }
)

export async function registerAuth(payload) {
  const response = await apiClient.post('/auth/register', payload)
  setApiAccessToken(response.data.accessToken)
  return response.data
}

export async function loginAuth(payload) {
  const response = await apiClient.post('/auth/login', payload)
  setApiAccessToken(response.data.accessToken)
  return response.data
}

export async function refreshSession() {
  return refreshAuthSession()
}

export async function getMe() {
  const response = await apiClient.get('/auth/me')
  return response.data
}

export async function logoutAuth() {
  try {
    await apiClient.post('/auth/logout')
  } finally {
    clearApiAccessToken()
  }
}

export async function getAiSettings() {
  const response = await apiClient.get('/auth/ai-settings')
  return response.data
}

export async function updateAiSettings(payload) {
  const response = await apiClient.put('/auth/ai-settings', payload)
  return response.data
}

export async function getRequirementModels() {
  const response = await apiClient.get('/auth/requirement-models')
  return response.data
}

export async function updateRequirementModels(payload) {
  const response = await apiClient.put('/auth/requirement-models', payload)
  return response.data
}

export async function importRequirementModelFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post('/auth/requirement-models/import', formData)
  return response.data
}

export async function getWorkbenchArtifacts() {
  const response = await apiClient.get('/auth/workbench-artifacts')
  return response.data
}

export async function getAiRuntimeSummary() {
  const response = await apiClient.get('/auth/ai-runtime')
  return response.data
}

export async function testAiProvider(payload) {
  const response = await apiClient.post('/auth/ai-settings/test', payload)
  return response.data
}

export async function getOperationalHealth() {
  const response = await axios.get(`${API_ORIGIN}/health`, { withCredentials: true })
  return response.data
}

export async function getAiOperationsOverview(params = {}) {
  const response = await apiClient.get('/observability/ai', { params })
  return response.data
}

export async function getProductionReadiness(params = {}) {
  const response = await apiClient.get('/observability/readiness', { params })
  return response.data
}

export async function getAuditTrail(params = {}) {
  const response = await apiClient.get('/observability/audit', { params })
  return response.data
}

export async function getGovernanceOverview(params = {}) {
  const response = await apiClient.get('/observability/governance', { params })
  return response.data
}

export async function getOperationalHistory(params = {}) {
  const response = await apiClient.get('/observability/history', { params })
  return response.data
}

export async function getActiveAlerts(params = {}) {
  const response = await apiClient.get('/observability/alerts', { params })
  return response.data
}

export async function analyzeAlignment(input) {
  const response = await apiClient.post('/alignment/analyze', { input })
  return response.data
}

export async function getPipelineQualityOverview(params = {}) {
  const response = await apiClient.get('/observability/pipeline-quality', { params })
  return response.data
}

export async function submitAlignmentClarifications(sessionUuid, answers) {
  const response = await apiClient.post(`/alignment/sessions/${sessionUuid}/clarifications`, { answers })
  return response.data
}

export async function analyzeVisualAlignment(input, image) {
  const formData = new FormData()
  formData.append('input', input || '')
  formData.append('image', image)
  const response = await apiClient.post('/alignment/analyze-visual', formData)
  return response.data
}

export async function runAgent({ agent, payload }) {
  const response = await apiClient.post('/agents/run', {
    agent,
    payload,
  })
  return response.data
}

export const generateProject = async (idea) => {
  try {
    const response = await apiClient.post('/generate-project', {
      idea: idea
    })
    return response.data
  } catch (error) {
    throw new Error(error.response?.data?.message || 'Erro ao gerar projeto')
  }
}

export const bootstrapWorkspace = async (payload) => {
  const response = await apiClient.post('/bootstrap', payload)
  return response.data
}

export const updateProjectStatus = async (projectUuid, status) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/status`, { status })
  return response.data
}

export const listProjects = async () => {
  const response = await apiClient.get('/projects')
  return response.data
}

export const getWorkspaceTeamSummary = async (params = {}) => {
  const response = await apiClient.get('/workspace/team', { params })
  return response.data
}

export const getProject = async (projectUuid) => {
  const response = await apiClient.get(`/projects/${projectUuid}`)
  return response.data
}

export const updateProjectBrief = async (projectUuid, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/brief`, payload)
  return response.data
}

export const addProjectMember = async (projectUuid, payload) => {
  const response = await apiClient.post(`/projects/${projectUuid}/members`, payload)
  return response.data
}

export const updateProjectMember = async (projectUuid, memberUuid, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/members/${memberUuid}`, payload)
  return response.data
}

export const removeProjectMember = async (projectUuid, memberUuid) => {
  const response = await apiClient.delete(`/projects/${projectUuid}/members/${memberUuid}`)
  return response.data
}

export const getProjectDocumentationBundle = async (projectUuid) => {
  const response = await apiClient.get(`/projects/${projectUuid}/documentation`)
  return response.data
}

export const listProjectTasks = async (projectUuid, params = {}) => {
  const response = await apiClient.get(`/projects/${projectUuid}/tasks`, { params })
  return response.data
}

export const listAllTasks = async (params = {}) => {
  const response = await apiClient.get('/tasks', { params })
  return response.data
}

export const createProject = async (payload) => {
  const response = await apiClient.post('/projects', payload)
  return response.data
}

export const deleteProject = async (projectUuid) => {
  const response = await apiClient.delete(`/projects/${projectUuid}`)
  return response.data
}

export const generateProjectBacklog = async (projectUuid, payload) => {
  const response = await apiClient.post(`/projects/${projectUuid}/generate-backlog`, payload)
  return response.data
}

export const getProjectArchitectureStatus = async (projectUuid) => {
  const response = await apiClient.get(`/projects/${projectUuid}/architecture/status`)
  return response.data
}

export const generateProjectArchitecture = async (projectUuid) => {
  const response = await apiClient.post(`/projects/${projectUuid}/generate-architecture`)
  return response.data
}

export const approveProjectArchitecture = async (projectUuid) => {
  const response = await apiClient.post(`/projects/${projectUuid}/architecture/approve`)
  return response.data
}

export const createTask = async (projectUuid, payload) => {
  const response = await apiClient.post(`/projects/${projectUuid}/tasks`, payload)
  return response.data
}

export const runTaskRequirements = async (taskUuid, payload = {}) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/requirements/run`, payload)
  return response.data
}

export const runTaskQa = async (taskUuid, payload = {}) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/qa/run`, payload)
  return response.data
}

export const updateTask = async (taskUuid, payload) => {
  const response = await apiClient.patch(`/tasks/${taskUuid}`, payload)
  return response.data
}

export const getTask = async (taskUuid) => {
  const response = await apiClient.get(`/tasks/${taskUuid}`)
  return response.data
}

export const createTaskComment = async (taskUuid, payload) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/comments`, payload)
  return response.data
}

export const ensurePipelineProject = async (payload) => {
  const response = await apiClient.post('/pipeline-project', payload)
  return response.data
}

export const importBacklogTasks = async (projectUuid, backlogMarkdown) => {
  const response = await apiClient.post(`/projects/${projectUuid}/import-backlog`, { backlogMarkdown })
  return response.data
}

export const publishProjectBacklog = async (projectUuid) => {
  const response = await apiClient.post(`/projects/${projectUuid}/publish-backlog`)
  return response.data
}
export const revalidateProjectBacklog = async (projectUuid) => {
  const response = await apiClient.post(`/projects/${projectUuid}/revalidate-backlog`)
  return response.data
}
export const decideBacklogProposal = async (projectUuid, proposalId, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/backlog-proposals/${proposalId}`, payload)
  return response.data
}
export const answerBacklogQuestion = async (projectUuid, questionId, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/backlog-questions/${questionId}`, payload)
  return response.data
}
export const applyBacklogProposals = async (projectUuid) => {
  const response = await apiClient.post(`/projects/${projectUuid}/backlog-proposals/apply`)
  return response.data
}

export const updateProjectBacklogStory = async (projectUuid, storyId, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/backlog-stories/${storyId}`, payload)
  return response.data
}
export const consolidateProjectBacklogStories = async (projectUuid, payload) => {
  const response = await apiClient.post(`/projects/${projectUuid}/backlog-stories/consolidate`, payload)
  return response.data
}
export const moveProjectBacklogAcceptanceCriterion = async (projectUuid, payload) => {
  const response = await apiClient.post(`/projects/${projectUuid}/backlog-stories/move-criterion`, payload)
  return response.data
}

export const reviewProjectBacklogStory = async (projectUuid, storyId, payload = {}) => {
  const response = await apiClient.post(`/projects/${projectUuid}/backlog-stories/${storyId}/review`, payload)
  return response.data
}
export const applyProjectBacklogStoryReview = async (projectUuid, storyId, payload) => {
  const response = await apiClient.patch(`/projects/${projectUuid}/backlog-stories/${storyId}/review`, payload)
  return response.data
}

export const createTaskArtifact = async (taskUuid, payload) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/artifacts`, payload)
  return response.data
}

export const reviewTaskArtifact = async (taskUuid, artifactUuid, payload) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/artifacts/${artifactUuid}/review`, payload)
  return response.data
}

export const repairTaskArtifact = async (taskUuid, artifactUuid, payload) => {
  const response = await apiClient.post(`/tasks/${taskUuid}/artifacts/${artifactUuid}/repair`, payload)
  return response.data
}

export { apiClient }

export default {
  registerAuth,
  loginAuth,
  refreshSession,
  getMe,
  logoutAuth,
  getAiSettings,
  updateAiSettings,
  getRequirementModels,
  importRequirementModelFile,
  getWorkbenchArtifacts,
  updateRequirementModels,
  getAiRuntimeSummary,
  testAiProvider,
  getProductionReadiness,
  getAuditTrail,
  getGovernanceOverview,
  getPipelineQualityOverview,
  getOperationalHistory,
  getActiveAlerts,
  analyzeAlignment,
  submitAlignmentClarifications,
  analyzeVisualAlignment,
  runAgent,
  generateProject,
  bootstrapWorkspace,
  listProjects,
  getWorkspaceTeamSummary,
  getProject,
  updateProjectBrief,
  addProjectMember,
  updateProjectMember,
  removeProjectMember,
  deleteProject,
  getProjectDocumentationBundle,
  listProjectTasks,
  createProject,
  generateProjectBacklog,
  getProjectArchitectureStatus,
  generateProjectArchitecture,
  createTask,
  runTaskRequirements,
  runTaskQa,
  updateTask,
  getTask,
  createTaskComment,
  ensurePipelineProject,
  importBacklogTasks,
  createTaskArtifact,
  listAllTasks,
}
