import { NavLink } from 'react-router-dom'
import {
  CalendarDays,
  Heart,
  Home,
  Images,
  ListChecks,
  Settings,
  Sparkles,
  User,
} from 'lucide-react'
import { useAuth } from '@/context/AuthProvider'
import { usePendingSubmissions } from '@/hooks/queries'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  badge?: number
}

export function BottomNav() {
  const { isKruti } = useAuth()
  const pending = usePendingSubmissions()

  const items: NavItem[] = isKruti
    ? [
        { to: '/kruti', label: 'Dashboard', icon: Home },
        {
          to: '/kruti/review',
          label: 'Review',
          icon: ListChecks,
          badge: pending.data?.length ?? 0,
        },
        { to: '/journey', label: 'Journey', icon: Sparkles },
        { to: '/photos', label: 'Photos', icon: Images },
        { to: '/kruti/settings', label: 'Settings', icon: Settings },
      ]
    : [
        { to: '/', label: 'Today', icon: Home },
        { to: '/journey', label: 'Journey', icon: Sparkles },
        { to: '/history', label: 'History', icon: CalendarDays },
        { to: '/photos', label: 'Photos', icon: Images },
        { to: '/profile', label: 'Profile', icon: User },
      ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-lg border-t border-white/70
                 bg-white/90 px-2 pt-1.5 backdrop-blur-md safe-bottom"
    >
      <ul className="flex items-stretch justify-between">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/' || item.to === '/kruti'}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[11px] font-bold
                 transition ${isActive ? 'text-blush-600' : 'text-ink-400'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <item.icon size={21} strokeWidth={isActive ? 2.6 : 2} />
                    {Boolean(item.badge) && (
                      <span
                        className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center
                                   rounded-full bg-blush-500 px-1 text-[10px] font-extrabold text-white"
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span>{item.label}</span>
                  {isActive && <Heart size={7} className="fill-blush-400 text-blush-400" />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
