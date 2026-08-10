import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { subDays } from 'date-fns'
import { useActivities, useGallery, useHistory } from '@/hooks/queries'
import { formatDate, formatTime, toIsoDate } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { formatBytes } from '@/lib/compressImage'
import type { GalleryProof } from '@/api/proof'

/** Enough for several months on screen; older photos are reached by month. */
const PHOTO_LIMIT = 300

export default function Gallery() {
  const [activityId, setActivityId] = useState<string | null>(null)
  const [month, setMonth] = useState<string>('all')
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

  return (
    <div className="space-y-4">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Our journey 📷</h1>
        <p className="text-sm text-ink-400">Every proof photo, kept forever.</p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActivityId(null)}
          className={`chip shrink-0 px-3 py-2 ${
            activityId === null ? 'bg-blush-500 text-white' : 'bg-white text-ink-600'
          }`}
        >
          All
        </button>
        {(activities.data ?? []).map((activity) => (
          <button
            key={activity.id}
            type="button"
            onClick={() => setActivityId(activity.id)}
            className={`chip shrink-0 px-3 py-2 ${
              activityId === activity.id ? 'bg-blush-500 text-white' : 'bg-white text-ink-600'
            }`}
          >
            {activity.icon} {activity.name}
          </button>
        ))}
      </div>

      {months.length > 1 && (
        <select
          className="input"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          aria-label="Filter by month"
        >
          <option value="all">All dates</option>
          {months.map((value) => (
            <option key={value} value={value}>
              {format(parseISO(`${value}-01`), 'MMMM yyyy')}
            </option>
          ))}
        </select>
      )}

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
          title="No photos yet"
          description="Proof photos show up here the moment the first one is uploaded."
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
