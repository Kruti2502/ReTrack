import { Link } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import type { DayActivity } from '@/types/db'

/**
 * The fallback for when browser notifications are off or unsupported: the
 * reminder simply waits inside the app instead.
 */
export function ReminderBanner({
  overdue,
  notificationsOff,
}: {
  overdue: DayActivity[]
  notificationsOff: boolean
}) {
  if (overdue.length === 0) return null

  const first = overdue[0]

  return (
    <div className="card animate-fade-up flex items-center gap-3 border-blush-200 bg-blush-50/80 px-4 py-3">
      <BellRing size={20} className="shrink-0 text-blush-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold leading-tight">
          {overdue.length === 1
            ? `${first.icon} ${first.name} is waiting for you`
            : `${overdue.length} activities are waiting for you`}
        </p>
        {notificationsOff && (
          <Link to="/profile" className="text-xs font-bold text-blush-600 underline">
            Turn on reminders
          </Link>
        )}
      </div>
      <Link to={`/activity/${first.id}`} className="btn-primary shrink-0 px-4 py-2 text-sm">
        Start
      </Link>
    </div>
  )
}
