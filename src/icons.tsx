import type { Alert, RuleKind } from './api'

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const paths: Record<string, React.ReactNode> = {
  // arrival: door with arrow in
  arrival: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M3 12h11" /><path d="m10 8 4 4-4 4" /></>,
  // deadline: clock
  deadline: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  // duration: hourglass
  duration: <><path d="M6 3h12M6 21h12" /><path d="M7 3c0 5 10 5 10 9s-10 4-10 9" /><path d="M17 3c0 5-10 5-10 9s10 4 10 9" /></>,
  // window: moon
  window: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  check: <path d="m5 12 5 5 9-10" />,
  alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>,
}

const ALERT_ICON: Record<Alert['kind'], string> = {
  arrived: 'arrival',
  missed: 'alert',
  seen: 'window',
  lingering: 'duration',
}

export function KindIcon({ kind, alert, size = 20 }: { kind?: RuleKind; alert?: Alert['kind']; size?: number }) {
  const key = alert ? ALERT_ICON[alert] : (kind ?? 'arrival')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden>
      {paths[key]}
    </svg>
  )
}
