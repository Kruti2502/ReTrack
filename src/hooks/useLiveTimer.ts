import { useEffect, useState } from 'react'
import type { ActivitySession } from '@/types/db'

/**
 * The ticking number on screen is only a preview of what the server already
 * knows. We correct for the device clock by measuring how far it is from the
 * server clock that came back with the day payload — so a phone with the wrong
 * time still shows an honest timer, and the record itself is unaffected either
 * way.
 */
export function useServerOffset(serverTime: string | null | undefined): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!serverTime) return
    setOffset(new Date(serverTime).getTime() - Date.now())
  }, [serverTime])

  return offset
}

export function sessionSeconds(
  session: ActivitySession | null | undefined,
  offsetMs: number,
): number {
  if (!session) return 0
  if (session.status !== 'running' || !session.last_resumed_at) return session.active_seconds

  const now = Date.now() + offsetMs
  const since = (now - new Date(session.last_resumed_at).getTime()) / 1000
  return session.active_seconds + Math.max(0, Math.floor(since))
}

/** Seconds on the live session, refreshed every second while it runs. */
export function useLiveSeconds(
  session: ActivitySession | null | undefined,
  offsetMs: number,
): number {
  const [, setTick] = useState(0)
  const running = session?.status === 'running'

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  return sessionSeconds(session, offsetMs)
}

/**
 * Total seconds for an activity today: everything already finished, plus the
 * session that is running right now.
 */
export function useActivitySeconds(
  completedSeconds: number,
  liveSession: ActivitySession | null | undefined,
  offsetMs: number,
): number {
  const live = useLiveSeconds(liveSession, offsetMs)
  return completedSeconds + live
}
