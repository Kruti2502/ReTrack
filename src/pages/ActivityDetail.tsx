import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, MapPin, Send } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { useDay, useProgressMutation } from '@/hooks/queries'
import { useServerOffset } from '@/hooks/useLiveTimer'
import { deriveStatus, STATUS_CLASS, STATUS_EMOJI, STATUS_LABEL } from '@/lib/activityStatus'
import { formatClock, formatDuration, formatTime, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { submitActivity } from '@/api/review'
import { deleteProof } from '@/api/proof'
import { TimerPanel } from '@/components/TimerPanel'
import { PhotoUploader } from '@/components/PhotoUploader'
import { ProofGrid } from '@/components/ProofGrid'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'

export default function ActivityDetail() {
  const { activityId } = useParams<{ activityId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast } = useToast()
  const day = useDay()
  const offset = useServerOffset(day.data?.server_time)
  const [note, setNote] = useState('')

  const submit = useProgressMutation(() => submitActivity(activityId as string, note || null))
  const removeProof = useProgressMutation((id: string) => deleteProof(id))

  if (day.isLoading) return <Spinner />
  if (day.isError) {
    return <ErrorState message={friendlyError(day.error)} onRetry={() => void day.refetch()} />
  }

  const activity = day.data?.activities.find((item) => item.id === activityId)
  if (!activity || !day.data) {
    return <ErrorState message="That activity is not part of today's plan." />
  }

  const status = deriveStatus(activity)
  const finished = activity.sessions.filter((session) => session.status === 'finished')
  const targetMinutes = toMinutes(activity.target_seconds)
  const percent = Math.min(
    100,
    Math.round((activity.completed_seconds / Math.max(1, activity.target_seconds)) * 100),
  )
  // Kruti can open the same screen from her dashboard, but only to look at it.
  const isOwner = profile?.role === 'DHARMIK'
  const locked = status === 'approved' || status === 'waiting'
  const editable = isOwner && !locked
  const hasProof = activity.proofs.length > 0
  const needsProof = activity.requires_photo && !hasProof
  const canSubmit = editable && activity.completed_seconds > 0 && !needsProof
  const reachedTarget = activity.completed_seconds >= activity.target_seconds

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="btn-ghost -ml-2 px-2 py-1 text-sm"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <header className="flex items-start gap-3">
        <span className="text-4xl">{activity.icon}</span>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold leading-tight">{activity.name}</h1>
          <p className="text-sm text-ink-400">
            Target {targetMinutes} minutes
            {!isOwner && ' · viewing only'}
          </p>
        </div>
        <span className={`chip ${STATUS_CLASS[status]}`}>
          {STATUS_EMOJI[status]} {STATUS_LABEL[status]}
        </span>
      </header>

      <ProgressBar percent={percent} tone={status === 'approved' ? 'sage' : 'blush'} />

      {activity.submission?.status === 'correction_requested' && (
        <div className="card border-blush-200 bg-blush-50/80 p-4">
          <p className="text-sm font-extrabold text-blush-700">Kruti asked for a small fix ❤️</p>
          <p className="mt-1 text-sm text-ink-600">{activity.submission.review_note}</p>
        </div>
      )}

      {editable && <TimerPanel activity={activity} offsetMs={offset} />}

      {locked && (
        <div className="card p-5 text-center">
          <p className="text-3xl">{status === 'approved' ? '✅' : '🟠'}</p>
          <p className="mt-1 text-lg font-extrabold">
            {status === 'approved' ? 'Approved by Kruti ❤️' : 'Waiting for Kruti'}
          </p>
          <p className="mt-1 text-sm text-ink-400">
            {formatDuration(activity.submission?.submitted_seconds ?? 0)} recorded
          </p>
          {activity.submission?.review_note && (
            <p className="mt-2 text-sm text-ink-600">"{activity.submission.review_note}"</p>
          )}
        </div>
      )}

      {finished.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-400">Sessions</h2>
          <ul className="mt-2 divide-y divide-blush-50">
            {finished.map((session, index) => (
              <li key={session.id} className="flex items-center gap-3 py-2.5">
                <Clock size={16} className="text-ink-400" />
                <div className="flex-1">
                  <p className="text-sm font-bold">
                    Session {index + 1} · {formatClock(session.active_seconds)}
                  </p>
                  <p className="text-xs text-ink-400">
                    {formatTime(session.started_at)}
                    {session.ended_at ? ` → ${formatTime(session.ended_at)}` : ''}
                  </p>
                </div>
                {activity.requires_location && (
                  <span
                    className={`chip text-[11px] ${
                      session.location_captured_at
                        ? 'bg-sage-100 text-sage-700'
                        : 'bg-blush-50 text-ink-400'
                    }`}
                  >
                    <MapPin size={11} />
                    {session.location_captured_at ? 'Verified' : 'Not verified'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm font-extrabold">
            Total: {formatDuration(activity.completed_seconds)} of {targetMinutes} minutes
          </p>
        </section>
      )}

      {hasProof && (
        <section className="card p-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-400">
            Proof photos
          </h2>
          <div className="mt-3">
            <ProofGrid
              proofs={activity.proofs}
              onDelete={
                !editable
                  ? undefined
                  : (proof) => {
                      void removeProof
                        .mutateAsync(proof.id)
                        .catch((caught) => toast(friendlyError(caught), 'error'))
                    }
              }
            />
          </div>
        </section>
      )}

      {editable && activity.requires_photo && (
        <PhotoUploader
          activityId={activity.id}
          sessionId={activity.live_session?.id ?? finished[finished.length - 1]?.id ?? null}
          localDate={day.data.date}
          owner={profile?.role.toLowerCase() ?? 'dharmik'}
          onUploaded={() => void day.refetch()}
        />
      )}

      {canSubmit && (
        <section className="card animate-fade-up p-5">
          <h2 className="text-center text-xl font-extrabold">Ready to submit ❤️</h2>

          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">Activity</dt>
              <dd className="font-bold">{activity.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Duration</dt>
              <dd className="font-bold">
                {formatDuration(activity.completed_seconds)} of {targetMinutes} min
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Proof</dt>
              <dd className="font-bold">
                {activity.proofs.length} photo{activity.proofs.length === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>

          {!reachedTarget && (
            <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You're at {percent}% of the target. You can still submit, and Kruti will see the
              exact time.
            </p>
          )}

          <textarea
            className="input mt-3 min-h-20 resize-none"
            placeholder="Anything you want to tell Kruti? (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <button
            type="button"
            className="btn-primary mt-3 w-full py-4"
            disabled={submit.isPending}
            onClick={() => {
              void submit
                .mutateAsync(undefined)
                .then(() => {
                  toast('Sent to Kruti ❤️', 'love')
                  setNote('')
                })
                .catch((caught) => toast(friendlyError(caught), 'error'))
            }}
          >
            <Send size={18} />
            {activity.submission?.status === 'correction_requested'
              ? 'Resubmit for approval'
              : 'Submit for approval'}
          </button>
        </section>
      )}

      {editable && needsProof && activity.completed_seconds > 0 && (
        <p className="px-2 text-center text-sm text-ink-400">
          <Check size={14} className="mr-1 inline" />
          Time is recorded. Add a photo and you can submit.
        </p>
      )}
    </div>
  )
}
