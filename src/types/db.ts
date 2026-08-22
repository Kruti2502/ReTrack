// Shapes returned by Supabase / the RPC layer.
// These mirror supabase/migrations/001_schema.sql.

export type Role = 'DHARMIK' | 'KRUTI'

export type SessionStatus = 'running' | 'paused' | 'finished' | 'discarded'

export type SubmissionStatus = 'submitted' | 'approved' | 'correction_requested'

export interface Profile {
  id: string
  role: Role
  display_name: string
  emoji: string
  created_at: string
  updated_at: string
}

export interface DailyPlan {
  id: string
  name: string
  owner_id: string
  start_date: string
  goal_days: number
  timezone: string
  day_start_hour: number
  /** Weekdays off, matching Postgres `extract(dow)`: 0 = Sunday … 6 = Saturday. */
  rest_days: number[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  plan_id: string
  name: string
  icon: string
  /** Null means untimed: no stopwatch, the photo proof is the whole task. */
  target_seconds: number | null
  is_required: boolean
  /**
   * Weekdays this activity sits out, matching Postgres `extract(dow)`:
   * 0 = Sunday … 6 = Saturday. Empty means every day.
   */
  skip_days: number[]
  requires_photo: boolean
  requires_location: boolean
  reminder_time: string | null
  sort_order: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface ActivitySession {
  id: string
  activity_id: string
  user_id: string
  local_date: string
  status: SessionStatus
  started_at: string
  last_resumed_at: string | null
  paused_at: string | null
  ended_at: string | null
  active_seconds: number
  location_lat: number | null
  location_lng: number | null
  location_accuracy: number | null
  location_captured_at: string | null
  /**
   * True when Kruti entered this after the fact instead of the server timing it.
   * A reconstructed day must never read as one that was measured second by
   * second, so anything showing a session says which it is.
   */
  is_backfilled: boolean
  created_at: string
  updated_at: string
}

export interface ActivityProof {
  id: string
  session_id: string | null
  activity_id: string
  user_id: string
  local_date: string
  cloudinary_public_id: string
  cloudinary_secure_url: string
  width: number | null
  height: number | null
  format: string | null
  bytes: number
  original_filename: string | null
  original_bytes: number | null
  exif: Record<string, unknown> | null
  /** Only for untimed activities — a timed one carries its point on the session. */
  location_lat: number | null
  location_lng: number | null
  location_accuracy: number | null
  location_captured_at: string | null
  /** True when Kruti attached an existing photo, so `uploaded_at` is when she attached it. */
  is_backfilled: boolean
  uploaded_at: string
  created_at: string
}

export interface ActivitySubmission {
  id: string
  activity_id: string
  user_id: string
  local_date: string
  status: SubmissionStatus
  submitted_seconds: number
  note: string | null
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  updated_at: string
}

export interface DailyProgress {
  percent: number
  required_total: number
  required_completed: number
  required_approved: number
  optional_completed: number
  total_active_seconds: number
  all_required_approved: boolean
  is_day_approved: boolean
}

export interface DailyApproval {
  id: string
  user_id: string
  local_date: string
  approved_by: string
  approved_at: string
  percent_at_approval: number
  message: string | null
}

export interface MotivationalMessage {
  id: string
  text: string
  min_percent: number
  max_percent: number
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface NotificationPreferences {
  user_id: string
  enabled: boolean
  activity_reminders: boolean
  daily_summary: boolean
  daily_summary_time: string
  nudge_when_incomplete: boolean
  created_at: string
  updated_at: string
}

export interface Milestone {
  day_number: number
  title: string
  emoji: string
  description: string | null
  reached: boolean
}

/** One activity as returned inside `get_day`. */
export interface DayActivity {
  id: string
  name: string
  icon: string
  /** Null means untimed: no stopwatch, the photo proof is the whole task. */
  target_seconds: number | null
  /**
   * For this date, not the plan's standing answer: an activity sitting the
   * weekday out is never required, whatever the plan says about other days.
   */
  is_required: boolean
  /** The rule behind `is_skipped`: 0 = Sunday … 6 = Saturday. */
  skip_days: number[]
  /**
   * This activity sits this particular date out. Nothing is owed, nothing is
   * counted against him — and anything he does anyway counts as a bonus.
   */
  is_skipped: boolean
  requires_photo: boolean
  requires_location: boolean
  reminder_time: string | null
  sort_order: number
  is_archived: boolean
  completed_seconds: number
  live_session: ActivitySession | null
  sessions: ActivitySession[]
  proofs: ActivityProof[]
  submission: ActivitySubmission | null
}

/** The `get_day` RPC payload — one call powers the whole dashboard. */
export interface DayBundle {
  date: string
  server_time: string
  day_number: number
  /** Derived from the date, so it is right before any timer has run. */
  is_rest_day: boolean
  /**
   * True only while this is the open day and the calendar has already turned —
   * the small hours, when `date` trails the date on his phone. Always false for
   * a past day he scrolls back to.
   */
  past_midnight: boolean
  /** The hour this day closes on, mirrored from the plan for convenience. */
  day_start_hour: number
  plan: DailyPlan | null
  progress: DailyProgress
  day_approval: DailyApproval | null
  activities: DayActivity[]
}

export interface JourneyStats {
  today: string
  plan: DailyPlan | null
  day_number: number
  goal_days: number
  days_remaining: number
  days_elapsed: number
  average_completion: number
  approved_days: number
  full_days: number
  partial_days: number
  active_days: number
  /** Working days he owed and did not turn up for. Rest days are not counted. */
  missed_days: number
  rest_days_elapsed: number
  /** Rest days he trained on anyway. */
  bonus_days: number
  is_rest_day: boolean
  total_active_seconds: number
  current_streak: number
  longest_streak: number
  milestones: Milestone[]
}

export interface HistoryDay {
  date: string
  day_number: number
  percent: number
  required_total: number
  required_completed: number
  required_approved: number
  total_active_seconds: number
  is_day_approved: boolean
  is_rest_day: boolean
  message: string | null
  photo_count: number
}

/** Derived on the client purely for display — the server owns the truth. */
export type ActivityCardStatus =
  | 'not_started'
  | 'in_progress'
  | 'paused'
  | 'needs_proof'
  | 'ready_to_submit'
  | 'waiting'
  | 'correction'
  | 'approved'
