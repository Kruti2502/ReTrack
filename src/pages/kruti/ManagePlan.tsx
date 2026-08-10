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
import { formatClockTime, toMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'
import type { Activity } from '@/types/db'

const ICONS = ['🏊', '🏃', '⚡', '💪', '🧘', '🚴', '🤸', '🦵', '🩺', '💊', '🥗', '😴', '📿', '❤️']

const EMPTY: ActivityDraft = {
  name: '',
  icon: '💪',
  target_seconds: 30 * 60,
  weight: 1,
  is_required: true,
  requires_photo: true,
  requires_location: false,
  reminder_time: null,
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
      weight: Number(activity.weight),
      is_required: activity.is_required,
      requires_photo: activity.requires_photo,
      requires_location: activity.requires_location,
      reminder_time: activity.reminder_time,
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
                  {toMinutes(activity.target_seconds)} min · weight {Number(activity.weight)} ·{' '}
                  {activity.is_required ? 'required' : 'optional'}
                  {activity.requires_photo && ' · 📷'}
                  {activity.requires_location && ' · 📍'}
                  {activity.reminder_time && ` · ⏰ ${formatClockTime(activity.reminder_time)}`}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="activity-target">
                Target (minutes)
              </label>
              <input
                id="activity-target"
                type="number"
                min={1}
                className="input"
                value={Math.round(draft.target_seconds / 60)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    target_seconds: Math.max(1, Number(event.target.value)) * 60,
                  })
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="activity-weight">
                Weight
              </label>
              <input
                id="activity-weight"
                type="number"
                min={0.5}
                step={0.5}
                className="input"
                value={draft.weight}
                onChange={(event) =>
                  setDraft({ ...draft, weight: Math.max(0.5, Number(event.target.value)) })
                }
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-ink-400">
            Weight decides how much this activity counts toward the daily percentage.
          </p>

          <div>
            <label className="label" htmlFor="activity-reminder">
              Reminder time (optional)
            </label>
            <input
              id="activity-reminder"
              type="time"
              className="input"
              value={draft.reminder_time?.slice(0, 5) ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, reminder_time: event.target.value || null })
              }
            />
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
            initial={plan.data}
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
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl bg-white px-4 py-3">
      <span className="text-sm font-bold">{label}</span>
      <input
        type="checkbox"
        className="h-5 w-5 accent-blush-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function PlanForm({
  initial,
  saving,
  onSave,
}: {
  initial: { name: string; start_date: string; goal_days: number; timezone: string }
  saving: boolean
  onSave: (patch: {
    name: string
    start_date: string
    goal_days: number
    timezone: string
  }) => void
}) {
  const [form, setForm] = useState(initial)

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
          This decides when a new day starts. The server uses it, not the phone.
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
