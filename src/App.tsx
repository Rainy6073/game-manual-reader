import { useEffect, useState } from 'react'
import ArchetypesPage from './pages/ArchetypesPage'
import EffortValuePage from './pages/EffortValuePage'
import ManualPage from './pages/ManualPage'
import PrototypesPage from './pages/PrototypesPage'
import Welcome from './pages/Welcome'
import { SessionContext, useStoredSession } from './session'
import { syncMode, useSyncStatus } from './sync/store'
import './App.css'

const PAGES = [
  { path: 'manual', label: 'Game Manual', short: 'Manual' },
  { path: 'effort-value', label: 'Effort / Value', short: 'E/V' },
  { path: 'archetypes', label: 'Archetypes', short: 'Archetypes' },
  { path: 'prototypes', label: 'Prototypes', short: 'Prototypes' },
] as const

/** The current route from the URL hash, e.g. "#/prototypes/abc" → ["prototypes", "abc"]. */
function useRoute() {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onHash = () => setRoute(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export default function App() {
  const [session, setSession] = useStoredSession()
  const route = useRoute()
  const [status, error] = useSyncStatus()
  const page = PAGES.find((p) => p.path === route[0]) ?? PAGES[0]

  useEffect(() => {
    document.title = `${page.label} · Kickoff HQ`
  }, [page])

  useEffect(() => {
    document.documentElement.dataset.role = session?.role ?? ''
  }, [session?.role])

  if (!session) return <Welcome onStart={setSession} />

  const statusLabel = {
    live: 'Live',
    connecting: 'Connecting…',
    offline: 'Reconnecting…',
    local: 'This device only',
  }[status]

  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        <header className="topbar">
          <a className="logo" href="#/manual">
            <span className="logo-mark" aria-hidden>
              K
            </span>
            <span className="logo-text">Kickoff HQ</span>
          </a>
          <nav className="tabs" aria-label="Pages">
            {PAGES.map((p, i) => (
              <a key={p.path} href={`#/${p.path}`} className="tab" aria-current={p === page ? 'page' : undefined}>
                <span className="tab-num">{i + 1}</span>
                <span className="tab-label">{p.label}</span>
                <span className="tab-short">{p.short}</span>
              </a>
            ))}
          </nav>
          <div className="who">
            <span
              className={`sync-dot ${status}`}
              title={
                syncMode === 'local'
                  ? 'Supabase is not configured, so changes only sync between tabs on this device.'
                  : statusLabel
              }
            >
              <span className="sync-label">{statusLabel}</span>
            </span>
            <button className="who-chip" onClick={() => setSession(null)} title="Change name or view">
              <span className="who-name">{session.name}</span>
              <span className={`role-badge ${session.role}`}>{session.role === 'presenter' ? 'Presenter' : 'Standard'}</span>
            </button>
          </div>
        </header>
        {error && <div className="sync-error">{error}</div>}
        <main className="content">
          {page.path === 'manual' && <ManualPage />}
          {page.path === 'effort-value' && <EffortValuePage />}
          {page.path === 'archetypes' && <ArchetypesPage />}
          {page.path === 'prototypes' && <PrototypesPage openId={route[1]} />}
        </main>
      </div>
    </SessionContext.Provider>
  )
}
