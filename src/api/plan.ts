import { supabase } from '@/lib/supabase'
import type { Activity, DailyPlan } from '@/types/db'

export async function fetchActivePlan(): Promise<DailyPlan | null> {
  const { data, error } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as DailyPlan | null
}

export async function fetchActivities(includeArchived = false): Promise<Activity[]> {
  let query = supabase.from('activities').select('*').order('sort_order')
  if (!includeArchived) query = query.eq('is_archived', false)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Activity[]
}

export type ActivityDraft = {
  name: string
  icon: string
  target_seconds: number
  weight: number
  is_required: boolean
  requires_photo: boolean
  requires_location: boolean
  reminder_time: string | null
  sort_order: number
}

export async function createActivity(planId: string, draft: ActivityDraft): Promise<Activity> {
  const { data, error } = await supabase
    .from('activities')
    .insert({ plan_id: planId, ...draft })
    .select()
    .single()
  if (error) throw error
  await refreshToday()
  return data as Activity
}

export async function updateActivity(
  id: string,
  patch: Partial<ActivityDraft>,
): Promise<Activity> {
  const { data, error } = await supabase
    .from('activities')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await refreshToday()
  return data as Activity
}

/**
 * Activities are archived rather than deleted, so every past day still renders
 * exactly as it happened.
 */
export async function archiveActivity(id: string): Promise<Activity> {
  const { data, error } = await supabase.rpc('archive_activity', { p_activity_id: id })
  if (error) throw error
  return data as Activity
}

export async function restoreActivity(id: string): Promise<Activity> {
  const { data, error } = await supabase.rpc('restore_activity', { p_activity_id: id })
  if (error) throw error
  return data as Activity
}

export async function updatePlan(
  id: string,
  patch: Partial<Pick<DailyPlan, 'name' | 'start_date' | 'goal_days' | 'timezone'>>,
): Promise<DailyPlan> {
  const { data, error } = await supabase
    .from('daily_plans')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await refreshToday()
  return data as DailyPlan
}

/** Targets changed — ask the server to recompute today's percentage. */
export async function refreshToday(): Promise<void> {
  const { error } = await supabase.rpc('refresh_today')
  if (error) throw error
}
