import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PencilLine, X } from 'lucide-react';
import AppShell from '../components/AppShell';
import ConfirmDialog from '../components/ConfirmDialog';
import ProjectTaskBoard from '../components/ProjectTaskBoard';
import ProjectStageNav from '../components/ProjectStageNav';
import {
  generateProjectBacklog,
  publishProjectBacklog,
  updateProjectBacklogStory,
  updateTask,
  getApiErrorMessage,
  getProject,
  listProjectTasks,
  updateProjectStatus,
} from '../services/api';
import { exportProjectDocumentationPdf } from '../utils/projectDocumentationExport';
import { getProjectStatusConfirmationMessage, getProjectStatusWorkflow } from '../utils/projectStatus';

function TextAreaField({ label, value, onChange, placeholder, rows = 4, disabled = false }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={`dashboard-input min-h-[120px] resize-none ${disabled ?'cursor-not-allowed bg-slate-100 text-slate-500' : ''}`}
      />
    </label>
  );
}

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const { projectUuid } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishingBacklog, setPublishingBacklog] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusDialog, setStatusDialog] = useState({ open: false, nextStatus: null });
  const [showBriefingModal, setShowBriefingModal] = useState(false);
  const [briefingResult, setBriefingResult] = useState(null);
  const [clarifications, setClarifications] = useState([]);
  const [clarificationAnswers, setClarificationAnswers] = useState({});
  const [requirementsContract, setRequirementsContract] = useState(null);
  const [editingStory, setEditingStory] = useState(null);
  const [storyDraft, setStoryDraft] = useState({ title: '', description: '' });
  const [storySaving, setStorySaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [form, setForm] = useState({
    idea: '',
    objective: '',
    audience: '',
    mainFlows: '',
    constraints: '',
  });
  const hasGeneratedStories = useMemo(
    () => tasks.some((task) => task.taskType === 'story') || Boolean(project?.intakeConfig?.backlogContract?.stories?.length),
    [project?.intakeConfig?.backlogContract?.stories?.length, tasks]
  );
  const hasPublishedStories = useMemo(() => tasks.some((task) => task.taskType === 'story'), [tasks]);
  // O PM persiste o contrato em snake_case; versões antigas usavam camelCase.
  // Normalizamos aqui para que o resultado recém-gerado apareça no overview
  // independentemente da versão do contrato retornada pela API.
  const backlogQualityReview = project?.intakeConfig?.backlogContract?.quality_review
    || project?.intakeConfig?.backlogContract?.qualityReview
    || null;
  const activeRequirementsContract = requirementsContract || project?.intakeConfig?.backlogContract?.requirementsContract || project?.intakeConfig?.requirementsContract || null;
  const pmElicitation = project?.intakeConfig?.pmElicitation || project?.intakeConfig?.backlogContract?.elicitation || null;
  const pendingBacklogContract = project?.intakeConfig?.backlogContract;
  const backlogAwaitingApproval = Boolean(pendingBacklogContract?.stories?.length && pendingBacklogContract?.publicationStatus !== 'published');
  const backlogGenerationRecovery = project?.intakeConfig?.backlogGenerationRecovery || null;
  const isBacklogGenerationActive = ['queued', 'running'].includes(String(backlogGenerationRecovery?.status || '').toLowerCase());
  const projectStatusMeta = useMemo(() => getProjectStatusWorkflow(project?.status || 'draft'), [project?.status]);
  const backlogStories = pendingBacklogContract?.stories || [];
  const approvedStoryCount = backlogStories.filter((story) => String(story?.reviewStatus || '').toLowerCase() === 'approved').length;
  const qualityGateDecision = backlogQualityReview?.decision || (hasPublishedStories ? 'PASS' : 'PENDENTE');
  const qualityGateTone = qualityGateDecision === 'PASS'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : qualityGateDecision === 'REVISE'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  const projectJourney = useMemo(() => {
    if (isBacklogGenerationActive) {
      return {
        stage: 'Backlog',
        title: 'Gerando o backlog do projeto',
        message: 'O PM Agent está consolidando o briefing. Esta página será atualizada quando as stories estiverem prontas para revisão.',
        tone: 'border-blue-200 bg-blue-50 text-[#102a72]',
        ctaLabel: 'Geração em andamento',
        ctaAction: null,
        ctaDisabled: true,
        ctaType: 'button',
      };
    }
    if (backlogAwaitingApproval) {
      return {
        stage: 'Revisão',
        title: 'Validar as stories antes da publicação',
        message: 'O backlog foi gerado. Revise as stories e execute a revalidação final antes de enviá-las ao board.',
        tone: 'border-amber-200 bg-amber-50 text-amber-950',
        ctaLabel: 'Revisar backlog',
        ctaAction: () => navigate(`/projects/${projectUuid}/backlog-review`),
        ctaDisabled: loading,
        ctaType: 'button',
      };
    }
    if (!hasPublishedStories) {
      return {
        stage: 'Briefing',
        title: 'Consolidar briefing e gerar stories',
        message: 'Descreva o produto com contexto suficiente e deixe o PM Agent abrir o backlog inicial.',
        tone: 'border-slate-200 bg-white text-slate-900',
        ctaLabel: 'Abrir briefing',
        ctaAction: () => setShowBriefingModal(true),
        ctaDisabled: loading,
        ctaType: 'button',
      };
    }

    return {
      stage: 'Board',
      title: 'Abrir o board do projeto refinado',
      message: 'Briefing e backlog já estão prontos. Agora siga pelo board dentro do contexto do projeto refinado.',
      tone: 'border-slate-200 bg-white text-slate-900',
      ctaLabel: 'Abrir board do projeto',
      ctaAction: scrollToRefinementBoard,
      ctaDisabled: false,
      ctaType: 'button',
    };
  }, [
    hasPublishedStories,
    backlogAwaitingApproval,
    isBacklogGenerationActive,
    loading,
    navigate,
    projectUuid,
  ]);

  function clampStoryText(value, maxLength = 110) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trimEnd()}...`;
  }

  useEffect(() => {
    loadOverview();
  }, [projectUuid]);

  useEffect(() => {
    if (!isBacklogGenerationActive) return undefined;
    const pollId = window.setInterval(() => {
      void loadOverview({ background: true });
    }, 5000);
    return () => window.clearInterval(pollId);
  }, [projectUuid, isBacklogGenerationActive]);

  async function loadOverview({ background = false } = {}) {
    if (!background) {
      setLoading(true);
      setError(null);
    }

    try {
      const [projectData, taskList] = await Promise.all([
        getProject(projectUuid),
        listProjectTasks(projectUuid),
      ]);

      setProject(projectData);
      setTasks(taskList);
      const pendingRequirements = projectData?.intakeConfig?.requirementsContract || null;
      const persistedElicitation = projectData?.intakeConfig?.pmElicitation || null;
      const persistedClarifications = persistedElicitation?.open_questions || projectData?.intakeConfig?.backlogClarifications || pendingRequirements?.blocking_questions || [];
      setRequirementsContract(projectData?.intakeConfig?.backlogContract?.requirementsContract || pendingRequirements);
      setClarifications(Array.isArray(persistedClarifications) ? persistedClarifications : []);
      const persistedAnswers = persistedElicitation?.answers || projectData?.intakeConfig?.answers?.clarifications || [];
      const answersByQuestion = Object.fromEntries(
        (Array.isArray(persistedAnswers) ? persistedAnswers : Object.entries(persistedAnswers || {}).map(([id, answer]) => ({ id, answer })))
          .filter((item) => item?.answer)
          .map((item) => [item.id || item.question, item.answer])
      );
      setClarificationAnswers(Object.fromEntries(
        (Array.isArray(persistedClarifications) ? persistedClarifications : []).map((item) => [
          item.id,
          answersByQuestion[item.question] || '',
        ])
      ));
      setForm({
        idea: projectData?.intakeConfig?.idea || projectData?.description || '',
        objective: projectData?.intakeConfig?.objective || projectData?.intakeConfig?.answers?.objective || '',
        audience: projectData?.intakeConfig?.audience || projectData?.intakeConfig?.answers?.audience || '',
        mainFlows: projectData?.intakeConfig?.answers?.mainFlows || '',
        constraints: projectData?.intakeConfig?.answers?.constraints || '',
      });
      if (background && !projectData?.intakeConfig?.backlogGenerationRecovery && projectData?.intakeConfig?.backlogContract?.stories?.length) {
        setSuccessMessage('Backlog concluído. As user stories estão prontas para sua revisão.');
      }
    } catch (loadError) {
      if (loadError.response?.status === 404) {
        navigate('/projects', { replace: true });
        return;
      }
      setError(getApiErrorMessage(loadError, 'Não foi possível carregar o overview do projeto.'));
    } finally {
      if (!background) setLoading(false);
    }
  }

  async function handleGenerateBacklog(event) {
    event.preventDefault();

    if (!form.idea.trim()) {
      setError('Descreva a ideia do projeto antes de acionar o PM Agent.');
      return;
    }
    if (clarifications.length && clarifications.some((item) => !String(clarificationAnswers[item.id] || '').trim())) {
      setError('Responda todas as perguntas de esclarecimento antes de gerar as user stories.');
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccessMessage('');
    setBriefingResult(null);

    try {
      const response = await generateProjectBacklog(projectUuid, {
        idea: form.idea,
        description: form.idea,
        vision: form.objective || project?.vision || '',
        answers: {
          objective: form.objective,
          audience: form.audience,
          mainFlows: form.mainFlows,
          constraints: form.constraints,
          clarifications: clarifications.map((item) => ({ question: item.question, answer: clarificationAnswers[item.id] || '' })),
          elicitationAnswers: Object.fromEntries(clarifications.map((item) => [item.id, clarificationAnswers[item.id] || ''])),
        },
        elicitation: project?.intakeConfig?.pmElicitation || null,
      });

      if (response?.code === 'PROJECT_BACKLOG_RETRY_QUEUED') {
        setProject((current) => ({
          ...(response.project || current || {}),
          intakeConfig: {
            ...(current?.intakeConfig || {}),
            backlogGenerationRecovery: {
              status: 'queued',
              ...(response.recovery || {}),
            },
          },
        }));
        setShowBriefingModal(false);
        setSuccessMessage('A geração continua em segundo plano. Esta página será atualizada automaticamente quando o backlog estiver pronto.');
        return;
      }

      if (response.result?.clarification_required || response.result?.elicitation_required) {
        const questions = response.result.clarifications || [];
        setClarifications(questions);
        setClarificationAnswers(Object.fromEntries(questions.map((item) => [
          item.id,
          clarificationAnswers[item.id] || '',
        ])));
        setRequirementsContract(response.result.requirements_contract || null);
        setProject(response.project || project);
        setSuccessMessage('O PM Agent precisa de algumas respostas antes de publicar as user stories.');
        return;
      }

      setProject(response.project);
      setTasks(response.tasks || []);
      setRequirementsContract(response.project?.intakeConfig?.backlogContract?.requirementsContract || response.result?.backlog_contract?.requirements_contract || null);
      setForm({
        idea: response.project?.intakeConfig?.idea || form.idea,
        objective: response.project?.intakeConfig?.objective || response.project?.intakeConfig?.answers?.objective || form.objective,
        audience: response.project?.intakeConfig?.audience || response.project?.intakeConfig?.answers?.audience || form.audience,
        mainFlows: response.project?.intakeConfig?.answers?.mainFlows || form.mainFlows,
        constraints: response.project?.intakeConfig?.answers?.constraints || form.constraints,
      });
      const contractStories = response.result?.backlog_contract?.stories || response.project?.intakeConfig?.backlogContract?.stories || [];
      const generatedStories = (contractStories.length ? contractStories : (response.tasks || []))
        .filter((task) => task.taskType !== 'agent_job')
        .map((task) => ({
          id: task.id,
          uuid: task.uuid,
          title: task.title,
          description: task.description || '',
          status: task.status,
        }));
      const taskCount = contractStories.length || (response.tasks || []).filter((task) => task.taskType !== 'agent_job').length || 0;
      setBriefingResult({
        projectName: response.project?.name || project?.name || 'Projeto',
        totalStories: taskCount,
        generatedStories,
        nextStep: 'Revise as tasks e aprove a publicação para enviá-las ao board.',
      });
      setClarifications([]);
      setClarificationAnswers({});
      setSuccessMessage('User stories geradas com sucesso. Abrindo a tela de revisão...');
      navigate(`/projects/${projectUuid}/backlog-review`);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, 'Não foi possível gerar o backlog do projeto.'));
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublishBacklog() {
    setPublishingBacklog(true);
    setError(null);
    try {
      const nextTasks = await publishProjectBacklog(projectUuid);
      setTasks(nextTasks || []);
      setBriefingResult(null);
      setSuccessMessage('Tasks aprovadas e publicadas no board.');
      await loadOverview();
    } catch (publishError) {
      setError(getApiErrorMessage(publishError, 'Não foi possível publicar as tasks no board.'));
    } finally {
      setPublishingBacklog(false);
    }
  }

  function openPersistedBacklogReview() {
    const stories = pendingBacklogContract?.stories || [];
    if (!stories.length) return;
    setBriefingResult({
      projectName: project?.name || 'Projeto',
      totalStories: stories.length,
      generatedStories: stories.map((story, index) => ({
        id: story.id,
        uuid: story.uuid,
        title: story.title,
        description: story.description || '',
        status: story.status || 'proposed',
      })),
      nextStep: 'Revise as tasks e aprove a publicação para enviá-las ao board.',
    });
    window.requestAnimationFrame(() => {
      document.getElementById('backlog-human-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function openStoryEditor(task) {
    if (!task) return;
    setEditingStory(task);
    setStoryDraft({
      title: task.title || '',
      description: task.description || '',
    });
  }

  function isEditingStory(story) {
    if (!editingStory || !story) return false;
    return Boolean(
      (editingStory.uuid && story.uuid && editingStory.uuid === story.uuid)
      || (editingStory.id && story.id && editingStory.id === story.id)
    );
  }

  async function handleSaveStoryEdit(event) {
    event.preventDefault();

    if (!editingStory?.uuid && !editingStory?.id) return;

    if (!storyDraft.title.trim()) {
      setError('O título da story é obrigatório.');
      return;
    }

    setStorySaving(true);
    setError(null);

    try {
      const updatedTask = editingStory.uuid
        ? await updateTask(editingStory.uuid, { title: storyDraft.title.trim(), description: storyDraft.description.trim() })
        : await updateProjectBacklogStory(projectUuid, editingStory.id, { title: storyDraft.title.trim(), description: storyDraft.description.trim() });

      if (updatedTask.uuid) setTasks((current) => current.map((task) => (task.uuid === updatedTask.uuid ? updatedTask : task)));
      setBriefingResult((current) => {
        if (!current?.generatedStories?.length) return current;
        return {
          ...current,
          generatedStories: current.generatedStories.map((story) =>
            (editingStory.uuid ? story.uuid === updatedTask.uuid : story.id === updatedTask.id)
              ? {
                  ...story,
                  title: updatedTask.title,
                  description: updatedTask.description || '',
                }
              : story
          ),
        };
      });
      setEditingStory(null);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Não foi possível atualizar a story.'));
    } finally {
      setStorySaving(false);
    }
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    setError(null);

    try {
      await exportProjectDocumentationPdf(projectUuid);
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'Não foi possível exportar a documentação em PDF.'));
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleProjectStatusChange(nextStatus) {
    if (!project?.uuid) return;

    setUpdatingStatus(true);
    setError(null);
    setSuccessMessage('');

    try {
      const updatedProject = await updateProjectStatus(project.uuid, nextStatus);
      setProject(updatedProject);
      setSuccessMessage(
        nextStatus === 'archived'
          ? 'Projeto arquivado com sucesso.'
          : nextStatus === 'completed'
            ? 'Projeto concluído com sucesso.'
            : nextStatus === 'on_hold'
            ? 'Projeto colocado em pausa.'
            : 'Projeto reativado com sucesso.'
      );
    } catch (statusError) {
      setError(getApiErrorMessage(statusError, 'Não foi possível atualizar o status do projeto.'));
    } finally {
      setUpdatingStatus(false);
    }
  }

  function requestProjectStatusChange(nextStatus) {
    setStatusDialog({ open: true, nextStatus });
  }

  function scrollToRefinementBoard() {
    const target = document.getElementById('project-refinement-board');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <>
      <AppShell
        eyebrow="Visão do Projeto"
        title={project?.name || 'Projeto'}
        description="Descreva a iniciativa, gere user stories com o PM Agent e siga para o kanban com as tasks prontas."
        actions={
          <div className="flex flex-col gap-3 sm:flex-row">
            <button onClick={() => navigate('/projects')} className="dashboard-button-secondary w-full sm:w-auto">
              Voltar para projetos
            </button>
            <button
              type={projectJourney.ctaType}
              onClick={projectJourney.ctaType === 'button' ? projectJourney.ctaAction : undefined}
              disabled={projectJourney.ctaDisabled}
              className="dashboard-button-primary w-full sm:w-auto"
            >
              {projectJourney.ctaLabel}
            </button>
            <details className="relative w-full sm:w-auto">
              <summary className="dashboard-button-secondary cursor-pointer list-none text-center">Mais ações</summary>
              <div className="absolute right-0 z-20 mt-2 flex min-w-56 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                <button type="button" onClick={handleExportPdf} disabled={loading || exportingPdf} className="dashboard-button-secondary text-left">
                  {exportingPdf ? 'Preparando dossiê...' : 'Exportar dossiê em PDF'}
                </button>
                <button type="button" onClick={() => requestProjectStatusChange(projectStatusMeta.primaryTarget)} disabled={loading || updatingStatus} className="dashboard-button-secondary text-left">
                  {updatingStatus ? 'Atualizando...' : projectStatusMeta.primaryAction}
                </button>
                {projectStatusMeta.secondaryTarget ? (
                  <button type="button" onClick={() => requestProjectStatusChange(projectStatusMeta.secondaryTarget)} disabled={loading || updatingStatus} className="dashboard-button-secondary text-left">
                    {updatingStatus ? 'Atualizando...' : projectStatusMeta.secondaryAction}
                  </button>
                ) : null}
              </div>
            </details>
          </div>
        }
      >
      <section className="space-y-6">
        <ProjectStageNav
          projectUuid={projectUuid}
          active={backlogAwaitingApproval ? 'review' : hasPublishedStories ? 'tasks' : isBacklogGenerationActive ? 'backlog' : 'briefing'}
          completed={[
            ...(hasGeneratedStories ? ['briefing', 'backlog'] : []),
            ...(hasPublishedStories ? ['review'] : []),
          ]}
          onSelectStage={{
            briefing: isBacklogGenerationActive ? undefined : () => setShowBriefingModal(true),
            backlog: backlogAwaitingApproval
              ? () => navigate(`/projects/${projectUuid}/backlog-review`)
              : isBacklogGenerationActive ? undefined : () => setShowBriefingModal(true),
            tasks: hasPublishedStories ? scrollToRefinementBoard : undefined,
          }}
        />
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={loadOverview} disabled={loading} className="dashboard-button-secondary px-3 py-2 text-xs">
              Tentar novamente
            </button>
          </div>
        )}
        {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div>}
        {isBacklogGenerationActive && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-[#102a72] shadow-sm" aria-live="polite">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#102a72]" />
              <div>
                <p className="text-sm font-semibold">{backlogGenerationRecovery?.status === 'running' ? 'PM Agent gerando o backlog' : 'Geração do backlog na fila'}</p>
                <p className="mt-1 text-sm leading-6 text-blue-900/80">
                  {backlogGenerationRecovery?.nextRetryAt
                    ? `Nova tentativa prevista para ${new Date(backlogGenerationRecovery.nextRetryAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
                    : 'O agente está processando as stories e esta página será atualizada automaticamente.'}
                  {backlogGenerationRecovery?.automaticRetryAttempt
                    ? ` Tentativa automática ${backlogGenerationRecovery.automaticRetryAttempt}${backlogGenerationRecovery?.maxAutomaticRetryAttempts ? ` de ${backlogGenerationRecovery.maxAutomaticRetryAttempts}` : ''}.`
                    : ''}
                </p>
              </div>
            </div>
          </section>
        )}
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-4 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Fluxo do projeto</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{projectJourney.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{projectJourney.message}</p>
            </div>
            <div className={`rounded-2xl border px-5 py-4 ${projectJourney.tone}`}>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Etapa atual</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{projectJourney.stage}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Stories</p>
                  <p className="mt-1 font-bold text-slate-900">{backlogStories.length || tasks.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Aprovadas</p>
                  <p className="mt-1 font-bold text-slate-900">{approvedStoryCount}</p>
                </div>
              </div>
              <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${qualityGateTone}`}>
                Quality Gate: {qualityGateDecision}
              </div>
            </div>
          </div>
        </section>
        {backlogAwaitingApproval && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-800">Próxima etapa do PM</p>
                <h3 className="mt-2 text-xl font-bold text-slate-900">Revisão humana das tasks</h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {pendingBacklogContract.stories.length} tasks foram geradas, mas ainda não foram publicadas no board. Revise o conteúdo antes de aprovar.
                </p>
              </div>
              <button type="button" onClick={() => navigate(`/projects/${projectUuid}/backlog-review`)} className="dashboard-button-primary w-full sm:w-auto">
                Revisar tasks e aprovar
              </button>
            </div>
          </section>
        )}
        {hasPublishedStories && <section className="dashboard-panel" id="project-refinement-board">
          <div className="dashboard-panel-header">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Tasks publicadas</p>
                <h3 className="mt-2 text-xl font-bold text-slate-900">Board do projeto</h3>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                  Aqui você acompanha as tasks dentro do contexto deste projeto, com as raias operacionais do fluxo atual.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                {tasks.length} tasks
              </span>
            </div>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">Carregando overview...</div>
            ) : (
              <ProjectTaskBoard
                projectUuid={projectUuid}
                tasks={tasks}
              />
            )}
          </div>
        </section>}
      </section>
      </AppShell>
      <AnimatePresence>
        {briefingResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="backlog-human-review"
            className="mx-auto w-full max-w-7xl scroll-mt-6 px-4 py-8 sm:px-6 lg:px-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="w-full overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-200 px-6 py-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Resultado do briefing</p>
                <h3 className="mt-2 text-3xl font-bold text-slate-900">Validação humana das tasks</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  O PM Agent terminou a geração e organizou o resultado de forma fácil de revisar.
                </p>
              </div>

              <div className="grid gap-5 px-6 py-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 xl:sticky xl:top-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Resumo</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{briefingResult.totalStories} histórias geradas</p>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {briefingResult.projectName} tem tasks geradas pelo PM aguardando sua aprovação antes de entrar no board.
                  </p>
                  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                    {briefingResult.nextStep}
                  </div>
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Formato</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">Leitura rápida e editável</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Próximo passo</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">Exportar Dossiê de Requisitos & QA</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">O que saiu</p>
                    <p className="mt-2 text-sm text-slate-600">
                        Revise títulos e descrições. A publicação no board só acontece após sua confirmação.
                      </p>
                    </div>
                    <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:block">
                      {briefingResult.generatedStories.length} itens
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {briefingResult.generatedStories.length ? (
                      briefingResult.generatedStories.map((story, index) => (
                        <article
                          key={story.uuid || `${story.title}-${index}`}
                          className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-[#102a72]/25 hover:bg-white"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Story {index + 1}</p>
                              {isEditingStory(story) ? (
                                <input value={storyDraft.title} onChange={(event) => setStoryDraft((current) => ({ ...current, title: event.target.value }))} className="dashboard-input mt-2 text-sm" aria-label="Título da story" />
                              ) : (
                                <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-slate-900">{clampStoryText(story.title, 120)}</h4>
                              )}
                            </div>
                            <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold capitalize text-slate-600">
                              {story.status}
                            </span>
                          </div>
                          {isEditingStory(story) ? (
                            <textarea value={storyDraft.description} onChange={(event) => setStoryDraft((current) => ({ ...current, description: event.target.value }))} rows={4} className="dashboard-input mt-3 min-h-[100px] resize-none text-sm" aria-label="Descrição da story" />
                          ) : story.description ? (
                            <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{story.description}</p>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-slate-500">Sem descrição adicional.</p>
                          )}
                          <div className="mt-auto pt-4">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openStoryEditor(story);
                              }}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-[#102a72]/30 hover:bg-[#102a72]/5 hover:text-[#102a72]"
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                              {story.uuid ? 'Ajustar story' : 'Editar no local'}
                            </button>
                            {isEditingStory(story) && (
                              <div className="mt-3 flex gap-2">
                                <button type="button" onClick={handleSaveStoryEdit} disabled={storySaving} className="dashboard-button-primary px-3 py-1.5 text-[11px]">{storySaving ? 'Salvando...' : 'Salvar'}</button>
                                <button type="button" onClick={() => setEditingStory(null)} disabled={storySaving} className="dashboard-button-secondary px-3 py-1.5 text-[11px]">Cancelar</button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                        O PM Agent concluiu o briefing, mas não retornou stories detalhadas.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setBriefingResult(null);
                    navigate(`/projects/${projectUuid}`);
                  }}
                  className="dashboard-button-primary w-full sm:w-auto"
                >
                  Voltar ao projeto
                </button>
                <button
                  type="button"
                  onClick={() => setBriefingResult(null)}
                  className="dashboard-button-secondary w-full sm:w-auto"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handlePublishBacklog}
                  disabled={publishingBacklog || !briefingResult.generatedStories.length}
                  className="dashboard-button-primary w-full sm:w-auto"
                >
                  {publishingBacklog ? 'Publicando...' : 'Aprovar e enviar ao board'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {false && editingStory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-md"
          >
            <motion.form
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleSaveStoryEdit}
              className="w-full max-w-2xl rounded-[30px] border border-white/15 bg-white shadow-2xl"
            >
              <div className="border-b border-slate-200 px-6 py-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Editar story</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">Ajustar story gerada</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Edite o texto da story sem sair do contexto do projeto.
                </p>
              </div>

              <div className="grid gap-4 px-6 py-6">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">Título</span>
                  <input
                    value={storyDraft.title}
                    onChange={(event) => setStoryDraft((prev) => ({ ...prev, title: event.target.value }))}
                    className="dashboard-input"
                    placeholder="Título da story"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">Descrição</span>
                  <textarea
                    value={storyDraft.description}
                    onChange={(event) => setStoryDraft((prev) => ({ ...prev, description: event.target.value }))}
                    rows={5}
                    className="dashboard-input min-h-[140px] resize-none"
                    placeholder="Descreva a story com mais contexto."
                  />
                </label>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setEditingStory(null)}
                  className="dashboard-button-secondary w-full sm:w-auto"
                  disabled={storySaving}
                >
                  Cancelar
                </button>
                <button type="submit" className="dashboard-button-primary w-full sm:w-auto" disabled={storySaving}>
                  {storySaving ? 'Salvando...' : 'Salvar story'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showBriefingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm"
            onClick={() => setShowBriefingModal(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleGenerateBacklog}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-[32px] border border-slate-200 bg-white shadow-2xl"
            >
              <div className="border-b border-slate-800 bg-gradient-to-r from-slate-950 to-[#102a72] px-6 py-5 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-blue-200">Briefing do projeto</p>
                    <h3 className="mt-2 text-2xl font-bold tracking-tight">
                      {clarifications.length ? 'Descoberta · Validar decisões de maior impacto' : 'Descoberta · Analisar contexto e preparar o backlog'}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      O PM usa os fatos informados, explicita lacunas e pergunta somente o que bloqueia uma decisão de produto antes de sintetizar as stories.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBriefingModal(false)}
                    className="rounded-xl border border-white/20 p-2 text-white transition hover:bg-white/10"
                    aria-label="Fechar briefing"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {generating && (
                <div className="border-b border-blue-200 bg-blue-50 px-6 py-4 text-[#102a72]">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 animate-pulse rounded-full bg-[#102a72]" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">PM Agent executando o briefing</p>
                      <p className="mt-1 text-sm leading-6 text-blue-900/80">
                        Estamos transformando sua descrição em user stories, critérios e backlog inicial. Isso pode levar alguns segundos.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 px-6 py-6 lg:grid-cols-2">
                {clarifications.length > 0 && (
                  <div className="lg:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-800">Esclarecimentos necessários</p>
                    <h4 className="mt-2 text-xl font-bold text-slate-900">Responda às decisões que bloqueiam a síntese</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-700">Rodada {pmElicitation?.metrics?.rounds || 1}. Suas respostas viram decisões rastreáveis no contexto do PM, não detalhes inventados nas stories.</p>
                    {typeof pmElicitation?.confidence === 'number' && (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">Confiança do contexto: {Math.round(pmElicitation.confidence * 100)}% · {pmElicitation?.metrics?.blocking_questions || 0} bloqueio(s) em aberto</p>
                    )}
                    {(pmElicitation?.assumptions || activeRequirementsContract?.assumptions)?.length > 0 && (
                      <p className="mt-3 text-sm leading-6 text-amber-900">Premissas identificadas: {(pmElicitation?.assumptions || activeRequirementsContract?.assumptions).map((item) => item.text).join(' · ')}</p>
                    )}
                    <div className="mt-5 grid gap-4">
                      {clarifications.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-amber-200 bg-white p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-800">{item.id}</p>
                          <p className="mt-2 text-base font-semibold leading-6 text-slate-900">{item.question}</p>
                          {item.reason && <p className="mt-2 text-sm leading-6 text-slate-600"><strong>Por que isso importa:</strong> {item.reason}</p>}
                          <TextAreaField
                            label="Sua decisão"
                            value={clarificationAnswers[item.id] || ''}
                            onChange={(event) => setClarificationAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder={item.answer_hint || 'Informe a decisão de produto, regra ou detalhe de negócio.'}
                            rows={3}
                            disabled={generating || loading}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="lg:col-span-2">
                  <TextAreaField
                    label="Problema que resolve"
                    value={form.idea}
                    onChange={(event) => setForm((prev) => ({ ...prev, idea: event.target.value }))}
                    placeholder="Descreva o produto, o problema que ele resolve e o resultado esperado."
                    rows={5}
                    disabled={generating || loading}
                  />
                </div>
                <TextAreaField
                  label="Objetivo"
                  value={form.objective}
                  onChange={(event) => setForm((prev) => ({ ...prev, objective: event.target.value }))}
                  placeholder="Qual transformação esse projeto deve entregar?"
                  rows={3}
                    disabled={generating || loading}
                />
                <TextAreaField
                  label="Quem usa"
                  value={form.audience}
                  onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value }))}
                  placeholder="Quem usa isso e em qual contexto?"
                  rows={3}
                    disabled={generating || loading}
                />
                <TextAreaField
                  label="Fluxos principais"
                  value={form.mainFlows}
                  onChange={(event) => setForm((prev) => ({ ...prev, mainFlows: event.target.value }))}
                  placeholder="Ex.: cadastrar cliente, consultar histórico, acompanhar dashboard."
                  rows={3}
                    disabled={generating || loading}
                />
                <TextAreaField
                  label="Restrições ou riscos"
                  value={form.constraints}
                  onChange={(event) => setForm((prev) => ({ ...prev, constraints: event.target.value }))}
                  placeholder="Regras, dependências e limitações técnicas ou operacionais."
                  rows={3}
                    disabled={generating || loading}
                />

                <div className="lg:col-span-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button type="button" onClick={loadOverview} disabled={loading || generating} className="dashboard-button-secondary w-full sm:w-auto">
                    Recarregar projeto
                  </button>
                    <button type="button" onClick={() => setShowBriefingModal(false)} className="dashboard-button-secondary w-full sm:w-auto">
                      Cancelar
                    </button>
                  <button disabled={generating || loading || isBacklogGenerationActive} className="dashboard-button-primary w-full sm:w-auto">
                    {isBacklogGenerationActive
                      ? 'Geração em andamento'
                      : hasGeneratedStories
                      ? 'Regerar user stories'
                      : generating
                        ? 'PM Agent gerando...'
                        : 'Gerar user stories agora'}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {generating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-xl rounded-[30px] border border-white/15 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#102a72] text-white shadow-lg shadow-[#102a72]/30">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Processando briefing</p>
                  <h3 className="mt-2 text-2xl font-bold text-slate-900">PM Agent executando o briefing</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Estamos transformando a descrição do projeto em user stories, critérios e backlog inicial. Não feche esta janela até a conclusão.
                  </p>
                  <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#102a72]">
                    Gerando stories acionáveis e preparando o board para a próxima etapa.
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={statusDialog.open}
        title="Confirmar alteração de status"
        description={
          statusDialog.nextStatus
            ? getProjectStatusConfirmationMessage(project?.name || 'projeto', statusDialog.nextStatus)
            : ''
        }
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        intent={statusDialog.nextStatus === 'archived' ? 'warning' : 'primary'}
        loading={updatingStatus}
        onConfirm={() => {
          const nextStatus = statusDialog.nextStatus;
          setStatusDialog({ open: false, nextStatus: null });
          if (nextStatus) {
            handleProjectStatusChange(nextStatus);
          }
        }}
        onClose={() => setStatusDialog({ open: false, nextStatus: null })}
      />
    </>
  );
}

