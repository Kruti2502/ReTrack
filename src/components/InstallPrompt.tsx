import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'retrack.install-dismissed'

/** A gentle one-time nudge to put the app on the home screen. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(() => localStorage.getItem(DISMISS_KEY) === 'true')

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!deferred || hidden) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setHidden(true)
  }

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 mx-auto w-full max-w-lg px-4">
      <div className="card flex items-center gap-3 px-4 py-3 shadow-lift">
        <span className="text-2xl">❤️</span>
        <div className="flex-1">
          <p className="text-sm font-extrabold leading-tight">Keep this on your home screen</p>
          <p className="text-xs text-ink-400">Opens like a normal app, full screen.</p>
        </div>
        <button
          type="button"
          className="btn-primary px-3 py-2 text-sm"
          onClick={async () => {
            await deferred.prompt()
            await deferred.userChoice
            setDeferred(null)
          }}
        >
          <Download size={16} /> Install
        </button>
        <button type="button" onClick={dismiss} aria-label="Not now" className="text-ink-400">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
