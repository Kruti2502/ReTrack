import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Clock } from 'lucide-react'
import { useDay } from '@/hooks/queries'
import {
  deriveStatus,
  isUntimed,
  STATUS_CLASS,
  STATUS_EMOJI,
  STATUS_LABEL,
} from '@/lib/activityStatus'
import { formatDate, formatDuration, formatTime, roundPercent, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ProofGrid } from '@/components/ProofGrid'
import { SessionLocation } from '@/components/SessionLocation'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'

/** A finished day, exactly as it happened. Read-only for both people. */
export default function DayDetail() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const day = useDay(date)

  if (day.isLoading) return <Spinner />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data) return null

  const { activities, progress, day_approval, day_number, is_rest_day } = day.data
  const percent = roundPercent(progress.percent)
  const withActivity = activities.filter(
    (activity) => activity.sessions.length > 0 || activity.proofs.length > 0,
  )

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="btn-ghost -ml-2 px-2 py-1 text-sm"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <header>
        <h1 className="text-2xl font-extrabold leading-tight">{formatDate(day.data.date)}</h1>
        <p className="text-sm text-ink-400">
          Day {day_number} · {formatDuration(progress.total_active_seconds)} recorded
          {is_rest_day && ' · 😴 Rest day'}
        </p>
      </header>

      <div className="flex justify-center">
        <ProgressRing
          percent={percent}
          size={160}
          strokeWidth={12}
          label={`${progress.required_approved} of ${progress.required_total} approved`}
        />
      </div>

      {day_approval && (
        <section className="card border-sage-300 bg-sage-100/70 p-4 text-center">
          <p className="font-extrabold">❤️ Approved by Kruti</p>
          <p className="text-xs text-ink-400">{formatTime(day_approval.approved_at)}</p>
          {day_approval.message && (
            <p className="mt-2 text-[15px] leading-snug text-ink-600">"{day_approval.message}"</p>
          )}
        </section>
      )}

      {withActivity.length === 0 ? (
        <EmptyState
          emoji="🌙"
          title="Nothing was recorded"
          description="Today didn't go as planned. Tomorrow is another chance. ❤️"
        />
      ) : (
        withActivity.map((activity) => {
          const status = deriveStatus(activity)
          const finished = activity.sessions.filter((session) => session.status === 'finished')
          return (
            <section key={activity.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{activity.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate font-extrabold">{activity.name}</h2>
                    <span className={`chip shrink-0 ${STATUS_CLASS[status]}`}>
                      {STATUS_EMOJI[status]} {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-sm text-ink-400">
                    {isUntimed(activity)
                      ? '📷 Photo only'
                      : `${toMinutes(activity.completed_seconds)} / ${toMinutes(
                          activity.target_seconds ?? 0,
                        )} minutes`}
                  </p>
                </div>
              </div>

              {finished.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-400">
                  {finished.map((session, index) => (
                    <li key={session.id} className="space-y-1.5">
                      <span className="flex items-center gap-1.5">
                        <Clock size={11} />
                        Session {index + 1}: {formatDuration(session.active_seconds)} ·{' '}
                        {formatTime(session.started_at)}
                      </span>
                      {(activity.requires_location || session.location_captured_at) && (
                        <span className="ml-4 block">
                          <SessionLocation session={session} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {activity.proofs.length > 0 && (
                <div className="mt-3">
                  <ProofGrid proofs={activity.proofs} />
                  <p className="mt-1.5 text-xs text-ink-400">
                    Proof uploaded {formatTime(activity.proofs[0].uploaded_at)}
                  </p>
                </div>
              )}

              {activity.submission?.review_note && (
                <p className="mt-3 rounded-2xl bg-blush-50 px-3 py-2 text-sm text-ink-600">
                  <span className="font-extrabold">Kruti:</span> {activity.submission.review_note}
                </p>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
