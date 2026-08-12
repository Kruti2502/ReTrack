import { supabase } from '@/lib/supabase'
import type { Coordinates } from '@/lib/geolocation'
import type { ActivitySession } from '@/types/db'

export type { Coordinates }

/**
 * All five of these are server-side functions. The browser never writes a
 * duration — it only asks the database to note that something happened, and
 * the database timestamps it.
 */

/**
 * `coords` is not decoration: for an activity with "ask for location at start"
 * switched on, the database refuses to open a session without one.
 */
export async function startSession(
  activityId: string,
  coords?: Coordinates | null,
): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('start_activity_session', {
    p_activity_id: activityId,
    p_lat: coords?.lat ?? null,
    p_lng: coords?.lng ?? null,
    p_accuracy: coords?.accuracy ?? null,
  })
  if (error) throw error
  return data as ActivitySession
}

export async function pauseSession(sessionId: string): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('pause_activity_session', { p_session_id: sessionId })
  if (error) throw error
  return data as ActivitySession
}

export async function resumeSession(sessionId: string): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('resume_activity_session', { p_session_id: sessionId })
  if (error) throw error
  return data as ActivitySession
}

export async function finishSession(sessionId: string): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('finish_activity_session', { p_session_id: sessionId })
  if (error) throw error
  return data as ActivitySession
}

export async function discardSession(sessionId: string): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('discard_activity_session', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return data as ActivitySession
}

export async function attachLocation(
  sessionId: string,
  coords: Coordinates,
): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc('set_session_location', {
    p_session_id: sessionId,
    p_lat: coords.lat,
    p_lng: coords.lng,
    p_accuracy: coords.accuracy ?? null,
  })
  if (error) throw error
  return data as ActivitySession
}
