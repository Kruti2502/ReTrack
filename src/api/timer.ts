import { supabase } from '@/lib/supabase'
import type { ActivitySession } from '@/types/db'

export interface Coordinates {
  lat: number
  lng: number
  accuracy?: number
}

/**
 * All five of these are server-side functions. The browser never writes a
 * duration — it only asks the database to note that something happened, and
 * the database timestamps it.
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

/**
 * A one-shot location read. Never a watch — we do not track anyone.
 * Resolves to null whenever permission is refused or unavailable.
 */
export function readLocationOnce(timeoutMs = 8000): Promise<Coordinates | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}
