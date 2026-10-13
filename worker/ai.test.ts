import { describe, expect, it } from 'vitest'
import { parseEvaluation, parseRules } from './ai'

describe('parseEvaluation', () => {
  const ids = ['r1', 'r2']

  it('parses a fenced json block', () => {
    const raw = 'Here you go:\n```json\n{"caption":"A child at the door","matches":[{"id":"r1","match":true,"confidence":0.9,"reason":"backpack"}]}\n```'
    expect(parseEvaluation(raw, ids)).toEqual({
      caption: 'A child at the door',
      matches: [
        { ruleId: 'r1', match: true, confidence: 0.9, reason: 'backpack' },
        { ruleId: 'r2', match: false, confidence: 0, reason: '' },
      ],
    })
  })

  it('drops rule ids that were not sent', () => {
    const raw = '{"caption":"x","matches":[{"id":"r9","match":true,"confidence":1,"reason":"?"}]}'
    expect(parseEvaluation(raw, ids).matches.every((m) => !m.match)).toBe(true)
  })

  it('clamps confidence to 0..1', () => {
    const raw = '{"caption":"x","matches":[{"id":"r1","match":true,"confidence":7,"reason":""}]}'
    expect(parseEvaluation(raw, ids).matches[0].confidence).toBe(1)
  })

  it('returns an empty result for garbage instead of throwing', () => {
    expect(parseEvaluation('I cannot help with that.', ids)).toEqual({ caption: '', matches: [] })
  })
})

describe('parseRules', () => {
  it('parses two rules from one sentence', () => {
    const raw = `[
      {"summary":"Weekdays 2:30–4pm: kids get home","kind":"arrival","look_for":"a child with a backpack","days":[1,2,3,4,5],"start":"14:30","end":"16:00","minutes":null,"severity":"info"},
      {"summary":"Nobody home by 4pm","kind":"deadline","look_for":"a child with a backpack","days":[1,2,3,4,5],"start":"14:30","end":"16:00","minutes":null,"severity":"urgent"}
    ]`
    const rules = parseRules(raw, 'kids text')
    expect(rules).toHaveLength(2)
    expect(rules[1]).toMatchObject({ kind: 'deadline', end: '16:00', severity: 'urgent', text: 'kids text' })
  })

  it('throws on an unknown kind', () => {
    expect(() => parseRules('[{"summary":"x","kind":"teleport","look_for":"y"}]', 't')).toThrow()
  })

  it('throws on a malformed time', () => {
    expect(() => parseRules('[{"summary":"x","kind":"arrival","look_for":"y","start":"4pm"}]', 't')).toThrow()
  })

  it('requires minutes for duration rules', () => {
    expect(() => parseRules('[{"summary":"x","kind":"duration","look_for":"a package"}]', 't')).toThrow()
  })

  it('throws when there is no array', () => {
    expect(() => parseRules('Sorry, I am not sure.', 't')).toThrow()
  })
})
