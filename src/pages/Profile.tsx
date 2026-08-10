import { useState } from 'react'
import { Heart, LogOut, Save } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { useJourney } from '@/hooks/queries'
import { updateProfile } from '@/api/settings'
import { formatDuration } from '@/lib/format'
import { friendlyError } from '@/lib/supabase'
import { NotificationSettings } from '@/components/NotificationSettings'
import { StatTile } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'

const EMOJIS = ['💪', '🏊', '🏃', '❤️', '🌱', '⭐', '🔥', '🐣']

export default function Profile() {
  const { profile, signOut, refreshProfile } = useAuth()
  const journey = useJourney()
  const { toast } = useToast()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [emoji, setEmoji] = useState(profile?.emoji ?? '💪')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!profile) return
    setSaving(true)
    try {
      await updateProfile(profile.id, { display_name: name.trim(), emoji })
      await refreshProfile()
      toast('Saved ❤️')
    } catch (caught) {
      toast(friendlyError(caught), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <header className="pt-1 text-center">
        <span className="text-5xl">{emoji}</span>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight">
          {profile?.display_name ?? 'You'}
        </h1>
        <p className="text-sm text-ink-400">Day {journey.data?.day_number ?? 1} of the journey</p>
      </header>

      {journey.data && (
        <section className="grid grid-cols-2 gap-2">
          <StatTile emoji="🔥" label="Streak" value={`${journey.data.current_streak} days`} />
          <StatTile emoji="❤️" label="Approved" value={journey.data.approved_days} />
          <StatTile emoji="📊" label="Average" value={`${journey.data.average_completion}%`} />
          <StatTile
            emoji="⏱️"
            label="Total time"
            value={formatDuration(journey.data.total_active_seconds)}
          />
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-extrabold">Your name</h2>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dharmik"
        />

        <div>
          <span className="label">Your emoji</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setEmoji(option)}
                className={`h-11 w-11 rounded-2xl text-xl transition ${
                  emoji === option ? 'bg-blush-500 shadow-lift' : 'bg-white'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          disabled={saving || !name.trim()}
          onClick={() => void save()}
        >
          <Save size={18} /> Save
        </button>
      </section>

      <NotificationSettings />

      <p className="px-4 text-center text-sm font-bold leading-relaxed text-ink-400">
        One day at a time. One step at a time. <Heart size={13} className="inline fill-blush-400 text-blush-400" />
      </p>

      <button type="button" className="btn-secondary w-full" onClick={() => void signOut()}>
        <LogOut size={18} /> Sign out
      </button>
    </div>
  )
}
