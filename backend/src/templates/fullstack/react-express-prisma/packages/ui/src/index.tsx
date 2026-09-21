import React from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  buildSectionSet as buildWorkbenchSectionSet,
  getWorkbenchVisualTokens as getWorkbenchVisualTokensShared,
  hasSection as hasWorkbenchSection,
  resolveWorkbenchComposition as resolveWorkbenchCompositionShared,
} from './workbenchComposition'

export const tokens = {
  color: {
    text: '#1f2a44',
    muted: '#7b879d',
    mutedStrong: '#49566d',
    border: '#d9deea',
    surface: '#ffffff',
    surfaceStrong: '#ffffff',
    surfaceAlt: '#f4f6fb',
    accent: '#2451b7',
    accentStrong: '#17377d',
    accentSoft: '#dde7ff',
    shell: '#23284d',
    shellSoft: '#303762',
    shellBorder: '#d7dced',
    success: '#0f766e',
    danger: '#b42318',
  },
  radius: {
    card: 18,
    control: 12,
    pill: 999,
  },
  shadow: {
    panel: '0 18px 46px rgba(15, 23, 42, 0.08)',
    header: '0 18px 40px rgba(8, 15, 32, 0.28)',
  },
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#eef2f7',
        color: tokens.color.text,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
      }}
    >
      {children}
    </main>
  )
}

export function AppHeader({
  title,
}: {
  title: string
  activePath: string
  routes: Array<{ path: string; label: string }>
}) {
  return (
    <header
      style={{
        height: 56,
        padding: '0 18px',
        background: '#f8fafc',
        color: '#0f172a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${tokens.color.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          OP
        </div>
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: tokens.color.muted,
              fontWeight: 800,
            }}
          >
            Plataforma de visitas
          </span>
          <strong style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: tokens.color.muted, fontWeight: 700 }}>Operacao ativa</span>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#dbe4ee',
            color: '#0f172a',
            fontWeight: 800,
            fontSize: 11,
          }}
        >
          BL
        </span>
      </div>
    </header>
  )
}

