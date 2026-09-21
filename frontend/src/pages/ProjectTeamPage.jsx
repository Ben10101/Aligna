import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import {
  addProjectMember,
  getApiErrorMessage,
  getProject,
  removeProjectMember,
  updateProjectMember,
} from '../services/api';

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_ORDER = ['owner', 'manager', 'editor', 'viewer'];

const ROLE_HELPERS = {
  owner: 'Controle total do projeto e da equipe.',
  manager: 'Gerencia equipe, aprova arquitetura e organiza o projeto.',
  editor: 'Cria e edita tasks, comentários e execução operacional.',
  viewer: 'Acompanha o projeto em modo leitura.',
};

function getRoleRank(role) {
  const index = ROLE_ORDER.indexOf(role || 'viewer');
  return index === -1 ? ROLE_ORDER.length : index;
}

function formatShortDate(value) {
  if (!value) return 'Sem registro';
  return new Date(value).toLocaleDateString('pt-BR');
}

function buildPermissionSummary(project) {
  const permissions = project?.permissions || {};
  if (permissions.canManageMembers) {
    return 'Você pode convidar pessoas, trocar papéis e remover membros deste projeto.';
  }
  if (permissions.canEditProject) {
    return 'Você pode editar o projeto, mas a gestão da equipe está reservada para managers e owners.';
  }
  return 'Você está em modo de acompanhamento. A composição da equipe é somente leitura para este perfil.';
}

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

