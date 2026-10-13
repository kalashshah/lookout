import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Alert, type Settings } from './api'
import { KindIcon } from './icons'
import { Alerts } from './pages/Alerts'
import { Demo } from './pages/Demo'
import { SettingsPage } from './pages/Settings'
import { Today } from './pages/Today'
import { Watch } from './pages/Watch'

const PAGES = [
  { path: '/', label: 'Watch' },
  { path: '/today', label: 'Today' },
  { path: '/alerts', label: 'Alerts' },
  { path: '/demo', label: 'Demo' },
  { path: '/settings', label: 'Settings' },
]

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  const go = useCallback((p: string) => {
    history.pushState(null, '', p)
    setPath(p)
    scrollTo(0, 0)
  }, [])
  return [path, go]
}

/** Polls for new alerts app-wide so a toast appears whichever page is open. */
function useAlertFeed(enabled: boolean) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [toasts, setToasts] = useState<Alert[]>([])
  const seen = useRef<Set<string> | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.alerts().catch(() => null)
    if (!list) return
    if (seen.current) {
      const fresh = list.filter((a) => !seen.current!.has(a.id))
      if (fresh.length) setToasts((t) => [...fresh, ...t].slice(0, 3))
    }
    seen.current = new Set(list.map((a) => a.id))
    setAlerts(list)
  }, [])

  useEffect(() => {
    if (!enabled) return
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [enabled, refresh])

  useEffect(() => {
    if (!toasts.length) return
    const id = setTimeout(() => setToasts((t) => t.slice(0, -1)), 7000)
    return () => clearTimeout(id)
  }, [toasts])

  return { alerts, toasts, dismiss: (id: string) => setToasts((t) => t.filter((a) => a.id !== id)), refresh }
}

export function App() {
  const [path, go] = usePath()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const feed = useAlertFeed(!!authed)
  const [lastSeenId, setLastSeenId] = useState(() => localStorageGet('ww-alerts-seen'))

  const loadSettings = useCallback(() => api.settings().then(setSettings), [])

  useEffect(() => {
    api.me().then(
      () => setAuthed(true),
      (e) => setAuthed(e instanceof ApiError && e.status === 401 ? false : true),
    )
  }, [])
  useEffect(() => {
    if (authed) loadSettings()
  }, [authed, loadSettings])
  useEffect(() => {
    // Track the newest alert id seen, not a timestamp: demo events can be stamped later in the day than "now".
    const newest = feed.alerts[0]?.id
    if (path === '/alerts' && newest) {
      setLastSeenId(newest)
      localStorageSet('ww-alerts-seen', newest)
    }
  }, [path, feed.alerts])

  if (authed === null) return null
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  if (!settings) return null

  const seenAt = feed.alerts.findIndex((a) => a.id === lastSeenId)
  const unread = (seenAt === -1 ? feed.alerts : feed.alerts.slice(0, seenAt)).filter((a) => a.kind !== 'ok').length
  const tz = settings.tz
  const page = PAGES.find((p) => p.path === path) ? path : '/'

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => (e.preventDefault(), go('/'))}>
          <span className="brand-dot" /> Watchword
        </a>
        <nav className="nav">
          {PAGES.map((p) => (
            <a key={p.path} href={p.path} className={page === p.path ? 'on' : ''} onClick={(e) => (e.preventDefault(), go(p.path))}>
              {p.label}
              {p.path === '/alerts' && unread > 0 && <span className="count">{unread}</span>}
            </a>
          ))}
        </nav>
      </header>

      {page === '/' && <Watch tz={tz} />}
      {page === '/today' && <Today tz={tz} />}
      {page === '/alerts' && <Alerts tz={tz} alerts={feed.alerts} />}
      {page === '/demo' && <Demo tz={tz} onChange={feed.refresh} />}
      {page === '/settings' && <SettingsPage settings={settings} onSaved={loadSettings} onSignOut={() => setAuthed(false)} />}

      <div className="toasts" aria-live="polite">
        {feed.toasts.map((a) => (
          <div key={a.id} className="card toast" onClick={() => (feed.dismiss(a.id), go('/alerts'))}>
            <div className={`rule-icon ${a.severity === 'urgent' ? 'urgent' : ''}`}>
              <KindIcon alert={a.kind} />
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="muted small">{a.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="center shell">
      <form
        className="login card"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          try {
            await api.login(token)
            onDone()
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <div className="brand">
          <span className="brand-dot" /> Watchword
        </div>
        <p className="muted">Tell your Ring camera what to watch for — in plain words.</p>
        <div className="field">
          <label htmlFor="token">Household access code</label>
          <input id="token" className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={!token}>
          Sign in
        </button>
      </form>
    </div>
  )
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}
