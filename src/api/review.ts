import { supabase } from '@/lib/supabase'
import type { ActivityProof, ActivitySubmission, DailyApproval } from '@/types/db'

export async function submitActivity(
  activityId: string,
  note?: string | null,
): Promise<ActivitySubmission> {
  const { data, error } = await supabase.rpc('submit_activity', {
    p_activity_id: activityId,
    p_note: note ?? null,
  })
  if (error) throw error
  return data as ActivitySubmission
}

export async function approveActivity(
  submissionId: string,
  note?: string | null,
): Promise<ActivitySubmission> {
  const { data, error } = await supabase.rpc('approve_activity', {
    p_submission_id: submissionId,
    p_note: note ?? null,
  })
  if (error) throw error
  return data as ActivitySubmission
}

/**
 * Her message on an activity she has already approved. Deliberately not
 * `approve_activity` with a note: that would re-stamp `reviewed_at`, and the
 * "Approved 9:41 PM" line would drift to whenever she got round to writing.
 * Pass null (or an empty string) to clear it again.
 */
export async function setReviewNote(
  submissionId: string,
  note: string | null,
): Promise<ActivitySubmission> {
  const { data, error } = await supabase.rpc('set_review_note', {
    p_submission_id: submissionId,
    p_note: note,
  })
  if (error) throw error
  return data as ActivitySubmission
}

export async function requestCorrection(
  submissionId: string,
  note: string,
): Promise<ActivitySubmission> {
  const { data, error } = await supabase.rpc('request_correction', {
    p_submission_id: submissionId,
    p_note: note,
  })
  if (error) throw error
  return data as ActivitySubmission
}

export async function approveDay(
  localDate: string | null,
  message?: string | null,
): Promise<DailyApproval> {
  const { data, error } = await supabase.rpc('approve_day', {
    p_local_date: localDate,
    p_message: message ?? null,
  })
  if (error) throw error
  return data as DailyApproval
}

export async function revokeDayApproval(localDate: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_day_approval', { p_local_date: localDate })
  if (error) throw error
}

export interface PendingSubmission extends ActivitySubmission {
  activities: { id: string; name: string; icon: string; target_seconds: number } | null
}

/** Everything currently sitting in Kruti's queue, oldest first. */
export async function fetchPendingSubmissions(): Promise<PendingSubmission[]> {
  const { data, error } = await supabase
    .from('activity_submissions')
    .select('*, activities(id, name, icon, target_seconds)')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as PendingSubmission[]
}

export async function fetchProofsForDay(localDate: string): Promise<ActivityProof[]> {
  const { data, error } = await supabase
    .from('activity_proofs')
    .select('*')
    .eq('local_date', localDate)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ActivityProof[]
}
