import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, Plus, Settings2, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { keys, useMessages } from '@/hooks/queries'
import { createMessage, deleteMessage, updateMessage } from '@/api/settings'
import { friendlyError } from '@/lib/supabase'
import { NotificationSettings } from '@/components/NotificationSettings'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/context/ToastProvider'

export default function KrutiSettings() {
  const { profile, signOut } = useAuth()
  const messages = useMessages()
  const client = useQueryClient()
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [range, setRange] = useState<[number, number]>([0, 100])

  function refresh() {
    void client.invalidateQueries({ queryKey: keys.messages })
  }

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-2xl font-extrabold leading-tight">Settings</h1>
        <p className="text-sm text-ink-400">
          Signed in as {profile?.display_name} {profile?.emoji}
        </p>
      </header>

      <Link to="/kruti/plan" className="card flex items-center gap-3 px-4 py-3">
        <Settings2 size={20} className="text-blush-500" />
        <div className="flex-1">
          <p className="font-extrabold">Manage the daily plan</p>
          <p className="text-xs text-ink-400">Activities, targets, reminders, weights</p>
        </div>
      </Link>

      <NotificationSettings />

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-extrabold">Motivational messages</h2>
            <p className="text-xs text-ink-400">Shown to Dharmik based on where the day is.</p>
          </div>
          <button
            type="button"
            className="btn-primary px-3 py-2 text-sm"
            onClick={() => {
              setText('')
              setRange([0, 100])
              setOpen(true)
            }}
          >
            <Plus size={16} />
          </button>
        </div>

        {messages.isLoading ? (
          <Spinner />
        ) : (
          <ul className="mt-3 space-y-2">
            {(messages.data ?? []).map((message) => (
              <li
                key={message.id}
                className={`flex items-start gap-2 rounded-2xl bg-white px-3 py-2.5 ${
                  message.is_active ? '' : 'opacity-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-snug">{message.text}</p>
                  <p className="text-[11px] text-ink-400">
                    Shows between {message.min_percent}% and {message.max_percent}%
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-blush-500"
                  checked={message.is_active}
                  aria-label="Active"
                  onChange={(event) => {
                    void updateMessage(message.id, { is_active: event.target.checked })
                      .then(refresh)
                      .catch((caught) => toast(friendlyError(caught), 'error'))
                  }}
                />
                <button
                  type="button"
                  className="rounded-full p-1 text-ink-400 hover:bg-blush-50"
                  aria-label="Delete message"
                  onClick={() => {
                    if (!window.confirm('Delete this message?')) return
                    void deleteMessage(message.id)
                      .then(refresh)
                      .catch((caught) => toast(friendlyError(caught), 'error'))
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="btn-secondary w-full" onClick={() => void signOut()}>
        <LogOut size={18} /> Sign out
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="New message">
        <textarea
          className="input min-h-24 resize-none"
          placeholder="You're doing better than you think."
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="min-percent">
              From %
            </label>
            <input
              id="min-percent"
              type="number"
              min={0}
              max={100}
              className="input"
              value={range[0]}
              onChange={(event) => setRange([Number(event.target.value), range[1]])}
            />
          </div>
          <div>
            <label className="label" htmlFor="max-percent">
              To %
            </label>
            <input
              id="max-percent"
              type="number"
              min={0}
              max={100}
              className="input"
              value={range[1]}
              onChange={(event) => setRange([range[0], Number(event.target.value)])}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={!text.trim() || range[0] > range[1]}
          onClick={() => {
            void createMessage({
              text: text.trim(),
              min_percent: range[0],
              max_percent: range[1],
            })
              .then(() => {
                refresh()
                setOpen(false)
                toast('Message added ❤️')
              })
              .catch((caught) => toast(friendlyError(caught), 'error'))
          }}
        >
          Add message
        </button>
      </Modal>
    </div>
  )
}
