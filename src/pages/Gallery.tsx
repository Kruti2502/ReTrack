import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { subDays } from 'date-fns'
import { CalendarRange, ChevronDown, X } from 'lucide-react'
import { useActivities, useGallery, useHistory } from '@/hooks/queries'
import { formatDate, formatTime, toIsoDate } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { formatBytes } from '@/lib/compressImage'
import type { GalleryProof } from '@/api/proof'

/** Enough for several months on screen; older photos are reached by month. */
const PHOTO_LIMIT = 300

/**
 * How many activity filters to show before folding the rest away. The list keeps
 * every activity the plan ever had, archived ones included, so it only grows —
 * and a filter panel three rows deep pushes the photos themselves off screen.
 */
const FILTERS_SHOWN = 6

export default function Gallery() {
  const [activityId, setActivityId] = useState<string | null>(null)
  const [month, setMonth] = useState<string>('all')
  const [allFilters, setAllFilters] = useState(false)
  const activities = useActivities(true)

  const filters = useMemo(() => {
    if (month === 'all') return { activityId }
    return {
      activityId,
      from: `${month}-01`,
      to: format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0), 'yyyy-MM-dd'),
    }
  }, [activityId, month])

  const gallery = useGallery({ ...filters, limit: PHOTO_LIMIT })
  const [open, setOpen] = useState<GalleryProof | null>(null)

  // The month list comes from the day history rather than from the photos on
  // screen — otherwise picking a month would erase every other option.
  const yearRange = useMemo(() => {
    const today = new Date()
    return { from: toIsoDate(subDays(today, 400)), to: toIsoDate(today) }
  }, [])
  const history = useHistory(yearRange.from, yearRange.to)

  const grouped = useMemo(() => {
    const map = new Map<string, GalleryProof[]>()
    for (const proof of gallery.data ?? []) {
      const list = map.get(proof.local_date) ?? []
      list.push(proof)
      map.set(proof.local_date, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [gallery.data])

  const months = useMemo(() => {
    const set = new Set(
      (history.data ?? [])
        .filter((day) => day.photo_count > 0)
        .map((day) => day.date.slice(0, 7)),
    )
    return [...set].sort().reverse()
  }, [history.data])

  const activityList = activities.data ?? []

  // Folded down to one or two rows, but never hiding the filter that is on: a
  // chip she cannot see is a filter she cannot switch off.
  const shownActivities = useMemo(() => {
    if (allFilters || activityList.length <= FILTERS_SHOWN + 1) return activityList
    const head = activityList.slice(0, FILTERS_SHOWN)
    const chosen = activityList.find((activity) => activity.id === activityId)
    return chosen && !head.includes(chosen) ? [...head, chosen] : head
  }, [activityList, activityId, allFilters])

  const hidden = activityList.length - shownActivities.length
  const chosenActivity = activityList.find((activity) => activity.id === activityId) ?? null
  const isFiltered = activityId !== null || month !== 'all'
  const photoCount = gallery.data?.length ?? 0

  return (
    <div className="space-y-4">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Our journey 📷</h1>
        <p className="text-sm text-ink-400">Every proof photo, kept forever.</p>
      </header>

      {/*
        The filters wrap instead of scrolling sideways. The old rail put a
        scrollbar across the page and cut the last chip in half, which read as
        breakage rather than as "there is more" — and half the plan was hidden
        behind a swipe nobody took.
      */}
      <section className="rounded-card border border-white/70 bg-blush-50/70 p-2.5">
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={activityId === null} onClick={() => setActivityId(null)}>
            All
          </FilterPill>
          {shownActivities.map((activity) => (
            <FilterPill
              key={activity.id}
              active={activityId === activity.id}
              onClick={() => setActivityId(activity.id)}
            >
              <span aria-hidden>{activity.icon}</span>
              {activity.name}
            </FilterPill>
          ))}
          {hidden > 0 && (
            <FilterPill active={false} onClick={() => setAllFilters(true)}>
              +{hidden} more
            </FilterPill>
          )}
          {allFilters && activityList.length > FILTERS_SHOWN + 1 && (
            <FilterPill active={false} onClick={() => setAllFilters(false)}>
              Show fewer
            </FilterPill>
          )}
        </div>

        {(months.length > 1 || isFiltered) && (
          <div className="mt-2.5 flex items-center gap-2 border-t border-white pt-2.5">
            {months.length > 1 && (
              <label className="relative flex-1">
                <span className="sr-only">Filter by month</span>
                <CalendarRange
                  size={14}
                  aria-hidden
                  className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${
                    month === 'all' ? 'text-ink-400' : 'text-white'
                  }`}
                />
                {/* The popup list stays light whatever the closed pill looks like. */}
                <select
                  className={`w-full appearance-none rounded-full py-2 pl-8 pr-8 text-[13px]
                              font-bold outline-none transition focus:ring-4
                              focus:ring-blush-100/70 [&>option]:bg-white
                              [&>option]:text-ink-900 ${
                                month === 'all'
                                  ? 'border border-blush-100 bg-white text-ink-600'
                                  : 'border border-blush-500 bg-blush-500 text-white'
                              }`}
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                >
                  <option value="all">All dates</option>
                  {months.map((value) => (
                    <option key={value} value={value}>
                      {format(parseISO(`${value}-01`), 'MMMM yyyy')}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${
                    month === 'all' ? 'text-ink-400' : 'text-white'
                  }`}
                />
              </label>
            )}

            {isFiltered && (
              <button
                type="button"
                onClick={() => {
                  setActivityId(null)
                  setMonth('all')
                }}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2
                           text-[13px] font-bold text-blush-600 transition hover:bg-white"
              >
                <X size={14} aria-hidden /> Clear
              </button>
            )}
          </div>
        )}

        {!gallery.isLoading && !gallery.isError && (
          <p className="mt-2 px-1 text-center text-xs text-ink-400">
            {photoCount === 0
              ? 'No photos'
              : `${photoCount}${photoCount === PHOTO_LIMIT ? '+' : ''} photo${
                  photoCount === 1 ? '' : 's'
                }`}
            {chosenActivity ? ` · ${chosenActivity.name}` : ''}
            {month === 'all' ? '' : ` · ${format(parseISO(`${month}-01`), 'MMMM yyyy')}`}
          </p>
        )}
      </section>

      {gallery.isLoading && <Spinner />}
      {gallery.isError && (
        <ErrorState
          message={friendlyError(gallery.error)}
          onRetry={() => void gallery.refetch()}
        />
      )}

      {gallery.data?.length === 0 && (
        <EmptyState
          emoji="📷"
          title={isFiltered ? 'Nothing matches that' : 'No photos yet'}
          description={
            isFiltered
              ? 'No proof photos for this filter. Clear it to see everything again.'
              : 'Proof photos show up here the moment the first one is uploaded.'
          }
        />
      )}

      {gallery.data?.length === PHOTO_LIMIT && (
        <p className="px-2 text-center text-xs text-ink-400">
          Showing the most recent {PHOTO_LIMIT} photos. Pick a month to see further back —
          nothing is ever deleted.
        </p>
      )}

      {grouped.map(([date, proofs]) => (
        <section key={date} className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="font-extrabold">{formatDate(date)}</h2>
            <Link to={`/history/${date}`} className="text-xs font-bold text-blush-600">
              See the day
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {proofs.map((proof) => (
              <button
                key={proof.id}
                type="button"
                onClick={() => setOpen(proof)}
                className="relative aspect-square overflow-hidden rounded-2xl bg-blush-50"
              >
                <img
                  src={proof.cloudinary_secure_url}
                  alt={proof.activities?.name ?? 'Proof'}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 left-1 rounded-full bg-ink-900/50 px-1.5 text-xs">
                  {proof.activities?.icon ?? '📷'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} bare>
        {open && (
          <div>
            <img
              src={open.cloudinary_secure_url}
              alt="Proof"
              className="max-h-[70vh] w-full object-contain"
            />
            <div className="space-y-0.5 bg-cream p-4 safe-bottom">
              <p className="font-extrabold">
                {open.activities?.icon} {open.activities?.name}
              </p>
              <p className="text-sm text-ink-600">
                {formatDate(open.local_date)} · {formatTime(open.uploaded_at)}
              </p>
              <p className="text-xs text-ink-400">
                {formatBytes(open.bytes)}
                {open.width && open.height ? ` · ${open.width}×${open.height}` : ''}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * One filter. Chunky enough for a thumb, and the chosen one is the only filled
 * pill on the panel so what is on screen is never in question.
 */
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-bold
                  transition active:scale-[0.97] ${
                    active
                      ? 'bg-blush-500 text-white shadow-soft'
                      : 'border border-blush-100 bg-white text-ink-600 hover:bg-blush-50'
                  }`}
    >
      {children}
    </button>
  )
}
