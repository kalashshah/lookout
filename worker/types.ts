export type RuleKind = 'arrival' | 'deadline' | 'duration' | 'window'
export type Severity = 'info' | 'urgent'

export type Rule = {
  id: string
  text: string
  summary: string
  kind: RuleKind
  look_for: string
  days: number[] // 0=Sun..6=Sat; empty = every day
  start: string | null // "HH:MM" local
  end: string | null // "HH:MM" local
  minutes: number | null
  severity: Severity
  enabled: boolean
}

export type FireKind = 'arrived' | 'missed' | 'seen' | 'lingering'

export type Fire = { ruleId: string; kind: FireKind; title: string; severity: Severity }

export type LocalTime = { date: string; dow: number; hm: string }

export type Match = { ruleId: string; match: boolean; confidence: number; reason: string }
