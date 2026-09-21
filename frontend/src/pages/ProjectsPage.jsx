import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronRight,
  MoreHorizontal,
  Filter,
  LayoutDashboard,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import ConfirmDialog from '../components/ConfirmDialog';
import { getProjectStatusConfirmationMessage, getProjectStatusMeta } from '../utils/projectStatus';
import { createProject, deleteProject, getApiErrorMessage, listProjects, updateProjectStatus } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const EMPTY_PROJECT = { name: '', description: '', vision: '' };

const PROJECT_STATUS_FILTERS = [
  { value: 'all', label: 'Todos os projetos' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'active', label: 'Ativos' },
  { value: 'on_hold', label: 'Em pausa' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'archived', label: 'Arquivados' },
];

function formatShortDate(value) {
  if (!value) return 'Sem data';
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatProjectActivity(value) {
  if (!value) return 'Sem atividade registrada';

  const date = new Date(value);
  const now = new Date();
  const dayDifference = Math.floor((now.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / 86_400_000);

  if (dayDifference === 0) return 'Atualizado hoje';
  if (dayDifference === 1) return 'Atualizado ontem';
  if (dayDifference > 1 && dayDifference < 7) return `Atualizado há ${dayDifference} dias`;
  return `Atualizado em ${formatShortDate(value)}`;
}

function getProjectNextStep(project) {
  if (project.status === 'archived') return 'Projeto arquivado';
  if (project.status === 'completed') return 'Projeto concluído';
  if (project.status === 'on_hold') return 'Retome quando estiver pronto';

  const backlog = project.intakeConfig?.backlogContract;
  const isGenerating = ['queued', 'running'].includes(String(project.intakeConfig?.backlogGenerationRecovery?.status || '').toLowerCase());
  if (isGenerating) return 'Aguardar geração do backlog';
  if (backlog?.stories?.length && backlog.publicationStatus !== 'published') return 'Revisar backlog';
  if (backlog?.publicationStatus === 'published' || project._count?.tasks) return 'Acompanhar o board';
  if (project.status === 'draft') return 'Consolidar o briefing';
  return 'Gerar o backlog inicial';
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{label}</span>
      <input value={value} onChange={onChange} placeholder={placeholder} className="dashboard-input" />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 4 }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="dashboard-input resize-none"
      />
    </label>
  );
}