export function SidebarNav({
  routes,
  activePath,
}: {
  routes: Array<{ path: string; label: string }>
  activePath: string
}) {
  return (
    <aside
      style={{
        width: 220,
        minHeight: 'calc(100vh - 56px)',
        background: '#f8fafc',
        borderRight: '1px solid #dbe4ee',
        display: 'grid',
        alignContent: 'start',
      }}
    >
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${tokens.color.border}` }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.color.muted, fontWeight: 800 }}>
          Modulos
        </div>
      </div>

      <nav style={{ display: 'grid', gap: 6, padding: 10 }}>
        {routes.map((route) => {
          const active = activePath === route.path
          return (
            <a
              key={route.path}
              href={route.path}
              style={{
                padding: '12px 14px',
                textDecoration: 'none',
                color: active ? '#0f172a' : tokens.color.mutedStrong,
                fontWeight: active ? 800 : 700,
                background: active ? '#ffffff' : 'transparent',
                border: active ? `1px solid ${tokens.color.border}` : '1px solid transparent',
                borderRadius: 12,
                boxShadow: active ? '0 6px 18px rgba(15, 23, 42, 0.06)' : 'none',
              }}
            >
              {route.label}
            </a>
          )
        })}
      </nav>

      <div style={{ marginTop: 'auto', padding: 14, fontSize: 11, color: tokens.color.muted }}>
        Navegacao direta pelas areas ativas do projeto.
      </div>
    </aside>
  )
}
export function StudioHome({
  title,
  routes,
}: {
  title: string
  routes: Array<{ path: string; label: string }>
}) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 20,
        padding: 24,
        borderRadius: 28,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,255,0.98) 100%)',
        border: `1px solid ${tokens.color.border}`,
        boxShadow: tokens.shadow.panel,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.color.muted, fontWeight: 800 }}>
            VisÃ£o geral
          </div>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', color: tokens.color.shell }}>{title}</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: tokens.color.mutedStrong }}>
            Estrutura base pronta para evoluir mÃƒÂ³dulos operacionais, fluxos de cadastro e jornadas de acompanhamento com mais consistÃƒÂªncia.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: tokens.color.muted, fontWeight: 700 }}>?ltima atualizaÃ§Ã£o</div>
          <strong style={{ display: 'block', marginTop: 6, color: tokens.color.shell }}>Agora</strong>
        </div>
      </div>

      <MetricRow
        items={[
          { label: 'MÃƒÂ³dulos ativos', value: String(routes.length) },
          { label: 'NavegaÃƒÂ§ÃƒÂ£o', value: 'Pronta' },
          { label: 'Base', value: 'Web + API' },
        ]}
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {routes.map((route) => (
          <a
            key={route.path}
            href={route.path}
            style={{
              padding: '16px 18px',
              borderRadius: 18,
              textDecoration: 'none',
              color: tokens.color.text,
              background: 'linear-gradient(135deg, #ffffff 0%, #f6f8ff 100%)',
              border: `1px solid ${tokens.color.border}`,
              boxShadow: '0 14px 28px rgba(31, 42, 68, 0.06)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: 16 }}>{route.label}</strong>
            <span style={{ color: tokens.color.mutedStrong, fontWeight: 700 }}>Abrir</span>
          </a>
        ))}
      </div>
    </section>
  )
}

type ComponentMap = {
  recordsLead?: string | null
  activity?: string | null
  summary?: string | null
  highlights?: string | null
  intentSignal?: string | null
}

type ScreenSpec = {
  screenTemplate?: string
  productMode?: string
  uiIntent?: string
  layoutVariant?: string
  pageArchetype?: string
  fallbackPattern?: string
  patternHints?: string[]
  sections?: string[]
  componentMap?: ComponentMap
  intentSignal?: 'visible' | 'hidden'
  layoutFlow?: string
}

function renderLeadBlock({
  blockType,
  highlights,
  heroDark,
  accentColor,
  visuals,
}: {
  blockType: string
  highlights: string[]
  heroDark: boolean
  accentColor: string
  visuals: ReturnType<typeof getWorkbenchVisualTokensShared>
}) {
  if (blockType === 'pills') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {highlights.map((item) => (
          <span
            key={item}
            style={{
              padding: '8px 11px',
              borderRadius: tokens.radius.pill,
              background: `${heroDark ? 'rgba(255,255,255,0.14)' : '#ffffff'}`,
              border: `1px solid ${accentColor}22`,
              color: tokens.color.shell,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {item}
          </span>
        ))}
      </div>
    )
  }

  if (blockType === 'soft-list') {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {highlights.map((item) => (
          <div
            key={item}
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: visuals.leadBackground,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.mutedStrong,
              lineHeight: 1.6,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    )
  }

  if (blockType === 'chips') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {highlights.map((item) => (
          <span
            key={item}
            style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: `${accentColor}10`,
              border: `1px dashed ${accentColor}55`,
              color: tokens.color.shell,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {item}
          </span>
        ))}
      </div>
    )
  }

  if (blockType === 'steps') {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {highlights.map((item, index) => (
          <div key={item} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, alignItems: 'start' }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: `${accentColor}15`,
                color: accentColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {index + 1}
            </div>
            <div style={{ paddingTop: 4, color: tokens.color.mutedStrong, lineHeight: 1.6 }}>{item}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {highlights.map((item) => (
        <div
          key={item}
          style={{
            padding: '14px 16px',
            borderRadius: 16,
            border: `1px solid ${tokens.color.border}`,
            background: `${accentColor}10`,
            boxShadow: tokens.shadow.panel,
            color: tokens.color.mutedStrong,
            lineHeight: 1.65,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  )
}

function renderRecordsLeadBlock({
  blockType,
  tableLabels,
  highlights,
  accentColor,
}: {
  blockType: string
  tableLabels: string[]
  highlights: string[]
  accentColor: string
}) {
  if (blockType === 'summary') {
    return <SettingsSnapshot items={highlights.slice(0, 2)} />
  }

  if (blockType === 'policy-grid') {
    return (
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {tableLabels.slice(0, 2).map((label) => (
          <div
            key={String(label)}
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: `${accentColor}08`,
              border: `1px solid ${tokens.color.border}`,
            }}
          >
            <div style={{ fontSize: 12, color: tokens.color.muted, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {String(label)}
            </div>
            <div style={{ marginTop: 6, color: tokens.color.shell, fontWeight: 700 }}>Em definicao</div>
          </div>
        ))}
      </div>
    )
  }

  if (blockType === 'evidence') {
    return <EvidenceRail accentColor={accentColor} />
  }

  if (blockType === 'insights') {
    return <InsightStrip labels={tableLabels.map((label) => String(label))} />
  }

  if (blockType === 'queue') {
    return <ReviewQueuePreview />
  }

  if (blockType === 'steps') {
    return <ApprovalStepsPreview accentColor={accentColor} />
  }

  return null
}

function IntentSignal({
  badge,
  title,
  tone,
  accentColor,
}: {
  badge: string
  title: string
  tone: string
  accentColor: string
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 18,
        background: '#ffffff',
        border: `1px solid ${accentColor}22`,
        boxShadow: tokens.shadow.panel,
      }}
    >
      <div style={{ fontSize: 12, color: tokens.color.muted, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{badge}</div>
      <strong style={{ display: 'block', marginTop: 8, color: tokens.color.shell, fontSize: 15 }}>{title}</strong>
      <p style={{ margin: '8px 0 0', color: tokens.color.mutedStrong, lineHeight: 1.6 }}>{tone}</p>
    </div>
  )
}

function SettingsSnapshot({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            padding: '12px 14px',
            borderRadius: 14,
            background: '#f8fafc',
            border: `1px solid ${tokens.color.border}`,
            color: tokens.color.mutedStrong,
            lineHeight: 1.6,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  )
}

function EvidenceRail({ accentColor }: { accentColor: string }) {
  return (
    <div
      style={{
        padding: '16px 18px',
        borderRadius: 18,
        background: `${accentColor}08`,
        border: `1px dashed ${accentColor}55`,
        color: tokens.color.mutedStrong,
        lineHeight: 1.7,
      }}
    >
      Organize comprovantes, links e anexos em uma trilha clara para quem vai analisar o caso.
    </div>
  )
}

function ReviewQueuePreview() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {['Precisa de validacao', 'Em revisao', 'Pronto para decidir'].map((item) => (
        <div
          key={item}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 14,
            background: '#f8fafc',
            border: `1px solid ${tokens.color.border}`,
          }}
        >
          <strong style={{ color: tokens.color.shell }}>{item}</strong>
          <span style={{ color: tokens.color.mutedStrong, fontWeight: 700 }}>Fila ativa</span>
        </div>
      ))}
    </div>
  )
}

function ApprovalStepsPreview({ accentColor }: { accentColor: string }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {[
        ['Preparar contexto', 'Reunir evidencias e criterio de decis?o.'],
        ['Revisar impacto', 'Validar risco, escopo e responsavel.'],
        ['Concluir parecer', 'Registrar a decis?o e proximo passo.'],
      ].map(([title, tone], index) => (
        <div key={title} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 12, alignItems: 'start' }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: `${accentColor}15`,
              color: accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 11,
            }}
          >
            {index + 1}
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <strong style={{ color: tokens.color.shell, fontSize: 14 }}>{title}</strong>
            <span style={{ color: tokens.color.mutedStrong, lineHeight: 1.6 }}>{tone}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ActivityTimeline({ items }: { items?: string[] }) {
  const timelineItems = items?.length
    ? items
    : [
        'Mudanca mais recente registrada nesta area.',
        'Ultimo ajuste validado pela operacao.',
        'Proximo evento aguardando acompanhamento.',
      ]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {timelineItems.slice(0, 3).map((item, index) => (
        <div key={`${item}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: tokens.color.accent }} />
            {index < Math.min(timelineItems.length, 3) - 1 ? <span style={{ width: 2, minHeight: 28, borderRadius: 999, background: tokens.color.border }} /> : null}
          </div>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: '#ffffff',
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.mutedStrong,
              lineHeight: 1.6,
            }}
          >
            {item}
          </div>
        </div>
      ))}
    </div>
  )
}

