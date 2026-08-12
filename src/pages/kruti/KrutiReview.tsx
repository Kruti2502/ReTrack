import { useDay, usePendingSubmissions } from '@/hooks/queries'
import { formatDate, roundPercent } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ApprovedOnDate } from '@/components/ApprovedOnDate'
import { EarlierSubmissions, StrandedSubmission } from '@/components/EarlierSubmissions'
import { ReviewCard } from '@/components/ReviewCard'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { ProgressBar } from '@/components/ui/ProgressRing'

export default function KrutiReview() {
  const day = useDay()
  // The queue is not the same question as "what happened today": it reaches
  // back over every day Dharmik sent something that was never answered.
  const pending = usePendingSubmissions()

  if (day.isLoading) return <Spinner />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data) return null

  const today = day.data.date
  const waiting = day.data.activities.filter(
    (activity) => activity.submission?.status === 'submitted',
  )
  const corrections = day.data.activities.filter(
    (activity) => activity.submission?.status === 'correction_requested',
  )
  const allPending = pending.data ?? []
  const earlier = allPending.filter((item) => item.local_date !== today)

  // Same rescue as on a past day: today's pending rows the day bundle dropped
  // because the activity was archived or moved off the active plan.
  const shownToday = new Set(waiting.map((activity) => activity.submission?.id))
  const strandedToday = allPending.filter(
    (item) => item.local_date === today && !shownToday.has(item.id),
  )

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Review ❤️</h1>
        <p className="text-sm text-ink-400">{formatDate(day.data.date)}</p>
        <div className="mt-3">
          <ProgressBar percent={roundPercent(day.data.progress.percent)} />
        </div>
      </header>

      {waiting.length === 0 &&
        corrections.length === 0 &&
        strandedToday.length === 0 &&
        earlier.length === 0 && (
          <EmptyState
            emoji="☕"
            title="Nothing waiting"
            description="Everything Dharmik has sent is reviewed. Enjoy the quiet."
          />
        )}

      {(waiting.length > 0 || strandedToday.length > 0) && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Waiting for approval 🟠</h2>
          {waiting.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
          {strandedToday.map((item) => (
            <StrandedSubmission key={item.id} submission={item} />
          ))}
        </section>
      )}

      <ApprovedOnDate today={today} />

      <EarlierSubmissions pending={earlier} today={today} />

      {corrections.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Waiting on Dharmik ✏️</h2>
          {corrections.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}
    </div>
  )
}
