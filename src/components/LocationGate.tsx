import { useEffect, useState } from 'react'
import { Loader2, MapPin, RotateCcw, Settings, ShieldCheck } from 'lucide-react'
import {
  LocationError,
  locationPermission,
  requestLocation,
  unblockSteps,
  type Coordinates,
} from '@/lib/geolocation'
import { Modal } from './ui/Modal'

type GateIntent = 'start' | 'resume' | 'photo'

/** Everything that changes between the timer's gate and the photo's. */
const COPY: Record<GateIntent, { verb: string; blocked: string; button: string }> = {
  start: { verb: 'start', blocked: 'the timer cannot start', button: 'start' },
  resume: { verb: 'continue', blocked: 'the timer cannot continue', button: 'continue' },
  photo: { verb: 'photograph', blocked: 'the camera does not open', button: 'take photo' },
}

interface LocationGateProps {
  open: boolean
  activityName: string
  /**
   * "start" for a fresh session, "resume" for one that never sent a location,
   * "photo" for an untimed activity where the upload is the only moment there is.
   */
  intent: GateIntent
  onCancel: () => void
  /** Runs only once a real fix exists. Rejecting keeps the gate open. */
  onShare: (coords: Coordinates) => Promise<unknown>
}

/**
 * The only door to the timer when Kruti switched on "ask for location at start".
 *
 * There is deliberately no skip: closing this sheet leaves the timer where it
 * was. The location is read first and sent with the very request that opens the
 * session, so a session can never exist without the point it was started from.
 */
export function LocationGate({ open, activityName, intent, onCancel, onShare }: LocationGateProps) {
  const [phase, setPhase] = useState<'idle' | 'locating' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const busy = phase !== 'idle'
  const unblock = unblockSteps()
  const copy = COPY[intent]

  /**
   * A remembered refusal means no prompt will appear, so say so before he taps.
   *
   * Re-checked whenever the tab comes back to the foreground: fixing this means
   * leaving for Settings and returning, and a panel still standing afterwards
   * would look like the fix had failed. 'unknown' (Safari often refuses this
   * query) leaves whatever the last real attempt reported.
   */
  useEffect(() => {
    if (!open) return
    let alive = true

    const check = () => {
      void locationPermission().then((state) => {
        if (!alive || state === 'unknown') return
        setBlocked(state === 'denied')
      })
    }

    check()
    document.addEventListener('visibilitychange', check)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', check)
    }
  }, [open])

  function close() {
    if (busy) return
    setError(null)
    onCancel()
  }

  async function share() {
    setError(null)
    setPhase('locating')
    try {
      const coords = await requestLocation()
      setBlocked(false)
      setPhase('sending')
      await onShare(coords)
      setPhase('idle')
    } catch (caught) {
      setPhase('idle')
      if (caught instanceof LocationError && caught.code === 'denied') {
        // The instructions below replace the message — they are the way out.
        setBlocked(true)
        return
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Your location could not be sent. Try again.',
      )
    }
  }

  return (
    <Modal open={open} onClose={close} title="Share where you are ❤️" center>
      {/* The timer card centres its text; instructions have to read left-aligned. */}
      <div className="text-left">
        <p className="text-sm leading-relaxed text-ink-600">
          Kruti asked to see where you are when you {copy.verb}{' '}
          <span className="font-extrabold">{activityName}</span>. Your current location is sent to
          her first, {copy.blocked} without it.
        </p>

        <div
          className="mt-4 flex items-start gap-2.5 rounded-2xl bg-blush-50 px-3 py-2.5
                     text-xs leading-relaxed text-ink-600"
        >
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage-700" />
          <span>
            One single reading, taken now and saved with this{' '}
            {intent === 'photo' ? 'photo when you send it' : 'session'}. Nothing is watched
            afterwards.
          </span>
        </div>

        {error && (
          <p
            className="mt-3 rounded-2xl bg-blush-100 px-3 py-2.5 text-sm
                       leading-relaxed text-blush-700"
          >
            {error}
          </p>
        )}

        {blocked && (
          <div
            className="mt-3 rounded-2xl bg-amber-50 px-3 py-3 text-xs
                       leading-relaxed text-amber-900"
          >
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
              <Settings size={14} /> Location is blocked
            </p>
            <p className="mt-1">
              Your phone is refusing without asking. Switch it back on in {unblock.where}:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              {unblock.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            {unblock.fallback && (
              <>
                <p className="mt-3 font-extrabold">If it is still blocked after that:</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  {unblock.fallback.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            )}

            <button
              type="button"
              className="btn-secondary mt-3 w-full py-2.5 text-xs"
              onClick={() => window.location.reload()}
            >
              <RotateCcw size={14} /> Reload this page
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn-primary mt-4 w-full py-4"
          disabled={busy}
          onClick={() => void share()}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={18} />}
          {phase === 'locating'
            ? 'Finding you…'
            : phase === 'sending'
              ? 'Sending to Kruti…'
              : error || blocked
                ? 'Try again'
                : `Share location & ${copy.button}`}
        </button>

        <button
          type="button"
          className="btn-ghost mt-2 w-full text-sm text-ink-400"
          disabled={busy}
          onClick={close}
        >
          Not now
        </button>

        <p className="mt-2 text-center text-xs text-ink-400">
          {intent === 'photo'
            ? 'The camera opens as soon as your location is shared.'
            : 'The timer stays where it is until the location is sent.'}
        </p>
      </div>
    </Modal>
  )
}