export default function ProjectTeamPage() {
  const navigate = useNavigate();
  const { projectUuid } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingInvite, setSavingInvite] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState(null);
  const [removingMemberFor, setRemovingMemberFor] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [inviteForm, setInviteForm] = useState({
    email: '',
    projectRole: 'editor',
  });

  useEffect(() => {
    loadProjectTeam();
  }, [projectUuid]);

  async function loadProjectTeam() {
    setLoading(true);
    setError(null);

    try {
      const projectData = await getProject(projectUuid);
      if (!projectData) {
        navigate('/projects', { replace: true });
        return;
      }
      setProject(projectData);
    } catch (loadError) {
      if (loadError.response?.status === 404) {
        navigate('/projects', { replace: true });
        return;
      }
      setError(getApiErrorMessage(loadError, 'Não foi possível carregar a equipe do projeto.'));
    } finally {
      setLoading(false);
    }
  }

  const members = useMemo(() => {
    return [...(project?.members || [])].sort((left, right) => {
      const roleDifference = getRoleRank(left.projectRole) - getRoleRank(right.projectRole);
      if (roleDifference !== 0) return roleDifference;
      return String(left.user?.name || left.user?.email || '').localeCompare(String(right.user?.name || right.user?.email || ''), 'pt-BR');
    });
  }, [project]);

  const teamStats = useMemo(() => {
    return {
      total: members.length,
      owners: members.filter((member) => member.projectRole === 'owner').length,
      managers: members.filter((member) => member.projectRole === 'manager').length,
      editors: members.filter((member) => member.projectRole === 'editor').length,
      viewers: members.filter((member) => member.projectRole === 'viewer').length,
    };
  }, [members]);

  const canManageMembers = Boolean(project?.permissions?.canManageMembers);

  async function handleInviteMember(event) {
    event.preventDefault();
    if (!inviteForm.email.trim()) {
      setError('Informe o e-mail da pessoa que deve entrar no projeto.');
      return;
    }

    setSavingInvite(true);
    setError(null);
    setSuccessMessage('');

    try {
      const updatedProject = await addProjectMember(projectUuid, inviteForm);
      setProject(updatedProject);
      setInviteForm({ email: '', projectRole: 'editor' });
      setSuccessMessage('Membro adicionado ao projeto com sucesso.');
    } catch (inviteError) {
      setError(getApiErrorMessage(inviteError, 'Não foi possível adicionar o membro ao projeto.'));
    } finally {
      setSavingInvite(false);
    }
  }

  async function handleRoleChange(memberUserUuid, nextRole) {
    setSavingRoleFor(memberUserUuid);
    setError(null);
    setSuccessMessage('');

    try {
      const updatedProject = await updateProjectMember(projectUuid, memberUserUuid, { projectRole: nextRole });
      setProject(updatedProject);
      setSuccessMessage('Papel do membro atualizado com sucesso.');
    } catch (roleError) {
      setError(getApiErrorMessage(roleError, 'Não foi possível atualizar o papel deste membro.'));
    } finally {
      setSavingRoleFor(null);
    }
  }

  async function handleRemoveMember(memberUserUuid) {
    setRemovingMemberFor(memberUserUuid);
    setError(null);
    setSuccessMessage('');

    try {
      const updatedProject = await removeProjectMember(projectUuid, memberUserUuid);
      setProject(updatedProject);
      setSuccessMessage('Membro removido do projeto com sucesso.');
    } catch (removeError) {
      setError(getApiErrorMessage(removeError, 'Não foi possível remover este membro do projeto.'));
    } finally {
      setRemovingMemberFor(null);
    }
  }

  return (
    <AppShell
      eyebrow="Equipe"
      title={project?.name || 'Equipe do projeto'}
      description="Gerencie quem participa do projeto, qual papel cada pessoa assume e quem pode operar a esteira."
      actions={
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={() => navigate(`/projects/${projectUuid}`)} className="dashboard-button-secondary w-full sm:w-auto">
            Visão geral
          </button>
          <button onClick={() => navigate(`/projects/${projectUuid}/planning`)} className="dashboard-button-secondary w-full sm:w-auto">
            Planejamento
          </button>
          <button onClick={() => navigate(`/projects/${projectUuid}`)} className="dashboard-button-primary w-full sm:w-auto">
            Abrir contexto
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
                [teamStats.total, 'Membros'],
                [teamStats.managers + teamStats.owners, 'Liderança'],
                [teamStats.editors, 'Operação'],
                [teamStats.viewers, 'Leitura'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-2xl font-semibold text-slate-900">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Seu papel</p>
            <div className="mt-4 flex items-center gap-3">
              <RoleBadge role={project?.currentUserRole || 'viewer'} />
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-700">{buildPermissionSummary(project)}</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Papéis</p>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {ROLE_ORDER.map((role) => (
                <div key={role} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <RoleBadge role={role} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{ROLE_HELPERS[role]}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      }
    >
      <section className="space-y-6">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div>}

        {!canManageMembers && !loading && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Esta tela está em modo leitura para o seu perfil. Somente managers e owners podem mudar a composição da equipe.
          </div>
        )}

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Equipe do projeto</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Quem participa e como cada pessoa atua</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Use esta área para manter a operação do projeto clara: quem decide, quem executa e quem acompanha.
            </p>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="space-y-4">
              {loading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                  Carregando equipe do projeto...
                </div>
              ) : members.length ? (
                members.map((member) => {
                  const memberUserUuid = member.user?.uuid;
                  const isBusy = savingRoleFor === memberUserUuid || removingMemberFor === memberUserUuid;

                  return (
                    <article key={memberUserUuid} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-3">
                            <h4 className="text-lg font-semibold text-slate-900">
                              {member.user?.name || 'Membro sem nome'}
                            </h4>
                            <RoleBadge role={member.projectRole} />
                            {project?.creator?.uuid === memberUserUuid && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                Criador
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">{member.user?.email || 'E-mail não disponível'}</p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Entrou em</p>
                              <p className="mt-2 text-sm font-semibold text-slate-900">{formatShortDate(member.joinedAt)}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Papel</p>
                              <p className="mt-2 text-sm font-semibold text-slate-900">{ROLE_HELPERS[member.projectRole] || ROLE_HELPERS.viewer}</p>
                            </div>
                          </div>
                        </div>

                        <div className="w-full xl:max-w-[260px]">
                          {canManageMembers ? (
                            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <label className="block">
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Papel no projeto</span>
                                <select
                                  value={member.projectRole}
                                  onChange={(event) => handleRoleChange(memberUserUuid, event.target.value)}
                                  disabled={isBusy}
                                  className="dashboard-input"
                                >
                                  {ROLE_ORDER.map((role) => (
                                    <option key={role} value={role}>
                                      {ROLE_LABELS[role]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(memberUserUuid)}
                                disabled={isBusy}
                                className="dashboard-button-secondary w-full border-rose-200 text-rose-700 hover:bg-rose-50"
                              >
                                {removingMemberFor === memberUserUuid ? 'Removendo...' : 'Remover do projeto'}
                              </button>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                              Perfil em leitura. A composição da equipe é visível aqui, mas mudanças dependem de alguém com papel de manager ou owner.
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                  Nenhum membro adicional neste projeto ainda. O criador continua como referência principal até a equipe ser montada.
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#102a72]">Adicionar membro</p>
                <h4 className="mt-2 text-xl font-bold text-slate-900">Convidar por e-mail</h4>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Traga alguém que já tenha conta na plataforma e escolha o papel mais adequado para a participação no projeto.
                </p>

                {canManageMembers ? (
                  <form className="mt-5 space-y-4" onSubmit={handleInviteMember}>
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

                    <button type="submit" disabled={savingInvite} className="dashboard-button-primary w-full">
                      {savingInvite ? 'Adicionando membro...' : 'Adicionar ao projeto'}
                    </button>
                  </form>
                ) : (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-600">
                    A gestão da equipe está bloqueada para o seu perfil. Se precisar mudar alguém de papel ou incluir novo membro, peça apoio a um manager ou owner.
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
