import { useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { keys, useNotificationPrefs } from '@/hooks/queries'
import { saveNotificationPrefs } from '@/api/settings'
import { notificationPermission, requestNotificationPermission } from '@/lib/notifications'
import { friendlyError } from '@/lib/supabase'
import { useToast } from '@/context/ToastProvider'
import type { NotificationPreferences } from '@/types/db'

export function NotificationSettings() {
  const { profile } = useAuth()
  const prefs = useNotificationPrefs(profile?.id)
  const client = useQueryClient()
  const { toast } = useToast()

  const permission = notificationPermission()
  const current = prefs.data

  async function patch(next: Partial<NotificationPreferences>) {
    if (!profile) return
    try {
      await saveNotificationPrefs(profile.id, next)
      await client.invalidateQueries({ queryKey: keys.prefs(profile.id) })
    } catch (caught) {
      toast(friendlyError(caught), 'error')
    }
  }

  async function enable() {
    const result = await requestNotificationPermission()
    if (result === 'granted') {
      await patch({ enabled: true })
      toast('Reminders are on ❤️')
    } else if (result === 'unsupported') {
      await patch({ enabled: true })
      toast('This browser has no notifications — reminders will show inside the app.', 'love')
    } else {
      toast('The browser blocked notifications. You can allow them in site settings.', 'error')
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        {current?.enabled ? (
          <Bell size={20} className="mt-0.5 text-blush-500" />
        ) : (
          <BellOff size={20} className="mt-0.5 text-ink-400" />
        )}
        <div className="flex-1">
          <h2 className="font-extrabold">Reminders</h2>
          <p className="text-xs text-ink-400">
            Free browser reminders. No SMS, no WhatsApp, nothing paid.
          </p>
        </div>
      </div>

      {!current?.enabled ? (
        <button type="button" className="btn-primary w-full" onClick={() => void enable()}>
          <Bell size={18} /> Turn on reminders
        </button>
      ) : (
        <div className="space-y-2">
          <Row
            label="Activity reminders"
            checked={current.activity_reminders}
            onChange={(value) => void patch({ activity_reminders: value })}
          />
          <Row
            label="Daily summary"
            checked={current.daily_summary}
            onChange={(value) => void patch({ daily_summary: value })}
          />
          <Row
            label="Nudge when the day is unfinished"
            checked={current.nudge_when_incomplete}
            onChange={(value) => void patch({ nudge_when_incomplete: value })}
          />

          <label className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
            <span className="text-sm font-bold">Daily summary at</span>
            <input
              type="time"
              className="rounded-xl border border-blush-100 px-3 py-1.5 text-sm font-bold"
              value={current.daily_summary_time.slice(0, 5)}
              onChange={(event) => void patch({ daily_summary_time: event.target.value })}
            />
          </label>

          <button
            type="button"
            className="btn-ghost w-full text-sm"
            onClick={() => void patch({ enabled: false })}
          >
            <BellOff size={16} /> Turn reminders off
          </button>
        </div>
      )}

      {permission === 'denied' && (
        <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Notifications are blocked for this site. Allow them in your browser settings, or leave
          them off — the app will still show reminders on the home screen.
        </p>
      )}

      <p className="text-xs leading-relaxed text-ink-400">
        Reminders are scheduled by the app itself, so they arrive while it is open or recently
        used. Installing the app on the home screen makes them much more reliable.
      </p>
    </section>
  )
}

function Row({
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