function ProjectCard({
  project,
  onOpenProject,
  onRequestStatusChange,
  onRequestDelete,
  busyProjectUuid,
}) {
  const statusMeta = getProjectStatusMeta(project?.status);
  const isBusy = busyProjectUuid === project.uuid;
  const canDeleteProject = project.currentUserRole === 'owner';
  const [actionsOpen, setActionsOpen] = useState(false);
  const nextStep = getProjectNextStep(project);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#102a72]/20 hover:shadow-md"
    >
      <button type="button" onClick={() => onOpenProject(project.uuid)} className="flex flex-1 flex-col text-left" aria-label={`Abrir projeto ${project.name}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#102a72] text-white shadow-sm">
              <LayoutDashboard className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-bold text-slate-900" title={project.name}>{project.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 line-clamp-3">
                {project.description || 'Sem descrição consolidada.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>
              {statusMeta.label}
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#102a72]" aria-hidden="true" />
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Próxima etapa</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{nextStep}</p>
        </div>
      </button>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">{formatProjectActivity(project.updatedAt || project.createdAt)}</span>
          {isBusy ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">Atualizando...</span>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setActionsOpen((current) => !current)}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={`Ações do projeto ${project.name}`}
            aria-expanded={actionsOpen}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {actionsOpen ? (
            <div className="absolute bottom-full right-0 z-10 mb-2 flex min-w-40 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {statusMeta.nextStatus ? (
                <button type="button" onClick={() => { setActionsOpen(false); onRequestStatusChange(project, statusMeta.nextStatus); }} disabled={isBusy} className="dashboard-button-secondary justify-start px-3 py-2 text-xs">
                  {isBusy ? 'Atualizando...' : statusMeta.action}
                </button>
              ) : null}
              {canDeleteProject ? (
                <button type="button" onClick={() => { setActionsOpen(false); onRequestDelete(project); }} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-700 transition hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, workspace } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('all');
  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [statusDialog, setStatusDialog] = useState({ open: false, project: null, nextStatus: null });
  const [statusUpdatingProjectUuid, setStatusUpdatingProjectUuid] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, project: null });
  const [deletingProjectUuid, setDeletingProjectUuid] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (searchParams.get('openCreate') === '1') {
      setShowProjectForm(true);
    }
  }, [searchParams]);

  async function loadProjects() {
    setLoading(true);
    setError(null);

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Nao foi possivel carregar os projetos.'));
    } finally {
      setLoading(false);
    }
  }

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return projects.filter((project) => {
      const searchable = `${project.name} ${project.description || ''} ${project.vision || ''}`.toLowerCase();
      const matchesQuery = !query || searchable.includes(query);
      const matchesStatus = projectStatusFilter === 'all' || project.status === projectStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [projectSearch, projectStatusFilter, projects]);

  const canCreateProject = Boolean(workspace?.uuid && user?.uuid);

  function openProject(projectUuid) {
    navigate(`/projects/${projectUuid}`);
  }

  function openProjectStatusDialog(project, nextStatus) {
    setStatusDialog({ open: true, project, nextStatus });
  }

  function openProjectDeleteDialog(project) {
    setDeleteDialog({ open: true, project });
  }

  async function confirmProjectStatusUpdate() {
    if (!statusDialog.project || !statusDialog.nextStatus) return;

    setStatusUpdatingProjectUuid(statusDialog.project.uuid);
    setError(null);

    try {
      await updateProjectStatus(statusDialog.project.uuid, statusDialog.nextStatus);
      await loadProjects();
      setStatusDialog({ open: false, project: null, nextStatus: null });
    } catch (statusError) {
      setError(getApiErrorMessage(statusError, 'Nao foi possivel atualizar o status do projeto.'));
    } finally {
      setStatusUpdatingProjectUuid(null);
    }
  }

  async function confirmProjectDelete() {
    if (!deleteDialog.project) return;

    const deletedProjectUuid = deleteDialog.project.uuid;
    setDeletingProjectUuid(deletedProjectUuid);
    setError(null);

    try {
      await deleteProject(deletedProjectUuid);
      setDeleteDialog({ open: false, project: null });
      await loadProjects();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, 'Nao foi possivel excluir o projeto.'));
    } finally {
      setDeletingProjectUuid(null);
    }
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    if (!canCreateProject) return;

    setSaving(true);
    setError(null);

    try {
      const project = await createProject({
        ...projectForm,
        workspaceUuid: workspace.uuid,
        createdByUuid: user.uuid,
        status: 'active',
      });
      setProjectForm(EMPTY_PROJECT);
      setShowProjectForm(false);
      await loadProjects();
      navigate(`/projects/${project.uuid}`);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, 'Nao foi possivel criar o projeto.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppShell
        eyebrow="Projetos"
        title="Projetos criados"
        description="Veja seus projetos, abra o contexto de cada um e crie novos espacos de trabalho quando precisar."
        actions={
          <button onClick={() => setShowProjectForm(true)} className="dashboard-button-primary w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Novo projeto
          </button>
        }
      >
        <div className="flex min-w-0 flex-col gap-6 pb-16">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={loadProjects} className="dashboard-button-secondary px-3 py-2 text-xs">
                      Tentar novamente
                    </button>
                    <button onClick={() => setError(null)} className="dashboard-button-secondary px-3 py-2 text-xs">
                      Fechar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Buscar projetos..."
                  className="dashboard-input pl-11"
                />
              </div>
              <div className="relative">
                <Filter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={projectStatusFilter}
                  onChange={(event) => setProjectStatusFilter(event.target.value)}
                  className="dashboard-input appearance-none pl-11 pr-10"
                >
                  {PROJECT_STATUS_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </div>
          </div>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">Projetos disponíveis</p>
                <h3 className="mt-2 text-xl font-bold text-slate-900">{filteredProjects.length} projeto(s) encontrado(s)</h3>
              </div>
            </div>

            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
                Carregando projetos...
              </div>
            ) : filteredProjects.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredProjects.map((project) => (
                    <ProjectCard
                      key={project.uuid}
                      project={project}
                      onOpenProject={openProject}
                      onRequestStatusChange={openProjectStatusDialog}
                      onRequestDelete={openProjectDeleteDialog}
                      busyProjectUuid={statusUpdatingProjectUuid || deletingProjectUuid}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
                <LayoutDashboard className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Nenhum projeto encontrado</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Ajuste a busca ou crie um novo projeto para começar.
                </p>
                <button
                  type="button"
                  onClick={() => setShowProjectForm(true)}
                  className="dashboard-button-primary mx-auto mt-6"
                >
                  <Plus className="h-4 w-4" />
                  Novo projeto
                </button>
              </div>
            )}
          </section>
        </div>
      </AppShell>

      <AnimatePresence>
        {showProjectForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm"
            onClick={() => setShowProjectForm(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleCreateProject}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Novo projeto</p>
                  <h3 className="mt-2 text-2xl font-bold text-slate-900">Criar espaco de trabalho</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Use isso para abrir um novo contexto de operacao sem misturar com projetos ja existentes.
                  </p>
                </div>
                <button type="button" onClick={() => setShowProjectForm(false)} className="dashboard-button-secondary px-3 py-2 text-xs">
                  Fechar
                </button>
              </div>

              <div className="mt-6 grid gap-4">
                <TextInput
                  label="Nome do projeto"
                  value={projectForm.name}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Ex.: Plataforma de EAD"
                />
                <TextInput
                  label="Resumo curto"
                  value={projectForm.description}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Uma frase para orientar o time..."
                />
                <TextArea
                  label="Visao do produto"
                  value={projectForm.vision}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, vision: event.target.value }))}
                  placeholder="Objetivo principal, publico e resultado esperado..."
                  rows={4}
                />
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button type="button" onClick={() => setShowProjectForm(false)} className="dashboard-button-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={saving || !canCreateProject} className="dashboard-button-primary">
                  {saving ? 'Criando...' : 'Criar projeto'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={statusDialog.open}
        title={`Atualizar status de ${statusDialog.project?.name || 'projeto'}`}
        description={
          statusDialog.project ? getProjectStatusConfirmationMessage(statusDialog.project.name, statusDialog.nextStatus) : ''
        }
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        intent={statusDialog.nextStatus === 'archived' ? 'warning' : 'primary'}
        loading={Boolean(statusUpdatingProjectUuid)}
        onConfirm={confirmProjectStatusUpdate}
        onClose={() => setStatusDialog({ open: false, project: null, nextStatus: null })}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title={`Excluir ${deleteDialog.project?.name || 'projeto'}`}
        description={
          deleteDialog.project
            ? `Tem certeza que deseja excluir o projeto "${deleteDialog.project.name}"? Esta acao remove o projeto, tasks, artefatos e historico associados.`
            : ''
        }
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        intent="danger"
        loading={Boolean(deletingProjectUuid)}
        onConfirm={confirmProjectDelete}
        onClose={() => setDeleteDialog({ open: false, project: null })}
      />
    </>
  );
}
