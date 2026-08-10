/**
 * Browser / PWA notifications.
 *
 * No paid provider, no SMS, no WhatsApp. Where the browser cannot deliver a
 * notification, the app falls back to an in-app reminder card (see
 * components/ReminderBanner.tsx).
 *
 * Because there is no push server, reminders fire while the app is open or
 * still alive in the background. That is a real limitation and the settings
 * screen says so out loud rather than pretending otherwise.
 */

export type PermissionState = NotificationPermission | 'unsupported'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): PermissionState {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.requestPermission()
}

export async function notify(title: string, body: string, tag: string): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false

  const options: NotificationOptions = {
    body,
    tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }

  try {
    // Android requires the service worker path; desktop is happy either way.
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(title, options)
      return true
    }
    new Notification(title, options)
    return true
  } catch {
    return false
  }
}

/** Remembers what has already fired so a reminder never repeats in a day. */
const FIRED_KEY = 'retrack.reminders-fired'

export function alreadyFired(id: string): boolean {
  try {
    const raw = localStorage.getItem(FIRED_KEY)
    return raw ? (JSON.parse(raw) as string[]).includes(id) : false
  } catch {
    return false
  }
}

export function markFired(id: string): void {
  try {
    const raw = localStorage.getItem(FIRED_KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    // Keep the list short — only today's entries matter.
    const today = id.split('|')[0]
    const next = [...list.filter((item) => item.startsWith(today)), id]
    localStorage.setItem(FIRED_KEY, JSON.stringify(next))
  } catch {
    /* a missing localStorage just means reminders may repeat */
  }
}

/** "18:30:00" on a given calendar date → a Date in the device's local time. */
export function timeToDate(isoDate: string, clockTime: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  const [hours, minutes] = clockTime.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}