function InsightStrip({ labels }: { labels: string[] }) {
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      {labels.map((label) => (
        <div
          key={label}
          style={{
            padding: '12px 14px',
            borderRadius: 14,
            background: '#111827',
            color: '#f8fafc',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
          <div style={{ marginTop: 8, fontWeight: 800 }}>Acompanhando</div>
        </div>
      ))}
    </div>
  )
}

export function FeaturePage({
  accent = 'teal',
  layout = 'split',
  productMode = 'structured-workspace',
  eyebrow,
  title,
  description,
  metrics,
  highlights,
  formTitle,
  formDescription,
  form,
  listTitle,
  listDescription,
  listMeta,
  children,
}: {
  accent?: 'teal' | 'blue' | 'violet' | 'amber'
  layout?: 'split' | 'stacked' | 'wizard' | 'dashboard' | 'workspace' | 'settings' | 'crud'
  productMode?: string
  eyebrow: string
  title: string
  description: string
  metrics?: Array<{ label: string; value: string }>
  highlights: string[]
  formTitle: string
  formDescription: string
  form: ReactNode
  listTitle: string
  listDescription: string
  listMeta: string
  children: ReactNode
}) {
  const accentMap: Record<string, string> = {
    teal: '#0f766e',
    blue: '#2451b7',
    violet: '#6d28d9',
    amber: '#b45309',
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div
        style={{
          padding: '18px 20px',
          borderRadius: tokens.radius.card,
          background: '#ffffff',
          border: `1px solid ${tokens.color.border}`,
          boxShadow: tokens.shadow.panel,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Badge subtle>{eyebrow}</Badge>
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.03em', color: tokens.color.shell }}>{title}</h1>
              <p style={{ margin: 0, color: tokens.color.mutedStrong, lineHeight: 1.7, maxWidth: 820 }}>{description}</p>
            </div>
          </div>
          <div style={{ minWidth: 180, textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: tokens.color.muted, fontWeight: 700 }}>?ltima atualizaÃ§Ã£o</div>
            <strong style={{ display: 'block', marginTop: 6, color: tokens.color.shell }}>Agora</strong>
          </div>
        </div>
      </div>

      <MetricRow items={metrics} />

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(340px, 420px) minmax(0, 1fr)' }}>
        <SurfaceCard title={formTitle} description={formDescription}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: `${accentMap[accent] || accentMap.teal}10`,
                border: `1px solid ${(accentMap[accent] || accentMap.teal)}22`,
                color: tokens.color.mutedStrong,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {highlights[0] || 'Fluxo pronto para operaÃƒÂ§ÃƒÂ£o com mais clareza.'}
            </div>
            {form}
          </div>
        </SurfaceCard>

        <SurfaceCard title={listTitle} description={listDescription} meta={listMeta}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 14,
                background: '#f6f8fc',
                border: `1px solid ${tokens.color.border}`,
              }}
            >
              <span style={{ color: tokens.color.muted }}>âŒ•</span>
              <span style={{ color: tokens.color.mutedStrong }}>Pesquisar...</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr 0.8fr 0.9fr',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 12,
                background: '#f6f8fc',
                border: `1px solid ${tokens.color.border}`,
                color: tokens.color.mutedStrong,
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              <span>Registro</span>
              <span>Status</span>
              <span>AtualizaÃ§Ã£o</span>
            </div>
            {children}
          </div>
        </SurfaceCard>
      </div>
    </section>
  )
}

export function FeatureWorkbench({
  accent = 'teal',
  productMode = 'structured-workspace',
  uiIntent = 'custom',
  layoutVariant = '',
  pageArchetype = '',
  fallbackPattern = '',
  patternHints = [],
  sections = [],
  componentMap = {},
  screenSpec = {},
  eyebrow,
  title,
  description,
  metrics,
  highlights,
  formTitle,
  formDescription,
  form,
  listTitle,
  listDescription,
  listMeta,
  children,
}: {
  accent?: 'teal' | 'blue' | 'violet' | 'amber'
  productMode?: string
  uiIntent?: string
  layoutVariant?: string
  pageArchetype?: string
  fallbackPattern?: string
  patternHints?: string[]
  sections?: string[]
  componentMap?: ComponentMap
  screenSpec?: ScreenSpec
  eyebrow: string
  title: string
  description: string
  metrics?: Array<{ label: string; value: string }>
  highlights: string[]
  formTitle: string
  formDescription: string
  form: ReactNode
  listTitle: string
  listDescription: string
  listMeta?: string
  children: ReactNode
}) {
  const accentMap: Record<string, string> = {
    teal: '#0f766e',
    blue: '#2451b7',
    violet: '#6d28d9',
    amber: '#b45309',
  }

  const accentColor = accentMap[accent] || accentMap.teal
  const composition = resolveWorkbenchCompositionShared({
    productMode,
    pageArchetype,
    fallbackPattern,
    layoutVariant,
    uiIntent,
    patternHints,
    screenSpec,
  })
  const surfaceBlueprint = composition.surfaceBlueprint
  const heroDark = surfaceBlueprint.hero.dark
  const metricDark = surfaceBlueprint.hero.metricDark
  const reversePanels = surfaceBlueprint.layout.panelOrder[0] === 'records'
  const bodyColumns = surfaceBlueprint.layout.bodyColumns
  const searchLabel = surfaceBlueprint.labels.search
  const tableLabels = surfaceBlueprint.labels.table
  const asideTitle = surfaceBlueprint.hero.asideTitle
  const asideTone = surfaceBlueprint.hero.asideTone
  const intentProfile = surfaceBlueprint.hero.intent
  const leadBlockType = surfaceBlueprint.blocks.lead
  const recordBlockType = surfaceBlueprint.blocks.records
  const formVariant = surfaceBlueprint.blocks.form
  const visuals = getWorkbenchVisualTokensShared(composition.resolvedProductMode || productMode, accentColor)
  const resolvedSections = composition.resolvedSections
  const resolvedComponentMap = composition.resolvedComponentMap
  const sectionSet = buildWorkbenchSectionSet(resolvedSections, composition.sectionBlocks)
  const showHero = hasWorkbenchSection(sectionSet, 'hero')
  const showMetrics = hasWorkbenchSection(sectionSet, 'metrics') && Boolean(metrics?.length)
  const showIntentSignal = resolvedComponentMap.intentSignal === 'visible' || screenSpec.intentSignal === 'visible'
  const showFilters = hasWorkbenchSection(sectionSet, 'filters')
  const showForm = hasWorkbenchSection(sectionSet, 'form')
  const showRecords = hasWorkbenchSection(sectionSet, 'records') || hasWorkbenchSection(sectionSet, 'list') || hasWorkbenchSection(sectionSet, 'queue')
  const showActivity = hasWorkbenchSection(sectionSet, 'activity')
  const leadBlock = resolvedComponentMap.highlights === 'none' ? 'cards' : leadBlockType
  const recordBlock =
    resolvedComponentMap.recordsLead === 'approvalSteps'
      ? 'steps'
      : resolvedComponentMap.recordsLead === 'queueRail'
        ? 'queue'
        : resolvedComponentMap.recordsLead === 'evidenceRail'
          ? 'evidence'
          : resolvedComponentMap.recordsLead === 'insightStrip'
            ? 'insights'
              : hasWorkbenchSection(sectionSet, 'steps')
              ? 'steps'
                : hasWorkbenchSection(sectionSet, 'queue')
                ? 'queue'
                  : hasWorkbenchSection(sectionSet, 'metrics')
                  ? 'insights'
                    : hasWorkbenchSection(sectionSet, 'summary') && recordBlockType === 'table'
                    ? 'summary'
                    : recordBlockType
  const highlightNode = renderLeadBlock({
    blockType: leadBlock,
    highlights,
    heroDark,
    accentColor,
    visuals,
  })
  const recordsLeadNode = renderRecordsLeadBlock({
    blockType: recordBlock,
    tableLabels,
    highlights,
    accentColor,
  })

  const formPanel = (
    <SurfaceCard title={formTitle} description={formDescription} background={visuals.formBackground}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            padding: '16px 18px',
            borderRadius: 18,
            background: formVariant === 'console' ? '#0f172a' : formVariant === 'settings' ? '#f8fafc' : `${accentColor}10`,
            border: formVariant === 'console' ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${formVariant === 'settings' ? tokens.color.border : `${accentColor}28`}`,
            display: 'grid',
            gap: 10,
          }}
        >
          <strong style={{ color: formVariant === 'console' ? '#f8fafc' : tokens.color.shell, fontSize: 15 }}>{asideTitle}</strong>
          <p style={{ margin: 0, color: formVariant === 'console' ? 'rgba(248,250,252,0.76)' : tokens.color.mutedStrong, lineHeight: 1.7 }}>{asideTone}</p>
          {leadBlock === 'pills' || leadBlock === 'chips' ? highlightNode : null}
        </div>
        {form}
        {showActivity || resolvedComponentMap.activity === 'activityTimeline' ? <ActivityTimeline /> : null}
      </div>
    </SurfaceCard>
  )

  const recordsPanel = (
    <SurfaceCard title={listTitle} description={listDescription} meta={listMeta} background={visuals.recordsBackground}>
      <div style={{ display: 'grid', gap: 14 }}>
        {recordsLeadNode}
        {showFilters && recordBlock !== 'summary' && recordBlock !== 'steps' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 14,
              background: visuals.leadBackground,
              border: `1px solid ${tokens.color.border}`,
            }}
          >
            <span style={{ color: tokens.color.muted }}>Buscar</span>
            <span style={{ color: tokens.color.mutedStrong }}>{searchLabel}</span>
          </div>
        ) : null}
        {showFilters && recordBlock !== 'summary' && recordBlock !== 'steps' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.3fr 0.8fr 0.9fr',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 12,
              background: visuals.leadBackground,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.mutedStrong,
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            <span>{String(tableLabels[0] || 'Registro')}</span>
            <span>{String(tableLabels[1] || 'Status')}</span>
            <span>{String(tableLabels[2] || 'Atualizacao')}</span>
          </div>
        ) : null}
        {children}
      </div>
    </SurfaceCard>
  )

  return (
    <section style={{ display: 'grid', gap: 20 }}>
      {showHero ? (
        <div
          style={{
            padding: '22px 24px',
            borderRadius: 24,
            background: heroDark ? `linear-gradient(135deg, ${tokens.color.shell} 0%, ${tokens.color.shellSoft} 100%)` : visuals.heroBackground,
            border: heroDark ? 'none' : `1px solid ${tokens.color.border}`,
            boxShadow: tokens.shadow.panel,
            color: heroDark ? '#f8fafc' : tokens.color.text,
          }}
        >
          <div style={{ display: 'grid', gap: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -36, right: -28, width: 180, height: 180, borderRadius: '50%', background: heroDark ? 'rgba(255,255,255,0.07)' : `${accentColor}10`, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -54, right: 132, width: 128, height: 128, borderRadius: 32, background: heroDark ? 'rgba(255,255,255,0.05)' : `${accentColor}14`, transform: 'rotate(18deg)', pointerEvents: 'none' }} />
            {showIntentSignal ? (
              <IntentSignal
                badge={intentProfile.badge}
                title={intentProfile.summaryTitle}
                tone={intentProfile.summaryTone}
                accentColor={accentColor}
              />
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 10, maxWidth: 820 }}>
                <Badge dark={heroDark} subtle={!heroDark}>{eyebrow}</Badge>
                <div style={{ display: 'grid', gap: 8 }}>
                  <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.02, letterSpacing: '-0.03em', color: heroDark ? '#f8fafc' : tokens.color.shell }}>{title}</h1>
                  <p style={{ margin: 0, color: heroDark ? 'rgba(248,250,252,0.78)' : tokens.color.mutedStrong, lineHeight: 1.75 }}>{description}</p>
                </div>
              </div>
              <div style={{ minWidth: 220, display: 'grid', gap: 10 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: heroDark ? 'rgba(248,250,252,0.62)' : tokens.color.muted }}>Atualizado agora</div>
                </div>
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 18,
                    background: heroDark ? 'rgba(255,255,255,0.1)' : `${accentColor}10`,
                    border: heroDark ? '1px solid rgba(255,255,255,0.16)' : `1px solid ${accentColor}20`,
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 14, color: heroDark ? '#f8fafc' : tokens.color.shell }}>{asideTitle}</strong>
                  <span style={{ display: 'block', marginTop: 6, lineHeight: 1.6, color: heroDark ? 'rgba(248,250,252,0.78)' : tokens.color.mutedStrong }}>{asideTone}</span>
                </div>
              </div>
            </div>

            {showMetrics ? <MetricRow items={metrics} dark={metricDark} /> : null}
          </div>
        </div>
      ) : null}

      {showForm || showRecords ? (
        <>
          {leadBlock === 'pills' || leadBlock === 'chips' ? null : highlightNode}
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: bodyColumns, padding: 6, borderRadius: 28, background: visuals.canvasBackground }}>
            {showRecords && showForm ? (
              <>
                {reversePanels ? recordsPanel : formPanel}
                {reversePanels ? formPanel : recordsPanel}
              </>
            ) : showForm ? (
              formPanel
            ) : (
              recordsPanel
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}

export function SettingsWorkbench({
  accent = 'teal',
  productMode = 'self-service-settings',
  uiIntent = 'configure',
  layoutVariant = 'calm-settings',
  pageArchetype = 'settings-console',
  fallbackPattern = 'stripe-settings',
  patternHints = [],
  sections = [],
  componentMap = {},
  screenSpec = {},
  eyebrow,
  title,
  description,
  highlights,
  formTitle,
  formDescription,
  form,
  summaryTitle,
  summaryDescription,
  summaryMeta,
  summaryHighlights,
  children,
}: {
  accent?: 'teal' | 'blue' | 'violet' | 'amber'
  productMode?: string
  uiIntent?: string
  layoutVariant?: string
  pageArchetype?: string
  fallbackPattern?: string
  patternHints?: string[]
  sections?: string[]
  componentMap?: ComponentMap
  screenSpec?: ScreenSpec
  eyebrow: string
  title: string
  description: string
  highlights: string[]
  formTitle: string
  formDescription: string
  form: ReactNode
  summaryTitle: string
  summaryDescription: string
  summaryMeta?: string
  summaryHighlights?: string[]
  children: ReactNode
}) {
  const accentMap: Record<string, string> = {
    teal: '#0f766e',
    blue: '#2451b7',
    violet: '#6d28d9',
    amber: '#b45309',
  }

  const accentColor = accentMap[accent] || accentMap.teal
  const composition = resolveWorkbenchCompositionShared({
    productMode,
    pageArchetype,
    fallbackPattern,
    layoutVariant,
    uiIntent,
    patternHints,
    screenSpec,
  })
  const surfaceBlueprint = composition.surfaceBlueprint
  const intentProfile = surfaceBlueprint.hero.intent
  const asideTone = String(surfaceBlueprint.hero.asideTone || 'Ajustes simples e claros para manter o controle do que esta ativo.')
  const summaryItems = (summaryHighlights?.length ? summaryHighlights : highlights).slice(0, 3)
  const visuals = getWorkbenchVisualTokensShared(composition.resolvedProductMode || productMode, accentColor)
  const settingsColumns = surfaceBlueprint.layout.settingsColumns
  const settingsReverse = surfaceBlueprint.layout.settingsReverse
  const settingsHighlightTitle = surfaceBlueprint.labels.settingsHighlightTitle
  const resolvedSections = composition.resolvedSections
  const resolvedComponentMap = composition.resolvedComponentMap
  const sectionSet = buildWorkbenchSectionSet(resolvedSections, composition.sectionBlocks)
  const showHero = hasWorkbenchSection(sectionSet, 'hero')
  const showSummary = hasWorkbenchSection(sectionSet, 'summary')
  const showActivity = hasWorkbenchSection(sectionSet, 'activity')
  const formPanel = (
    <SurfaceCard title={formTitle} description={formDescription} background={visuals.formBackground}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            padding: '16px 18px',
            borderRadius: 18,
            background: visuals.leadBackground,
            border: `1px solid ${tokens.color.border}`,
            display: 'grid',
            gap: 10,
          }}
        >
          <strong style={{ color: tokens.color.shell, fontSize: 15 }}>{summaryTitle}</strong>
          <p style={{ margin: 0, color: tokens.color.mutedStrong, lineHeight: 1.7 }}>{asideTone}</p>
        </div>
        {form}
      </div>
    </SurfaceCard>
  )
  const summaryPanel = (
    <div style={{ display: 'grid', gap: 16 }}>
          {showSummary || resolvedComponentMap.summary === 'settingsSnapshot' ? (
            <SurfaceCard title={summaryTitle} description={summaryDescription} meta={summaryMeta} background={visuals.recordsBackground}>
          <div style={{ display: 'grid', gap: 14 }}>
            <SettingsSnapshot items={summaryItems} />
            {children}
          </div>
        </SurfaceCard>
      ) : null}
      {highlights.length ? (
        <SurfaceCard title={settingsHighlightTitle} description="Pontos de atencao para manter este ajuste claro para o usuario." background={visuals.recordsBackground}>
          <div style={{ display: 'grid', gap: 10 }}>
            {highlights.map((item) => (
              <div
                key={item}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: visuals.leadBackground,
                  border: `1px solid ${tokens.color.border}`,
                  color: tokens.color.mutedStrong,
                  lineHeight: 1.6,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}
          {showActivity || resolvedComponentMap.activity === 'activityTimeline' ? (
            <SurfaceCard title="Atividade recente" description="Sinais recentes para acompanhar o impacto dessas configuracoes." background={visuals.recordsBackground}>
              <ActivityTimeline />
            </SurfaceCard>
      ) : null}
    </div>
  )

  return (
    <section style={{ display: 'grid', gap: 20 }}>
      {showHero ? (
        <div
          style={{
            padding: '22px 24px',
            borderRadius: 24,
            background: visuals.heroBackground,
            border: `1px solid ${tokens.color.border}`,
            boxShadow: tokens.shadow.panel,
          }}
        >
          <div style={{ display: 'grid', gap: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -34, right: -30, width: 160, height: 160, borderRadius: '50%', background: `${accentColor}12`, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -44, left: 36, width: 124, height: 124, borderRadius: 28, background: `${accentColor}10`, transform: 'rotate(16deg)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 10, maxWidth: 820 }}>
                <Badge subtle>{eyebrow}</Badge>
                <div style={{ display: 'grid', gap: 8 }}>
                  <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.02, letterSpacing: '-0.03em', color: tokens.color.shell }}>{title}</h1>
                  <p style={{ margin: 0, color: tokens.color.mutedStrong, lineHeight: 1.75 }}>{description}</p>
                </div>
              </div>
              <div style={{ minWidth: 240, display: 'grid', gap: 10 }}>
                <IntentSignal
                  badge={intentProfile.badge}
                  title={intentProfile.summaryTitle}
                  tone={intentProfile.summaryTone}
                  accentColor={accentColor}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: settingsColumns, padding: 6, borderRadius: 28, background: visuals.canvasBackground }}>
        {settingsReverse ? summaryPanel : formPanel}
        {settingsReverse ? formPanel : summaryPanel}
      </div>
    </section>
  )
}

export function SurfaceCard({
  title,
  description,
  meta,
  background = '#ffffff',
  children,
}: {
  title: string
  description?: string
  meta?: string
  background?: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 22,
        background,
        border: `1px solid ${tokens.color.border}`,
        boxShadow: tokens.shadow.panel,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', marginBottom: 18 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.08, letterSpacing: '-0.03em', color: tokens.color.shell }}>{title}</h2>
          {description ?<p style={{ margin: 0, color: tokens.color.mutedStrong, lineHeight: 1.6 }}>{description}</p> : null}
        </div>
        {meta ?<Badge subtle>{meta}</Badge> : null}
      </div>
      {children}
    </div>
  )
}

export function MetricRow({
  items,
  dark = false,
}: {
  items: Array<{ label: string; value: string }>
  dark?: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: '16px 18px',
            borderRadius: 14,
            background: dark ?'rgba(255,255,255,0.08)' : '#ffffff',
            border: dark ?'1px solid rgba(255,255,255,0.12)' : `1px solid ${tokens.color.border}`,
            boxShadow: dark ?'none' : tokens.shadow.panel,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: dark ?'rgba(248,250,252,0.66)' : tokens.color.muted, fontWeight: 800 }}>
            {item.label}
          </div>
          <strong style={{ display: 'block', marginTop: 8, fontSize: 24, color: dark ?'#f8fafc' : tokens.color.shell }}>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

export function Badge({
  children,
  dark = false,
  subtle = false,
}: {
  children: ReactNode
  dark?: boolean
  subtle?: boolean
}) {
  const style: CSSProperties = {
    display: 'inline-flex',
    width: 'fit-content',
    padding: '7px 12px',
    borderRadius: tokens.color.accentSoft ?tokens.radius.pill : 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }

  if (dark) {
    return <span style={{ ...style, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)', color: '#f8fafc' }}>{children}</span>
  }

  if (subtle) {
    return <span style={{ ...style, background: tokens.color.accentSoft, color: tokens.color.accentStrong }}>{children}</span>
  }

  return <span style={{ ...style, background: tokens.color.accentSoft, color: tokens.color.accentStrong }}>{children}</span>
}

export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ fontWeight: 800, fontSize: 14, color: tokens.color.shell }}>{label}</span>
      {children}
      {hint ?<small style={{ color: tokens.color.muted, fontSize: 13, lineHeight: 1.5 }}>{hint}</small> : null}
    </label>
  )
}

export function inputStyle(overrides: CSSProperties = {}): CSSProperties {
  return {
    width: '100%',
    padding: '13px 14px',
    borderRadius: tokens.radius.control,
    border: `1px solid ${tokens.color.border}`,
    background: '#ffffff',
    color: tokens.color.text,
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
    ...overrides,
  }
}

export function PrimaryButton({
  children,
  accent = 'teal',
  type = 'button',
}: {
  children: ReactNode
  accent?: 'teal' | 'blue' | 'violet' | 'amber'
  type?: 'button' | 'submit'
}) {
  const colorByAccent: Record<string, string> = {
    teal: '#0f766e',
    blue: '#2451b7',
    violet: '#6d28d9',
    amber: '#b45309',
  }

  return (
    <button
      type={type}
      style={{
        padding: '13px 16px',
        borderRadius: tokens.radius.control,
        border: 'none',
        background: colorByAccent[accent] || colorByAccent.teal,
        color: '#ffffff',
        fontWeight: 800,
        fontSize: 14,
        cursor: 'pointer',
        boxShadow: '0 12px 24px rgba(37, 81, 183, 0.18)',
      }}
    >
      {children}
    </button>
  )
}

type FeatureWorkbenchProps = Parameters<typeof FeatureWorkbench>[0]
type SettingsWorkbenchProps = Parameters<typeof SettingsWorkbench>[0]

export function OperationsWorkspace(props: FeatureWorkbenchProps) {
  return <FeatureWorkbench {...props} />
}

export function ExecutiveCockpit(props: FeatureWorkbenchProps) {
  return (
    <FeatureWorkbench
      productMode={props.productMode || 'manager-cockpit'}
      layoutVariant={props.layoutVariant || 'hero-metrics'}
      pageArchetype={props.pageArchetype || 'executive-dashboard'}
      fallbackPattern={props.fallbackPattern || 'vercel-analytics'}
      {...props}
    />
  )
}

export function PlannerWorkbench(props: FeatureWorkbenchProps) {
  return (
    <FeatureWorkbench
      productMode={props.productMode || 'timeline-planner'}
      layoutVariant={props.layoutVariant || 'workflow-guided'}
      pageArchetype={props.pageArchetype || 'approval-flow'}
      fallbackPattern={props.fallbackPattern || 'github-review'}
      {...props}
    />
  )
}

export function SettingsConsole(props: SettingsWorkbenchProps) {
  return (
    <SettingsWorkbench
      layoutVariant={props.layoutVariant || 'calm-settings'}
      pageArchetype={props.pageArchetype || 'settings-console'}
      {...props}
    />
  )
}

