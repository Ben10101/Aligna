const SHELL_REGISTRY = {
  'operations-utilitarian-v1': {
    key: 'operations-utilitarian-v1',
    family: 'operations-shell',
    label: 'Operations Utilitarian',
    frame: 'AppFrame',
    header: 'AppHeader',
    sidebar: 'SidebarNav',
    navigationStyle: 'direct-sidebar',
    visualTone: 'utilitarian',
  },
};

export function getFrontendShellRegistry() {
  return SHELL_REGISTRY;
}

export function resolveProjectShell({ projectTemplate = null, projectDna = null } = {}) {
  const productMode = String(projectDna?.project?.productMode || '').toLowerCase();
  const navigationStyle = String(projectTemplate?.frontend?.navigationStyle || '').toLowerCase();

  if (
    productMode.includes('workspace') ||
    productMode.includes('operations') ||
    navigationStyle.includes('sidebar') ||
    navigationStyle.includes('suite')
  ) {
    return SHELL_REGISTRY['operations-utilitarian-v1'];
  }

  return SHELL_REGISTRY['operations-utilitarian-v1'];
}
