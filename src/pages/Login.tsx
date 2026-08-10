import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Heart, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { friendlyError } from '@/lib/supabase'

export default function Login() {
  const { session, signIn, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session && !loading) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-blush-500 shadow-lift">
          <Heart size={30} className="fill-white text-white" />
        </div>
        <h1 className="text-3xl font-extrabold leading-tight">ReTrack</h1>
        <p className="mt-1 text-sm text-ink-400">One day at a time. One step at a time.</p>
      </div>

      <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="rounded-2xl bg-blush-50 px-4 py-2.5 text-sm font-bold text-blush-700">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Heart size={18} />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-ink-400">
        This app is just for Kruti and Dharmik. There is no sign-up.
      </p>
    </div>
  )
}
