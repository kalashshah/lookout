import { fmtTime, frameUrl, type Alert } from '../api'

export function Alerts({ tz, alerts }: { tz: string; alerts: Alert[] }) {
  return (
    <main>
      <section className="hero">
        <h1>Alerts</h1>
        <p>Everything Watchword told you about, newest first. Alerts are also emailed if you add an address in Settings.</p>
      </section>
      <section className="section stack">
        {!alerts.length && <div className="empty">No alerts yet. They’ll appear here the moment a rule fires.</div>}
        {alerts.map((a) => (
          <article key={a.id} className={`card alert ${a.severity === 'urgent' ? 'urgent' : a.kind === 'ok' ? 'ok' : ''}`}>
            <div className="bar" />
            <div className="content">
              <div className="row" style={{ gap: 8 }}>
                <span className="title">{a.title}</span>
                {a.severity === 'urgent' && <span className="chip urgent">Urgent</span>}
              </div>
              <p className="muted">{a.body}</p>
              <p className="muted small">
                {fmtTime(a.at, tz)} · {new Date(a.at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}
              </p>
            </div>
            {a.event_id ? <img className="thumb" src={frameUrl(a.event_id)} alt="" loading="lazy" /> : <div />}
          </article>
        ))}
      </section>
    </main>
  )
}
