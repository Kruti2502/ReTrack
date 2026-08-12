import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Loader2, PackageOpen } from 'lucide-react'
import type { PendingSubmission } from '@/api/review'
import { approveActivity } from '@/api/review'
import { useDay, useProgressMutation } from '@/hooks/queries'
import { formatDate, formatDateShort, formatDaysAgo, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { useToast } from '@/context/ToastProvider'
import { useAuth } from '@/context/AuthProvider'
import { ReviewCard } from './ReviewCard'

interface EarlierSubmissionsProps {
  /** Everything still sitting at `submitted`, any date. */
  pending: PendingSubmission[]
  /** The server's today, so "yesterday" is counted from the plan's timezone. */
  today: string
}

/**
 * Submissions Dharmik sent on an earlier day that were never reviewed.
 *
 * Nothing ever clears `submitted` on its own, so before this existed those rows
 * counted towards the Review badge while being unreachable: the review page only
 * ever asked the server for today. They are grouped newest first, each day
 * fetched in full so a session's time, location and photos read exactly as they
 * do for today — Kruti should never approve something she cannot see.
 */
export function EarlierSubmissions({ pending, today }: EarlierSubmissionsProps) {
  const dates = [...new Set(pending.map((item) => item.local_date))]
    .filter((date) => date !== today)
    .sort()
    .reverse()

  if (dates.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="px-1 text-lg font-extrabold">Still waiting from earlier days ⏳</h2>
      {dates.map((date) => (
        <EarlierDay
          key={date}
          date={date}
          today={today}
          submissions={pending.filter((item) => item.local_date === date)}
        />
      ))}
    </section>
  )
}

/** One past day, drawn from the same `get_day` bundle that today's cards use. */
function EarlierDay({
  date,
  today,
  submissions,
}: {
  date: string
  today: string
  submissions: PendingSubmission[]
}) {
  const day = useDay(date)
  const relative = formatDaysAgo(date, today)

  const waiting = (day.data?.activities ?? []).filter(
    (activity) => activity.submission?.status === 'submitted',
  )

  // A pending row the day bundle left out — its activity was archived, or it
  // belongs to a plan that is no longer active. Reduced to a card of its own
  // rather than dropped, so the queue can always be emptied.
  const shown = new Set(waiting.map((activity) => activity.submission?.id))
  const stranded = submissions.filter((item) => !shown.has(item.id))

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-sm font-extrabold">
          {relative}
          {/* Skip the exact date once "days ago" has given way to a date itself. */}
          {relative !== formatDateShort(date) && (
            <span className="ml-2 font-bold text-ink-400">{formatDate(date)}</span>
          )}
        </h3>
        <Link
          to={`/history/${date}`}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-blush-600"
        >
          Open day <ArrowUpRight size={12} />
        </Link>
      </div>

      {day.isLoading && (
        <p className="flex items-center gap-2 px-1 text-xs text-ink-400">
          <Loader2 size={13} className="animate-spin" /> Loading that day…
        </p>
      )}

      {waiting.map((activity) => (
        <ReviewCard key={activity.id} activity={activity} />
      ))}

      {stranded.map((item) => (
        <StrandedSubmission key={item.id} submission={item} />
      ))}
    </div>
  )
}

/**
 * A submission whose activity has left the plan. There is no "ask to fix" here:
 * Dharmik can no longer open an archived activity to redo anything, so the only
 * kind thing to offer is approving the time he did put in.
 */
export function StrandedSubmission({ submission }: { submission: PendingSubmission }) {
  const { toast } = useToast()
  const { isKruti } = useAuth()
  const approve = useProgressMutation((id: string) => approveActivity(id))
  const name = submission.activities?.name ?? 'An activity that has left the plan'

  return (
    <div className="card animate-fade-up p-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl">{submission.activities?.icon ?? '📦'}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold">{name}</h3>
          <p className="text-sm text-ink-400">
            {toMinutes(submission.submitted_seconds)} minutes sent
          </p>
        </div>
      </div>

      <p
        className="mt-3 flex items-start gap-2 rounded-2xl bg-blush-50 px-3 py-2.5
                   text-xs leading-relaxed text-ink-600"
      >
        <PackageOpen size={15} className="mt-0.5 shrink-0 text-ink-400" />
        This activity is no longer part of the plan, so its day cannot be opened. The time above is
        what Dharmik sent.
      </p>

      {submission.note && (
        <p className="mt-3 rounded-2xl bg-blush-50 px-3 py-2 text-sm text-ink-600">
          <span className="font-extrabold">Dharmik:</span> {submission.note}
        </p>
      )}

      {isKruti && (
        <button
          type="button"
          className="btn-success mt-4 w-full"
          disabled={approve.isPending}
          onClick={() => {
            void approve
              .mutateAsync(submission.id)
              .then(() => toast(`${name} approved ❤️`, 'success'))
              .catch((caught) => toast(friendlyError(caught), 'error'))
          }}
        >
          {approve.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Approve
        </button>
      )}
    </div>
  )
}
