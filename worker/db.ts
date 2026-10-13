import type { Rule } from './types'

export const DEFAULT_TZ = 'America/Los_Angeles'

export type Settings = { tz: string; email?: string; ring_token?: string; device_id?: string }

export async function getSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]))
  return { ...s, tz: s.tz || DEFAULT_TZ }
}

export async function putSettings(env: Env, values: Record<string, string>) {
  const stmt = env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  await env.DB.batch(Object.entries(values).map(([k, v]) => stmt.bind(k, v)))
}

type RuleRow = Omit<Rule, 'days' | 'enabled'> & { days: string; enabled: number }

const toRule = (r: RuleRow): Rule => ({ ...r, days: JSON.parse(r.days), enabled: !!r.enabled })

export async function listRules(env: Env, onlyEnabled = false): Promise<Rule[]> {
  const sql = `SELECT * FROM rules ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY created_at DESC`
  const { results } = await env.DB.prepare(sql).all<RuleRow>()
  return results.map(toRule)
}

export async function insertRule(env: Env, rule: Rule) {
  await env.DB.prepare(
    `INSERT INTO rules (id, text, summary, kind, look_for, days, start, "end", minutes, severity, enabled, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
  )
    .bind(
      rule.id, rule.text, rule.summary, rule.kind, rule.look_for, JSON.stringify(rule.days),
      rule.start, rule.end, rule.minutes, rule.severity, rule.enabled ? 1 : 0, Date.now(),
    )
    .run()
}

export async function lastFire(env: Env, ruleId: string): Promise<{ at: number; date: string } | null> {
  return env.DB.prepare('SELECT at, local_date AS date FROM alerts WHERE rule_id = ?1 ORDER BY at DESC LIMIT 1')
    .bind(ruleId)
    .first<{ at: number; date: string }>()
}

export async function firedOn(env: Env, ruleId: string, date: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM alerts WHERE rule_id = ?1 AND local_date = ?2 LIMIT 1')
    .bind(ruleId, date)
    .first()
  return row !== null
}

export async function recentMatchTimes(env: Env, ruleId: string, since: number): Promise<number[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.at FROM matches m JOIN events e ON e.id = m.event_id
     WHERE m.rule_id = ?1 AND m.match = 1 AND e.at >= ?2`,
  )
    .bind(ruleId, since)
    .all<{ at: number }>()
  return results.map((r) => r.at)
}
