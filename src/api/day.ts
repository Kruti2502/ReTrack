import { supabase } from '@/lib/supabase'
import type { DayBundle, HistoryDay, JourneyStats } from '@/types/db'

/** Everything the dashboard needs for one day, in a single round trip. */
export async function fetchDay(localDate?: string): Promise<DayBundle> {
  const { data, error } = await supabase.rpc('get_day', {
    p_local_date: localDate ?? null,
  })
  if (error) throw error
  return data as DayBundle
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
