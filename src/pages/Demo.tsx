import { useState } from 'react'
import { api, fmtHm } from '../api'

export const SCENES = [
  { file: 'kids-arrive.jpg', label: 'Kids home from school', sub: 'human' },
  { file: 'empty-porch.jpg', label: 'Empty porch', sub: 'motion' },
  { file: 'package.jpg', label: 'Package left', sub: 'package_delivery' },
  { file: 'package-gone.jpg', label: 'Package picked up', sub: 'human' },
  { file: 'delivery-van.jpg', label: 'Delivery van', sub: 'vehicle' },
  { file: 'cleaner-leaving.jpg', label: 'Cleaner leaving', sub: 'human' },
  { file: 'guests-suitcases.jpg', label: 'Guests with suitcases', sub: 'human' },
  { file: 'night-visitor.jpg', label: 'Someone at night', sub: 'human' },
  { file: 'shop-line.jpg', label: 'Line outside a shop', sub: 'human' },
]

const nowHm = (tz: string) =>
  new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function Demo({ tz, onChange }: { tz: string; onChange: () => void }) {
  const [scene, setScene] = useState(SCENES[0])
  const [type, setType] = useState<'motion_detected' | 'button_press'>('motion_detected')
  const [time, setTime] = useState(() => nowHm(tz))
  const [clock, setClock] = useState('16:00')
  const [file, setFile] = useState<File | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} — ${s}`, ...l].slice(0, 8))

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      note(label)
      onChange()
    } catch (e) {
      note(`Failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>Demo console</h1>
        <p>
          The Ring Playground can’t send motion or doorbell webhooks, so this console posts Ring-format events — signed with the
          same HMAC scheme Ring uses — to Lookout’s real webhook. Times are in {tz.replace('_', ' ')}.
        </p>
      </section>

      <section className="section card stack">
        <div className="section-head" style={{ margin: 0 }}>
          <h2>1. Something happens at the door</h2>
        </div>
        <div className="scenes">
          {SCENES.map((s) => (
            <button key={s.file} className={`scene ${scene.file === s.file && !file ? 'on' : ''}`} onClick={() => (setScene(s), setFile(null))}>
              <img src={`/scenes/${s.file}`} alt="" />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Or use your own photo</label>
            <input className="input" type="file" accept="image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="field">
            <label>Ring event</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="motion_detected">Motion detected</option>
              <option value="button_press">Doorbell pressed</option>
            </select>
          </div>
          <div className="field">
            <label>Time it happened</label>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(`Sent ${type === 'button_press' ? 'doorbell press' : 'motion'} at ${time}: ${file?.name ?? scene.label}`, () => {
                const form = new FormData()
                form.set('type', type)
                form.set('sub_type', scene.sub)
                form.set('time', time)
                if (file) form.set('file', file)
                else form.set('scene', scene.file)
                return api.demoEvent(form)
              })
            }
          >
            Send Ring event
          </button>
        </div>
      </section>

      <section className="section card stack">
        <h2>2. Move the clock</h2>
        <p className="muted">Lookout checks deadlines and “still there” rules every minute. Jump ahead to see what fires.</p>
        <div className="row">
          <input className="input" style={{ width: 140 }} type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => run(`Clock checked at ${clock}`, () => api.demoTick(clock))}>
            Run clock to {clock ? fmtHm(clock) : '…'}
          </button>
        </div>
      </section>

      <section className="section card stack">
        <div className="section-head" style={{ margin: 0 }}>
          <h2>Log</h2>
          <button
            className="btn danger sm"
            disabled={busy}
            onClick={() => confirm('Clear all events and alerts? Rules are kept.') && run('Cleared events and alerts', api.demoReset)}
          >
            Clear events & alerts
          </button>
        </div>
        {log.length ? log.map((l) => <p key={l} className="small muted">{l}</p>) : <p className="small muted">Nothing sent yet.</p>}
      </section>
    </main>
  )
}
