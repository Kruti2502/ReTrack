import { useState } from "react";
import { Check, Clock, Heart, MapPin, MessageCircleHeart } from "lucide-react";
import type { DayActivity } from "@/types/db";
import {
  approveActivity,
  requestCorrection,
  setReviewNote,
} from "@/api/review";
import { useProgressMutation } from "@/hooks/queries";
import {
  deriveStatus,
  isUntimed,
  STATUS_CLASS,
  STATUS_EMOJI,
  STATUS_LABEL,
} from "@/lib/activityStatus";
import { formatDuration, formatTime, toMinutes } from "@/lib/format";
import { friendlyError } from "@/lib/supabase";
import { useToast } from "@/context/ToastProvider";
import { ProofGrid } from "./ProofGrid";
import { SessionLocation } from "./SessionLocation";
import { Modal } from "./ui/Modal";

/** One activity as Kruti sees it: the time, the photo, and what she wants to say. */
export function ReviewCard({ activity }: { activity: DayActivity }) {
  const { toast } = useToast();
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState("");
  const [praising, setPraising] = useState(false);
  const [message, setMessage] = useState("");

  const approve = useProgressMutation(
    (args: { id: string; note: string | null }) =>
      approveActivity(args.id, args.note),
  );
  const correction = useProgressMutation((args: { id: string; note: string }) =>
    requestCorrection(args.id, args.note),
  );
  // Writing on something already approved. Separate call so the approval time
  // stays the moment she approved, not the moment she found the words.
  const praise = useProgressMutation((args: { id: string; note: string }) =>
    setReviewNote(args.id, args.note),
  );

  const status = deriveStatus(activity);
  const untimed = isUntimed(activity);
  const submission = activity.submission;
  const finished = activity.sessions.filter(
    (session) => session.status === "finished",
  );
  const locationVerified = finished.some(
    (session) => session.location_captured_at,
  );
  // An untimed activity has no session to hang a point on — it rides the photo.
  const locatedProof = activity.proofs.find(
    (proof) => proof.location_captured_at,
  );

  return (
    <div className="card animate-fade-up p-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl">{activity.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[17px] font-extrabold">
              {activity.name}
            </h3>
            <span className={`chip shrink-0 ${STATUS_CLASS[status]}`}>
              {STATUS_EMOJI[status]} {STATUS_LABEL[status]}
            </span>
          </div>
          <p className="text-sm text-ink-400">
            {isUntimed(activity)
              ? "📷 Photo only"
              : `${toMinutes(activity.completed_seconds)} / ${toMinutes(
                  activity.target_seconds ?? 0,
                )} minutes`}
            {activity.proofs.length > 0 && ` · 📷 ${activity.proofs.length}`}
          </p>
        </div>
      </div>

      {finished.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          {finished.map((session, index) => (
            <li key={session.id} className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Clock size={11} />
                Session {index + 1}: {formatDuration(session.active_seconds)} ·{" "}
                {formatTime(session.started_at)}
                {session.ended_at && ` → ${formatTime(session.ended_at)}`}
              </span>
              {activity.requires_location && (
                // Where he was standing when he pressed start.
                <span className="ml-4 block">
                  <SessionLocation session={session} />
                </span>
              )}
            </li>
          ))}
          {activity.requires_location && !locationVerified && (
            <li className="text-ink-400">
              <MapPin size={11} className="mr-1 inline" />
              No location on record for this activity
            </li>
          )}
        </ul>
      )}

      {untimed && activity.requires_location && (
        <p className="mt-3 text-xs text-ink-400">
          {locatedProof ? (
            <SessionLocation session={locatedProof} />
          ) : (
            <>
              <MapPin size={11} className="mr-1 inline" />
              No location on record for this activity
            </>
          )}
        </p>
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

      {submission?.status === "submitted" && (
        <div className="mt-4 space-y-3">
          {/* Approve on its own stays one tap — five activities a night, and
              most of them need nothing said. */}
          <button
            type="button"
            className="btn-success w-full"
            disabled={approve.isPending}
            onClick={() => {
              void approve
                .mutateAsync({ id: submission.id, note: null })
                .then(() => toast(`${activity.name} approved ❤️`, "success"))
                .catch((caught) => toast(friendlyError(caught), "error"));
            }}
          >
            <Check size={16} /> Approve
          </button>

          {/* The two things she might want to say, side by side and equal.
              Until now only the left one existed, so the only message the app
              could carry was a complaint. */}
          <div className="grid grid-cols-2 gap-3">
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
              className="btn-secondary text-blush-600"
              disabled={approve.isPending}
              onClick={() => {
                setMessage("");
                setPraising(true);
              }}
            >
              <Heart size={16} /> Appreciate
            </button>
          </div>
        </div>
      )}

      {submission?.status === "correction_requested" &&
        submission.review_note && (
          <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            You asked: "{submission.review_note}"
          </p>
        )}

      {submission?.status === "approved" && submission.review_note && (
        <p className="mt-3 rounded-2xl bg-sage-100 px-3 py-2 text-sm text-ink-600">
          <span className="font-extrabold">You wrote:</span>{" "}
          {submission.review_note}
        </p>
      )}

      {submission?.status === "approved" && submission.reviewed_at && (
        <p className="mt-3 text-xs text-sage-700">
          Approved {formatTime(submission.reviewed_at)} ❤️
        </p>
      )}

      {/* The evening case: approved in a hurry during the day, and now she has
          a minute to write something. Editing never moves the approval time. */}
      {submission?.status === "approved" && (
        <button
          type="button"
          className="btn-secondary mt-3 w-full text-blush-600"
          disabled={praise.isPending}
          onClick={() => {
            setMessage(submission.review_note ?? "");
            setPraising(true);
          }}
        >
          <Heart size={16} />
          {submission.review_note ? "Edit what you wrote" : "Appreciate"}
        </button>
      )}

      <Modal
        open={correcting}
        onClose={() => setCorrecting(false)}
        title="Ask for a small fix"
      >
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
            if (!submission) return;
            void correction
              .mutateAsync({ id: submission.id, note: note.trim() })
              .then(() => {
                toast("Sent to Dharmik", "love");
                setCorrecting(false);
                setNote("");
              })
              .catch((caught) => toast(friendlyError(caught), "error"));
          }}
        >
          Send request
        </button>
      </Modal>

      <Modal
        open={praising}
        onClose={() => setPraising(false)}
        title="Appreciate him ❤️"
      >
        <p className="mb-3 text-sm text-ink-400">
          He sees this on {activity.name}, and it stays with the day in his
          history.
        </p>

        <textarea
          className="input min-h-24 resize-none"
          placeholder="Proud of you ❤️"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={!message.trim() || approve.isPending || praise.isPending}
          onClick={() => {
            if (!submission) return;
            const text = message.trim();
            const approved = submission.status === "approved";
            const sending = approved
              ? praise.mutateAsync({ id: submission.id, note: text })
              : approve.mutateAsync({ id: submission.id, note: text });

            void sending
              .then(() => {
                toast(
                  approved
                    ? "Sent to Dharmik ❤️"
                    : `${activity.name} approved ❤️`,
                  "love",
                );
                setPraising(false);
                setMessage("");
              })
              .catch((caught) => toast(friendlyError(caught), "error"));
          }}
        >
          <Heart size={16} className="fill-white" />
          {submission?.status === "approved" ? "Send" : "Approve & send"}
        </button>
      </Modal>
    </div>
  );
}
