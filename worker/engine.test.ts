import { describe, expect, it } from 'vitest'
import { atLocal, fmtMinutes, durationDue, inWindow, localTime, matchedInWindowToday, onMatch, onTick } from './engine'
import type { Rule } from './types'

const TZ = 'America/Los_Angeles'
// 2026-10-13 is a Tuesday. PDT = UTC-7.
const at = (hm: string, date = '2026-10-13') => Date.parse(`${date}T${hm}:00-07:00`)

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r1',
  text: '',
  summary: 'Kids home',
  kind: 'arrival',
  look_for: 'a child with a backpack',
  days: [],
  start: null,
  end: null,
  minutes: null,
  severity: 'info',
  enabled: true,
  ...over,
})

describe('localTime', () => {
  it('converts to the household time zone', () => {
    expect(localTime(at('15:42'), TZ)).toEqual({ date: '2026-10-13', dow: 2, hm: '15:42' })
  })
  it('gives different local dates for the same instant in different zones', () => {
    const t = at('20:00') // 03:00 UTC Oct 14 → 08:30 IST Oct 14
    expect(localTime(t, TZ).date).toBe('2026-10-13')
    expect(localTime(t, 'Asia/Kolkata').date).toBe('2026-10-14')
  })
})

describe('inWindow', () => {
  it('treats null start/end as the whole day', () => {
    expect(inWindow(rule({}), localTime(at('03:00'), TZ))).toBe(true)
  })
  it('respects start and end', () => {
    const r = rule({ start: '14:30', end: '16:00' })
    expect(inWindow(r, localTime(at('14:29'), TZ))).toBe(false)
    expect(inWindow(r, localTime(at('15:00'), TZ))).toBe(true)
    expect(inWindow(r, localTime(at('16:00'), TZ))).toBe(false)
  })
  it('handles overnight windows', () => {
    const r = rule({ start: '23:00', end: '05:00' })
    expect(inWindow(r, localTime(at('01:00'), TZ))).toBe(true)
    expect(inWindow(r, localTime(at('23:30'), TZ))).toBe(true)
    expect(inWindow(r, localTime(at('12:00'), TZ))).toBe(false)
  })
  it('ignores days not in the list', () => {
    const weekdays = rule({ days: [1, 2, 3, 4, 5] })
    expect(inWindow(weekdays, localTime(at('12:00', '2026-10-17'), TZ))).toBe(false) // Saturday
    expect(inWindow(weekdays, localTime(at('12:00'), TZ))).toBe(true)
  })
})

describe('onMatch', () => {
  it('fires arrival inside the window', () => {
    const r = rule({ start: '14:30', end: '16:00' })
    expect(onMatch(r, at('15:10'), TZ, null)).toMatchObject({ ruleId: 'r1', kind: 'arrived' })
  })
  it('ignores arrival outside the window', () => {
    const r = rule({ start: '14:30', end: '16:00' })
    expect(onMatch(r, at('13:00'), TZ, null)).toBeNull()
  })
  it('fires arrival at most once per local day', () => {
    const r = rule({})
    expect(onMatch(r, at('15:20'), TZ, { at: at('15:10'), date: '2026-10-13' })).toBeNull()
    expect(onMatch(r, at('15:20', '2026-10-14'), TZ, { at: at('15:10'), date: '2026-10-13' })).not.toBeNull()
  })
  it('sends an ok note when a deadline rule is met in time', () => {
    const r = rule({ kind: 'deadline', start: '14:30', end: '16:00' })
    expect(onMatch(r, at('15:10'), TZ, null)).toMatchObject({ kind: 'ok', severity: 'info' })
  })
  it('dedupes window alerts to one per 10 minutes', () => {
    const r = rule({ kind: 'window', start: '00:00', end: '05:00', severity: 'urgent' })
    expect(onMatch(r, at('01:00'), TZ, null)).toMatchObject({ kind: 'seen', severity: 'urgent' })
    expect(onMatch(r, at('01:05'), TZ, { at: at('01:00'), date: '2026-10-13' })).toBeNull()
    expect(onMatch(r, at('01:11'), TZ, { at: at('01:00'), date: '2026-10-13' })).not.toBeNull()
  })
  it('never fires duration rules directly', () => {
    expect(onMatch(rule({ kind: 'duration', minutes: 120 }), at('12:00'), TZ, null)).toBeNull()
  })
  it('never fires disabled rules', () => {
    expect(onMatch(rule({ enabled: false }), at('12:00'), TZ, null)).toBeNull()
  })
})

