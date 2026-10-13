import { useEffect, useState } from 'react'
import { api, fmtTime, frameUrl, type Rule, type WatchEvent } from '../api'

const TYPE_LABEL = (e: WatchEvent) =>
  e.type === 'button_press'
    ? 'Doorbell pressed'
    : ({ human: 'Person detected', vehicle: 'Vehicle detected', package_delivery: 'Package delivery' } as Record<string, string>)[
        e.sub_type ?? ''
      ] ?? 'Motion'

const STATUS_NOTE: Record<string, string> = {
  pending: 'Looking…',
  unanalyzed: 'Waiting to analyze',
  error: 'Couldn’t analyze this one',
  no_image: 'No snapshot available',
}

export function Today({ tz }: { tz: string }) {
  const [events, setEvents] = useState<WatchEvent[] | null>(null)
  const [rules, setRules] = useState<Map<string, Rule>>(new Map())

  useEffect(() => {
    api.rules().then((r) => setRules(new Map(r.map((x) => [x.id, x]))))
    const load = () => api.events(Date.now() - 36 * 3600_000, Date.now() + 24 * 3600_000).then(setEvents)
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <main>
      <section className="hero">
        <h1>At the door today</h1>
        <p>Every Ring event, what Lookout saw in it, and which of your rules it matched.</p>
      </section>
      <section className="section">
        {events && !events.length && <div className="empty">No activity yet.</div>}
        <div className="timeline">
          {events?.map((e) => (
            <div key={e.id} className={`moment ${e.matches.length ? 'hit' : ''}`}>
              <div className="time">{fmtTime(e.at, tz)}</div>
              <div className="card body">
                {e.has_image ? <img src={frameUrl(e.id)} alt={e.caption ?? 'Ring snapshot'} loading="lazy" /> : <div className="thumb noimg">No image</div>}
                <div className="stack" style={{ gap: 8, alignContent: 'start' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="chip">{TYPE_LABEL(e)}</span>
                    {e.source === 'feeder' && <span className="chip">Simulated event</span>}
                  </div>
                  <p className="caption">{e.caption || STATUS_NOTE[e.status] || ''}</p>
                  {e.matches.map((m) => (
                    <div key={m.rule_id} className="row" style={{ gap: 8 }}>
                      <span className="chip accent">✓ {rules.get(m.rule_id)?.summary ?? 'Rule'}</span>
                      <span className="muted small">
                        {m.reason} · {Math.round(m.confidence * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
