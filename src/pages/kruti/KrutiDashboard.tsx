import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Flame, Heart, ListChecks, Settings2 } from 'lucide-react'
import { useDay, useJourney, useProgressMutation } from '@/hooks/queries'
import { useServerOffset } from '@/hooks/useLiveTimer'
import { approveDay, revokeDayApproval } from '@/api/review'
import { deriveStatus } from '@/lib/activityStatus'
import { formatDate, formatDuration, roundPercent } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ActivityCard } from '@/components/ActivityCard'
import { ReviewCard } from '@/components/ReviewCard'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/context/ToastProvider'

export default function KrutiDashboard() {
  const day = useDay()
  const journey = useJourney()
  const offset = useServerOffset(day.data?.server_time)
  const { toast } = useToast()
  const [approving, setApproving] = useState(false)
  const [message, setMessage] = useState('')

  const approve = useProgressMutation((note: string | null) => approveDay(null, note))
  const revoke = useProgressMutation((date: string) => revokeDayApproval(date))

  if (day.isLoading) return <Spinner label="Loading Dharmik's day…" />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data) return null

  const { activities, progress, day_number, day_approval } = day.data
  const percent = roundPercent(progress.percent)

  const waiting = activities.filter((activity) => activity.submission?.status === 'submitted')
  const rest = activities.filter((activity) => activity.submission?.status !== 'submitted')
  const requiredLeft = activities.filter(
    (activity) => activity.is_required && deriveStatus(activity) !== 'approved',
  ).length

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Dharmik's today ❤️</h1>
        <p className="text-sm text-ink-400">
          Day {day_number} · {formatDate(day.data.date)}
        </p>
      </header>

      <section className="flex flex-col items-center gap-3">
        <ProgressRing
          percent={percent}
          label={`${progress.required_approved} of ${progress.required_total} approved`}
          sublabel={formatDuration(progress.total_active_seconds) + ' recorded'}
        />
        {(journey.data?.current_streak ?? 0) > 0 && (
          <span className="chip bg-blush-100 text-blush-700">
            <Flame size={14} /> {journey.data?.current_streak} day streak
          </span>
        )}
      </section>

      {day_approval ? (
        <section className="card border-sage-300 bg-sage-100/70 p-4 text-center">
          <p className="text-lg font-extrabold">Day approved ❤️</p>
          {day_approval.message && (
            <p className="mt-1 text-sm text-ink-600">"{day_approval.message}"</p>
          )}
          <button
            type="button"
            className="btn-ghost mt-2 text-xs text-ink-400"
            onClick={() => {
              if (!window.confirm('Undo today’s approval?')) return
              void revoke
                .mutateAsync(day.data.date)
                .then(() => toast('Approval removed'))
                .catch((caught) => toast(friendlyError(caught), 'error'))
            }}
          >
            Undo approval
          </button>
        </section>
      ) : (
        <button
          type="button"
          className="btn-primary w-full py-4 text-base"
          disabled={requiredLeft > 0}
          onClick={() => setApproving(true)}
        >
          <Heart size={18} className="fill-white" />
          {requiredLeft > 0
            ? `${requiredLeft} still to approve`
            : 'Approve today ❤️'}
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Link to="/kruti/review" className="card flex flex-col items-center gap-1 px-2 py-3">
          <ListChecks size={20} className="text-blush-500" />
          <span className="text-xs font-bold">Review</span>
        </Link>
        <Link to="/history" className="card flex flex-col items-center gap-1 px-2 py-3">
          <CalendarDays size={20} className="text-blush-500" />
          <span className="text-xs font-bold">History</span>
        </Link>
        <Link to="/kruti/plan" className="card flex flex-col items-center gap-1 px-2 py-3">
          <Settings2 size={20} className="text-blush-500" />
          <span className="text-xs font-bold">Manage plan</span>
        </Link>
      </div>

      {waiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold">Waiting for you 🟠</h2>
          {waiting.map((activity) => (
            <ReviewCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold">Everything today</h2>
        {activities.length === 0 ? (
          <EmptyState
            emoji="🌱"
            title="No activities yet"
            description="Add the first one so Dharmik knows what today looks like."
            action={
              <Link to="/kruti/plan" className="btn-primary">
                Manage plan
              </Link>
            }
          />
        ) : (
          rest.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} offsetMs={offset} readOnly />
          ))
        )}
      </section>

      <Modal open={approving} onClose={() => setApproving(false)} title="Approve today ❤️">
        <p className="text-sm text-ink-400">
          This creates a permanent record for {formatDate(day.data.date)} and keeps the streak
          going.
        </p>
        <textarea
          className="input mt-3 min-h-24 resize-none"
          placeholder="Today's mission complete ❤️ I'm proud of you."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={approve.isPending}
          onClick={() => {
            void approve
              .mutateAsync(message.trim() || null)
              .then(() => {
                toast('Day approved ❤️', 'love')
                setApproving(false)
                setMessage('')
              })
              .catch((caught) => toast(friendlyError(caught), 'error'))
          }}
        >
          <Heart size={18} className="fill-white" /> Approve today
        </button>
      </Modal>
    </div>
  )
}
