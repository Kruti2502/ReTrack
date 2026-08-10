interface ProgressRingProps {
  percent: number
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
}

/** The big number on the dashboard. Nothing here computes progress — it draws it. */
export function ProgressRing({
  percent,
  size = 200,
  strokeWidth = 14,
  label,
  sublabel,
}: ProgressRingProps) {
  const safe = Math.min(100, Math.max(0, percent))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (safe / 100) * circumference
  const complete = safe >= 100

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-blush-100"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
        <defs>
          <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={complete ? '#7aab86' : '#f08a85'} />
            <stop offset="100%" stopColor={complete ? '#4f7a5c' : '#e8747c'} />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        <span className="text-5xl font-extrabold tracking-tight">{Math.round(safe)}%</span>
        {label && <span className="mt-1 text-sm font-bold text-ink-600">{label}</span>}
        {sublabel && <span className="text-xs text-ink-400">{sublabel}</span>}
      </div>
    </div>
  )
}

export function ProgressBar({ percent, tone = 'blush' }: { percent: number; tone?: 'blush' | 'sage' }) {
  const safe = Math.min(100, Math.max(0, percent))
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-blush-100">
      <div
        className={`h-full rounded-full transition-all duration-700 ${
          tone === 'sage' ? 'bg-sage-500' : 'bg-blush-500'
        }`}
        style={{ width: `${safe}%` }}
      />
    </div>
  )
}
