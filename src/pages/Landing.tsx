import { useEffect, useState } from 'react'
import { api } from '../api'

// Each hero story: what you type → the rules it becomes → the frame it fires on → the alert.
const STORIES = [
  {
    say: 'Tell me when the kids get home from school. If nobody’s home by 4pm, alert me.',
    rules: ['When it happens · weekdays', 'If not by 4:00pm · urgent'],
    scene: 'kids-arrive.jpg',
    time: '3:12 PM',
    alert: 'The kids are home',
    detail: 'Two children walking up to the door',
  },
  {
    say: 'If a package sits on the porch for more than 2 hours, remind me.',
    rules: ['If it lasts over 2h'],
    scene: 'package.jpg',
    time: '1:47 PM',
    alert: 'Package still on the porch',
    detail: 'A cardboard box has been there for 2 hours',
  },
  {
    say: 'Let me know when the cleaner leaves. Warn me if they’re still there at 3pm check-in.',
    rules: ['When it happens', 'Still there at 3:00pm · urgent'],
    scene: 'cleaner-leaving.jpg',
    time: '2:31 PM',
    alert: 'The cleaner just left',
    detail: 'A person carrying cleaning supplies, heading out',
  },
]

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Drives the hero: type the sentence, show rules, scan the frame, pop the alert, next story. */
function useStory() {
  const [i, setI] = useState(0)
  const [typed, setTyped] = useState(0)
  const [stage, setStage] = useState(0) // 0 typing · 1 rules · 2 scanning · 3 alert
  const story = STORIES[i]

  useEffect(() => {
    if (reduced()) {
      setTyped(story.say.length)
      setStage(3)
      return
    }
    setTyped(0)
    setStage(0)
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    for (let c = 1; c <= story.say.length; c++) at(c * 28, () => setTyped(c))
    const typedAt = story.say.length * 28
    at(typedAt + 500, () => setStage(1))
    at(typedAt + 1500, () => setStage(2))
    at(typedAt + 3000, () => setStage(3))
    at(typedAt + 6500, () => setI((n) => (n + 1) % STORIES.length))
    return () => timers.forEach(clearTimeout)
  }, [i, story.say.length])

  return { story, typed, stage, i, pick: setI }
}

