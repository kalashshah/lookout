import { evaluateFrame, takeBudget } from './ai'
import { fireAlert } from './alerts'
import { firedOn, getSettings, lastFire, listRules, recentMatchTimes } from './db'
import { durationDue, fmtHm, fmtMinutes, localTime, matchedInWindowToday, onMatch, onTick } from './engine'
import { snapshot } from './ring'
import type { Rule } from './types'

type EventRow = { id: string; device_id: string | null; at: number; status: string }

const utcDay = () => new Date().toISOString().slice(0, 10)

const setStatus = (env: Env, id: string, status: string) =>
  env.DB.prepare('UPDATE events SET status = ?2 WHERE id = ?1').bind(id, status).run()

/** Frame for an event: feeder pre-upload in R2, else a Ring snapshot (stored to R2). */
async function frameFor(env: Env, ev: EventRow, token?: string): Promise<Uint8Array | null> {
  const key = `frames/${ev.id}.jpg`
  const stored = await env.FRAMES.get(key)
  if (stored) return new Uint8Array(await stored.arrayBuffer())
  if (!token || !ev.device_id) return null
  const img = await snapshot(token, ev.device_id, ev.at)
  if (img) await env.FRAMES.put(key, img, { httpMetadata: { contentType: 'image/jpeg' } })
  return img
}

export async function processEvent(env: Env, eventId: string): Promise<void> {
  const ev = await env.DB.prepare('SELECT id, device_id, at, status FROM events WHERE id = ?1')
    .bind(eventId)
    .first<EventRow>()
  if (!ev || ev.status === 'done') return
  const settings = await getSettings(env)

  const image = await frameFor(env, ev, settings.ring_token)
  if (!image) return void (await setStatus(env, ev.id, 'no_image'))
  await env.DB.prepare('UPDATE events SET image_key = ?2 WHERE id = ?1').bind(ev.id, `frames/${ev.id}.jpg`).run()

  const rules = await listRules(env, true)
  if (!rules.length) return void (await setStatus(env, ev.id, 'done'))
  if (!(await takeBudget(env, utcDay()))) return void (await setStatus(env, ev.id, 'unanalyzed'))

  let result
  try {
    result = await evaluateFrame(env, image, rules)
  } catch (e) {
    console.error('evaluate failed', e)
    // Retry a failed analysis once (from the cron), then give up so a broken key can't drain the daily budget.
    return void (await setStatus(env, ev.id, ev.status === 'unanalyzed' ? 'error' : 'unanalyzed'))
  }

  const ins = env.DB.prepare(
    'INSERT OR REPLACE INTO matches (event_id, rule_id, match, confidence, reason) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
  await env.DB.batch([
    env.DB.prepare('UPDATE events SET caption = ?2, status = ?3 WHERE id = ?1').bind(ev.id, result.caption, 'done'),
    ...result.matches.map((m) => ins.bind(ev.id, m.ruleId, m.match ? 1 : 0, m.confidence, m.reason)),
  ])

  const byId = new Map(rules.map((r) => [r.id, r]))
  for (const m of result.matches) {
    const rule = byId.get(m.ruleId)!
    if (rule.kind === 'duration') {
      await trackEpisode(env, rule, m.match, ev.at)
      continue
    }
    if (!m.match) continue
    const f = onMatch(rule, ev.at, settings.tz, await lastFire(env, rule.id))
    if (f) await fireAlert(env, settings, f, ev.at, m.reason || result.caption, ev.id)
  }
}

async function trackEpisode(env: Env, rule: Rule, matched: boolean, at: number) {
  const open = await env.DB.prepare('SELECT id FROM episodes WHERE rule_id = ?1 AND closed_at IS NULL')
    .bind(rule.id)
    .first<{ id: number }>()
  if (matched && open) {
    await env.DB.prepare('UPDATE episodes SET last_seen_at = ?2 WHERE id = ?1').bind(open.id, at).run()
  } else if (matched) {
    await env.DB.prepare('INSERT INTO episodes (rule_id, opened_at, last_seen_at) VALUES (?1, ?2, ?2)')
      .bind(rule.id, at)
      .run()
  } else if (open) {
    await env.DB.prepare('UPDATE episodes SET closed_at = ?2 WHERE id = ?1').bind(open.id, at).run()
  }
}

/** Runs every minute (and from the demo clock with a chosen `now`). */
export async function tick(env: Env, now: number): Promise<void> {
  const settings = await getSettings(env)
  const rules = await listRules(env, true)
  const today = localTime(now, settings.tz).date

  for (const rule of rules.filter((r) => r.kind === 'deadline')) {
    const times = await recentMatchTimes(env, rule.id, now - 36 * 3600_000)
    const f = onTick(rule, now, settings.tz, await firedOn(env, rule.id, today), matchedInWindowToday(rule, times, now, settings.tz))
    if (f) await fireAlert(env, settings, f, now, `Nothing matching “${rule.look_for}” was seen by ${fmtHm(rule.end!)}.`, null)
  }

  const byId = new Map(rules.map((r) => [r.id, r]))
  const { results: open } = await env.DB.prepare(
    'SELECT id, rule_id, opened_at, last_seen_at FROM episodes WHERE closed_at IS NULL AND alerted = 0',
  ).all<{ id: number; rule_id: string; opened_at: number; last_seen_at: number }>()
  for (const ep of open) {
    const rule = byId.get(ep.rule_id)
    if (!rule) continue
    const f = durationDue(rule, { opened_at: ep.opened_at, alerted: false, closed_at: null }, now)
    if (!f) continue
    await env.DB.prepare('UPDATE episodes SET alerted = 1 WHERE id = ?1').bind(ep.id).run()
    const since = Math.round((now - ep.opened_at) / 60_000)
    const lastEvent = await env.DB.prepare('SELECT id FROM events WHERE at <= ?1 AND image_key IS NOT NULL ORDER BY at DESC LIMIT 1')
      .bind(ep.last_seen_at)
      .first<{ id: string }>()
    await fireAlert(env, settings, f, now, `Still there after ${fmtMinutes(since)}.`, lastEvent?.id ?? null)
  }

  const { results: retry } = await env.DB.prepare(
    "SELECT id FROM events WHERE status = 'unanalyzed' ORDER BY at DESC LIMIT 5",
  ).all<{ id: string }>()
  for (const r of retry) await processEvent(env, r.id)
}
