import { useEffect, useState } from 'react'
import { api, describeDays, fmtHm, type Draft, type Rule } from '../api'
import { KindIcon } from '../icons'

const EXAMPLES: { label: string; items: string[] }[] = [
  {
    label: 'Family',
    items: [
      'Tell me when the kids get home from school on weekdays. If nobody’s home by 4pm, alert me.',
      'Let me know if someone rings the doorbell while I’m at work, 9 to 5 on weekdays.',
    ],
  },
  {
    label: 'Hosts',
    items: [
      'Let me know when the cleaner leaves. Warn me if they’re still there at 3pm check-in.',
      'Tell me when guests with suitcases arrive.',
    ],
  },
  {
    label: 'Home',
    items: [
      'If a package sits on the porch for more than 2 hours, remind me.',
      'Any activity at the front door between midnight and 5am.',
    ],
  },
  { label: 'Shops', items: ['Tell me when the delivery van arrives in the morning.', 'Alert me if more than 5 people are waiting outside.'] },
]

const KIND_LABEL: Record<Rule['kind'], string> = {
  arrival: 'When it happens',
  deadline: 'If it hasn’t happened by',
  duration: 'If it lasts too long',
  window: 'During a time window',
}

export function Watch({ tz }: { tz: string }) {
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rules, setRules] = useState<Rule[] | null>(null)

  const load = () => api.rules().then(setRules)
  useEffect(() => {
    load()
  }, [])

  async function compile() {
    setBusy(true)
    setError('')
    setDrafts(null)
    try {
      setDrafts((await api.compile(text)).drafts)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!drafts) return
    setBusy(true)
    try {
      await api.saveRules(drafts)
      setDrafts(null)
      setText('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>What should I watch for?</h1>
        <p>Describe it the way you’d tell a neighbor. Watchword reads every Ring event and tells you when it happens — or when it doesn’t.</p>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) compile()
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) compile()
            }}
            placeholder="e.g. Tell me when the kids get home from school. If nobody’s home by 4pm, alert me."
            aria-label="What should I watch for?"
          />
          <button className="btn primary" disabled={busy || !text.trim()}>
            {busy && !drafts ? 'Thinking…' : 'Set it up'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {!drafts && (
          <div className="examples">
            {EXAMPLES.map((g) => (
              <div className="group" key={g.label}>
                <span className="label">{g.label}</span>
                {g.items.map((t) => (
                  <button key={t} type="button" className="example" onClick={() => setText(t)}>
                    {t}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {drafts && (
        <section className="section">
          <div className="section-head">
            <h2>Here’s what I’ll do</h2>
            <span className="muted small">Check it reads right</span>
          </div>
          <div className="stack">
            {drafts.map((d, i) => (
              <RuleCard key={i} rule={d} draft />
            ))}
            <div className="row">
              <button className="btn primary" onClick={save} disabled={busy}>
                Start watching
              </button>
              <button className="btn ghost" onClick={() => setDrafts(null)}>
                Edit request
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Watching</h2>
          <span className="muted small">Times in {tz.replace('_', ' ')}</span>
        </div>
        {rules && !rules.length && <div className="empty">Nothing yet. Describe something above to start watching.</div>}
        <div className="stack">
          {rules?.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              onToggle={async () => (await api.toggleRule(r.id, !r.enabled), load())}
              onDelete={async () => (await api.deleteRule(r.id), load())}
            />
          ))}
        </div>
      </section>

      <p className="muted small section">
        Watchword describes what it sees — clothing, objects, vehicles — and never identifies people by face or name.
      </p>
    </main>
  )
}

function RuleCard({
  rule,
  draft,
  onToggle,
  onDelete,
}: {
  rule: Draft | Rule
  draft?: boolean
  onToggle?: () => void
  onDelete?: () => void
}) {
  const enabled = 'enabled' in rule ? rule.enabled : true
  return (
    <div className={`card rule ${draft ? 'draft' : ''} ${enabled ? '' : 'off'}`}>
      <div className={`rule-icon ${rule.severity === 'urgent' ? 'urgent' : ''}`}>
        <KindIcon kind={rule.kind} />
      </div>
      <div>
        <div className="rule-title">{rule.summary}</div>
        <div className="look">Looking for {rule.look_for}</div>
        <div className="chips">
          <span className="chip accent">{KIND_LABEL[rule.kind]}</span>
          <span className="chip">{describeDays(rule.days)}</span>
          {(rule.start || rule.end) && (
            <span className="chip">
              {rule.kind === 'deadline' && rule.end
                ? `${rule.start ? fmtHm(rule.start) + ' – ' : 'by '}${fmtHm(rule.end)}`
                : `${rule.start ? fmtHm(rule.start) : 'any time'} – ${rule.end ? fmtHm(rule.end) : 'midnight'}`}
            </span>
          )}
          {rule.minutes && <span className="chip">over {rule.minutes >= 60 && rule.minutes % 60 === 0 ? `${rule.minutes / 60}h` : `${rule.minutes} min`}</span>}
          {rule.severity === 'urgent' && <span className="chip urgent">Urgent</span>}
        </div>
      </div>
      {!draft && (
        <div className="row actions" style={{ flexWrap: 'nowrap' }}>
          <button className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle} aria-label={enabled ? 'Pause' : 'Resume'} />
          <button className="btn danger sm" onClick={onDelete} aria-label="Delete rule">
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
