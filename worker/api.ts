// JSON API for the Lookout UI. Everything here sits behind the household cookie.
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { CompileError, compileRules, parseRules, takeBudget } from './ai'
import { getSettings, insertRule, listRules, putSettings } from './db'
import { atLocal, localTime } from './engine'
import { ringPayload, type FeedType } from './feeder'
import { signBody } from './hmac'
import { tick } from './pipeline'
import { webhook } from './webhook'
import { deviceStatus, listDevices } from './ring'
import type { Rule } from './types'

export const api = new Hono<{ Bindings: Env }>()

const COOKIE = 'lookout'
const SETTINGS_KEYS = ['tz', 'email', 'ring_token', 'device_id'] as const
const utcDay = () => new Date().toISOString().slice(0, 10)

api.post('/login', async (c) => {
  const { token } = await c.req.json<{ token?: string }>()
  if (!token || token !== c.env.APP_TOKEN) return c.json({ error: 'wrong token' }, 401)
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return c.json({ ok: true })
})

api.post('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' })
  return c.json({ ok: true })
})

api.use('*', async (c, next) => {
  if (getCookie(c, COOKIE) !== c.env.APP_TOKEN) return c.json({ error: 'sign in' }, 401)
  await next()
})

api.get('/me', (c) => c.json({ ok: true }))

// ---- settings ----
api.get('/settings', async (c) => {
  const { ring_token, ...rest } = await getSettings(c.env)
  return c.json({ ...rest, has_ring_token: !!ring_token })
})

api.post('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>()
  const values: Record<string, string> = {}
  for (const k of SETTINGS_KEYS) if (typeof body[k] === 'string') values[k] = body[k].trim()
  if (values.tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: values.tz })
    } catch {
      return c.json({ error: 'unknown time zone' }, 400)
    }
  }
  if (Object.keys(values).length) await putSettings(c.env, values)
  return c.json({ ok: true })
})

// ---- rules ----
api.get('/rules', async (c) => c.json(await listRules(c.env)))

api.post('/rules/compile', async (c) => {
  const { text } = await c.req.json<{ text?: string }>()
  if (!text?.trim()) return c.json({ error: 'Tell me what to watch for.' }, 400)
  if (text.length > 500) return c.json({ error: 'Keep it under 500 characters.' }, 400)
  if (!(await takeBudget(c.env, utcDay()))) return c.json({ error: 'Daily AI limit reached. Try again tomorrow.' }, 429)
  try {
    const { tz } = await getSettings(c.env)
    return c.json({ drafts: await compileRules(c.env, text.trim(), tz) })
  } catch (e) {
    if (e instanceof CompileError) return c.json({ error: 'I couldn’t turn that into a rule. Try rephrasing?' }, 422)
    throw e
  }
})

api.post('/rules', async (c) => {
  const { drafts } = await c.req.json<{ drafts?: unknown[] }>()
  let valid
  try {
    valid = parseRules(JSON.stringify(drafts ?? []), '')
  } catch {
    return c.json({ error: 'invalid rules' }, 400)
  }
  const saved: Rule[] = valid.map((d, i) => ({
    ...d,
    text: String((drafts![i] as { text?: string }).text ?? ''),
    id: crypto.randomUUID(),
    enabled: true,
  }))
  for (const r of saved) await insertRule(c.env, r)
  return c.json(saved)
})

api.patch('/rules/:id', async (c) => {
  const { enabled } = await c.req.json<{ enabled?: boolean }>()
  await c.env.DB.prepare('UPDATE rules SET enabled = ?2 WHERE id = ?1').bind(c.req.param('id'), enabled ? 1 : 0).run()
  return c.json({ ok: true })
})

api.delete('/rules/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM rules WHERE id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM episodes WHERE rule_id = ?1').bind(id),
  ])
  return c.json({ ok: true })
})

