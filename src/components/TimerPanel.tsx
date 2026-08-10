import { useState } from 'react'
import { Flag, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import type { DayActivity } from '@/types/db'
import { useLiveSeconds } from '@/hooks/useLiveTimer'
import { formatClock, toMinutes } from '@/lib/format'
import {
  discardSession,
  finishSession,
  pauseSession,
  readLocationOnce,
  resumeSession,
  startSession,
} from '@/api/timer'
import { useProgressMutation } from '@/hooks/queries'
import { useToast } from '@/context/ToastProvider'
import { friendlyError } from '@/lib/supabase'

interface TimerPanelProps {
  activity: DayActivity
  offsetMs: number
}

/**
 * The timer is a remote control, not a stopwatch: every button asks the
 * database to record something, and the database supplies the time. What ticks
 * on screen is only a preview of the row that already exists on the server.
 */
export function TimerPanel({ activity, offsetMs }: TimerPanelProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const session = activity.live_session
  const liveSeconds = useLiveSeconds(session, offsetMs)

  const start = useProgressMutation(async () => {
    // Optional and one-shot: if Kruti asked for location, try once at start.
    const coords = activity.requires_location ? await readLocationOnce() : null
    return startSession(activity.id, coords)
  })
  const pause = useProgressMutation((id: string) => pauseSession(id))
  const resume = useProgressMutation((id: string) => resumeSession(id))
  const finish = useProgressMutation((id: string) => finishSession(id))
  const discard = useProgressMutation((id: string) => discardSession(id))

  async function run(name: string, action: () => Promise<unknown>, success?: string) {
    setBusy(name)
    try {
      await action()
      if (success) toast(success, 'success')
    } catch (caught) {
      toast(friendlyError(caught), 'error')
    } finally {
      setBusy(null)
    }
  }

  const totalToday = activity.completed_seconds + (session ? liveSeconds : 0)
  const targetMinutes = toMinutes(activity.target_seconds)
  const running = session?.status === 'running'

  return (
    <div className="card p-5 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
        Target {targetMinutes} minutes
      </p>

      <p
        className={`mt-2 font-mono text-5xl font-extrabold tabular-nums ${
          running ? 'text-blush-600' : 'text-ink-900'
        }`}
      >
        {formatClock(session ? liveSeconds : 0)}
      </p>

      <p className="mt-1 text-sm text-ink-400">
        {toMinutes(totalToday)} of {targetMinutes} minutes today
        {activity.sessions.filter((item) => item.status === 'finished').length > 0 && (
          <>
            {' · '}
            {activity.sessions.filter((item) => item.status === 'finished').length} finished{' '}
            {activity.sessions.filter((item) => item.status === 'finished').length === 1
              ? 'session'
              : 'sessions'}
          </>
        )}
      </p>

      {!session && (
        <button
          type="button"
          className="btn-primary mt-4 w-full py-4"
          disabled={busy !== null}
          onClick={() => void run('start', () => start.mutateAsync(undefined))}
        >
          {busy === 'start' ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
          Start activity
        </button>
      )}

      {session && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {running ? (
              <button
                type="button"
                className="btn-secondary py-4"
                disabled={busy !== null}
                onClick={() => void run('pause', () => pause.mutateAsync(session.id))}
              >
                {busy === 'pause' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Pause size={18} />
                )}
                Pause
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary py-4"
                disabled={busy !== null}
                onClick={() => void run('resume', () => resume.mutateAsync(session.id))}
              >
                {busy === 'resume' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Play size={18} />
                )}
                Resume
              </button>
            )}

            <button
              type="button"
              className="btn-success py-4"
              disabled={busy !== null}
              onClick={() =>
                void run('finish', () => finish.mutateAsync(session.id), 'Session saved ❤️')
              }
            >
              {busy === 'finish' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Flag size={18} />
              )}
              Finish
            </button>
          </div>

          <button
            type="button"
            className="btn-ghost w-full text-sm text-ink-400"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm('Throw away this session? Nothing will be recorded.')) return
              void run('discard', () => discard.mutateAsync(session.id), 'Session discarded')
            }}
          >
            <Trash2 size={14} /> Discard this session
          </button>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-400">
        You can pause and come back — a target can be reached across several sessions.
      </p>
    </div>
  )
}
