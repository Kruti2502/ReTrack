import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-ink-400">
      <Loader2 className="animate-spin" size={26} />
      {label && <p className="text-sm font-bold">{label}</p>}
    </div>
  )
}

export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="text-4xl">{emoji}</span>
      <h3 className="text-lg font-extrabold">{title}</h3>
      {description && <p className="max-w-xs text-sm text-ink-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-8 text-center">
      <span className="text-3xl">🌧️</span>
      <p className="text-sm font-bold text-ink-600">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  emoji,
}: {
  label: string
  value: string | number
  hint?: string
  emoji?: string
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
        {emoji && <span>{emoji}</span>}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-2xl font-extrabold leading-tight">{value}</p>
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  )
}
