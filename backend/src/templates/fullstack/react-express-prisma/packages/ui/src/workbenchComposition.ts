export function getFeatureModeProfile(productMode: string) {
  const base = {
    heroDark: false,
    metricDark: false,
    reversePanels: false,
    bodyColumns: 'minmax(340px, 420px) minmax(0, 1fr)',
    searchLabel: 'Pesquisar...',
    tableLabels: ['Registro', 'Status', 'Atualizacao'],
    asideTitle: 'Operacao viva',
    asideTone: 'Acompanhe o contexto principal desta area sem perder clareza.',
    highlightVariant: 'cards',
    recordsVariant: 'table',
    formVariant: 'panel',
  }

  return base
}

export function getLayoutVariantOverrides(layoutVariant: string) {
  return {}
}

export function getArchetypeOverrides(pageArchetype: string, fallbackPattern: string, patternHints: string[] = []) {
  const joinedHints = patternHints.join(' ')
  const base: Record<string, unknown> = {}

  if (joinedHints.includes('priority-visible')) return { searchLabel: 'Buscar por prioridade, dono ou estado' }
  if (joinedHints.includes('decision-focused')) return { highlightVariant: 'steps', recordsVariant: 'steps' }
  if (joinedHints.includes('summary-before-secondary-actions')) {
    return { settingsColumns: 'minmax(320px, 0.9fr) minmax(0, 1.1fr)', settingsReverse: true }
  }

  return base
}

export function buildSectionSet(sections: string[] = [], fallback: string[] = []) {
  return new Set((Array.isArray(sections) && sections.length ? sections : fallback).filter(Boolean))
}

export function hasSection(sectionSet: Set<string>, section: string) {
  return sectionSet.has(section)
}

export function getUiIntentProfile(uiIntent: string, pageArchetype: string) {
  const profiles: Record<string, Record<string, string>> = {
    configure: {
      badge: 'Ajuste',
      summaryTitle: 'Configuracao',
      summaryTone: 'Ajuste as preferencias com clareza.',
    },
    attach: {
      badge: 'Envio',
      summaryTitle: 'Anexos',
      summaryTone: 'Envie arquivos e contexto sem friccao.',
    },
    review: {
      badge: 'Revisao',
      summaryTitle: 'Itens em destaque',
      summaryTone: 'Veja o que precisa de atencao agora.',
    },
    monitor: {
      badge: 'Leitura',
      summaryTitle: 'Visao atual',
      summaryTone: 'Acompanhe os sinais principais sem excesso de estrutura.',
    },
    create: {
      badge: 'Criacao',
      summaryTitle: 'Novo registro',
      summaryTone: 'Registre o essencial para iniciar o fluxo.',
    },
    update: {
      badge: 'Atualizacao',
      summaryTitle: 'Resumo atual',
      summaryTone: 'Atualize o que importa sem sobrecarregar a tela.',
    },
    list: {
      badge: 'Consulta',
      summaryTitle: 'Leitura atual',
      summaryTone: 'Filtre e encontre o que precisa de atencao.',
    },
  }

  return {
    badge: 'Fluxo',
    summaryTitle: 'Resumo',
    summaryTone: 'A tela prioriza a informacao principal.',
    ...(profiles[uiIntent] || {}),
  }
}

