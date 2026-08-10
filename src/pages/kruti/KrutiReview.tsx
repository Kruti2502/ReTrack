import { useDay } from '@/hooks/queries'
import { deriveStatus } from '@/lib/activityStatus'
import { formatDate, roundPercent } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ReviewCard } from '@/components/ReviewCard'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { ProgressBar } from '@/components/ui/ProgressRing'

export default function KrutiReview() {
  const day = useDay()

  if (day.isLoading) return <Spinner />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data) return null

  const waiting = day.data.activities.filter(
    (activity) => activity.submission?.status === 'submitted',
  )
  const corrections = day.data.activities.filter(
    (activity) => activity.submission?.status === 'correction_requested',
  )
  const approved = day.data.activities.filter((activity) => deriveStatus(activity) === 'approved')

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Review ❤️</h1>
        <p className="text-sm text-ink-400">{formatDate(day.data.date)}</p>
        <div className="mt-3">
          <ProgressBar percent={roundPercent(day.data.progress.percent)} />
        </div>
      </header>

      {waiting.length === 0 && corrections.length === 0 && (
        <EmptyState
          emoji="☕"
          title="Nothing waiting"
          description="Everything Dharmik has sent is reviewed. Enjoy the quiet."
        />
      )}

      {waiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Waiting for approval 🟠</h2>
          {waiting.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}

      {corrections.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Waiting on Dharmik ✏️</h2>
          {corrections.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}

      {approved.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Approved today ✅</h2>
          {approved.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}
    </div>
  )
}
