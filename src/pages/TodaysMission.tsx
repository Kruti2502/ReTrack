import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Flame, Heart } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { useDay, useJourney } from '@/hooks/queries'
import { useServerOffset } from '@/hooks/useLiveTimer'
import { deriveStatus } from '@/lib/activityStatus'
import { formatDate, formatDateShort, formatDuration, formatHour, roundPercent } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ActivityCard } from '@/components/ActivityCard'
import { MotivationBanner } from '@/components/MotivationBanner'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'

export default function TodaysMission() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const day = useDay()
  const journey = useJourney()
  const offset = useServerOffset(day.data?.server_time)

  if (day.isLoading) return <Spinner label="Getting today ready…" />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data) return null

  const { activities, progress, day_number, day_approval, is_rest_day, past_midnight } = day.data
  const percent = roundPercent(progress.percent)

  // On a rest day nothing is owed, so the 0% ring would be a lie. It comes back
  // the moment he trains anyway — that is a bonus and deserves to be seen.
  const restingOnly = is_rest_day && percent === 0

  const required = activities.filter((activity) => activity.is_required)
  const remaining = required.filter((activity) => {
    const status = deriveStatus(activity)
    return status !== 'approved' && status !== 'waiting'
  })
  const completedCount = required.length - remaining.length

  // The one button that matters: whatever is closest to being finished.
  const nextUp =
    remaining.find((activity) => deriveStatus(activity) === 'ready_to_submit') ??
    remaining.find((activity) => deriveStatus(activity) === 'needs_proof') ??
    remaining.find((activity) => deriveStatus(activity) === 'correction') ??
    remaining.find((activity) => activity.live_session) ??
    remaining[0]

  const allDone = required.length > 0 && remaining.length === 0
  const streak = journey.data?.current_streak ?? 0

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <p className="text-sm font-bold text-ink-400">
          Hi {profile?.display_name ?? 'there'}
        </p>
        <h1 className="text-2xl font-extrabold leading-tight">Today's Mission ❤️</h1>
        <p className="text-sm text-ink-400">
          Day {day_number} of {day.data.plan?.goal_days ?? 90} · {formatDate(day.data.date)}
          {is_rest_day && ' · Rest day'}
        </p>
        {past_midnight && (
          <p className="mt-2 chip inline-flex bg-white text-ink-600">
            🌙 Still {formatDateShort(day.data.date)} until {formatHour(day.data.day_start_hour)} —
            what you finish now counts for it
          </p>
        )}
      </header>

      {restingOnly ? (
        <section className="card animate-fade-up p-5 text-center">
          <p className="text-3xl">😴</p>
          <h2 className="mt-1 text-xl font-extrabold">Rest day</h2>
          <p className="mt-1 text-sm text-ink-400">
            Nothing is owed today and nothing counts against you. Resting is part of the plan. ❤️
          </p>
          {streak > 0 && (
            <p className="mt-3 chip inline-flex bg-blush-100 text-blush-700">
              <Flame size={14} /> {streak} day streak — safe
            </p>
          )}
        </section>
      ) : (
        <section className="flex flex-col items-center gap-3">
          <ProgressRing
            percent={percent}
            label={allDone ? 'All done ❤️' : `${completedCount} of ${required.length} done`}
            sublabel={
              remaining.length > 0
                ? `${remaining.length} ${remaining.length === 1 ? 'task' : 'tasks'} remaining`
                : undefined
            }
          />

          <div className="flex flex-wrap items-center justify-center gap-2">
            {streak > 0 && (
              <span className="chip bg-blush-100 text-blush-700">
                <Flame size={14} /> {streak} day streak
              </span>
            )}
            {is_rest_day && <span className="chip bg-sage-100 text-sage-700">🎁 Bonus day</span>}
            <span className="chip bg-white text-ink-600">
              ⏱️ {formatDuration(progress.total_active_seconds)} today
            </span>
          </div>

          {!is_rest_day && <MotivationBanner percent={percent} dayNumber={day_number} />}
        </section>
      )}

      {day_approval && (
        <section className="card animate-fade-up border-sage-300 bg-sage-100/70 p-4 text-center">
          <p className="text-2xl">🎉</p>
          <p className="mt-1 text-lg font-extrabold">Approved by Kruti ❤️</p>
          {day_approval.message && (
            <p className="mt-2 text-[15px] leading-snug text-ink-600">"{day_approval.message}"</p>
          )}
        </section>
      )}

      {!day_approval && allDone && (
        <section className="card animate-fade-up p-5 text-center">
          <p className="text-3xl">🎉</p>
          <h2 className="mt-1 text-xl font-extrabold">Today's mission complete</h2>
          <p className="mt-1 text-sm text-ink-400">
            Everything is done and approved. Kruti just needs to sign off on the day.
          </p>
          <p className="mt-3 chip inline-flex bg-orange-100 text-orange-700">
            🟠 Waiting for Kruti's final approval
          </p>
        </section>
      )}

      {nextUp && (
        <button
          type="button"
          onClick={() => navigate(`/activity/${nextUp.id}`)}
          className={`w-full py-4 text-base ${is_rest_day ? 'btn-secondary' : 'btn-primary'}`}
        >
          {is_rest_day ? (
            <>Train anyway — it counts as a bonus 🎁</>
          ) : (
            <>
              Continue today's mission <Heart size={18} className="fill-white" />
            </>
          )}
        </button>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-extrabold">
            {is_rest_day ? 'Optional today' : "Today's activities"}
          </h2>
          <Link to="/history" className="text-sm font-bold text-blush-600">
            History <ArrowRight size={14} className="inline" />
          </Link>
        </div>

        {activities.length === 0 ? (
          <EmptyState
            emoji="🌱"
            title="No activities yet"
            description="Kruti hasn't set up the daily plan. Ask her to add the first one."
          />
        ) : (
          activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} offsetMs={offset} />
          ))
        )}
      </section>
    </div>
  )
}
