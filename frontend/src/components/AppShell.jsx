import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Briefcase,
  ChevronRight,
  Compass,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NAV_SECTIONS = [
  {
    label: 'Projeto',
    items: [{ label: 'Projetos', hint: 'Board operacional', to: '/projects', icon: Briefcase }],
  },
  {
    label: 'Governança',
    items: [
      { label: 'IA', hint: 'Runtime e policy', to: '/settings/ai', icon: Settings },
      { label: 'Governança', hint: 'Readiness e auditoria', to: '/governance', icon: ShieldCheck },
    ],
  },
];

const QUICK_NAV_ITEMS = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    ...item,
    section: section.label,
    keywords: `${section.label} ${item.label} ${item.hint || ''}`.toLowerCase(),
  }))
);

function NavItem({ item }) {
  const location = useLocation();
  const currentPath = location.pathname;
  const currentLocation = `${location.pathname}${location.search}`;
  const active =
    item.exact
      ? currentPath === item.to
      : currentPath === item.to || currentPath.startsWith(`${item.to}/`) || currentLocation.startsWith(`${item.to}?`);
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      className={`group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
        active
          ? 'bg-[#102a72] text-white shadow-sm shadow-[#102a72]/30'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 transition-colors ${
          active ? 'text-blue-300' : 'text-slate-500 group-hover:text-slate-300'
        }`}
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-normal leading-5">{item.label}</span>
        {item.hint ? (
          <span className="mt-0.5 block whitespace-normal text-[10px] leading-4 text-slate-500">
            {item.hint}
          </span>
        ) : null}
      </div>
      {active && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300/60" />}
    </Link>
  );
}

export default function AppShell({
  title,
  eyebrow,
  description,
  actions,
  sidebar,
  hideSidebar = false,
  children,
  mainClassName = 'p-8',
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  const filteredQuickNavItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return QUICK_NAV_ITEMS.slice(0, 6);
    return QUICK_NAV_ITEMS.filter((item) => item.keywords.includes(query)).slice(0, 8);
  }, [search]);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    setSearch('');
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  async function handleLogout() {
    await logout();
    navigate('/auth');
  }

  function handleSearchSelect(to) {
    navigate(to);
    setSearch('');
    setSearchOpen(false);
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setSearch('');
      setSearchOpen(false);
      return;
    }

    if (event.key === 'Enter' && filteredQuickNavItems.length) {
      event.preventDefault();
      handleSearchSelect(filteredQuickNavItems[0].to);
    }
  }

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-slate-50 font-sans text-slate-900 antialiased">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#0A1128] text-white">
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.07] px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#102a72] shadow-lg shadow-[#102a72]/40">
            <Compass className="h-4 w-4 text-blue-300" strokeWidth={2.5} />
          </div>
          <div>
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.25em] leading-none text-blue-400/80">
              Product Workspace
            </p>
            <span className="text-sm font-bold leading-none text-white">Aligna</span>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3 pt-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.3em] text-slate-600">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.07] px-3 py-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-[#102a72]">
              <User className="h-3.5 w-3.5 text-blue-300" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-none text-white">{user?.name || 'Usuário'}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-500">{user?.email || ''}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className="rounded-md p-1.5 text-slate-600 transition-colors hover:bg-white/5 hover:text-rose-400"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pl-64">
        <header className="sticky top-0 z-30 flex h-16 min-w-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setSearchOpen(false), 120);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Ir para páginas e áreas..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-16 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:inline">
              Ctrl K
            </span>
            {searchOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                    {search.trim() ? 'Resultados rápidos' : 'Atalhos do produto'}
                  </p>
                </div>
                <div className="max-h-80 overflow-auto p-2">
                  {filteredQuickNavItems.length ? (
                    filteredQuickNavItems.map((item) => {
                      const active = `${location.pathname}${location.search}`.startsWith(item.to);
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.to}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSearchSelect(item.to)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                            active ? 'bg-[#102a72]/8 text-[#102a72]' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                            <Icon className="h-4 w-4" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{item.label}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.section} · {item.hint}
                            </p>
                          </div>
                          {active ? (
                            <span className="rounded-full bg-[#102a72] px-2 py-1 text-[10px] font-semibold text-white">
                              Atual
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3 py-6 text-sm text-slate-500">
                      Nenhuma página encontrada para essa busca.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="ml-4 flex shrink-0 items-center gap-2">
            <button className="relative rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
              <Bell className="h-4 w-4" strokeWidth={2} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#102a72]" />
            </button>
            <Link
              to="/settings/ai"
              className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <Settings className="h-4 w-4" strokeWidth={2} />
            </Link>
            <div className="ml-2 h-6 w-px bg-slate-200" />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#102a72] shadow shadow-[#102a72]/30">
              <User className="h-4 w-4 text-blue-200" strokeWidth={2.5} />
            </div>
          </div>
        </header>

        {title && (
          <div className="min-w-0 border-b border-slate-200 bg-white px-8 py-5">
            {eyebrow && (
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">{eyebrow}</p>
            )}
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
                {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
              </div>
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
          </div>
        )}

        <main
          className={`min-w-0 flex-1 overflow-x-hidden ${mainClassName} ${
            sidebar && !hideSidebar ? 'grid gap-8 lg:grid-cols-[1fr_320px]' : ''
          }`}
        >
          <div className="min-w-0">{children}</div>
          {sidebar && !hideSidebar && <aside className="space-y-6">{sidebar}</aside>}
        </main>
      </div>
    </div>
  );
}