export function resolveWorkbenchComposition({
  productMode,
  pageArchetype,
  fallbackPattern,
  layoutVariant,
  uiIntent,
  patternHints = [],
  screenSpec = {},
}: {
  productMode: string
  pageArchetype: string
  fallbackPattern: string
  layoutVariant: string
  uiIntent: string
  patternHints?: string[]
  screenSpec?: {
    screenTemplate?: string
    productMode?: string
    uiIntent?: string
    layoutVariant?: string
    pageArchetype?: string
    fallbackPattern?: string
    patternHints?: string[]
    sections?: string[]
    componentMap?: Record<string, string | null | undefined>
    intentSignal?: 'visible' | 'hidden'
    layoutFlow?: string
  }
}) {
  const hasScreenSpec = Boolean(screenSpec && Object.keys(screenSpec).length)
  const resolvedScreenTemplate = hasScreenSpec ? screenSpec.screenTemplate || '' : ''
  const resolvedLayoutVariant = hasScreenSpec ? screenSpec.layoutVariant || '' : layoutVariant
  const resolvedPageArchetype = hasScreenSpec ? screenSpec.pageArchetype || '' : pageArchetype
  const resolvedFallbackPattern = hasScreenSpec ? screenSpec.fallbackPattern || '' : fallbackPattern
  const resolvedPatternHints = hasScreenSpec
    ? Array.isArray(screenSpec.patternHints) && screenSpec.patternHints.length
      ? screenSpec.patternHints
      : []
    : patternHints
  const resolvedSections = hasScreenSpec ? (Array.isArray(screenSpec.sections) ? screenSpec.sections : []) : []
  const resolvedComponentMap = hasScreenSpec ? (screenSpec.componentMap || {}) : {}
  const resolvedUiIntent = hasScreenSpec ? screenSpec.uiIntent || 'custom' : uiIntent
  const resolvedProductMode = hasScreenSpec ? screenSpec.productMode || 'structured-workspace' : productMode
  const modeProfile = getFeatureModeProfile(resolvedProductMode)
  const layoutOverrides = getLayoutVariantOverrides(resolvedLayoutVariant)
  const archetypeOverrides = getArchetypeOverrides(resolvedPageArchetype, resolvedFallbackPattern, resolvedPatternHints)
  const intentProfile = getUiIntentProfile(resolvedUiIntent, resolvedPageArchetype)
  const layoutKey = `${resolvedProductMode}|${resolvedPageArchetype}|${resolvedFallbackPattern}|${resolvedLayoutVariant}|${resolvedScreenTemplate}|${resolvedUiIntent}`
  const baseSectionBlocks = new Set((resolvedSections.length ? resolvedSections : ['hero', 'form', 'records']).filter(Boolean))

  const panelOrder = archetypeOverrides.reversePanels ?? layoutOverrides.reversePanels ?? modeProfile.reversePanels ? ['records', 'form'] : ['form', 'records']
  const layoutFlow = hasScreenSpec && screenSpec.layoutFlow
    ? screenSpec.layoutFlow
    : resolvedLayoutVariant === 'calm-settings'
      ? 'settings'
      : resolvedLayoutVariant === 'guided-stack'
        ? 'guided'
        : resolvedLayoutVariant === 'hero-metrics' || resolvedProductMode === 'manager-cockpit'
          ? 'decision'
          : resolvedLayoutVariant === 'evidence-split'
            ? 'evidence'
            : resolvedLayoutVariant === 'queue-first' || resolvedLayoutVariant === 'queue-priority'
              ? 'queue'
              : 'workspace'
  const heroBlocks = {
    intent: intentProfile,
    asideTitle: String(archetypeOverrides.asideTitle || modeProfile.asideTitle || 'Operacao viva'),
    asideTone: String(archetypeOverrides.asideTone || modeProfile.asideTone || 'Acompanhe o contexto principal desta area sem perder clareza.'),
  }
  const leadBlockType =
    archetypeOverrides.highlightVariant ||
    layoutOverrides.highlightVariant ||
    modeProfile.highlightVariant ||
    (layoutFlow === 'settings' ? 'soft-list' : layoutFlow === 'guided' ? 'steps' : layoutFlow === 'evidence' ? 'chips' : 'cards')
  const recordBlockType =
    archetypeOverrides.recordsVariant ||
    layoutOverrides.recordsVariant ||
    modeProfile.recordsVariant ||
    (layoutFlow === 'settings' ? 'summary' : layoutFlow === 'guided' ? 'steps' : layoutFlow === 'evidence' ? 'evidence' : layoutFlow === 'review' ? 'queue' : layoutFlow === 'queue' ? 'queue' : layoutFlow === 'decision' ? 'insights' : 'table')
  const panelDensity =
    layoutFlow === 'settings'
      ? 'calm'
      : layoutFlow === 'guided'
        ? 'guided'
        : layoutFlow === 'evidence'
          ? 'evidence'
          : layoutFlow === 'queue'
            ? 'queue'
            : layoutFlow === 'review'
              ? 'review'
              : 'workspace'

  return {
    layoutKey,
    layoutFlow,
    panelDensity,
    sectionBlocks: Array.from(baseSectionBlocks),
    panelOrder,
    leadBlockType: String(leadBlockType),
    recordBlockType: String(recordBlockType),
    formVariant: String(modeProfile.formVariant || 'panel'),
    searchLabel: String(archetypeOverrides.searchLabel || modeProfile.searchLabel || 'Pesquisar...'),
    tableLabels: Array.isArray(archetypeOverrides.tableLabels)
      ? archetypeOverrides.tableLabels
      : Array.isArray(modeProfile.tableLabels)
        ? modeProfile.tableLabels
        : ['Registro', 'Status', 'Atualizacao'],
    heroBlocks,
    heroDark: Boolean(archetypeOverrides.heroDark ?? modeProfile.heroDark),
    metricDark: Boolean(archetypeOverrides.metricDark ?? modeProfile.metricDark),
    bodyColumns: String(archetypeOverrides.bodyColumns || layoutOverrides.bodyColumns || modeProfile.bodyColumns || 'minmax(340px, 420px) minmax(0, 1fr)'),
    settingsColumns: String(archetypeOverrides.settingsColumns || layoutOverrides.settingsColumns || 'minmax(0, 1.08fr) minmax(320px, 0.92fr)'),
    settingsReverse: Boolean(archetypeOverrides.settingsReverse ?? layoutOverrides.settingsReverse),
    settingsHighlightTitle: String(archetypeOverrides.settingsHighlightTitle || layoutOverrides.settingsHighlightTitle || 'Boas praticas'),
    surfaceBlueprint: {
      hero: {
        dark: Boolean(archetypeOverrides.heroDark ?? modeProfile.heroDark),
        metricDark: Boolean(archetypeOverrides.metricDark ?? modeProfile.metricDark),
        intent: intentProfile,
        asideTitle: String(archetypeOverrides.asideTitle || modeProfile.asideTitle || 'Operacao viva'),
        asideTone: String(archetypeOverrides.asideTone || modeProfile.asideTone || 'Acompanhe o contexto principal desta area sem perder clareza.'),
      },
      layout: {
        flow: layoutFlow,
        density: panelDensity,
        panelOrder,
        bodyColumns: String(archetypeOverrides.bodyColumns || layoutOverrides.bodyColumns || modeProfile.bodyColumns || 'minmax(340px, 420px) minmax(0, 1fr)'),
        settingsColumns: String(archetypeOverrides.settingsColumns || layoutOverrides.settingsColumns || 'minmax(0, 1.08fr) minmax(320px, 0.92fr)'),
        settingsReverse: Boolean(archetypeOverrides.settingsReverse ?? layoutOverrides.settingsReverse),
      },
      blocks: {
        lead: String(leadBlockType),
        records: String(recordBlockType),
        form: String(modeProfile.formVariant || 'panel'),
      },
      labels: {
        search: String(archetypeOverrides.searchLabel || modeProfile.searchLabel || 'Pesquisar...'),
        table: Array.isArray(archetypeOverrides.tableLabels)
          ? archetypeOverrides.tableLabels
          : Array.isArray(modeProfile.tableLabels)
            ? modeProfile.tableLabels
            : ['Registro', 'Status', 'Atualizacao'],
        settingsHighlightTitle: String(archetypeOverrides.settingsHighlightTitle || layoutOverrides.settingsHighlightTitle || 'Boas praticas'),
      },
    },
    resolvedSections,
    resolvedComponentMap,
    resolvedProductMode,
    resolvedUiIntent,
    resolvedLayoutVariant,
    resolvedPageArchetype,
    resolvedFallbackPattern,
  }
}

