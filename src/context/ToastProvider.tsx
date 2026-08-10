import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Heart, XCircle } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'love'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface ToastValue {
  toast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'bg-sage-500 text-white',
  error: 'bg-blush-600 text-white',
  love: 'bg-white text-ink-900 border border-blush-100',
}

const TONE_ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  love: Heart,
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId++
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 4000)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4 safe-top">
        {toasts.map((item) => {
          const Icon = TONE_ICONS[item.tone]
          return (
            <div
              key={item.id}
              className={`animate-fade-up flex w-full max-w-sm items-center gap-2 rounded-2xl px-4 py-3
                          text-sm font-bold shadow-lift ${TONE_STYLES[item.tone]}`}
            >
              <Icon size={18} className="shrink-0" />
              <span className="leading-snug">{item.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
