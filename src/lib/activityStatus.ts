import type { ActivityCardStatus, DayActivity } from '@/types/db'

/** No target means no stopwatch: the photo is the whole task. */
export function isUntimed(activity: { target_seconds: number | null }): boolean {
  return activity.target_seconds === null
}

/**
 * Turns the server's raw day data into the one word the card should show.
 * This is presentation only — the database already decided what is true.
 */
export function deriveStatus(activity: DayActivity): ActivityCardStatus {
  const submission = activity.submission

  if (submission?.status === 'approved') return 'approved'
  if (submission?.status === 'submitted') return 'waiting'
  if (submission?.status === 'correction_requested') return 'correction'

  // An untimed activity has nothing between "no photo" and "done".
  if (isUntimed(activity)) {
    return activity.proofs.length > 0 ? 'ready_to_submit' : 'needs_proof'
  }

  if (activity.live_session?.status === 'running') return 'in_progress'
  if (activity.live_session?.status === 'paused') return 'paused'

  const reachedTarget = activity.completed_seconds >= (activity.target_seconds ?? 0)
  if (reachedTarget) {
    const needsPhoto = activity.requires_photo && activity.proofs.length === 0
    return needsPhoto ? 'needs_proof' : 'ready_to_submit'
  }

  return activity.completed_seconds > 0 ? 'in_progress' : 'not_started'
}

export const STATUS_LABEL: Record<ActivityCardStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  needs_proof: 'Needs a photo',
  ready_to_submit: 'Ready to submit',
  waiting: 'Waiting for Kruti',
  correction: 'Needs a fix',
  approved: 'Approved',
}

export const STATUS_EMOJI: Record<ActivityCardStatus, string> = {
  not_started: '❌',
  in_progress: '🟡',
  paused: '⏸️',
  needs_proof: '📷',
  ready_to_submit: '🟢',
  waiting: '🟠',
  correction: '✏️',
  approved: '✅',
}

export const STATUS_CLASS: Record<ActivityCardStatus, string> = {
  not_started: 'bg-blush-50 text-ink-600',
  in_progress: 'bg-amber-100 text-amber-800',
  paused: 'bg-amber-50 text-amber-700',
  needs_proof: 'bg-blush-100 text-blush-700',
  ready_to_submit: 'bg-sage-100 text-sage-700',
  waiting: 'bg-orange-100 text-orange-700',
  correction: 'bg-blush-100 text-blush-700',
  approved: 'bg-sage-100 text-sage-700',
}

/** The button on the front of the card. */
export function ctaLabel(status: ActivityCardStatus): string {
  switch (status) {
    case 'not_started':
      return 'Start'
    case 'in_progress':
    case 'paused':
      return 'Continue'
    case 'needs_proof':
      return 'Take photo'
    case 'ready_to_submit':
      return 'Submit'
    case 'correction':
      return 'Fix and resubmit'
    case 'waiting':
    case 'approved':
      return 'View proof'
  }
}

/** Per-activity completion, capped at 100% — 40 of 30 minutes is never 133%. */
export function activityPercent(activity: DayActivity): number {
  // Untimed: all or nothing. The photo is there or it is not.
  if (isUntimed(activity)) return activity.proofs.length > 0 ? 100 : 0
  if (!activity.target_seconds || activity.target_seconds <= 0) return 0
  return Math.min(100, Math.round((activity.completed_seconds / activity.target_seconds) * 100))
}

export function isSettled(status: ActivityCardStatus): boolean {
  return status === 'approved' || status === 'waiting'
}
