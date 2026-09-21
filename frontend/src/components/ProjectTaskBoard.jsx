import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Plus,
  Sparkles,
  TestTube2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  AGENT_RUN_CONFLICT_MESSAGE,
  createTask,
  getApiErrorMessage,
  getProjectArchitectureStatus,
  listProjectTasks,
  runTaskQa,
  runTaskRequirements,
} from '../services/api';
import { getAgentLabel } from '../utils/agentLabels';

const BOARD_COLUMNS = [
  { key: 'backlog', label: 'Backlog', icon: LayoutDashboard },
  { key: 'todo', label: 'A Fazer', icon: Clock },
  { key: 'in_progress', label: 'Em Progresso', icon: Sparkles },
  { key: 'in_review', label: 'Em Revisão', icon: AlertCircle },
  { key: 'blocked', label: 'Bloqueado', icon: Ban },
  { key: 'qa', label: 'Qualidade', icon: TestTube2 },
  { key: 'done', label: 'Concluído', icon: CheckCircle2 },
];

const EMPTY_TASK = {
  title: '',
  description: '',
  status: 'backlog',
  priority: 'medium',
  taskType: 'story',
  assigneeType: 'agent',
  assigneeAgentName: 'requirements_analyst',
};

function formatElapsed(seconds) {
  if (!seconds) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatShortDate(value) {
  if (!value) return 'Sem prazo';
  return new Date(value).toLocaleDateString('pt-BR');
}

function hasCurrentArtifact(task, artifactType) {
  return (task?.artifacts || []).some((artifact) => artifact.artifactType === artifactType && artifact.isCurrent);
}

function hasCurrentQaValidation(task) {
  return (task?.artifacts || []).some((artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType) && artifact.isCurrent);
}

function hasApprovedQaValidation(task) {
  return (task?.artifacts || []).some((artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType) && artifact.isCurrent && artifact.isApproved);
}

function getLatestStatusHistoryNote(task, toStatus = null) {
  const history = task?.statusHistory || [];
  const entry = toStatus ? history.find((item) => item.toStatus === toStatus) : history[0];
  return entry?.note || '';
}

function isTaskAgentRunning(task, agentName = null) {
  const runs = task?.agentRuns || [];
  if (!runs.length) return false;
  return runs.some((run) => run.status === 'running' && (!agentName || run.agentName === agentName));
}

function TaskCard({
  task,
  onRequirements,
  onQa,
  onOpenDetail,
  onReview,
  onExportArtifacts,
  busy,
}) {
  const hasRequirements = hasCurrentArtifact(task, 'requirements');
  const hasApprovedRequirements = (task?.artifacts || []).some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent && artifact.isApproved);
  const hasTestPlan = hasCurrentQaValidation(task);
  const hasApprovedTestPlan = hasApprovedQaValidation(task);
  const isDone = task.status === 'done';
  const isBlocked = task.status === 'blocked';
  const processingError = task.processingError;
  const isStory = task.taskType === 'story';
  const isEpic = task.taskType === 'epic';
  const requirementsRunning = task.status === 'in_progress' && isTaskAgentRunning(task, 'requirements_analyst');
  const qaRunning =
    (task.status === 'qa' || task.status === 'in_progress' || task.status === 'in_review') &&
    isTaskAgentRunning(task, 'qa_engineer');
  const taskHasActiveRun = requirementsRunning || qaRunning;
  const canRunRequirements = isStory && !isBlocked && (!hasRequirements || !hasApprovedRequirements) && !requirementsRunning;
  const canRunQa = isStory && !isBlocked && hasApprovedRequirements && !hasTestPlan && !qaRunning;
  const activeReviewLabel = hasTestPlan ? 'Abrir revisão de QA' : 'Abrir revisão de requisitos';

  const priorityColors = {
    high: 'bg-rose-50 text-rose-700',
    medium: 'bg-blue-50 text-[#102a72]',
    low: 'bg-slate-100 text-slate-600',
  };
  const typeLabels = {
    epic: 'Epic',
    story: 'Story',
    task: 'Técnica',
  };
  const typeGuidance = {
    epic: 'Épico de planejamento. Abra os detalhes para ver o desdobramento em stories.',
    story: 'Story pronta para refinamento e validação.',
    task: 'Tarefa técnica fora da esteira de requisitos/QA.',
  };
  const blockReason = getLatestStatusHistoryNote(task, 'blocked');
  const taskDescription = task.description || typeGuidance[task.taskType] || 'Sem contexto adicional registrado para esta task.';
  const primaryTag = isBlocked
    ? 'Bloqueada'
    : hasApprovedTestPlan
      ? 'QA aprovado'
      : hasTestPlan
        ? 'QA gerado'
        : hasRequirements
        ? 'Refinada'
        : 'Briefing';
  const validationState = isBlocked
    ? { label: 'Bloqueada', detail: 'Resolva o bloqueio registrado para continuar.', tone: 'border-rose-200 bg-rose-50 text-rose-700' }
    : hasApprovedTestPlan
      ? { label: 'QA aprovado', detail: 'Os casos de validação foram aprovados. A especificação BDD e QA está pronta para transferência.', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
      : hasTestPlan
        ? { label: 'QA gerado', detail: 'Revise os casos de validação de QA para finalizar a especificação.', tone: 'border-amber-200 bg-amber-50 text-amber-700' }
      : hasRequirements && !hasApprovedRequirements
        ? { label: 'Aguardando aprovação', detail: 'Os requisitos foram gerados, mas precisam de validação humana.', tone: 'border-amber-200 bg-amber-50 text-amber-700' }
        : hasApprovedRequirements
          ? { label: 'QA liberado', detail: 'Requisitos aprovados. A validação de QA está disponível.', tone: 'border-blue-200 bg-blue-50 text-[#102a72]' }
          : { label: 'Aguardando requisitos', detail: 'Execute a análise para gerar os requisitos desta task.', tone: 'border-slate-200 bg-slate-50 text-slate-600' };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
    >
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`dashboard-badge ${priorityColors[String(task.priority).toLowerCase()] || priorityColors.medium}`}>
                {task.priority}
              </span>
              <span
                className={`dashboard-badge ${
                  isBlocked
                    ? 'bg-rose-50 text-rose-700'
                    : hasApprovedTestPlan
                      ? 'bg-emerald-50 text-emerald-700'
                      : hasTestPlan
                        ? 'bg-amber-50 text-amber-700'
                      : hasRequirements
                        ? 'bg-blue-50 text-[#102a72]'
                        : 'bg-slate-100 text-slate-600'
                }`}
              >
                {primaryTag}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">#{task.uuid?.split('-')[0]}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold leading-6 text-slate-900">{task.title}</h3>
          </div>
          <button
            onClick={() => onOpenDetail(task)}
            aria-label={activeReviewLabel}
            title={activeReviewLabel}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-[#102a72]/10 hover:text-[#102a72]"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>

        <p className="line-clamp-3 text-sm leading-6 text-slate-500">{taskDescription}</p>

        <div className={`rounded-lg border px-3 py-2 ${validationState.tone}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]">{validationState.label}</p>
          <p className="mt-1 text-xs font-medium">{validationState.detail}</p>
          {hasRequirements && !hasApprovedRequirements && (
            <button type="button" onClick={() => onReview(task, 'requirements')} className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
              Revisar requisitos
            </button>
          )}
          {hasTestPlan && !hasApprovedTestPlan && (
            <button type="button" onClick={() => onReview(task, 'qa')} className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
              Revisar QA
            </button>
          )}
        </div>

        <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          <p>
            <span className="font-semibold text-slate-500">Responsável:</span>{' '}
            {task.assigneeUser?.name || task.assigneeAgentLabel || getAgentLabel(task.assigneeAgentName, 'Sem responsável')}
          </p>
          <p>
            <span className="font-semibold text-slate-500">Prazo:</span> {formatShortDate(task.dueDate)}
          </p>
        </div>

        {isBlocked && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-rose-500">Motivo do bloqueio</p>
            <p className="mt-1 text-sm font-medium text-rose-700">{blockReason || 'Bloqueio sem observação registrada.'}</p>
          </div>
        )}

        {processingError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-rose-500">Falha na última execução</p>
            <p className="mt-1 text-sm font-medium text-rose-700">{processingError.message}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Tipo</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{typeLabels[task.taskType] || task.taskType || 'Task'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Tempo de ciclo</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{formatElapsed(task.timing?.cycleTimeSeconds)}</p>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4">
        {!isDone ? (
          <>
            {isStory ? (
              <>
                <button
                  onClick={() => onRequirements(task.uuid)}
                  disabled={busy || !canRunRequirements || taskHasActiveRun}
                  className="dashboard-button-primary flex-1"
                  title={
                    taskHasActiveRun
                      ? AGENT_RUN_CONFLICT_MESSAGE
                      : canRunRequirements
                        ? undefined
                        : 'A etapa de requisitos já foi concluída ou ainda depende de outro estado.'
                  }
                >
                  <FileText className="h-4 w-4" />
                  {requirementsRunning ? 'Executando...' : hasRequirements ? 'Regenerar' : 'Analisar'}
                </button>
                <button
                  onClick={() => onQa(task.uuid)}
                  disabled={busy || !canRunQa || taskHasActiveRun}
                  className="dashboard-button-secondary flex-1"
                  title={
                    taskHasActiveRun
                      ? AGENT_RUN_CONFLICT_MESSAGE
                      : qaRunning
                        ? 'Já existe uma execução de QA em andamento para esta task.'
                        : !canRunQa && hasTestPlan
                          ? 'A etapa de QA já foi concluída.'
                          : undefined
                  }
                >
                  <TestTube2 className="h-4 w-4" />
                  {qaRunning ? 'Executando...' : 'Validar'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onOpenDetail(task)}
                  className="dashboard-button-secondary flex-1"
                >
                  <FileText className="h-4 w-4" />
                  Abrir detalhes
                </button>
                <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-center text-xs font-medium text-slate-500">
                  {isEpic ? 'Épico de planejamento' : 'Tarefa técnica fora do fluxo de refinamento'}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => onOpenDetail(task)}
              className="dashboard-button-primary flex-1"
            >
              <FileText className="h-4 w-4" />
              {hasTestPlan ? 'Revisar QA' : 'Revisar requisitos'}
            </button>
            <button
              onClick={() => onExportArtifacts(task)}
              disabled={!task.artifacts?.length}
              className="dashboard-button-secondary px-3"
              title="Export bundle"
            >
              <Download className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default function ProjectTaskBoard({ projectUuid, tasks: initialTasks = [] }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState(initialTasks);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [architectureStatus, setArchitectureStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingArchitecture, setGeneratingArchitecture] = useState(false);
  const [error, setError] = useState(null);
  const [scopeReview, setScopeReview] = useState(null);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!projectUuid) return;

      try {
        setLoading(true);
        setError(null);
        const [nextTasks, nextArchitectureStatus] = await Promise.all([
          listProjectTasks(projectUuid),
          getProjectArchitectureStatus(projectUuid),
        ]);
        if (!active) return;
        setTasks(nextTasks);
        setArchitectureStatus(nextArchitectureStatus);
      } catch (loadError) {
        if (!active) return;
        setError(getApiErrorMessage(loadError, 'Não foi possível carregar o board do projeto.'));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    const intervalId = setInterval(() => {
      load();
    }, 4000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [projectUuid]);

  const groupedColumns = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        ...column,
        tasks: tasks
          .filter((task) => task.status === column.key)
          .slice()
          .sort((a, b) => {
            const priorityRank = { high: 0, medium: 1, low: 2 };
            return (priorityRank[String(a.priority).toLowerCase()] ?? 1) - (priorityRank[String(b.priority).toLowerCase()] ?? 1);
          }),
      })),
    [tasks]
  );

  const storyTasks = tasks.filter((task) => (task.taskType || 'story') === 'story');
  const canCreateTask = Boolean(projectUuid);

  async function refreshBoard() {
    const [nextTasks, nextArchitectureStatus] = await Promise.all([
      listProjectTasks(projectUuid),
      getProjectArchitectureStatus(projectUuid),
    ]);
    setTasks(nextTasks);
    setArchitectureStatus(nextArchitectureStatus);
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (!canCreateTask || !taskForm.title.trim()) return;

    setSaving(true);
    setError(null);
    setScopeReview(null);
    try {
      await createTask(projectUuid, {
        ...taskForm,
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
      });
      setTaskForm(EMPTY_TASK);
      await refreshBoard();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, 'Não foi possível criar a task.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunRequirements(taskUuid) {
    setSaving(true);
    setError(null);
    setScopeReview(null);
    try {
      await runTaskRequirements(taskUuid, { changedByUserUuid: null });
      await refreshBoard();
    } catch (submitError) {
      setScopeReview(submitError?.response?.data?.scopeReview || null);
      setError(getApiErrorMessage(submitError, 'A analise de requisitos falhou.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunQa(taskUuid) {
    setSaving(true);
    setError(null);
    setScopeReview(null);
    try {
      await runTaskQa(taskUuid, { changedByUserUuid: null });
      await refreshBoard();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, 'A analise de QA falhou.'));
    } finally {
      setSaving(false);
    }
  }

  function reviewRoute(task, stage = null) {
    const hasCurrentQa = hasCurrentQaValidation(task);
    const reviewStage = stage || (hasCurrentQa ? 'qa' : 'requirements');
    return `/tasks/${task.uuid}/${reviewStage}/review`;
  }

  function handleOpenDetail(task) {
    navigate(reviewRoute(task));
  }

  function handleExportArtifacts(task) {
    const artifacts = (task?.artifacts || []).filter((artifact) => artifact.isCurrent);
    if (!artifacts.length) return;

    const content = [
      `# ${task.title}`,
      task.description ? `\n${task.description}` : '',
      ...artifacts.map(
        (artifact) =>
          `\n\n---\n\n## ${artifact.title}\nTipo: ${artifact.artifactType}\nVersao: ${artifact.version}\n\n${artifact.content}`
      ),
    ].join('');

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${task.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'task'}-artefatos.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="min-w-0 space-y-4">
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Board do projeto</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Kanban do projeto</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Arraste uma história para o agente gerar o artefato correspondente.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="dashboard-badge bg-slate-100 text-slate-600">{storyTasks.length} itens</span>
              <span className="dashboard-badge bg-emerald-50 text-emerald-700">
                {storyTasks.filter((task) => task.status === 'done').length} processados
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {scopeReview && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-700">Análise de escopo necessária</p>
          <h3 className="mt-2 text-base font-bold">Esta história precisa ser dividida antes do refinamento</h3>
          <p className="mt-2 leading-6 text-amber-900">{scopeReview.reason}</p>

          {scopeReview.independent_journeys?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Jornadas identificadas</p>
              <ul className="mt-2 space-y-1.5 pl-5 text-sm leading-5 text-amber-950">
                {scopeReview.independent_journeys.map((journey) => <li key={journey}>{journey}</li>)}
              </ul>
            </div>
          )}

          {scopeReview.suggested_stories?.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Stories sugeridas</p>
              <ul className="mt-2 space-y-2 text-sm leading-5 text-slate-700">
                {scopeReview.suggested_stories.map((story) => <li key={story}>{story}</li>)}
              </ul>
            </div>
          )}

          {scopeReview.questions?.length > 0 && (
            <p className="mt-4 text-xs leading-5 text-amber-900">Próxima decisão: {scopeReview.questions[0]}</p>
          )}
        </section>
      )}

      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Gate do fluxo ativo</p>
              <p className="mt-2 text-sm text-slate-700">
                O produto principal continua focado em briefing, refinamento de requisitos e validação de QA.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="dashboard-badge bg-slate-100 text-slate-600">
                  {storyTasks.length} histórias no board
                </span>
                <span className="dashboard-badge bg-emerald-50 text-emerald-700">
                  Fluxo PM + Requirements + QA
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <form onSubmit={handleCreateTask} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
            <div className="relative">
              <Plus className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Descreva a nova task..."
                value={taskForm.title}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                className="dashboard-input pl-11"
              />
            </div>
            <select
              value={taskForm.status}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, status: event.target.value }))}
              className="dashboard-input appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M4%206L8%2010L12%206%22%20stroke%3D%22%2364748B%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[right_1rem_center] bg-no-repeat pr-10"
            >
              {BOARD_COLUMNS.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
            <button disabled={saving || !canCreateTask} className="dashboard-button-primary h-[46px]">
              Criar
            </button>
          </form>
        </div>
      </div>

      <section className="min-w-0 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
          {groupedColumns.map((column) => (
            <div key={column.key} className="min-w-0 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <column.icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">{column.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{column.tasks.length}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="-mx-2 overflow-x-auto px-2 pb-4">
          <div className="flex min-w-max gap-5">
            {groupedColumns.map((column) => (
              <div key={column.key} className="w-[320px] flex-none space-y-4 xl:w-[340px]">
                <div className="dashboard-panel">
                  <div className="dashboard-panel-header">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <column.icon className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{column.label}</h4>
                        <p className="mt-1 text-xs text-slate-500">{column.tasks.length} itens</p>
                      </div>
                    </div>
                  </div>

                  <div className="h-[min(68vh,760px)] p-3">
                    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
                      <AnimatePresence mode="popLayout">
                        {column.tasks.map((task) => (
                          <motion.div key={task.uuid} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                            <TaskCard
                              task={task}
                              busy={saving}
                              onRequirements={handleRunRequirements}
                              onQa={handleRunQa}
                              onExportArtifacts={handleExportArtifacts}
                              onOpenDetail={handleOpenDetail}
                              onReview={(reviewTask, stage) => navigate(reviewRoute(reviewTask, stage))}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {!column.tasks.length && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center"
                        >
                          <Plus className="h-8 w-8 text-slate-300" />
                          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Coluna vazia
                          </p>
                          <p className="mt-2 text-sm text-slate-500">Pronta para receber novas stories</p>
                        </motion.div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
