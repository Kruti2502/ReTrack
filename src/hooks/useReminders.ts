import { useEffect } from 'react'
import { useAuth } from '@/context/AuthProvider'
import { useDay, useNotificationPrefs } from './queries'
import { alreadyFired, markFired, notify, timeToDate } from '@/lib/notifications'
import { deriveStatus } from '@/lib/activityStatus'
import { roundPercent } from '@/lib/format'
import type { DayBundle } from '@/types/db'

interface PlannedReminder {
  id: string
  at: Date
  title: string
  body: string
}

function buildReminders(
  day: DayBundle,
  options: { activityReminders: boolean; dailySummary: boolean; summaryTime: string; nudge: boolean },
): PlannedReminder[] {
  const planned: PlannedReminder[] = []
  const date = day.date

  // Nothing is due on a rest day, so nothing is chased. A finished rest day is
  // still worth celebrating, which the summary below handles.
  if (options.activityReminders && !day.is_rest_day) {
    for (const activity of day.activities) {
      if (!activity.reminder_time) continue
      const status = deriveStatus(activity)
      if (status === 'approved' || status === 'waiting') continue

      planned.push({
        id: `${date}|activity|${activity.id}`,
        at: timeToDate(date, activity.reminder_time),
        title: `${activity.icon} ${activity.name} reminder ❤️`,
        body: `${Math.round(activity.target_seconds / 60)} minutes. You've got this.`,
      })
    }
  }

  if (options.dailySummary) {
    const remaining = day.activities.filter(
      (activity) => activity.is_required && deriveStatus(activity) !== 'approved',
    ).length
    const percent = roundPercent(day.progress.percent)
    const complete = percent >= 100

    // On an unfinished day the summary is a nudge, so it is skipped for anyone
    // who asked not to be nudged.
    if (complete || (options.nudge && !day.is_rest_day)) {
      planned.push({
        id: `${date}|summary`,
        at: timeToDate(date, options.summaryTime),
        title: complete ? 'Today is complete ❤️' : `You're at ${percent}%`,
        body: complete
          ? 'Everything done. Kruti just needs to approve it.'
          : remaining === 1
            ? 'Just one task left. Finish strong.'
            : `${remaining} tasks remaining. One step at a time. ❤️`,
      })
    }
  }

  return planned
}

/**
 * Schedules today's reminders while the app is alive. Nothing is scheduled on
 * a server, so this is best-effort by design — cheap, private, and enough for
 * two people who keep the app installed.
 */
export function useReminders() {
  const { profile } = useAuth()
  const prefs = useNotificationPrefs(profile?.id)
  // Signed out, there is nothing to remind anyone about — and no session to ask with.
  const day = useDay(null, { enabled: Boolean(profile) })

  useEffect(() => {
    if (!profile || !prefs.data?.enabled || !day.data) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

    const planned = buildReminders(day.data, {
      // Only Dharmik gets nudged about his own activities.
      activityReminders: profile.role === 'DHARMIK' && prefs.data.activity_reminders,
      dailySummary: prefs.data.daily_summary,
      summaryTime: prefs.data.daily_summary_time,
      nudge: prefs.data.nudge_when_incomplete,
    })

    const timers: number[] = []
    const now = Date.now()

    for (const reminder of planned) {
      if (alreadyFired(reminder.id)) continue
      const delay = reminder.at.getTime() - now
      // Skip anything more than a day out, and anything long past.
      if (delay < -60_000 || delay > 24 * 60 * 60 * 1000) continue

      timers.push(
        window.setTimeout(
          () => {
            void notify(reminder.title, reminder.body, reminder.id)
            markFired(reminder.id)
          },
          Math.max(0, delay),
        ),
      )
    }

    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [profile, prefs.data, day.data])
}

/**
 * The in-app fallback: which reminders are already overdue right now.
 * Used when notifications are unavailable or switched off.
 */
export function useOverdueReminders(day: DayBundle | undefined) {
  // A rest day has no deadlines, so nothing on it can be late.
  if (!day || day.is_rest_day) return []

  const now = new Date()
  return day.activities.filter((activity) => {
    if (!activity.reminder_time) return false
    const status = deriveStatus(activity)
    if (status === 'approved' || status === 'waiting') return false
    return timeToDate(day.date, activity.reminder_time) <= now
  })
}
