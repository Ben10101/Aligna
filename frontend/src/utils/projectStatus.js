export function getProjectStatusMeta(status) {
  if (status === 'archived') {
    return { label: 'Arquivado', tone: 'bg-slate-50 text-slate-700 border-slate-200', action: 'Reativar', nextStatus: 'active' };
  }

  if (status === 'on_hold') {
    return { label: 'Em pausa', tone: 'bg-amber-50 text-amber-800 border-amber-200', action: 'Reativar', nextStatus: 'active' };
  }

  if (status === 'completed') {
    return { label: 'Concluído', tone: 'bg-blue-50 text-[#102a72] border-blue-200', action: 'Arquivar', nextStatus: 'archived' };
  }

  if (status === 'active') {
    return { label: 'Ativo', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', action: 'Concluir', nextStatus: 'completed' };
  }

  return { label: 'Rascunho', tone: 'bg-blue-50 text-[#102a72] border-blue-200', action: 'Ativar', nextStatus: 'active' };
}

export function getProjectStatusTransition(status) {
  return getProjectStatusMeta(status).nextStatus;
}

export function getProjectStatusConfirmationMessage(projectName, nextStatus) {
  const readableStatus = {
    active: 'ativo',
    on_hold: 'em pausa',
    completed: 'concluído',
    archived: 'arquivado',
    draft: 'rascunho',
  }[nextStatus] || nextStatus;

  return `Deseja realmente mover o projeto "${projectName}" para o status "${readableStatus}"?`;
}

export function getProjectStatusWorkflow(status) {
  const meta = getProjectStatusMeta(status);

  if (status === 'archived') {
    return {
      ...meta,
      primaryAction: 'Reativar projeto',
      primaryTarget: 'active',
      secondaryAction: 'Manter arquivado',
    };
  }

  if (status === 'on_hold') {
    return {
      ...meta,
      primaryAction: 'Reativar projeto',
      primaryTarget: 'active',
      secondaryAction: 'Arquivar projeto',
      secondaryTarget: 'archived',
    };
  }

  if (status === 'completed') {
    return {
      ...meta,
      primaryAction: 'Arquivar projeto',
      primaryTarget: 'archived',
      secondaryAction: 'Reabrir projeto',
      secondaryTarget: 'active',
    };
  }

  if (status === 'active') {
    return {
      ...meta,
      primaryAction: 'Concluir projeto',
      primaryTarget: 'completed',
      secondaryAction: 'Colocar em pausa',
      secondaryTarget: 'on_hold',
    };
  }

  return {
    ...meta,
    primaryAction: 'Ativar projeto',
    primaryTarget: 'active',
    secondaryAction: 'Arquivar projeto',
    secondaryTarget: 'archived',
  };
}
