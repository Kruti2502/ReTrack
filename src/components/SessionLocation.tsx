import { ArrowUpRight, MapPin, TriangleAlert } from 'lucide-react'
import type { ActivitySession } from '@/types/db'
import {
  accuracyWarning,
  formatCoords,
  formatPrecision,
  mapsUrl,
  sessionCoords,
} from '@/lib/geolocation'
import { formatTime } from '@/lib/format'

interface SessionLocationProps {
  session: ActivitySession
  /** `chip` sits beside a session row; `line` reads as its own line of text. */
  variant?: 'chip' | 'line'
  /** Show the map link and how precise the reading was — Kruti's view. */
  detailed?: boolean
}

/** Soft rounded pill, the shape the rest of the app uses for small badges. */
const PILL = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold'

/**
 * Where a session was started from, as Kruti sees it: a tappable pill that
 * opens the point on a map, with how fresh and how precise it was beside it.
 *
 * The raw latitude and longitude are deliberately kept out of the row — five
 * decimal places of nothing meaningful to read. They stay in the link's title
 * for anyone who wants the exact numbers, and the map shows the real answer.
 */
export function SessionLocation({
  session,
  variant = 'line',
  detailed = true,
}: SessionLocationProps) {
  const point = sessionCoords(session)

  if (!point) {
    return (
      <span className={`${PILL} shrink-0 bg-blush-50 text-ink-400`}>
        <MapPin size={11} /> No location
      </span>
    )
  }

  const warning = accuracyWarning(point.accuracy)
  const captured = point.capturedAt ?? session.started_at

  if (!detailed) {
    return (
      <span className={`${PILL} shrink-0 bg-sage-100 text-sage-700`}>
        <MapPin size={11} /> Location shared
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <a
        href={mapsUrl(point)}
        target="_blank"
        rel="noreferrer"
        className={`${PILL} shrink-0 border border-sage-300/70 bg-sage-100 text-sage-700
                    transition hover:bg-sage-300/50 active:scale-[0.98]`}
        title={[
          `Started from ${formatCoords(point)} at ${formatTime(captured)}`,
          formatPrecision(point.accuracy),
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        <MapPin size={11} /> View on map
        <ArrowUpRight size={11} className="opacity-60" />
      </a>

      {variant === 'line' && (
        <span className="text-[11px] text-ink-400">Shared {formatTime(captured)}</span>
      )}

      {/* Only ever shown for a reading too loose to place him — see accuracyWarning. */}
      {warning && (
        <span className={`${PILL} shrink-0 bg-amber-50 text-amber-900`}>
          <TriangleAlert size={11} /> {warning}
        </span>
      )}
    </span>
  )
}
