import { lazy, Suspense, useMemo } from 'react'
import { subDays } from 'date-fns'
import { Flame } from 'lucide-react'
import { useHistory, useJourney } from '@/hooks/queries'
import { formatDuration, toIsoDate } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { ErrorState, Spinner, StatTile } from '@/components/ui/Feedback'
// The charting library is only needed here, so it loads on demand.
const WeeklyChart = lazy(() =>
  import('@/components/Analytics').then((module) => ({ default: module.WeeklyChart })),
)
const MonthlySummary = lazy(() =>
  import('@/components/Analytics').then((module) => ({ default: module.MonthlySummary })),
)

export default function Journey() {
  const journey = useJourney()

  const range = useMemo(() => {
    const today = new Date()
    return { from: toIsoDate(subDays(today, 29)), to: toIsoDate(today) }
  }, [])
  const history = useHistory(range.from, range.to)

  if (journey.isLoading) return <Spinner label="Adding it all up…" />
  if (journey.isError) {
    return (
      <ErrorState message={friendlyError(journey.error)} onRetry={() => void journey.refetch()} />
    )
  }
  if (!journey.data) return null

  const stats = journey.data
  const journeyPercent = Math.min(100, Math.round((stats.day_number / stats.goal_days) * 100))
  const beyondGoal = stats.day_number > stats.goal_days

  return (
    <div className="space-y-5">
      <header className="pt-1 text-center">
        <h1 className="text-2xl font-extrabold leading-tight">ReTrack</h1>
        <p className="mt-1 text-4xl font-extrabold">
          Day {stats.day_number}
          <span className="text-xl font-bold text-ink-400"> / {stats.goal_days}</span>
        </p>
      </header>

      <section className="card p-4">
        <ProgressBar percent={journeyPercent} tone={beyondGoal ? 'sage' : 'blush'} />
        <p className="mt-2 text-center text-sm text-ink-400">
          {beyondGoal
            ? 'Past the goal and still going. This never expires. ❤️'
            : `${stats.days_remaining} days to the goal`}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <StatTile
          emoji="🔥"
          label="Current streak"
          value={`${stats.current_streak} ${stats.current_streak === 1 ? 'day' : 'days'}`}
        />
        <StatTile emoji="🏅" label="Longest streak" value={`${stats.longest_streak} days`} />
        <StatTile emoji="❤️" label="Approved days" value={stats.approved_days} />
        <StatTile emoji="📊" label="Average" value={`${stats.average_completion}%`} />
        <StatTile emoji="✅" label="Full days" value={stats.full_days} />
        <StatTile
          emoji="⏱️"
          label="Total time"
          value={formatDuration(stats.total_active_seconds)}
        />
      </section>

      {stats.current_streak === 0 && stats.days_elapsed > 1 && (
        <p className="card px-4 py-3 text-center text-sm font-bold text-ink-600">
          Streak paused. Today didn't go as planned — tomorrow is another chance. ❤️
        </p>
      )}

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold">Milestones</h2>
        <div className="card space-y-3 p-4">
          {stats.milestones.map((milestone) => (
            <div key={milestone.day_number} className="flex items-center gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${
                  milestone.reached ? 'bg-blush-100' : 'bg-blush-50 opacity-40'
                }`}
              >
                {milestone.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-extrabold ${
                    milestone.reached ? '' : 'text-ink-400'
                  }`}
                >
                  Day {milestone.day_number} · {milestone.title}
                </p>
                {milestone.description && (
                  <p className="truncate text-xs text-ink-400">{milestone.description}</p>
                )}
              </div>
              {milestone.reached && <Flame size={16} className="shrink-0 text-blush-500" />}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold">This week</h2>
        {history.isLoading ? (
          <Spinner />
        ) : (
          <Suspense fallback={<Spinner />}>
            <WeeklyChart days={history.data ?? []} />
          </Suspense>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold">Last 30 days</h2>
        {history.isLoading ? (
          <Spinner />
        ) : (
          <Suspense fallback={<Spinner />}>
            <MonthlySummary days={history.data ?? []} longestStreak={stats.longest_streak} />
          </Suspense>
        )}
      </section>
    </div>
  )
}
