// Pure rule logic: no I/O. Every decision takes `now`/`at` in epoch ms and the
// household IANA time zone, so the cron, webhook and demo clock all agree.
import type { Fire, LocalTime, Rule } from './types'

const WINDOW_DEDUPE_MS = 10 * 60_000
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function localTime(ms: number, tz: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, dow: DOW[parts.weekday], hm: `${parts.hour}:${parts.minute}` }
}

// ponytail: overnight windows check the day-of-week of the current moment, not the night they started on.
export function inWindow(rule: Rule, lt: LocalTime): boolean {
  if (rule.days.length && !rule.days.includes(lt.dow)) return false
  const start = rule.start ?? '00:00'
  const end = rule.end ?? '24:00'
  return start <= end ? lt.hm >= start && lt.hm < end : lt.hm >= start || lt.hm < end
}

export function onMatch(
  rule: Rule,
  at: number,
  tz: string,
  lastFire: { at: number; date: string } | null,
): Fire | null {
  if (!rule.enabled || rule.kind === 'duration') return null
  const lt = localTime(at, tz)
  if (!inWindow(rule, lt)) return null
  if (rule.kind === 'window') {
    if (lastFire && at - lastFire.at < WINDOW_DEDUPE_MS) return null
    return fire(rule, 'seen', rule.severity)
  }
  if (lastFire?.date === lt.date) return null
  return rule.kind === 'arrival' ? fire(rule, 'arrived', rule.severity) : fire(rule, 'ok', 'info')
}

export function onTick(
  rule: Rule,
  now: number,
  tz: string,
  firedToday: boolean,
  matchedInWindow: boolean,
): Fire | null {
  if (!rule.enabled || rule.kind !== 'deadline' || !rule.end || firedToday || matchedInWindow) return null
  const lt = localTime(now, tz)
  if (rule.days.length && !rule.days.includes(lt.dow)) return null
  return lt.hm >= rule.end ? fire(rule, 'missed', rule.severity) : null
}

export function matchedInWindowToday(rule: Rule, matchTimes: number[], now: number, tz: string): boolean {
  const today = localTime(now, tz).date
  return matchTimes.some((t) => {
    const lt = localTime(t, tz)
    return lt.date === today && inWindow(rule, lt)
  })
}

export function durationDue(
  rule: Rule,
  ep: { opened_at: number; alerted: boolean; closed_at: number | null },
  now: number,
): Fire | null {
  if (!rule.enabled || rule.kind !== 'duration' || !rule.minutes || ep.alerted || ep.closed_at) return null
  return now - ep.opened_at >= rule.minutes * 60_000 ? fire(rule, 'lingering', rule.severity) : null
}

const TITLES: Record<Fire['kind'], (s: string) => string> = {
  arrived: (s) => s,
  ok: (s) => `All good: ${s}`,
  missed: (s) => `Didn't happen: ${s}`,
  seen: (s) => s,
  lingering: (s) => `Still there: ${s}`,
}

function fire(rule: Rule, kind: Fire['kind'], severity: Fire['severity']): Fire {
  return { ruleId: rule.id, kind, title: TITLES[kind](rule.summary), severity }
}

/** Epoch ms for a local wall-clock date + "HH:MM" in `tz` (used by the demo clock). */
export function atLocal(date: string, hm: string, tz: string): number {
  const guess = Date.parse(`${date}T${hm}:00Z`)
  // Shift by the zone's offset at the guess, then once more in case the offset differs at the result (DST edges).
  const offsetAt = (ms: number) => {
    const lt = localTime(ms, tz)
    return Date.parse(`${lt.date}T${lt.hm}:00Z`) - ms
  }
  const first = guess - offsetAt(guess)
  return guess - offsetAt(first)
}
