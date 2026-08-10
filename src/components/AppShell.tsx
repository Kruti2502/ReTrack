import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { InstallPrompt } from './InstallPrompt'

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <main className="flex-1 px-4 pb-28 pt-4 safe-top">
        <Outlet />
      </main>
      <InstallPrompt />
      <BottomNav />
    </div>
  )
}
