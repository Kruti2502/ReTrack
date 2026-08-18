import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, parseISO, subDays } from 'date-fns'
import { Camera, Check, ChevronLeft, ChevronRight, Heart, Lock } from 'lucide-react'
import { useDay, useProgressMutation } from '@/hooks/queries'
import { backfillActivity } from '@/api/backfill'
import { approveDay } from '@/api/review'
import { isUntimed } from '@/lib/activityStatus'
import { formatDate, formatDuration, roundPercent, toIsoDate, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { PhotoUploader } from '@/components/PhotoUploader'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { Modal } from '@/components/ui/Modal'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'
import type { DayActivity } from '@/types/db'

/**
 * Kruti filling in a day the app missed — the phone was dead, it was offline, or
 * he forgot to submit.
 *
 * Deliberately hers alone. Dharmik cannot reach this screen and the database
 * would refuse him if he could: him being unable to type in his own minutes is
 * what makes every other number in the app worth something. She is already the
 * one who decides whether a day counted, so she is the one who can say it about
 * a day the app did not see.
 */
export default function BackfillDay() {
  const { toast } = useToast()
  // Today's label as the SERVER reckons it, which past 6 AM is not the phone's.
  const today = useDay()
  const [date, setDate] = useState<string | null>(null)

  const lastClosed = today.data ? toIsoDate(subDays(parseISO(today.data.date), 1)) : null
  useEffect(() => {
    if (lastClosed && date === null) setDate(lastClosed)
  }, [lastClosed, date])

  const day = useDay(date, { enabled: date !== null })
  const [message, setMessage] = useState('')
  const [approving, setApproving] = useState(false)

  const approve = useProgressMutation((args: { date: string; note: string | null }) =>
    approveDay(args.date, args.note),
  )

  if (today.isLoading || !date) return <Spinner label="Loading…" />
  if (day.isLoading) return <Spinner label="Loading that day…" />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }
  if (!day.data || !lastClosed) return null

  const { activities, progress, day_number, day_approval, is_rest_day } = day.data
  const percent = roundPercent(progress.percent)
  const atLastClosed = date >= lastClosed
  const requiredLeft = activities.filter(
    (activity) => activity.is_required && activity.submission?.status !== 'approved',
  ).length

  const shift = (days: number) => {
    const next = toIsoDate(addDays(parseISO(date), days))
    if (next > lastClosed) return
    setDate(next)
  }

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Fill in a missed day</h1>
        <p className="text-sm text-ink-400">
          For a day the app did not see. Everything you add here is marked as filled in by you,
          so it never reads as a day he timed live.
        </p>
      </header>

      {/* Date picker — never today, because today still has the normal flow. */}
      <section className="card flex items-center gap-2 p-3">
        <button
          type="button"
          aria-label="Previous day"
          className="btn-ghost h-11 w-11 shrink-0"
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="date"
          className="input text-center"
          value={date}
          max={lastClosed}
          onChange={(event) => {
            const next = event.target.value
            if (next && next <= lastClosed) setDate(next)
          }}
        />
        <button
          type="button"
          aria-label="Next day"
          className="btn-ghost h-11 w-11 shrink-0"
          disabled={atLastClosed}
          onClick={() => shift(1)}
        >
          <ChevronRight size={18} />
        </button>
      </section>

      <section className="flex flex-col items-center gap-2">
        <ProgressRing
          percent={percent}
          label={`Day ${day_number} · ${formatDate(date)}`}
          sublabel={`${progress.required_approved} of ${progress.required_total} approved · ${formatDuration(
            progress.total_active_seconds,
          )}`}
        />
        {is_rest_day && (
          <span className="chip bg-sage-100 text-sage-700">
            😴 Rest day — nothing was owed, so filling this in is a bonus
          </span>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold">What he did that day</h2>
        {activities.map((activity) => (
          <BackfillRow key={activity.id} activity={activity} date={date} />
        ))}
      </section>

      {day_approval ? (
        <p className="card border-sage-300 bg-sage-100/70 p-4 text-center font-extrabold">
          Day approved ❤️
        </p>
      ) : (
        <button
          type="button"
          className="btn-primary w-full py-4 text-base"
          disabled={requiredLeft > 0}
          onClick={() => setApproving(true)}
        >
          <Heart size={18} className="fill-white" />
          {requiredLeft > 0 ? `${requiredLeft} still to fill in` : 'Approve this day ❤️'}
        </button>
      )}

      <p className="text-center text-xs text-ink-400">
        Looking for a day that is still open?{' '}
        <Link to="/kruti" className="font-bold text-blush-600">
          Today's review
        </Link>
      </p>

      <Modal open={approving} onClose={() => setApproving(false)} title="Approve this day ❤️">
        <p className="text-sm text-ink-400">
          This creates a permanent record for {formatDate(date)} and lets the streak count it.
        </p>
        <textarea
          className="input mt-3 min-h-24 resize-none"
          placeholder="We filled this one in together ❤️"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={approve.isPending}
          onClick={() => {
            void approve
              .mutateAsync({ date, note: message.trim() || null })
              .then(() => {
                toast('Day approved ❤️', 'love')
                setApproving(false)
                setMessage('')
              })
              .catch((caught) => toast(friendlyError(caught), 'error'))
          }}
        >
          <Heart size={18} className="fill-white" /> Approve {formatDate(date)}
        </button>
      </Modal>
    </div>
  )
}

/**
 * One activity on that day. A row she cannot edit is not a bug: anything the
 * server actually timed is left exactly as it was measured.
 */
function BackfillRow({ activity, date }: { activity: DayActivity; date: string }) {
  const { toast } = useToast()
  const untimed = isUntimed(activity)
  const live = activity.sessions.some(
    (session) => session.status === 'finished' && !session.is_backfilled,
  )
  const filledIn = activity.sessions.some((session) => session.is_backfilled)
  const minutesNow = toMinutes(activity.completed_seconds)

  const [minutes, setMinutes] = useState(String(minutesNow || ''))
  const [photoOpen, setPhotoOpen] = useState(false)

  // A save elsewhere on the page refetches the day; follow the new number
  // rather than sitting on a stale one.
  useEffect(() => setMinutes(String(minutesNow || '')), [minutesNow])

  const save = useProgressMutation((value: number) =>
    backfillActivity({ activityId: activity.id, localDate: date, minutes: value }),
  )

  const target = activity.target_seconds ? toMinutes(activity.target_seconds) : null
  const dirty = String(minutesNow || '') !== minutes

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-extrabold">
            {activity.icon} {activity.name}
            {!activity.is_required && (
              <span className="ml-1.5 text-xs font-bold text-ink-400">optional</span>
            )}
          </p>
          <p className="text-xs text-ink-400">
            {untimed ? 'Untimed — the photo is the whole task' : `Target ${target}m`}
          </p>
        </div>
        {live ? (
          <span className="chip shrink-0 bg-sage-100 text-sage-700">
            <Lock size={12} /> Timed live
          </span>
        ) : filledIn ? (
          <span className="chip shrink-0 bg-blush-100 text-blush-700">
            <Check size={12} /> Filled in
          </span>
        ) : null}
      </div>

      {live ? (
        <p className="text-sm text-ink-600">
          {formatDuration(activity.completed_seconds)} recorded by the timer that day — left
          exactly as it was measured.
        </p>
      ) : (
        <>
          {!untimed && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label" htmlFor={`mins-${activity.id}`}>
                  Minutes
                </label>
                <input
                  id={`mins-${activity.id}`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="input"
                  placeholder="0"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary h-11 shrink-0 px-5"
                disabled={save.isPending || !dirty}
                onClick={() => {
                  const value = Number(minutes || 0)
                  if (!Number.isFinite(value) || value < 0) {
                    toast('Minutes have to be a positive number', 'error')
                    return
                  }
                  void save
                    .mutateAsync(value)
                    .then(() =>
                      toast(value === 0 ? 'Cleared' : `${activity.name}: ${value}m saved ❤️`),
                    )
                    .catch((caught) => toast(friendlyError(caught), 'error'))
                }}
              >
                Save
              </button>
            </div>
          )}

          {activity.requires_photo && (
            <button
              type="button"
              className="btn-ghost w-full justify-center border border-blush-200"
              onClick={() => setPhotoOpen(true)}
            >
              <Camera size={16} />
              {activity.proofs.length > 0
                ? `${activity.proofs.length} photo${activity.proofs.length > 1 ? 's' : ''} — add another`
                : 'Attach a photo'}
            </button>
          )}
        </>
      )}

      <Modal
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        title={`${activity.icon} ${activity.name}`}
      >
        <PhotoUploader
          activityId={activity.id}
          activityName={activity.name}
          localDate={date}
          owner="dharmik"
          backfill
          onUploaded={() => setPhotoOpen(false)}
        />
      </Modal>
    </div>
  )
}
