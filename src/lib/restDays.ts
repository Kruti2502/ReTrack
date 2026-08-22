import { getDay, parseISO } from 'date-fns'

/**
 * Rest days are stored as Postgres weekday numbers (0 = Sunday … 6 = Saturday),
 * which is the same numbering `date-fns` uses, so a date can be tested against
 * the plan without any conversion. An activity's skip days — the weekdays it
 * sits out — are stored the same way, so the labels below read any weekday list.
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
  return weekdayNames(restDays, (day) => day.label)
}

/**
 * The same list said as a standing rule rather than as dates:
 * [6] → "Saturdays", [0, 6] → "Sundays and Saturdays".
 */
export function weekdayNamesPlural(days: number[] | undefined): string {
  return weekdayNames(days, (day) => `${day.label}s`)
}

/** [6] → "Sat", [0, 6] → "Sun, Sat" — for a chip, where there is no room. */
export function weekdayShortNames(days: number[] | undefined): string {
  const names = WEEKDAYS.filter((day) => (days ?? []).includes(day.value)).map(
    (day) => day.short,
  )
  return names.length === 0 ? 'None' : names.join(', ')
}

/** Always in week order, whatever order the numbers arrived in. */
function weekdayNames(
  days: number[] | undefined,
  name: (day: (typeof WEEKDAYS)[number]) => string,
): string {
  const names = WEEKDAYS.filter((day) => (days ?? []).includes(day.value)).map(name)
  if (names.length === 0) return 'None'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
