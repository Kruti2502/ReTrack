import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthProvider'
import { Spinner } from './ui/Feedback'
import type { Role } from '@/types/db'

/**
 * Route guards keep the wrong screen from rendering. They are not the security
 * boundary — Row Level Security and the SECURITY DEFINER functions are. Even
 * if someone forced their way to /kruti/review, every approval call would be
 * refused by the database.
 */
export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="One moment…" />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />

  if (!profile) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="text-4xl">🔒</span>
        <h1 className="text-xl font-extrabold">This account is not set up</h1>
        <p className="text-sm text-ink-400">
          Only Kruti and Dharmik can use this app. Ask for a profile to be created in Supabase.
        </p>
      </div>
    )
  }

  return <Outlet />
}

export function RequireRole({ role }: { role: Role }) {
  const { profile, loading } = useAuth()

  if (loading) return <Spinner />
  if (profile?.role !== role) {
    return <Navigate to={profile?.role === 'KRUTI' ? '/kruti' : '/'} replace />
  }
  return <Outlet />
}

/** Sends each person to the home screen that belongs to them. */
export function RoleHome() {
  const { profile } = useAuth()
  return <Navigate to={profile?.role === 'KRUTI' ? '/kruti' : '/'} replace />
}
