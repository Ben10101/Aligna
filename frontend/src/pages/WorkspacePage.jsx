import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, FolderKanban, LayoutGrid } from 'lucide-react';
import AppShell from '../components/AppShell';
import ConfirmDialog from '../components/ConfirmDialog';
import { getApiErrorMessage, listAllTasks, listProjects, updateProjectStatus } from '../services/api';
import { getProjectStatusConfirmationMessage, getProjectStatusMeta } from '../utils/projectStatus';

function MetricCard({ label, value, hint, icon: Icon, tone = 'slate' }) {
  const tones = {
    blue: 'bg-blue-50 text-[#102a72] border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tones[tone]}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-2 text-sm leading-6 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ProjectCard({ project, summary, onOpen, onRequestStatusChange }) {
  const statusMeta = getProjectStatusMeta(project?.status);
  const roadmap = project?.intakeConfig?.roadmap || null;
  const risks = project?.intakeConfig?.riskRegister?.risks?.length || 0;
  const impediments = project?.intakeConfig?.riskRegister?.impediments?.length || 0;
  const timeline = project?.intakeConfig?.timeline || null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-slate-400">Projeto</p>
          <h3 className="mt-1.5 text-lg font-bold text-slate-900">{project.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-slate-600">{project.description || 'Sem descrição consolidada.'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
            {summary.totalTasks} tasks
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Backlog</p>
          <p className="mt-1.5 text-xl font-bold text-slate-900">{summary.backlog}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Em andamento</p>
          <p className="mt-1.5 text-xl font-bold text-slate-900">{summary.active}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Concluídas</p>
          <p className="mt-1.5 text-xl font-bold text-slate-900">{summary.done}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Bloqueadas</p>
          <p className="mt-1.5 text-xl font-bold text-slate-900">{summary.blocked}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2.5 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Roadmap</p>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{roadmap?.milestone || 'Sem marco definido'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Riscos</p>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{risks} riscos • {impediments} impedimentos</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Timeline</p>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            {timeline?.startDate ? new Date(timeline.startDate).toLocaleDateString('pt-BR') : 'Sem início'} •{' '}
            {timeline?.targetDate ? new Date(timeline.targetDate).toLocaleDateString('pt-BR') : 'Sem meta'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
        {statusMeta.nextStatus ? (
          <button onClick={() => onRequestStatusChange(project, statusMeta.nextStatus)} className="dashboard-button-secondary px-3 py-2 text-xs">
            {statusMeta.action}
          </button>
        ) : null}
        <button onClick={() => onOpen(`/projects/${project.uuid}`)} className="dashboard-button-primary px-3 py-2 text-xs">
          Abrir projeto
        </button>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [statusDialog, setStatusDialog] = useState({ open: false, project: null, nextStatus: null });
  const [statusUpdatingProjectUuid, setStatusUpdatingProjectUuid] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [nextProjects, nextTasks] = await Promise.all([listProjects(), listAllTasks()]);
        if (!active) return;
        setProjects(nextProjects);
        setTasks(nextTasks);
      } catch (loadError) {
        if (!active) return;
        setError(getApiErrorMessage(loadError, 'Não foi possível carregar o workspace.'));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const projectSummaries = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      const key = task.project?.uuid;
      if (!key) return;
      const current = map.get(key) || { totalTasks: 0, backlog: 0, active: 0, done: 0, blocked: 0, qa: 0 };
      current.totalTasks += 1;
      if (task.status === 'backlog') current.backlog += 1;
      if (['todo', 'in_progress', 'in_review'].includes(task.status)) current.active += 1;
      if (task.status === 'done') current.done += 1;
      if (task.status === 'blocked') current.blocked += 1;
      if (task.status === 'qa') current.qa += 1;
      map.set(key, current);
    });
    return map;
  }, [tasks]);

  const metrics = useMemo(() => {
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((task) => task.status === 'done').length;
    const blockedTasks = tasks.filter((task) => task.status === 'blocked').length;
    const activeProjects = projects.filter((project) => project.status !== 'archived').length;
    const planningProjects = projects.filter((project) => project.intakeConfig?.roadmap?.milestone).length;
    return { totalTasks, doneTasks, blockedTasks, activeProjects, planningProjects };
  }, [projects, tasks]);

  const workspaceNextStep = useMemo(() => {
    if (!projects.length) {
      return {
        title: 'Criar o primeiro projeto',
        message: 'Abra o catálogo de projetos para iniciar briefing, backlog e execução no workspace.',
        primaryLabel: 'Criar projeto',
        primaryAction: () => navigate('/projects?openCreate=1'),
      };
    }

    return {
      title: 'Entrar no catálogo operacional',
      message: 'O workspace já tem projetos ativos. Agora o melhor próximo passo é escolher um deles e seguir no board do projeto.',
      primaryLabel: 'Ver projetos',
      primaryAction: () => navigate('/projects'),
    };
  }, [navigate, projects.length]);

  function openStatusDialog(project, nextStatus) {
    setStatusDialog({ open: true, project, nextStatus });
  }

  async function confirmStatusUpdate() {
    if (!statusDialog.project || !statusDialog.nextStatus) return;

    setStatusUpdatingProjectUuid(statusDialog.project.uuid);
    setError(null);

    try {
      await updateProjectStatus(statusDialog.project.uuid, statusDialog.nextStatus);
      await Promise.all([listProjects().then(setProjects), listAllTasks().then(setTasks)]);
      setStatusDialog({ open: false, project: null, nextStatus: null });
    } catch (statusError) {
      setError(getApiErrorMessage(statusError, 'Não foi possível atualizar o status do projeto.'));
    } finally {
      setStatusUpdatingProjectUuid(null);
    }
  }

  return (
    <>
      <AppShell
      eyebrow="Workspace"
      title="Workspace Multi-Projetos"
      description="Visão consolidada do portfólio, com leitura rápida da saúde, do board e da execução de cada projeto."
      actions={
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => navigate('/workspace/team')} className="dashboard-button-secondary w-full sm:w-auto">
            Equipe do workspace
          </button>
          <button onClick={workspaceNextStep.primaryAction} className="dashboard-button-primary w-full sm:w-auto">
            {workspaceNextStep.primaryLabel}
          </button>
        </div>
      }
    >
      <section className="space-y-6">
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Projetos" value={projects.length} hint="Portfólio disponível no workspace" icon={FolderKanban} tone="blue" />
          <MetricCard label="Tasks" value={metrics.totalTasks} hint="Tudo o que está em andamento" icon={LayoutGrid} tone="slate" />
          <MetricCard label="Concluídas" value={metrics.doneTasks} hint="Entrega já materializada" icon={CheckCircle2} tone="emerald" />
          <MetricCard label="Bloqueadas" value={metrics.blockedTasks} hint="Atenção operacional" icon={AlertCircle} tone={metrics.blockedTasks ? 'rose' : 'amber'} />
        </div>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Portfólio</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">Projetos criados</h3>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Cada card abre o contexto do projeto com visão geral, board e equipe.
                </p>
              </div>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">Carregando workspace...</div>
            ) : projects.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.uuid}
                    project={project}
                    summary={projectSummaries.get(project.uuid) || { totalTasks: 0, backlog: 0, active: 0, done: 0, blocked: 0, qa: 0 }}
                    onOpen={(to) => navigate(to)}
                    onRequestStatusChange={openStatusDialog}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-[#102a72]/20 bg-gradient-to-br from-white to-blue-50 p-8 shadow-sm">
                <div className="max-w-xl">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Comece por aqui</p>
                  <h4 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Seu workspace está pronto para o primeiro projeto</h4>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Crie um projeto para organizar briefing, backlog, planejamento, execução e governança em um só lugar.
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button onClick={() => navigate('/projects?openCreate=1')} className="dashboard-button-primary w-full sm:w-auto">
                      Criar projeto
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

      </section>
      </AppShell>
      <ConfirmDialog
        open={statusDialog.open}
        title={`Atualizar status de ${statusDialog.project?.name || 'projeto'}`}
        description={
          statusDialog.project
            ? getProjectStatusConfirmationMessage(statusDialog.project.name, statusDialog.nextStatus)
            : ''
        }
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        intent={statusDialog.nextStatus === 'archived' ? 'warning' : 'primary'}
        loading={Boolean(statusUpdatingProjectUuid)}
        onConfirm={confirmStatusUpdate}
        onClose={() => setStatusDialog({ open: false, project: null, nextStatus: null })}
      />
    </>
  );
}