export function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [signIn, setSignIn] = useState(false)
  const { story, typed, stage, i, pick } = useStory()

  return (
    <div className="landing">
      <div className="glow" aria-hidden />
      <header className="l-top">
        <span className="brand">
          <span className="brand-dot" /> Lookout
        </span>
        <nav className="l-nav">
          <a href="#how">How it works</a>
          <a href="#who">Who it’s for</a>
          <button className="btn primary sm" onClick={() => setSignIn(true)}>
            Sign in
          </button>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-copy">
          <span className="eyebrow">For Ring doorbells &amp; cameras</span>
          <h1>
            Tell your doorbell what <em>matters</em>.
          </h1>
          <p className="lede">
            Describe it the way you’d tell a neighbor. Lookout checks every Ring event against your words and tells you when it
            happens — <strong>or when it doesn’t.</strong>
          </p>
          <div className="row">
            <button className="btn primary lg" onClick={() => setSignIn(true)}>
              Start watching
            </button>
            <a className="btn ghost lg" href="#how">
              See how it works
            </a>
          </div>
          <p className="muted small">No new hardware. Works with the Ring camera you already have.</p>
        </div>

        <div className="l-demo" aria-label="Example: a sentence becomes rules, then an alert">
          <div className="say card">
            <span className="say-label">You say</span>
            <p>
              {story.say.slice(0, typed)}
              {stage === 0 && <span className="caret" />}
            </p>
            <div className={`say-rules ${stage >= 1 ? 'in' : ''}`}>
              {story.rules.map((r) => (
                <span key={r} className={`chip ${r.includes('urgent') ? 'urgent' : 'accent'}`}>
                  {r}
                </span>
              ))}
            </div>
          </div>

          <div className={`cam ${stage >= 2 ? 'live' : ''}`}>
            <img key={story.scene} src={`/scenes/${story.scene}`} alt="" />
            <span className="cam-tag">
              <span className="rec" /> Front door · {story.time}
            </span>
            {stage === 2 && <span className="scan" />}
          </div>

          <div className={`l-alert card ${stage >= 3 ? 'in' : ''}`}>
            <span className="l-alert-dot" />
            <div>
              <div className="l-alert-title">{story.alert}</div>
              <div className="muted small">{story.detail}</div>
            </div>
            <span className="muted small">now</span>
          </div>

          <div className="pager">
            {STORIES.map((_, n) => (
              <button key={n} className={n === i ? 'on' : ''} onClick={() => pick(n)} aria-label={`Example ${n + 1}`} />
            ))}
          </div>
        </div>
      </section>

      <section className="l-section">
        <h2 className="l-h2">
          Ring tells you when something moves.
          <br />
          <em>Lookout tells you what it means.</em>
        </h2>
        <div className="kinds">
          {[
            { k: 'When it happens', t: 'The delivery van is here', d: 'The first time it’s seen in your window, once a day.', img: 'delivery-van.jpg' },
            { k: 'If it doesn’t happen', t: 'Nobody home by 4pm', d: 'The alert Ring can’t send: the absence of an event.', img: 'empty-porch.jpg', urgent: true },
            { k: 'If it lasts too long', t: 'Package out for 2 hours', d: 'Still there after N minutes? You’ll hear about it.', img: 'package.jpg' },
            { k: 'During a time window', t: 'Someone at 2am', d: 'Anything matching between the hours you choose.', img: 'night-visitor.jpg', urgent: true },
          ].map((c) => (
            <article key={c.k} className="kind card">
              <img src={`/scenes/${c.img}`} alt="" loading="lazy" />
              <span className={`chip ${c.urgent ? 'urgent' : 'accent'}`}>{c.k}</span>
              <h3>{c.t}</h3>
              <p className="muted">{c.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="l-section" id="how">
        <h2 className="l-h2">How it works</h2>
        <ol className="steps">
          <li className="card">
            <span className="num">1</span>
            <h3>Say it in plain words</h3>
            <p className="muted">Amazon Bedrock turns your sentence into watch rules and reads them back to you before anything is saved.</p>
          </li>
          <li className="card">
            <span className="num">2</span>
            <h3>Every Ring event gets a look</h3>
            <p className="muted">On motion or a doorbell press, Lookout grabs the frame and checks it against all your rules in one pass.</p>
          </li>
          <li className="card">
            <span className="num">3</span>
            <h3>Hear about what matters</h3>
            <p className="muted">An email with the snapshot and a live feed in the app — and a clock that notices when things don’t happen.</p>
          </li>
        </ol>
      </section>

      <section className="l-section" id="who">
        <h2 className="l-h2">One doorbell, a lot of different questions</h2>
        <div className="who">
          {[
            { who: 'Parents', say: '“Tell me when the kids get home on weekdays. Alert me if not by 4pm.”', img: 'kids-arrive.jpg' },
            { who: 'Rental hosts', say: '“Let me know when the cleaner leaves, and when guests with suitcases arrive.”', img: 'guests-suitcases.jpg' },
            { who: 'Small shops', say: '“Tell me when the delivery van shows up, or more than 5 people are waiting outside.”', img: 'shop-line.jpg' },
          ].map((p) => (
            <figure key={p.who} className="person">
              <img src={`/scenes/${p.img}`} alt="" loading="lazy" />
              <figcaption>
                <span className="eyebrow">{p.who}</span>
                <blockquote>{p.say}</blockquote>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="l-section privacy card">
        <div>
          <span className="eyebrow">Privacy</span>
          <h2 className="l-h2">Describes. Never identifies.</h2>
        </div>
        <p className="muted">
          Rules are about what’s visible — clothing, objects, vehicles. Lookout never does face recognition and never names people.
          AI calls are capped every day, and you can pause any rule with one tap.
        </p>
      </section>

      <section className="l-cta">
        <h2 className="l-h2">
          What should your door <em>watch for</em>?
        </h2>
        <button className="btn primary lg" onClick={() => setSignIn(true)}>
          Start watching
        </button>
      </section>

      <footer className="l-foot muted small">
        <span>Built for the Amazon “Build, Ship, Shape” hackathon · Ring + Amazon Bedrock (Nova 2 Lite)</span>
        <span>Demo images are AI-generated stand-ins for doorbell footage.</span>
      </footer>

      {signIn && <SignIn onClose={() => setSignIn(false)} onDone={onSignedIn} />}
    </div>
  )
}

function SignIn({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal" onClick={onClose}>
      <form
        className="login card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(e) => e.stopPropagation()}
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
        <h2 id="signin-title">Welcome home</h2>
        <p className="muted">Enter your household access code. Hackathon judges: it's in our Devpost submission under Additional info → Testing instructions.</p>
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