export function getWorkbenchVisualTokens(productMode: string, accentColor: string) {
  const presets: Record<string, Record<string, string>> = {
    'governance-console': {
      heroBackground: 'linear-gradient(135deg, #1f274d 0%, #2d396d 100%)',
      canvasBackground: 'linear-gradient(180deg, rgba(22,34,66,0.04) 0%, rgba(255,255,255,0.42) 100%)',
      formBackground: '#f7f9ff',
      recordsBackground: '#ffffff',
      leadBackground: '#eef3ff',
    },
    'self-service-settings': {
      heroBackground: 'linear-gradient(135deg, #ffffff 0%, #f5f8ff 100%)',
      canvasBackground: 'linear-gradient(180deg, rgba(36,81,183,0.05) 0%, rgba(255,255,255,0.4) 100%)',
      formBackground: '#ffffff',
      recordsBackground: '#fbfcff',
      leadBackground: '#f3f7ff',
    },
    'evidence-workbench': {
      heroBackground: 'linear-gradient(135deg, #f4fffb 0%, #ffffff 54%, #edf8ff 100%)',
      canvasBackground: 'linear-gradient(180deg, rgba(15,118,110,0.06) 0%, rgba(255,255,255,0.42) 100%)',
      formBackground: '#f7fffd',
      recordsBackground: '#fcfffe',
      leadBackground: '#edf8f6',
    },
    'manager-cockpit': {
      heroBackground: 'linear-gradient(135deg, #1f2447 0%, #2d3d77 62%, #1f5ba8 100%)',
      canvasBackground: 'linear-gradient(180deg, rgba(36,81,183,0.08) 0%, rgba(255,255,255,0.4) 100%)',
      formBackground: '#f8faff',
      recordsBackground: '#ffffff',
      leadBackground: '#eef4ff',
    },
  }
  return (
    presets[productMode] || {
      heroBackground: `linear-gradient(135deg, ${accentColor}12 0%, #ffffff 54%, #f5f8ff 100%)`,
      canvasBackground: 'linear-gradient(180deg, rgba(36,81,183,0.05) 0%, rgba(255,255,255,0.4) 100%)',
      formBackground: '#ffffff',
      recordsBackground: '#ffffff',
      leadBackground: '#f5f8ff',
    }
  )
}
