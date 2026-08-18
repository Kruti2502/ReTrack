import { differenceInCalendarDays, format, parseISO } from 'date-fns'

/** 3725 → "1:02:05", 125 → "02:05" */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

/** Whole minutes, rounded down — what the activity cards show. */
export function toMinutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60)
}

/** 5400 → "1h 30m", 1800 → "30m" */
export function formatDuration(seconds: number): string {
  const minutes = toMinutes(seconds)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** "2026-08-09" → "August 9, 2026" */
export function formatDate(isoDate: string): string {
  return format(parseISO(isoDate), 'MMMM d, yyyy')
}

/** "2026-08-09" → "Sunday, August 9, 2026" */
export function formatDateWithWeekday(isoDate: string): string {
  return format(parseISO(isoDate), 'EEEE, MMMM d')
}

/** "2026-08-09" → "Sat, Aug 9" */
export function formatDateShort(isoDate: string): string {
  return format(parseISO(isoDate), 'EEE, MMM d')
}

/**
 * How long ago a day was, in the words Kruti would use: "Yesterday",
 * "3 days ago", and a plain date once "days ago" stops meaning anything.
 */
export function formatDaysAgo(isoDate: string, today: string): string {
  const days = differenceInCalendarDays(parseISO(today), parseISO(isoDate))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return formatDateShort(isoDate)
}

/** A full timestamp → "August 9, 2026 · 6:42 PM" */
export function formatTimestamp(iso: string): string {
  return format(new Date(iso), "MMMM d, yyyy '·' h:mm a")
}

export function formatTime(iso: string): string {
  return format(new Date(iso), 'h:mm a')
}

export function formatHour(hour: number): string {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return format(date, 'h a')
}

/** "20:00:00" → "8:00 PM" */
export function formatClockTime(value: string): string {
  const [hours, minutes] = value.split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return format(date, 'h:mm a')
}

export function roundPercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/** Local YYYY-MM-DD, used only for building calendar ranges — never for records. */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}
