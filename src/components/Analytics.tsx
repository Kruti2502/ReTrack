import { useMemo } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HistoryDay } from '@/types/db'
import { formatDuration, toIsoDate } from '@/lib/format'
import { isRestDate } from '@/lib/restDays'
import { StatTile } from './ui/Feedback'

const BLUSH = '#e8747c'
const SAGE = '#7aab86'
const GRID = '#fde8e6'

type ChartDay = ReturnType<typeof fillRange>[number]

/** Days without a record simply mean nothing happened — they chart as 0. */
function fillRange(days: HistoryDay[], count: number, restDays: number[]) {
  const byDate = new Map(days.map((day) => [day.date, day]))
  const today = new Date()

  return Array.from({ length: count }, (_, index) => {
    const date = toIsoDate(subDays(today, count - 1 - index))
    const record = byDate.get(date)
    return {
      date,
      label: format(parseISO(date), count > 7 ? 'd' : 'EEEEE'),
      percent: record ? Math.round(Number(record.percent)) : 0,
      minutes: record ? Math.round(record.total_active_seconds / 60) : 0,
      approved: record?.is_day_approved ?? false,
      // A day with no record still has a weekday, so the plan decides.
      rest: record?.is_rest_day ?? isRestDate(date, restDays),
    }
  })
}

/**
 * A rest day is only left out while it is empty — training on one still counts
 * for him. The same rule the server applies to the lifetime average.
 */
function scored(data: ChartDay[]): ChartDay[] {
  return data.filter((day) => !day.rest || day.percent > 0)
}

function averagePercent(data: ChartDay[]): number {
  const counted = scored(data)
  if (counted.length === 0) return 0
  return Math.round(counted.reduce((sum, day) => sum + day.percent, 0) / counted.length)
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { date: string; percent: number; minutes: number; rest: boolean } }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-xs shadow-lift">
      <p className="font-extrabold">{format(parseISO(point.date), 'MMM d')}</p>
      {point.rest && point.percent === 0 ? (
        <p className="text-ink-400">😴 Rest day</p>
      ) : (
        <>
          <p className="text-ink-600">
            {point.percent}% complete{point.rest && ' · bonus'}
          </p>
          <p className="text-ink-400">{point.minutes} minutes</p>
        </>
      )}
    </div>
  )
}

/**
 * An empty rest day and an empty missed day both draw a zero-height bar, so
 * without this they look identical. The weekday label carries the difference.
 */
function WeekdayTick({
  data,
  x,
  y,
  payload,
}: {
  data: ChartDay[]
  x?: number
  y?: number
  payload?: { value: string; index: number }
}) {
  const day = payload ? data[payload.index] : undefined
  const resting = day?.rest && day.percent === 0
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      fontSize={11}
      fill={resting ? '#b9aca3' : '#8b8078'}
    >
      {resting ? '😴' : payload?.value}
    </text>
  )
}

export function WeeklyChart({ days, restDays }: { days: HistoryDay[]; restDays: number[] }) {
  const data = useMemo(() => fillRange(days, 7, restDays), [days, restDays])
  const average = averagePercent(data)
  const minutes = data.reduce((sum, day) => sum + day.minutes, 0)
  const hasRest = data.some((day) => day.rest && day.percent === 0)

  return (
    <div className="space-y-2">
      <div className="card p-4">
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={<WeekdayTick data={data} />}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#8b8078' }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(232,116,124,0.08)' }} />
            <Bar dataKey="percent" radius={[8, 8, 4, 4]} maxBarSize={30}>
              {data.map((day) => (
                <Cell key={day.date} fill={day.approved ? SAGE : BLUSH} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          emoji="📊"
          label="Average"
          value={`${average}%`}
          hint={hasRest ? 'rest days excluded' : 'last 7 days'}
        />
        <StatTile emoji="⏱️" label="Total time" value={formatDuration(minutes * 60)} />
      </div>
    </div>
  )
}

export function MonthlySummary({
  days,
  restDays,
  longestStreak,
}: {
  days: HistoryDay[]
  restDays: number[]
  longestStreak: number
}) {
  const data = useMemo(() => fillRange(days, 30, restDays), [days, restDays])
  const average = averagePercent(data)
  const approved = data.filter((day) => day.approved).length
  // A rest day spent resting was never a day he owed, so it is not a miss.
  const missed = scored(data).filter((day) => day.percent === 0).length
  const rested = data.filter((day) => day.rest && day.percent === 0).length
  const minutes = data.reduce((sum, day) => sum + day.minutes, 0)

  return (
    <div className="space-y-2">
      <div className="card p-4">
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={4}
              tick={{ fontSize: 10, fill: '#8b8078' }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#8b8078' }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="percent"
              stroke={BLUSH}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile emoji="📊" label="Average" value={`${average}%`} />
        <StatTile emoji="❤️" label="Approved" value={approved} hint="days" />
        <StatTile emoji="🌧️" label="Missed" value={missed} hint="working days with nothing" />
        <StatTile emoji="🔥" label="Longest streak" value={longestStreak} hint="days" />
        {rested > 0 && (
          <div className="col-span-2">
            <StatTile emoji="😴" label="Rest days" value={rested} hint="not counted either way" />
          </div>
        )}
        <div className="col-span-2">
          <StatTile emoji="⏱️" label="Total time" value={formatDuration(minutes * 60)} />
        </div>
      </div>
    </div>
  )
}
