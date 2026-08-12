import { getDay, parseISO } from 'date-fns'

/**
 * Rest days are stored as Postgres weekday numbers (0 = Sunday … 6 = Saturday),
 * which is the same numbering `date-fns` uses, so a date can be tested against
 * the plan without any conversion.
 */
export const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
] as const

/** The server decides this for the days it reports; this is for dates it did not. */
export function isRestDate(isoDate: string, restDays: number[] | undefined): boolean {
  return (restDays ?? []).includes(getDay(parseISO(isoDate)))
}

/** [0] → "Sunday", [0, 3] → "Sunday and Wednesday", [] → "None" */
export function restDaysLabel(restDays: number[] | undefined): string {
  const names = WEEKDAYS.filter((day) => (restDays ?? []).includes(day.value)).map(
    (day) => day.label,
  )
  if (names.length === 0) return 'None'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
