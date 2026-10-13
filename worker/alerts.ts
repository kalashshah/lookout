import { localTime } from './engine'
import type { Settings } from './db'
import type { Fire } from './types'

export async function fireAlert(
  env: Env,
  settings: Settings,
  f: Fire,
  at: number,
  body: string,
  eventId: string | null,
) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO alerts (id, rule_id, event_id, at, kind, title, body, severity, local_date)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(id, f.ruleId, eventId, at, f.kind, f.title, body, f.severity, localTime(at, settings.tz).date)
    .run()
  if (!settings.email) return
  try {
    const image = eventId ? await env.FRAMES.get(`frames/${eventId}.jpg`) : null
    const when = new Date(at).toLocaleString('en-US', { timeZone: settings.tz, timeStyle: 'short', dateStyle: 'medium' })
    await env.EMAIL.send({
      to: settings.email,
      from: { email: env.EMAIL_FROM, name: 'Watchword' },
      subject: `${f.severity === 'urgent' ? '⚠️ ' : ''}${f.title}`,
      text: `${f.title}\n${body}\n${when}\n\n${env.APP_URL}/alerts`,
      html: `<h2 style="margin:0 0 8px">${esc(f.title)}</h2><p>${esc(body)}</p><p style="color:#666">${esc(when)}</p>
<p><a href="${env.APP_URL}/alerts">Open Watchword</a></p>`,
      attachments: image
        ? [{ content: await image.arrayBuffer(), filename: 'snapshot.jpg', type: 'image/jpeg', disposition: 'attachment' }]
        : undefined,
    })
  } catch (e) {
    console.error('alert email failed', e)
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
