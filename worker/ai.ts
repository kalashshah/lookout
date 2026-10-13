// Amazon Bedrock (Nova 2 Lite, Converse API). Two jobs: turn a sentence into rules,
// and check one camera frame against every active rule in a single call.
import { AwsClient } from 'aws4fetch'
import type { Match, Rule, RuleKind, Severity } from './types'

export const DAILY_CALL_CAP = 300

const KINDS: RuleKind[] = ['arrival', 'deadline', 'duration', 'window']
const HM = /^([01]\d|2[0-3]):[0-5]\d$/

export type RuleDraft = Omit<Rule, 'id' | 'enabled'>
export type Evaluation = { caption: string; matches: Match[] }

export class CompileError extends Error {}

export async function converse(env: Env, system: string, content: unknown[], maxTokens = 400) {
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: 'bedrock',
  })
  const url = `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com/model/${encodeURIComponent(env.MODEL_ID)}/converse`
  const res = await aws.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system: [{ text: system }],
      messages: [{ role: 'user', content }],
      inferenceConfig: { maxTokens, temperature: 0 },
    }),
  })
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    output: { message: { content: { text?: string }[] } }
    usage: { inputTokens: number; outputTokens: number }
  }
  return { text: data.output.message.content.map((c) => c.text ?? '').join(''), usage: data.usage }
}

/** Atomically count one Bedrock call; false once today's cap is reached. */
export async function takeBudget(env: Env, day: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO usage (day, calls) VALUES (?1, 1)
     ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
     RETURNING calls`,
  )
    .bind(day, DAILY_CALL_CAP)
    .first()
  return row !== null
}

const COMPILE_SYSTEM = `You turn a homeowner's request about their Ring doorbell camera into watch rules.
Reply with ONLY a JSON array. Each item:
{"summary": short plain-English restatement (max 12 words),
 "kind": "arrival" (tell me when X shows up) | "deadline" (alert if X has NOT shown up by a time) | "duration" (alert if X stays longer than N minutes) | "window" (alert on any X during a time range),
 "look_for": what the camera should visually look for, e.g. "a child with a school backpack",
 "days": array of weekday numbers 0=Sun..6=Sat, [] for every day,
 "start": "HH:MM" 24h or null, "end": "HH:MM" 24h or null,
 "minutes": integer for duration rules, else null,
 "severity": "urgent" for safety/missed things, else "info"}
Rules:
- One sentence can need two rules, e.g. "tell me when the kids get home, alert me if not by 4pm" → an arrival rule and a deadline rule with the same look_for and window.
- A deadline rule needs "end" (the deadline) and should have "start" (when to begin expecting it; default 2 hours before end).
- "look_for" must describe appearance, clothing, objects or vehicles. Never identify a specific person by name or face; describe them instead ("a person carrying cleaning supplies").
- Only describe things a front-door camera could see.`

export async function compileRules(env: Env, text: string, tz: string): Promise<RuleDraft[]> {
  const prompt = `Household time zone: ${tz}.\nRequest: ${text}`
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: raw } = await converse(env, COMPILE_SYSTEM, [{ text: prompt }], 800)
    try {
      return parseRules(raw, text)
    } catch (e) {
      last = e
    }
  }
  throw new CompileError(`Couldn't understand that: ${(last as Error).message}`)
}

export function parseRules(raw: string, text: string): RuleDraft[] {
  const block = raw.match(/\[[\s\S]*\]/)
  if (!block) throw new CompileError('no JSON array in reply')
  const items = JSON.parse(block[0]) as Record<string, unknown>[]
  if (!Array.isArray(items) || !items.length) throw new CompileError('empty rule list')
  return items.map((it) => {
    const kind = it.kind as RuleKind
    if (!KINDS.includes(kind)) throw new CompileError(`unknown kind ${String(it.kind)}`)
    const time = (v: unknown) => {
      if (v == null) return null
      if (typeof v !== 'string' || !HM.test(v)) throw new CompileError(`bad time ${String(v)}`)
      return v
    }
    const minutes = it.minutes == null ? null : Number(it.minutes)
    if (kind === 'duration' && !(minutes && minutes > 0)) throw new CompileError('duration rule needs minutes')
    if (kind === 'deadline' && !it.end) throw new CompileError('deadline rule needs end')
    if (typeof it.look_for !== 'string' || !it.look_for) throw new CompileError('missing look_for')
    const days = Array.isArray(it.days) ? it.days.map(Number).filter((d) => d >= 0 && d <= 6) : []
    return {
      text,
      summary: String(it.summary ?? it.look_for),
      kind,
      look_for: it.look_for,
      days,
      start: time(it.start),
      end: time(it.end),
      minutes,
      severity: (it.severity === 'urgent' ? 'urgent' : 'info') as Severity,
    }
  })
}

const EVAL_SYSTEM = `You check a single frame from a front-door security camera against a list of things to look for.
Reply with ONLY JSON: {"caption": one short sentence describing the scene, "matches": [{"id": rule id, "match": true|false, "confidence": 0..1, "reason": max 12 words}]}
Include every rule id. Describe what is visible; never identify or name people. Ignore the Ring watermark overlay.`

export async function evaluateFrame(env: Env, image: Uint8Array, rules: Rule[]): Promise<Evaluation> {
  const list = rules.map((r) => `- id ${r.id}: ${r.look_for}`).join('\n')
  const { text } = await converse(env, EVAL_SYSTEM, [
    { image: { format: 'jpeg', source: { bytes: toBase64(image) } } },
    { text: `Things to look for:\n${list}` },
  ])
  return parseEvaluation(text, rules.map((r) => r.id))
}

export function parseEvaluation(raw: string, ruleIds: string[]): Evaluation {
  const block = raw.match(/\{[\s\S]*\}/)
  if (!block) return { caption: '', matches: [] }
  let data: { caption?: unknown; matches?: { id?: unknown; match?: unknown; confidence?: unknown; reason?: unknown }[] }
  try {
    data = JSON.parse(block[0])
  } catch {
    return { caption: '', matches: [] }
  }
  const byId = new Map((Array.isArray(data.matches) ? data.matches : []).map((m) => [String(m.id), m]))
  return {
    caption: typeof data.caption === 'string' ? data.caption : '',
    matches: ruleIds.map((id) => {
      const m = byId.get(id)
      return {
        ruleId: id,
        match: m?.match === true,
        confidence: Math.min(1, Math.max(0, Number(m?.confidence) || 0)),
        reason: typeof m?.reason === 'string' ? m.reason : '',
      }
    }),
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
