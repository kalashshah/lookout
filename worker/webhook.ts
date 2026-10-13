import { Hono } from 'hono'
import { verifySignature } from './hmac'
import { processEvent } from './pipeline'

export const webhook = new Hono<{ Bindings: Env }>()

const HANDLED = new Set(['motion_detected', 'button_press'])

type RingWebhook = {
  meta: { request_id: string }
  data: { id: string; type: string; attributes: { source?: string; timestamp?: number; sub_type?: string } }
}

/** Ring webhook v1.1. Verify the raw body first, dedupe on request_id, answer fast, process in the background. */
webhook.post('/ring/webhook', async (c) => {
  const raw = await c.req.text()
  if (!(await verifySignature(c.env.RING_HMAC_KEY, raw, c.req.header('X-Signature') ?? null))) {
    return c.json({ error: 'bad signature' }, 401)
  }
  let body: RingWebhook
  try {
    body = JSON.parse(raw)
  } catch {
    return c.json({ error: 'bad json' }, 400)
  }
  const { meta, data } = body
  if (!meta?.request_id || !data?.id || !data.type) return c.json({ error: 'not a Ring event' }, 400)

  const handled = HANDLED.has(data.type)
  const res = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO events (id, request_id, device_id, type, sub_type, at, status, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      data.id, meta.request_id, data.attributes?.source ?? null, data.type, data.attributes?.sub_type ?? null,
      data.attributes?.timestamp ?? Date.now(), handled ? 'pending' : 'ignored',
      c.req.header('X-Lookout-Source') === 'feeder' ? 'feeder' : 'ring',
    )
    .run()
  if (!res.meta.changes) return c.json({ status: 'duplicate' })
  if (handled) c.executionCtx.waitUntil(processEvent(c.env, data.id))
  return c.json({ status: 'accepted' })
})
