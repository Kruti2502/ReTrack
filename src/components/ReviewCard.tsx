import { useState } from 'react'
import { Check, Clock, MapPin, MessageCircleHeart } from 'lucide-react'
import type { DayActivity } from '@/types/db'
import { approveActivity, requestCorrection } from '@/api/review'
import { useProgressMutation } from '@/hooks/queries'
import { deriveStatus, STATUS_CLASS, STATUS_EMOJI, STATUS_LABEL } from '@/lib/activityStatus'
import { formatDuration, formatTime, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { useToast } from '@/context/ToastProvider'
import { ProofGrid } from './ProofGrid'
import { Modal } from './ui/Modal'

/** One activity as Kruti sees it: the time, the photo, and two decisions. */
export function ReviewCard({ activity }: { activity: DayActivity }) {
  const { toast } = useToast()
  const [correcting, setCorrecting] = useState(false)
  const [note, setNote] = useState('')

  const approve = useProgressMutation((id: string) => approveActivity(id))
  const correction = useProgressMutation((args: { id: string; note: string }) =>
    requestCorrection(args.id, args.note),
  )

  const status = deriveStatus(activity)
  const submission = activity.submission
  const finished = activity.sessions.filter((session) => session.status === 'finished')
  const locationVerified = finished.some((session) => session.location_captured_at)

  return (
    <div className="card animate-fade-up p-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl">{activity.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[17px] font-extrabold">{activity.name}</h3>
            <span className={`chip shrink-0 ${STATUS_CLASS[status]}`}>
              {STATUS_EMOJI[status]} {STATUS_LABEL[status]}
            </span>
          </div>
          <p className="text-sm text-ink-400">
            {toMinutes(activity.completed_seconds)} / {toMinutes(activity.target_seconds)} minutes
            {activity.proofs.length > 0 && ` · 📷 ${activity.proofs.length}`}
          </p>
        </div>
      </div>

      {finished.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          {finished.map((session, index) => (
            <li key={session.id} className="flex items-center gap-1.5">
              <Clock size={11} />
              Session {index + 1}: {formatDuration(session.active_seconds)} ·{' '}
              {formatTime(session.started_at)}
              {session.ended_at && ` → ${formatTime(session.ended_at)}`}
            </li>
          ))}
          {activity.requires_location && (
            <li className={locationVerified ? 'text-sage-700' : 'text-ink-400'}>
              <MapPin size={11} className="mr-1 inline" />
              {locationVerified ? 'Location verified' : 'Location not verified'}
            </li>
          )}
        </ul>
      )}

      {activity.proofs.length > 0 && (
        <div className="mt-3">
          <ProofGrid proofs={activity.proofs} columns={3} />
        </div>
      )}

      {submission?.note && (
        <p className="mt-3 rounded-2xl bg-blush-50 px-3 py-2 text-sm text-ink-600">
          <span className="font-extrabold">Dharmik:</span> {submission.note}
        </p>
      )}

      {submission?.status === 'submitted' && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={approve.isPending}
            onClick={() => setCorrecting(true)}
          >
            <MessageCircleHeart size={16} /> Ask to fix
          </button>
          <button
            type="button"
            className="btn-success"
            disabled={approve.isPending}
            onClick={() => {
              void approve
                .mutateAsync(submission.id)
                .then(() => toast(`${activity.name} approved ❤️`, 'success'))
                .catch((caught) => toast(friendlyError(caught), 'error'))
            }}
          >
            <Check size={16} /> Approve
          </button>
        </div>
      )}

      {submission?.status === 'correction_requested' && submission.review_note && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You asked: "{submission.review_note}"
        </p>
      )}

      {submission?.status === 'approved' && submission.reviewed_at && (
        <p className="mt-3 text-xs text-sage-700">
          Approved {formatTime(submission.reviewed_at)} ❤️
        </p>
      )}

      <Modal open={correcting} onClose={() => setCorrecting(false)} title="Ask for a small fix">
        <p className="mb-3 text-sm text-ink-400">
          Dharmik will see this and can resubmit. Keep it kind ❤️
        </p>
        <textarea
          className="input min-h-24 resize-none"
          placeholder="Please upload a clearer photo ❤️"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={!note.trim() || correction.isPending}
          onClick={() => {
            if (!submission) return
            void correction
              .mutateAsync({ id: submission.id, note: note.trim() })
              .then(() => {
                toast('Sent to Dharmik', 'love')
                setCorrecting(false)
                setNote('')
              })
              .catch((caught) => toast(friendlyError(caught), 'error'))
          }}
        >
          Send request
        </button>
      </Modal>
    </div>
  )
}