describe('onTick', () => {
  const r = rule({ kind: 'deadline', start: '14:30', end: '16:00', severity: 'urgent' })
  it('does nothing before the deadline', () => {
    expect(onTick(r, at('15:59'), TZ, false, false)).toBeNull()
  })
  it('fires missed at the deadline when nothing matched', () => {
    expect(onTick(r, at('16:00'), TZ, false, false)).toMatchObject({ kind: 'missed', severity: 'urgent' })
  })
  it('does not fire when matched in the window', () => {
    expect(onTick(r, at('16:01'), TZ, false, true)).toBeNull()
  })
  it('fires once per day across repeated ticks', () => {
    expect(onTick(r, at('16:02'), TZ, true, false)).toBeNull()
  })
  it('skips inactive days', () => {
    const weekdays = { ...r, days: [1, 2, 3, 4, 5] }
    expect(onTick(weekdays, at('16:00', '2026-10-17'), TZ, false, false)).toBeNull()
  })
  it('ignores non-deadline rules', () => {
    expect(onTick(rule({ end: '16:00' }), at('16:00'), TZ, false, false)).toBeNull()
  })
})

describe('durationDue', () => {
  const r = rule({ kind: 'duration', minutes: 120, summary: 'Package waiting' })
  const ep = { opened_at: at('10:00'), alerted: false, closed_at: null }
  it('is not due before the threshold', () => {
    expect(durationDue(r, ep, at('11:59'))).toBeNull()
  })
  it('is due once the threshold passes', () => {
    expect(durationDue(r, ep, at('12:00'))).toMatchObject({ kind: 'lingering' })
  })
  it('does not fire twice', () => {
    expect(durationDue(r, { ...ep, alerted: true }, at('13:00'))).toBeNull()
  })
  it('does not fire after the episode closed', () => {
    expect(durationDue(r, { ...ep, closed_at: at('11:00') }, at('13:00'))).toBeNull()
  })
})

describe('matchedInWindowToday', () => {
  const r = rule({ kind: 'deadline', start: '14:30', end: '16:00' })
  it('does not count a match from before the window opened', () => {
    expect(matchedInWindowToday(r, [at('13:00')], at('16:00'), TZ)).toBe(false)
  })
  it('does not count a match from yesterday', () => {
    expect(matchedInWindowToday(r, [at('15:00', '2026-10-12')], at('16:00'), TZ)).toBe(false)
  })
  it('counts a match inside today\'s window', () => {
    expect(matchedInWindowToday(r, [at('13:00'), at('15:10')], at('16:00'), TZ)).toBe(true)
  })
})

describe('atLocal', () => {
  it('turns a local date + HH:MM into the right instant', () => {
    expect(atLocal('2026-10-13', '16:00', TZ)).toBe(at('16:00'))
  })
  it('works for a zone east of UTC', () => {
    expect(atLocal('2026-10-14', '08:30', 'Asia/Kolkata')).toBe(Date.parse('2026-10-14T08:30:00+05:30'))
  })
  it('round-trips through localTime', () => {
    expect(localTime(atLocal('2026-10-13', '00:05', TZ), TZ)).toMatchObject({ date: '2026-10-13', hm: '00:05' })
  })
})

describe('fmtMinutes', () => {
  it('reads like a person would say it', () => {
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtMinutes(120)).toBe('2h')
    expect(fmtMinutes(296)).toBe('4h 56m')
  })
})
