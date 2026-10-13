import { useEffect, useMemo, useState } from 'react'
import { api, type Device, type Settings } from '../api'

export function SettingsPage({ settings, onSaved, onSignOut }: { settings: Settings; onSaved: () => void; onSignOut: () => void }) {
  const [email, setEmail] = useState(settings.email ?? '')
  const [tz, setTz] = useState(settings.tz)
  const [token, setToken] = useState('')
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [ringError, setRingError] = useState('')
  const [saved, setSaved] = useState('')
  const [usage, setUsage] = useState<{ calls: number; cap: number } | null>(null)
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])

  const loadDevices = () =>
    api.devices().then(
      (d) => (setDevices(d), setRingError('')),
      (e) => (setDevices(null), setRingError((e as Error).message)),
    )

  useEffect(() => {
    api.usage().then(setUsage)
    if (settings.has_ring_token) loadDevices()
  }, [settings.has_ring_token])

  async function save(values: Record<string, string>, label: string) {
    await api.saveSettings(values)
    setSaved(label)
    setTimeout(() => setSaved(''), 2000)
    onSaved()
  }

  return (
    <main>
      <section className="hero">
        <h1>Settings</h1>
      </section>

      <section className="section card stack">
        <h2>Ring</h2>
        <p className="muted">
          Paste an access token from the{' '}
          <a href="https://developer.amazon.com/ring/console/playground" target="_blank" rel="noreferrer">
            Ring Developer Playground
          </a>
          . Playground tokens last about 30 minutes.
        </p>
        <div className="row">
          <input
            className="input"
            style={{ flex: '1 1 260px' }}
            type="password"
            placeholder={settings.has_ring_token ? 'Token saved — paste a new one to replace it' : 'eyJ…'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn primary" disabled={!token} onClick={async () => (await save({ ring_token: token }, 'Ring token saved'), setToken(''), loadDevices())}>
            Connect
          </button>
        </div>
        {ringError && <p className="error">{ringError}</p>}
        {devices?.map((d) => (
          <label key={d.id} className="row card" style={{ padding: 14, cursor: 'pointer' }}>
            <input type="radio" name="device" checked={settings.device_id === d.id} onChange={() => save({ device_id: d.id }, 'Device selected')} />
            <span className={`dot ${d.online ? 'on' : ''}`} />
            <span style={{ fontWeight: 600 }}>{d.name}</span>
            <span className="muted small">{d.online ? 'Online' : 'Offline'}</span>
          </label>
        ))}
      </section>

      <section className="section card stack">
        <h2>Alerts</h2>
        <div className="field">
          <label htmlFor="email">Email alerts to</label>
          <div className="row">
            <input id="email" className="input" style={{ flex: '1 1 260px' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn" onClick={() => save({ email }, 'Email saved')}>
              Save
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="tz">Time zone</label>
          <select id="tz" className="input" value={tz} onChange={(e) => (setTz(e.target.value), save({ tz: e.target.value }, 'Time zone saved'))}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </div>
        {saved && <p className="small" style={{ color: 'var(--ok)' }}>{saved}</p>}
      </section>

      {usage && (
        <section className="section card stack">
          <h2>AI usage today</h2>
          <div className="meter">
            <i style={{ width: `${Math.min(100, (usage.calls / usage.cap) * 100)}%` }} />
          </div>
          <p className="muted small">
            {usage.calls} of {usage.cap} Amazon Bedrock checks used. Each check costs about $0.0008; past the cap, events are saved but not analyzed.
          </p>
        </section>
      )}

      <section className="section">
        <button className="btn ghost" onClick={async () => (await api.logout(), onSignOut())}>
          Sign out
        </button>
      </section>
    </main>
  )
}
