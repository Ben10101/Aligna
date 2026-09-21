import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import {
  addProjectMember,
  getApiErrorMessage,
  getWorkspaceTeamSummary,
  removeProjectMember,
  updateProjectMember,
} from '../services/api';

const ROLE_ORDER = ['owner', 'manager', 'editor', 'viewer'];

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  editor: 'Editor',
  viewer: 'Viewer',
};

function RoleBadge({ role }) {
  const normalizedRole = role || 'viewer';
  const toneClass =
    normalizedRole === 'owner'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : normalizedRole === 'manager'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : normalizedRole === 'editor'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-100 text-slate-600';

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
      {ROLE_LABELS[normalizedRole] || ROLE_LABELS.viewer}
    </span>
  );
}

function formatShortDate(value) {
  if (!value) return 'Sem registro';
  return new Date(value).toLocaleDateString('pt-BR');
}

export default function WorkspaceTeamPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [inviteForm, setInviteForm] = useState({
    projectUuid: '',
    email: '',
    projectRole: 'editor',
  });
  const [inviting, setInviting] = useState(false);
  const [savingMembershipKey, setSavingMembershipKey] = useState(null);
  const [removingMembershipKey, setRemovingMembershipKey] = useState(null);

  useEffect(() => {
    loadWorkspaceTeam();
  }, []);

  async function loadWorkspaceTeam() {
    setLoading(true);
    setError(null);

    try {
      const nextSummary = await getWorkspaceTeamSummary();
      setSummary(nextSummary);
      setInviteForm((prev) => ({
        ...prev,
        projectUuid: prev.projectUuid || nextSummary?.projects?.[0]?.uuid || '',
      }));
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Não foi possível carregar a equipe do workspace.'));
    } finally {
      setLoading(false);
    }
  }

  const manageableProjects = useMemo(() => {
    return (summary?.projects || []).filter((project) => project.permissions?.canManageMembers);
  }, [summary]);

  async function handleInvite(event) {
    event.preventDefault();
    if (!inviteForm.projectUuid || !inviteForm.email.trim()) {
      setError('Escolha um projeto e informe o e-mail da pessoa que deve entrar.');
      return;
    }

    setInviting(true);
    setError(null);
    setSuccessMessage('');

    try {
      await addProjectMember(inviteForm.projectUuid, {
        email: inviteForm.email,
        projectRole: inviteForm.projectRole,
      });
      await loadWorkspaceTeam();
      setInviteForm((prev) => ({
        ...prev,
        email: '',
        projectRole: 'editor',
      }));
      setSuccessMessage('Pessoa adicionada ao projeto a partir da central de equipe do workspace.');
    } catch (inviteError) {
      setError(getApiErrorMessage(inviteError, 'Não foi possível adicionar esta pessoa ao projeto.'));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(projectUuid, memberUuid, nextRole) {
    const key = `${projectUuid}:${memberUuid}`;
    setSavingMembershipKey(key);
    setError(null);
    setSuccessMessage('');

    try {
      await updateProjectMember(projectUuid, memberUuid, { projectRole: nextRole });
      await loadWorkspaceTeam();
      setSuccessMessage('Papel atualizado com sucesso.');
    } catch (roleError) {
      setError(getApiErrorMessage(roleError, 'Não foi possível atualizar o papel neste projeto.'));
    } finally {
      setSavingMembershipKey(null);
    }
  }

  async function handleRemoveMembership(projectUuid, memberUuid) {
    const key = `${projectUuid}:${memberUuid}`;
    setRemovingMembershipKey(key);
    setError(null);
    setSuccessMessage('');

    try {
      await removeProjectMember(projectUuid, memberUuid);
      await loadWorkspaceTeam();
      setSuccessMessage('Participação removida do projeto com sucesso.');
    } catch (removeError) {
      setError(getApiErrorMessage(removeError, 'Não foi possível remover esta participação.'));
    } finally {
      setRemovingMembershipKey(null);
    }
  }

  return (
    <AppShell
      eyebrow="Workspace"
      title={summary?.workspace?.name || 'Equipe do workspace'}
      description="Veja quem participa do workspace, em quais projetos cada pessoa atua e ajuste papéis por projeto em um único lugar."
      actions={
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={() => navigate('/workspace')} className="dashboard-button-secondary w-full sm:w-auto">
            Voltar ao workspace
          </button>
          <button onClick={() => navigate('/projects')} className="dashboard-button-primary w-full sm:w-auto">
            Ver projetos
          </button>
        </div>
      }
      sidebar={
        <>
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Resumo da equipe</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {[
                [summary?.summary?.totalPeople || 0, 'Pessoas'],
                [summary?.summary?.totalProjects || 0, 'Projetos'],
                [summary?.summary?.managers || 0, 'Liderança'],
                [summary?.summary?.contributors || 0, 'Operação'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-2xl font-semibold text-slate-900">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Gestão</p>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Aqui o workspace funciona como uma central da equipe. O controle real continua sendo por projeto, sem criar um modelo paralelo de acesso.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Workspace owner</p>
            <p className="mt-3 text-sm font-semibold text-slate-900">{summary?.workspace?.ownerUser?.name || 'Sem owner'}</p>
            <p className="mt-1 text-sm text-slate-600">{summary?.workspace?.ownerUser?.email || 'Sem e-mail disponível'}</p>
          </section>
        </>
      }
    >
      <section className="space-y-6">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div>}

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Equipe consolidada</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Quem participa do workspace hoje</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Cada pessoa aparece uma vez e, dentro do card, você vê em quais projetos ela atua e com qual nível de acesso.
            </p>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="space-y-4">
              {loading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                  Carregando equipe do workspace...
                </div>
              ) : summary?.members?.length ? (
                summary.members.map((person) => (
                  <article key={person.user.uuid} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h4 className="text-lg font-semibold text-slate-900">{person.user.name || 'Pessoa sem nome'}</h4>
                          {person.workspaceOwner && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                              Workspace owner
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{person.user.email}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {person.memberships.length} projetos
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {person.memberships.length ? (
                        person.memberships.map((membership) => {
                          const key = `${membership.projectUuid}:${person.user.uuid}`;
                          const canManageThisProject = membership.permissions?.canManageMembers;
                          const isBusy = savingMembershipKey === key || removingMembershipKey === key;

                          return (
                            <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-3">
                                    <p className="text-sm font-semibold text-slate-900">{membership.projectName}</p>
                                    <RoleBadge role={membership.projectRole} />
                                  </div>
                                  <p className="mt-2 text-sm text-slate-600">
                                    Entrou em {formatShortDate(membership.joinedAt)} · Seu papel neste projeto: {ROLE_LABELS[membership.currentUserRole] || 'Viewer'}
                                  </p>
                                </div>

                                {canManageThisProject ? (
                                  <div className="grid w-full gap-3 sm:grid-cols-[1fr_auto] lg:max-w-[360px]">
                                    <select
                                      value={membership.projectRole}
                                      onChange={(event) => handleRoleChange(membership.projectUuid, person.user.uuid, event.target.value)}
                                      disabled={isBusy}
                                      className="dashboard-input"
                                    >
                                      {ROLE_ORDER.map((role) => (
                                        <option key={role} value={role}>
                                          {ROLE_LABELS[role]}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveMembership(membership.projectUuid, person.user.uuid)}
                                      disabled={isBusy}
                                      className="dashboard-button-secondary border-rose-200 px-4 text-rose-700 hover:bg-rose-50"
                                    >
                                      {removingMembershipKey === key ? 'Removendo...' : 'Remover'}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/projects/${membership.projectUuid}/team`)}
                                    className="dashboard-button-secondary w-full lg:w-auto"
                                  >
                                    Abrir equipe do projeto
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                          Esta pessoa ainda não participa de nenhum projeto, mas já aparece aqui por ser owner do workspace.
                        </div>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                  Nenhuma participação registrada ainda no workspace.
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#102a72]">Adicionar ao projeto</p>
                <h4 className="mt-2 text-xl font-bold text-slate-900">Convidar a partir do workspace</h4>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Em vez de abrir cada projeto separadamente, traga uma pessoa direto por aqui e escolha o projeto de destino.
                </p>

                {manageableProjects.length ? (
                  <form className="mt-5 space-y-4" onSubmit={handleInvite}>
                    <label className="block">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Projeto</span>
                      <select
                        value={inviteForm.projectUuid}
                        onChange={(event) => setInviteForm((prev) => ({ ...prev, projectUuid: event.target.value }))}
                        className="dashboard-input"
                      >
                        {manageableProjects.map((project) => (
                          <option key={project.uuid} value={project.uuid}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">E-mail</span>
                      <input
                        type="email"
                        value={inviteForm.email}
                        onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                        placeholder="nome@empresa.com"
                        className="dashboard-input"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Papel inicial</span>
                      <select
                        value={inviteForm.projectRole}
                        onChange={(event) => setInviteForm((prev) => ({ ...prev, projectRole: event.target.value }))}
                        className="dashboard-input"
                      >
                        {ROLE_ORDER.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button type="submit" disabled={inviting} className="dashboard-button-primary w-full">
                      {inviting ? 'Adicionando pessoa...' : 'Adicionar ao projeto'}
                    </button>
                  </form>
                ) : (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-600">
                    Você não tem nenhum projeto com permissão para gerir membros neste workspace agora.
                  </div>
                )}
              </section>
            </aside>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
