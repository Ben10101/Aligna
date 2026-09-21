import { Suspense } from 'react'
import { AppFrame, AppHeader, SidebarNav, SurfaceCard } from '../../../packages/ui/src/index.tsx'

const routes = [
  // AUTO_REGISTER_WEB_ROUTES
]

function RouteLoadingFallback() {
  return (
    <SurfaceCard
      title="Preparando modulo"
      description="Carregando a experiencia dessa area com navegacao progressiva para manter o shell mais leve."
      meta="Lazy loading ativo"
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ height: 12, borderRadius: 999, background: '#dbe4ee' }} />
        <div style={{ height: 12, width: '72%', borderRadius: 999, background: '#e7edf5' }} />
      </div>
    </SurfaceCard>
  )
}

export default function App() {
  const currentPath = window.location.pathname
  const defaultRoute = routes[0]
  const activeRoute = routes.find((route) => route.path === currentPath) || defaultRoute

  if (currentPath === '/' && defaultRoute && window.location.pathname !== defaultRoute.path) {
    window.history.replaceState({}, '', defaultRoute.path)
  }

  return (
    <AppFrame>
      <AppHeader title={activeRoute?.label || '__PROJECT_NAME__'} routes={routes.map(({ path, label }) => ({ path, label }))} activePath={activeRoute?.path || ''} />
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)' }}>
        <SidebarNav routes={routes.map(({ path, label }) => ({ path, label }))} activePath={activeRoute?.path || ''} />
        <div style={{ padding: 14 }}>
          <Suspense fallback={<RouteLoadingFallback />}>
            {activeRoute ? activeRoute.render() : null}
          </Suspense>
        </div>
      </div>
    </AppFrame>
  )
}
