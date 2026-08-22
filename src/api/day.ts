import { supabase } from '@/lib/supabase'
import type { DailyProgress, DayActivity, DayBundle, HistoryDay, JourneyStats } from '@/types/db'

/**
 * A day nothing has been recorded on yet has no progress row behind it, and an
 * older `get_day` answered that with an object of nulls instead of zeroes — read
 * straight through, it put "null of null approved" under the ring. Migration 014
 * fixes the source; this keeps the screens honest against a database that has
 * not caught up yet, and against any future day the server cannot count.
 */
function zeroedProgress(progress: Partial<DailyProgress> | null): DailyProgress {
  return {
    percent: progress?.percent ?? 0,
    required_total: progress?.required_total ?? 0,
    required_completed: progress?.required_completed ?? 0,
    required_approved: progress?.required_approved ?? 0,
    optional_completed: progress?.optional_completed ?? 0,
    total_active_seconds: progress?.total_active_seconds ?? 0,
    all_required_approved: progress?.all_required_approved ?? false,
    is_day_approved: progress?.is_day_approved ?? false,
  }
}

/**
 * Skip days arrived after some days were already being read, and a database that
 * has not run migration 015 yet answers without them. Absent means "sits nothing
 * out", which is what every activity did before the rule existed.
 */
function withSkipDays(activity: DayActivity): DayActivity {
  return {
    ...activity,
    skip_days: activity.skip_days ?? [],
    is_skipped: activity.is_skipped ?? false,
  }
}

/** Everything the dashboard needs for one day, in a single round trip. */
export async function fetchDay(localDate?: string): Promise<DayBundle> {
  const { data, error } = await supabase.rpc('get_day', {
    p_local_date: localDate ?? null,
  })
  if (error) throw error
  const day = data as DayBundle
  return {
    ...day,
    progress: zeroedProgress(day.progress),
    activities: (day.activities ?? []).map(withSkipDays),
  }
}

export async function fetchJourneyStats(): Promise<JourneyStats> {
  const { data, error } = await supabase.rpc('get_journey_stats')
  if (error) throw error
  return data as JourneyStats
}

export async function fetchHistory(from: string, to: string): Promise<HistoryDay[]> {
  const { data, error } = await supabase.rpc('get_history', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as HistoryDay[]
}

/** The server's idea of "today", in the plan's timezone. */
export async function fetchToday(): Promise<string> {
  const { data, error } = await supabase.rpc('today_local')
  if (error) throw error
  return data as string
}
