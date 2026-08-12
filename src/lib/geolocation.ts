import type { ActivitySession } from '@/types/db'

export interface Coordinates {
  lat: number
  lng: number
  accuracy?: number
}

export type LocationErrorCode = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout'

/** A refusal we can explain, rather than a silent `null`. */
export class LocationError extends Error {
  readonly code: LocationErrorCode

  constructor(code: LocationErrorCode) {
    super(LOCATION_MESSAGE[code])
    this.name = 'LocationError'
    this.code = code
  }
}

export const LOCATION_MESSAGE: Record<LocationErrorCode, string> = {
  unsupported: 'This browser cannot share a location.',
  insecure: 'Location only works over a secure (https) connection.',
  denied: 'Location is switched off for this app, so the phone never asked.',
  unavailable: 'Your location could not be found. Move near a window or outside, then try again.',
  timeout: 'Finding your location took too long. Try again.',
}

/**
 * A one-shot location read. Never a watch — we do not track anyone.
 *
 * Unlike a best-effort read, this rejects with a `LocationError` instead of
 * resolving to null: the caller needs to know that nothing was captured so it
 * can refuse to start the timer. `maximumAge: 0` matters — a cached fix from an
 * hour ago would prove nothing about where Dharmik is standing now.
 */
export function requestLocation(timeoutMs = 15_000): Promise<Coordinates> {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new LocationError('unsupported'))
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return Promise.reject(new LocationError('insecure'))
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) return reject(new LocationError('denied'))
        if (error.code === error.TIMEOUT) return reject(new LocationError('timeout'))
        reject(new LocationError('unavailable'))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

/**
 * "denied" is the one that traps people: once a browser has remembered a
 * refusal it stops asking, so `getCurrentPosition` fails instantly and the only
 * way back is the device's own settings. Asking up front lets us show the way
 * out before Dharmik taps a button that cannot work.
 *
 * Returns 'unknown' where the Permissions API is missing or refuses the query.
 */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!navigator.permissions?.query) return 'unknown'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}

export interface UnblockGuide {
  where: string
  steps: string[]
  /** The switch above the per-site one. Allowing the site does nothing without it. */
  fallback?: string[]
}

/** Where the switch actually lives on the device in hand. */
export function unblockSteps(): UnblockGuide {
  const ua = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // A home-screen install has no address bar, so its permission lives in Settings.
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true

  // iOS keeps two switches: one for the website and one for Safari itself. The
  // site-level "Allow" looks like it worked but changes nothing while the
  // system-level one is off, which is what makes this so confusing.
  const iosSystem = [
    'Open the iPhone Settings app.',
    'Tap Privacy & Security → Location Services.',
    'Make sure Location Services is ON (green).',
    installed
      ? 'In the list below, find ReTrack and set it to "While Using the App".'
      : 'Scroll to Safari Websites and set it to "While Using the App".',
    'Turn Precise Location ON.',
    'Come back and tap "Try again".',
  ]

  if (isIos && installed) {
    return {
      where: 'iPhone Settings',
      steps: iosSystem,
      fallback: [
        'Still blocked? Close the app fully (swipe it away from the app switcher) and open it again.',
      ],
    }
  }
  if (isIos) {
    return {
      where: 'Safari',
      steps: [
        'Tap the "aA" or ⓘ button on the left of the address bar.',
        'Tap Website Settings.',
        'Set Location to Ask (or Allow), then tap Done.',
        'Swipe Safari fully closed from the app switcher, then reopen this page.',
      ],
      fallback: iosSystem,
    }
  }
  if (/Android/.test(ua)) {
    return {
      where: 'Chrome',
      steps: [
        'Tap the 🔒 or ⓘ icon on the left of the address bar.',
        'Tap Permissions, then Location.',
        'Choose Allow.',
        'Reload this page below.',
      ],
      fallback: [
        'Still blocked? Android Settings → Location must be on, and Chrome needs location access.',
      ],
    }
  }
  return {
    where: 'your browser',
    steps: [
      'Click the icon on the left of the address bar.',
      'Set Location to Allow.',
      'Reload this page below.',
    ],
  }
}

export interface SessionLocationPoint extends Coordinates {
  capturedAt: string | null
}

/** The point a session was started from, or null when nothing was captured. */
export function sessionCoords(session: ActivitySession): SessionLocationPoint | null {
  if (session.location_lat === null || session.location_lng === null) return null
  return {
    lat: session.location_lat,
    lng: session.location_lng,
    accuracy: session.location_accuracy ?? undefined,
    capturedAt: session.location_captured_at,
  }
}

/** 23.022505 → "23.02251" — five decimals is about a metre. */
export function formatCoords(point: Coordinates): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

/** 12.4 → "±12 m", 1400 → "±1.4 km" */
export function formatAccuracy(accuracy?: number): string | null {
  if (accuracy === undefined || !Number.isFinite(accuracy)) return null
  return accuracy >= 1000 ? `±${(accuracy / 1000).toFixed(1)} km` : `±${Math.round(accuracy)} m`
}

/** The same reading as `formatAccuracy`, in words: 12.4 → "within 12 m". */
export function formatPrecision(accuracy?: number): string | null {
  const exact = formatAccuracy(accuracy)
  return exact && `within ${exact.slice(1)}`
}

/**
 * Beyond this the phone never saw a satellite: it guessed from wifi or from the
 * network, which can be a whole neighbourhood out. A real GPS fix lands well
 * inside it, so anything wider is worth flagging rather than showing as a pin.
 */
const VAGUE_ACCURACY_M = 100

/**
 * A warning for a reading too loose to place anyone, or null when the fix is
 * good. Precision is only worth a reader's attention when it is bad — "within
 * 8 m" tells them nothing they would act on, "within 1.4 km" tells them the
 * point is a guess.
 */
export function accuracyWarning(accuracy?: number): string | null {
  if (accuracy === undefined || !Number.isFinite(accuracy)) return null
  return accuracy > VAGUE_ACCURACY_M ? `rough area, ${formatPrecision(accuracy)}` : null
}

/** Opens the point in whatever map app the phone prefers. */
export function mapsUrl(point: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`
}
