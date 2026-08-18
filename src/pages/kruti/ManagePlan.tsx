import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import {
  archiveActivity,
  createActivity,
  restoreActivity,
  updateActivity,
  updatePlan,
  type ActivityDraft,
} from '@/api/plan'
import { keys, useActivePlan, useActivities, useProgressMutation } from '@/hooks/queries'
import { formatHour, toMinutes } from '@/lib/format'
import { restDaysLabel, WEEKDAYS } from '@/lib/restDays'
import { friendlyError } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'
import type { Activity } from '@/types/db'

const ICONS = ['🏊', '🏃', '⚡', '💪', '🧘', '🚴', '🤸', '🦵', '🩺', '💊', '🥗', '😴', '📿', '❤️']

const EMPTY: ActivityDraft = {
  name: '',
  icon: '💪',
  // Empty, not a guess: a new activity is photo-only until a target is typed in.
  target_seconds: null,
  is_required: true,
  requires_photo: true,
  requires_location: false,
  sort_order: 0,
}

export default function ManagePlan() {
  const plan = useActivePlan()
  const activities = useActivities(true)
  const client = useQueryClient()
  const { toast } = useToast()

  const [editing, setEditing] = useState<Activity | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<ActivityDraft>(EMPTY)
  const [planOpen, setPlanOpen] = useState(false)

  const save = useProgressMutation(async (args: { id?: string; draft: ActivityDraft }) => {
    if (args.id) return updateActivity(args.id, args.draft)
    if (!plan.data) throw new Error('No active plan')
    return createActivity(plan.data.id, args.draft)
  })
  const archive = useProgressMutation((id: string) => archiveActivity(id))
  const restore = useProgressMutation((id: string) => restoreActivity(id))
  const savePlan = useProgressMutation(
    (args: { id: string; patch: Parameters<typeof updatePlan>[1] }) =>
      updatePlan(args.id, args.patch),
  )

  function refresh() {
    void client.invalidateQueries({ queryKey: keys.activities(true) })
    void client.invalidateQueries({ queryKey: keys.activities(false) })
    void client.invalidateQueries({ queryKey: keys.plan })
  }

  function openCreate() {
    const nextOrder = (activities.data?.length ?? 0) + 1
    setDraft({ ...EMPTY, sort_order: nextOrder })
    setEditing(null)
    setCreating(true)
  }

  function openEdit(activity: Activity) {
    setDraft({
      name: activity.name,
      icon: activity.icon,
      target_seconds: activity.target_seconds,
      is_required: activity.is_required,
      requires_photo: activity.requires_photo,
      requires_location: activity.requires_location,
      sort_order: activity.sort_order,
    })
    setEditing(activity)
    setCreating(true)
  }

  if (plan.isLoading || activities.isLoading) return <Spinner />

  const active = (activities.data ?? []).filter((activity) => !activity.is_archived)
  const archived = (activities.data ?? []).filter((activity) => activity.is_archived)

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Manage plan</h1>
        <p className="text-sm text-ink-400">
          Everything here is yours to change — nothing is fixed in the app.
        </p>
      </header>

      {plan.data && (
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="card flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div>
            <p className="font-extrabold">{plan.data.name}</p>
            <p className="text-xs text-ink-400">
              Started {plan.data.start_date} · goal {plan.data.goal_days} days ·{' '}
              {plan.data.timezone}
            </p>
            <p className="text-xs text-ink-400">
              😴 Rest: {restDaysLabel(plan.data.rest_days)}
            </p>
            <p className="text-xs text-ink-400">
              🌙 A day runs {formatHour(plan.data.day_start_hour ?? 6)} →{' '}
              {formatHour(plan.data.day_start_hour ?? 6)}
            </p>
          </div>
          <Pencil size={16} className="text-ink-400" />
        </button>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-extrabold">Daily activities</h2>
          <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={openCreate}>
            <Plus size={16} /> Add
          </button>
        </div>

        {active.length === 0 ? (
          <EmptyState emoji="🌱" title="No activities yet" description="Add the first one." />
        ) : (
          active.map((activity) => (
            <div key={activity.id} className="card flex items-center gap-3 p-4">
              <span className="text-2xl">{activity.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{activity.name}</p>
                <p className="text-xs text-ink-400">
                  {activity.target_seconds === null
                    ? '📷 photo only'
                    : `${toMinutes(activity.target_seconds)} min`}{' '}
                  · {activity.is_required ? 'required' : 'optional'}
                  {activity.requires_photo && ' · 📷'}
                  {activity.requires_location && ' · 📍'}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-ink-400 hover:bg-blush-50"
                onClick={() => openEdit(activity)}
                aria-label={`Edit ${activity.name}`}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="rounded-full p-2 text-ink-400 hover:bg-blush-50"
                aria-label={`Archive ${activity.name}`}
                onClick={() => {
                  if (!window.confirm(`Remove ${activity.name} from the daily plan?`)) return
                  void archive
                    .mutateAsync(activity.id)
                    .then(() => {
                      refresh()
                      toast('Removed from the plan. History is kept.')
                    })
                    .catch((caught) => toast(friendlyError(caught), 'error'))
                }}
              >
                <Archive size={16} />
              </button>
            </div>
          ))
        )}
      </section>

      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-extrabold uppercase tracking-wide text-ink-400">
            Removed (history kept)
          </h2>
          {archived.map((activity) => (
            <div key={activity.id} className="card flex items-center gap-3 px-4 py-3 opacity-70">
              <span className="text-xl">{activity.icon}</span>
              <p className="flex-1 truncate text-sm font-bold">{activity.name}</p>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => {
                  void restore
                    .mutateAsync(activity.id)
                    .then(() => {
                      refresh()
                      toast('Back in the plan')
                    })
                    .catch((caught) => toast(friendlyError(caught), 'error'))
                }}
              >
                <ArchiveRestore size={14} /> Restore
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Activity editor */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={editing ? `Edit ${editing.name}` : 'New activity'}
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="activity-name">
              Name
            </label>
            <input
              id="activity-name"
              className="input"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Swimming"
            />
          </div>

          <div>
            <span className="label">Icon</span>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon })}
                  className={`h-11 w-11 rounded-2xl text-xl transition ${
                    draft.icon === icon ? 'bg-blush-500 shadow-lift' : 'bg-white'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="activity-target">
              Target minutes (optional)
            </label>
            <input
              id="activity-target"
              type="number"
              min={1}
              className="input"
              value={draft.target_seconds === null ? '' : Math.round(draft.target_seconds / 60)}
              onChange={(event) => {
                const raw = event.target.value.trim()
                // Cleared means untimed, and an untimed activity can only be
                // finished by its photo — so the photo requirement comes on.
                if (raw === '') {
                  setDraft({ ...draft, target_seconds: null, requires_photo: true })
                  return
                }
                setDraft({ ...draft, target_seconds: Math.max(1, Number(raw)) * 60 })
              }}
            />
            <p className="mt-1 text-xs text-ink-400">
              {draft.target_seconds === null ? (
                <>
                  <span className="font-bold text-ink-600">No target — photo only.</span> There is
                  no timer: he takes the photo and this activity is done.
                </>
              ) : (
                'Leave this empty for a photo-only activity — no timer, just the photo.'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Toggle
              label="Required for 100%"
              checked={draft.is_required}
              onChange={(value) => setDraft({ ...draft, is_required: value })}
            />
            <Toggle
              label="Photo proof required"
              checked={draft.requires_photo}
              // An untimed activity would have no way to be finished without it.
              disabled={draft.target_seconds === null}
              onChange={(value) => setDraft({ ...draft, requires_photo: value })}
            />
            <Toggle
              label="Ask for location at start"
              checked={draft.requires_location}
              onChange={(value) => setDraft({ ...draft, requires_location: value })}
            />
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={!draft.name.trim() || save.isPending}
            onClick={() => {
              void save
                .mutateAsync({ id: editing?.id, draft: { ...draft, name: draft.name.trim() } })
                .then(() => {
                  refresh()
                  setCreating(false)
                  toast(editing ? 'Activity updated' : 'Activity added ❤️')
                })
                .catch((caught) => toast(friendlyError(caught), 'error'))
            }}
          >
            {editing ? 'Save changes' : 'Add activity'}
          </button>
        </div>
      </Modal>

      {/* Plan editor */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="Journey settings">
        {plan.data && (
          <PlanForm
            initial={{
              name: plan.data.name,
              start_date: plan.data.start_date,
              goal_days: plan.data.goal_days,
              timezone: plan.data.timezone,
              // Both undefined until their migration has run, and neither the
              // picker nor the hour may crash meanwhile.
              day_start_hour: plan.data.day_start_hour ?? 6,
              rest_days: plan.data.rest_days ?? [],
            }}
            saving={savePlan.isPending}
            onSave={(patch) => {
              void savePlan
                .mutateAsync({ id: plan.data!.id, patch })
                .then(() => {
                  refresh()
                  setPlanOpen(false)
                  toast('Journey updated')
                })
                .catch((caught) => toast(friendlyError(caught), 'error'))
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label
      className={`flex items-center justify-between rounded-2xl bg-white px-4 py-3 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="text-sm font-bold">{label}</span>
      <input
        type="checkbox"
        className="h-5 w-5 accent-blush-500"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

/** Every hour a day could begin on. 6 is the plan's default. */
const DAY_START_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

type PlanPatch = {
  name: string
  start_date: string
  goal_days: number
  timezone: string
  day_start_hour: number
  rest_days: number[]
}

function PlanForm({
  initial,
  saving,
  onSave,
}: {
  initial: PlanPatch
  saving: boolean
  onSave: (patch: PlanPatch) => void
}) {
  const [form, setForm] = useState(initial)

  function toggleRestDay(value: number) {
    const next = form.rest_days.includes(value)
      ? form.rest_days.filter((day) => day !== value)
      : [...form.rest_days, value].sort((a, b) => a - b)
    // A week that is entirely rest has no journey left to measure — the
    // database rejects it, so the last working day cannot be given away here.
    if (next.length > 6) return
    setForm({ ...form, rest_days: next })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="plan-name">
          Journey name
        </label>
        <input
          id="plan-name"
          className="input"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="plan-start">
            Day 1
          </label>
          <input
            id="plan-start"
            type="date"
            className="input"
            value={form.start_date}
            onChange={(event) => setForm({ ...form, start_date: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-goal">
            Goal (days)
          </label>
          <input
            id="plan-goal"
            type="number"
            min={1}
            className="input"
            value={form.goal_days}
            onChange={(event) =>
              setForm({ ...form, goal_days: Math.max(1, Number(event.target.value)) })
            }
          />
        </div>
      </div>

      <div>
        <span className="label">Rest days</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const on = form.rest_days.includes(day.value)
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleRestDay(day.value)}
                className={`h-11 flex-1 rounded-2xl text-xs font-extrabold transition ${
                  on ? 'bg-blush-500 text-white shadow-lift' : 'bg-white text-ink-600'
                }`}
              >
                {day.short}
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-xs text-ink-400">
          {form.rest_days.length === 0
            ? 'No rest days — every day counts.'
            : `${restDaysLabel(form.rest_days)} never count against him. Nothing is owed, the streak
               carries over, and the average ignores them. If he trains anyway it still counts for
               him.`}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="plan-tz">
          Timezone
        </label>
        <input
          id="plan-tz"
          className="input"
          value={form.timezone}
          onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          placeholder="Asia/Kolkata"
        />
        <p className="mt-1 text-xs text-ink-400">
          This decides which clock a new day starts on. The server uses it, not the phone.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="plan-day-start">
          A day starts at
        </label>
        <select
          id="plan-day-start"
          className="input"
          value={form.day_start_hour}
          onChange={(event) =>
            setForm({ ...form, day_start_hour: Number(event.target.value) })
          }
        >
          {DAY_START_HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {formatHour(hour)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-400">
          {form.day_start_hour === 0
            ? 'Plain calendar days: anything after midnight belongs to the new day.'
            : `A day runs ${formatHour(form.day_start_hour)} to ${formatHour(
                form.day_start_hour,
              )}, so training he finishes late at night still counts for the day it
               followed. Nothing is backdated — the server still stamps every session
               as it happens.`}
        </p>
      </div>

      <p className="rounded-2xl bg-blush-50 px-3 py-2 text-xs text-ink-600">
        The goal is a target, not an ending. The journey keeps going past day {form.goal_days}.
      </p>

      <button
        type="button"
        className="btn-primary w-full"
        disabled={saving}
        onClick={() => onSave(form)}
      >
        Save
      </button>
    </div>
  )
}
