import { useState } from 'react'
import { addDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useDay } from '@/hooks/queries'
import { deriveStatus } from '@/lib/activityStatus'
import { formatDate, formatDaysAgo, toIsoDate } from '@/lib/format'
import { ReviewCard } from './ReviewCard'

interface ApprovedOnDateProps {
  /** The server's today, so the picker never reaches into the future. */
  today: string
}

/**
 * Everything Kruti has already approved, for whichever day she picks. It starts
 * on today and walks backwards, so the notes on a card she answered last week
 * are one tap away instead of being lost the moment the day rolls over.
 *
 * Today is the only bound. A floor at the plan's start date looks tidy but locks
 * the field to a single day whenever the plan began today, which is exactly how
 * a fresh plan is seeded — a day before the plan simply comes back empty.
 */
export function ApprovedOnDate({ today }: ApprovedOnDateProps) {
  const [date, setDate] = useState(today)

  // Today is asked for as `null` so this reuses the bundle the page already
  // has, instead of opening a second query for the same day.
  const day = useDay(date === today ? null : date)
  const approved = (day.data?.activities ?? []).filter(
    (activity) => deriveStatus(activity) === 'approved',
  )

  const shift = (days: number) => setDate(toIsoDate(addDays(parseISO(date), days)))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-lg font-extrabold">Approved ✅</h2>
        <span className="chip bg-sage-100 text-sage-700">
          {approved.length} approved
        </span>
      </div>

      <div className="card flex items-center gap-2 p-2">
        <button
          type="button"
          aria-label="Previous day"
          className="btn-ghost shrink-0 px-2 py-2"
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="date"
          aria-label="Show approvals from"
          className="input flex-1 py-2 text-center"
          value={date}
          max={today}
          onChange={(event) => {
            const picked = event.target.value
            // An emptied or out-of-range field would ask the server for nothing.
            if (!picked || picked > today) return
            setDate(picked)
          }}
        />
        <button
          type="button"
          aria-label="Next day"
          className="btn-ghost shrink-0 px-2 py-2"
          disabled={date >= today}
          onClick={() => shift(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <p className="px-1 text-xs font-bold text-ink-400">
        {formatDaysAgo(date, today)} · {formatDate(date)}
      </p>

      {day.isLoading ? (
        <p className="flex items-center gap-2 px-1 text-xs text-ink-400">
          <Loader2 size={13} className="animate-spin" /> Loading that day…
        </p>
      ) : approved.length === 0 ? (
        <p className="card px-4 py-5 text-center text-sm text-ink-400">
          Nothing approved on this day.
        </p>
      ) : (
        approved.map((activity) => <ReviewCard key={activity.id} activity={activity} />)
      )}
    </section>
  )
}
