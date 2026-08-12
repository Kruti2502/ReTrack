import { useNavigate } from 'react-router-dom'
import { ChevronRight, MapPin } from 'lucide-react'
import type { DayActivity } from '@/types/db'
import {
  activityPercent,
  ctaLabel,
  deriveStatus,
  isUntimed,
  STATUS_CLASS,
  STATUS_EMOJI,
  STATUS_LABEL,
} from '@/lib/activityStatus'
import { useActivitySeconds } from '@/hooks/useLiveTimer'
import { formatClock, toMinutes } from '@/lib/format'
import { ProgressBar } from './ui/ProgressRing'

interface ActivityCardProps {
  activity: DayActivity
  offsetMs: number
  /** Kruti's view is read-only — no start button. */
  readOnly?: boolean
}

export function ActivityCard({ activity, offsetMs, readOnly = false }: ActivityCardProps) {
  const navigate = useNavigate()
  const status = deriveStatus(activity)
  const liveSeconds = useActivitySeconds(activity.completed_seconds, activity.live_session, offsetMs)

  const untimed = isUntimed(activity)
  const targetMinutes = toMinutes(activity.target_seconds ?? 0)
  const doneMinutes = Math.min(toMinutes(liveSeconds), targetMinutes)
  const percent = untimed
    ? activityPercent(activity)
    : Math.min(100, Math.round((liveSeconds / Math.max(1, activity.target_seconds ?? 1)) * 100))
  const running = !untimed && activity.live_session?.status === 'running'
  // An untimed activity carries its point on the photo, a timed one on a session.
  const locationVerified = untimed
    ? activity.proofs.some((proof) => proof.location_captured_at)
    : activity.sessions.some((session) => session.location_captured_at)

  return (
    <div className="card animate-fade-up p-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none">{activity.icon}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[17px] font-extrabold leading-tight">{activity.name}</h3>
            <span className={`chip shrink-0 ${STATUS_CLASS[status]}`}>
              {STATUS_EMOJI[status]} {STATUS_LABEL[status]}
            </span>
          </div>

          <p className="mt-0.5 text-sm text-ink-400">
            {untimed ? '📷 Photo only' : `${doneMinutes} / ${targetMinutes} min`}
            {!activity.is_required && <span className="ml-1.5 text-xs">· optional</span>}
          </p>

          {running && (
            <p className="mt-1 font-mono text-lg font-extrabold text-blush-600">
              <span className="mr-1.5 inline-block h-2 w-2 animate-pulse-soft rounded-full bg-blush-500 align-middle" />
              {formatClock(liveSeconds)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar percent={percent} tone={status === 'approved' ? 'sage' : 'blush'} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-ink-400">
          {activity.proofs.length > 0 && <span>📷 {activity.proofs.length}</span>}
          {activity.requires_location && (
            <span className={locationVerified ? 'text-sage-700' : 'text-ink-400'}>
              <MapPin size={12} className="mr-0.5 inline" />
              {locationVerified ? 'Location shared' : 'Location required'}
            </span>
          )}
          {!untimed && activityPercent(activity) >= 100 && status !== 'approved' && (
            <span className="font-bold text-sage-700">Target reached</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate(`/activity/${activity.id}`)}
          className={`btn px-4 py-2 text-sm ${
            status === 'approved' || status === 'waiting'
              ? 'btn-secondary'
              : readOnly
                ? 'btn-secondary'
                : 'btn-primary'
          }`}
        >
          {readOnly ? 'View' : ctaLabel(status)}
          <ChevronRight size={16} />
        </button>
      </div>

      {activity.submission?.status === 'correction_requested' && activity.submission.review_note && (
        <p className="mt-3 rounded-2xl bg-blush-50 px-3 py-2 text-sm text-blush-700">
          <span className="font-extrabold">Kruti:</span> {activity.submission.review_note}
        </p>
      )}
    </div>
  )
}
