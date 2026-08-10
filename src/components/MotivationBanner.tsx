import { useMemo } from 'react'
import { useMessages } from '@/hooks/queries'

/** Rotating encouragement, chosen for where the day currently stands. */
export function MotivationBanner({ percent, dayNumber }: { percent: number; dayNumber: number }) {
  const { data } = useMessages()

  const message = useMemo(() => {
    const pool = (data ?? []).filter(
      (item) => item.is_active && percent >= item.min_percent && percent <= item.max_percent,
    )
    if (pool.length === 0) return null
    // Rotates through the day without flickering on every re-render.
    const index = (dayNumber + new Date().getHours()) % pool.length
    return pool[index]
  }, [data, percent, dayNumber])

  if (!message) return null

  return (
    <p className="animate-fade-up px-2 text-center text-[15px] font-bold leading-snug text-ink-600">
      {message.text}
    </p>
  )
}