// ---- timeline ----
api.get('/events', async (c) => {
  const from = Number(c.req.query('from') ?? Date.now() - 24 * 3600_000)
  const to = Number(c.req.query('to') ?? Date.now() + 24 * 3600_000)
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.type, e.sub_type, e.at, e.caption, e.status, e.source, e.image_key IS NOT NULL AS has_image,
       (SELECT json_group_array(json_object('rule_id', m.rule_id, 'confidence', m.confidence, 'reason', m.reason))
          FROM matches m WHERE m.event_id = e.id AND m.match = 1) AS matches
     FROM events e WHERE e.at BETWEEN ?1 AND ?2 AND e.status != 'ignored' ORDER BY e.at DESC LIMIT 200`,
  )
    .bind(from, to)
    .all<Record<string, unknown> & { matches: string }>()
  return c.json(results.map((r) => ({ ...r, has_image: !!r.has_image, matches: JSON.parse(r.matches) })))
})

api.get('/alerts', async (c) => {
  const since = Number(c.req.query('since') ?? 0)
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, r.summary AS rule_summary FROM alerts a LEFT JOIN rules r ON r.id = a.rule_id
     WHERE a.at >= ?1 ORDER BY a.at DESC LIMIT 100`,
  )
    .bind(since)
    .all()
  return c.json(results)
})

api.get('/frames/:id', async (c) => {
  const obj = await c.env.FRAMES.get(`frames/${c.req.param('id')}.jpg`)
  if (!obj) return c.notFound()
  return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } })
})

api.get('/usage', async (c) => {
  const row = await c.env.DB.prepare('SELECT calls FROM usage WHERE day = ?1').bind(utcDay()).first<{ calls: number }>()
  return c.json({ calls: row?.calls ?? 0, cap: 300 })
})

// ---- Ring ----
api.get('/ring/devices', async (c) => {
  const { ring_token } = await getSettings(c.env)
  if (!ring_token) return c.json({ error: 'Add a Ring Playground token in Settings.' }, 400)
  try {
    const devices = await listDevices(ring_token)
    const withStatus = await Promise.all(
      devices.map(async (d) => ({ ...d, online: (await deviceStatus(ring_token, d.id).catch(() => ({ online: false }))).online })),
    )
    return c.json(withStatus)
  } catch (e) {
    return c.json({ error: (e as Error).message.includes('401') ? 'Ring token expired — paste a fresh one.' : (e as Error).message }, 502)
  }
})

// ---- demo console ----
/** Resolve "HH:MM" (today, household tz) or epoch ms to an instant. */
async function demoTime(env: Env, time?: string | number): Promise<number> {
  if (typeof time === 'number') return time
  if (!time) return Date.now()
  const { tz } = await getSettings(env)
  return atLocal(localTime(Date.now(), tz).date, time, tz)
}

api.post('/demo/event', async (c) => {
  const form = await c.req.formData()
  const type = (form.get('type') as FeedType) || 'motion_detected'
  const subType = (form.get('sub_type') as string) || undefined
  const at = await demoTime(c.env, (form.get('time') as string) || undefined)
  const { device_id } = await getSettings(c.env)
  const payload = ringPayload(device_id || 'ava1.ring.device.demo', type, at, subType)

  const file = form.get('file')
  const scene = form.get('scene') as string | null
  let image: ArrayBuffer | null = null
  if (file instanceof File && file.size) {
    if (file.size > 5_000_000) return c.json({ error: 'Image too large (max 5 MB)' }, 400)
    image = await file.arrayBuffer()
  } else if (scene && /^[\w-]+\.jpg$/.test(scene)) {
    const res = await c.env.ASSETS.fetch(new URL(`/scenes/${scene}`, c.req.url))
    if (res.ok) image = await res.arrayBuffer()
  }
  if (image) await c.env.FRAMES.put(`frames/${payload.data.id}.jpg`, image, { httpMetadata: { contentType: 'image/jpeg' } })

  // Deliver through the real webhook route, signed exactly as Ring signs it.
  const raw = JSON.stringify(payload)
  const res = await webhook.request(
    '/ring/webhook',
    {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', 'X-Signature': await signBody(c.env.RING_HMAC_KEY, raw), 'X-Lookout-Source': 'feeder' },
    },
    c.env,
    c.executionCtx,
  )
  return c.json({ event_id: payload.data.id, at, webhook: await res.json() }, res.status as 200)
})

api.post('/demo/tick', async (c) => {
  const { time } = await c.req.json<{ time?: string }>()
  const now = await demoTime(c.env, time)
  await tick(c.env, now)
  return c.json({ ok: true, now })
})

api.post('/demo/reset', async (c) => {
  await c.env.DB.batch(
    ['DELETE FROM matches', 'DELETE FROM alerts', 'DELETE FROM episodes', 'DELETE FROM events'].map((s) => c.env.DB.prepare(s)),
  )
  return c.json({ ok: true })
})
