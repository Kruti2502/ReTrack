import { supabase } from '@/lib/supabase'
import type { DailyProgress } from '@/types/db'

/**
 * Filling in a day the app missed.
 *
 * Only Kruti can reach these — the database enforces it, not the router. Dharmik
 * being unable to name a date or a duration for himself is the property the
 * whole app rests on, and the escape hatch for a missed day must not spend it.
 */

/**
 * Sets the total minutes for one activity on one past day. It replaces rather
 * than adds, so the same call can be repeated with a corrected number, and 0
 * clears it. Returns the day's progress as it now stands.
 */
export async function backfillActivity(args: {
  activityId: string
  localDate: string
  minutes: number
  note?: string | null
}): Promise<DailyProgress> {
  const { data, error } = await supabase.rpc('backfill_activity', {
    p_activity_id: args.activityId,
    p_local_date: args.localDate,
    p_minutes: args.minutes,
    p_note: args.note ?? null,
  })
  if (error) throw error
  return data as DailyProgress
}
