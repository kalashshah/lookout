export type RuleKind = 'arrival' | 'deadline' | 'duration' | 'window'

export type Rule = {
  id: string
  text: string
  summary: string
  kind: RuleKind
  look_for: string
  days: number[]
  start: string | null
  end: string | null
  minutes: number | null
  severity: 'info' | 'urgent'
  enabled: boolean
}
export type Draft = Omit<Rule, 'id' | 'enabled'>

export type WatchEvent = {
  id: string
  type: string
  sub_type: string | null
  at: number
  caption: string | null
  status: string
  source: string
  has_image: boolean
  matches: { rule_id: string; confidence: number; reason: string }[]
}

export type Alert = {
  id: string
  rule_id: string
  event_id: string | null
  at: number
  kind: 'arrived' | 'ok' | 'missed' | 'seen' | 'lingering'
  title: string
  body: string
  severity: 'info' | 'urgent'
  rule_summary: string | null
}

export type Settings = { tz: string; email?: string; device_id?: string; has_ring_token: boolean }
export type Device = { id: string; name: string; online: boolean }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(`/api${path}`, {
    ...rest,
    method: rest.method ?? (json !== undefined ? 'POST' : 'GET'),
    headers: json !== undefined ? { 'content-type': 'application/json' } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  me: () => call<{ ok: true }>('/me'),
  login: (token: string) => call('/login', { json: { token } }),
  logout: () => call('/logout', { method: 'POST' }),
  settings: () => call<Settings>('/settings'),
  saveSettings: (s: Record<string, string>) => call('/settings', { json: s }),
  rules: () => call<Rule[]>('/rules'),
  compile: (text: string) => call<{ drafts: Draft[] }>('/rules/compile', { json: { text } }),
  saveRules: (drafts: Draft[]) => call<Rule[]>('/rules', { json: { drafts } }),
  toggleRule: (id: string, enabled: boolean) => call(`/rules/${id}`, { method: 'PATCH', json: { enabled } }),
  deleteRule: (id: string) => call(`/rules/${id}`, { method: 'DELETE' }),
  events: (from: number, to: number) => call<WatchEvent[]>(`/events?from=${from}&to=${to}`),
  alerts: (since = 0) => call<Alert[]>(`/alerts?since=${since}`),
  usage: () => call<{ calls: number; cap: number }>('/usage'),
  devices: () => call<Device[]>('/ring/devices'),
  demoEvent: (form: FormData) => call<{ event_id: string }>('/demo/event', { method: 'POST', body: form }),
  demoTick: (time: string) => call('/demo/tick', { json: { time } }),
  demoReset: () => call('/demo/reset', { method: 'POST' }),
}

export const frameUrl = (eventId: string) => `/api/frames/${encodeURIComponent(eventId)}`

export function fmtTime(ms: number, tz: string) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeDays(days: number[]) {
  if (!days.length || days.length === 7) return 'Every day'
  const key = [...days].sort().join()
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '0,6') return 'Weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

export function fmtHm(hm: string) {
  const [h, m] = hm.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}
