import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, endOfMonth, format, isFuture, startOfMonth, subMonths } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useHistory } from '@/hooks/queries'
import { formatDate, formatDuration, toIsoDate } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { ProgressBar } from '@/components/ui/ProgressRing'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'

export default function History() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const range = useMemo(
    () => ({ from: toIsoDate(startOfMonth(month)), to: toIsoDate(endOfMonth(month)) }),
    [month],
  )
  const history = useHistory(range.from, range.to)

  const atCurrentMonth = format(month, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  return (
    <div className="space-y-4">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">History</h1>
        <p className="text-sm text-ink-400">Nothing here is ever deleted.</p>
      </header>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn-ghost px-3 py-2"
          onClick={() => setMonth(subMonths(month, 1))}
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="font-extrabold">{format(month, 'MMMM yyyy')}</p>
        <button
          type="button"
          className="btn-ghost px-3 py-2 disabled:opacity-30"
          disabled={atCurrentMonth || isFuture(addMonths(month, 1))}
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {history.isLoading && <Spinner />}
      {history.isError && (
        <ErrorState
          message={friendlyError(history.error)}
          onRetry={() => void history.refetch()}
        />
      )}

      {history.data?.length === 0 && (
        <EmptyState
          emoji="📅"
          title="Nothing recorded this month"
          description="Days appear here as soon as the first timer starts."
        />
      )}

      <div className="space-y-2">
        {(history.data ?? []).map((day) => {
          const percent = Math.round(Number(day.percent))
          return (
            <Link
              key={day.date}
              to={`/history/${day.date}`}
              className="card block animate-fade-up p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-extrabold">{formatDate(day.date)}</p>
                <p className="text-lg font-extrabold">{percent}%</p>
              </div>

              <div className="mt-2">
                <ProgressBar percent={percent} tone={day.is_day_approved ? 'sage' : 'blush'} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <span>Day {day.day_number}</span>
                <span>· {formatDuration(day.total_active_seconds)}</span>
                {day.photo_count > 0 && <span>· 📷 {day.photo_count}</span>}
                {day.is_day_approved ? (
                  <span className="chip bg-sage-100 text-sage-700">❤️ Approved</span>
                ) : (
                  <span className="chip bg-blush-50 text-ink-600">Incomplete</span>
                )}
              </div>

              {day.message && (
                <p className="mt-2 truncate text-sm italic text-ink-600">"{day.message}"</p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
