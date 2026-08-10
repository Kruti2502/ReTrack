import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Photos look better edge to edge. */
  bare?: boolean
}

export function Modal({ open, onClose, title, children, bare = false }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-up relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-card
                    sm:max-w-lg sm:rounded-card ${
                      bare ? 'bg-ink-900' : 'bg-cream p-5 safe-bottom'
                    }`}
      >
        {!bare && (
          <div className="mb-4 flex items-start justify-between gap-3">
            {title && <h2 className="text-xl font-extrabold leading-tight">{title}</h2>}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-ink-400 hover:bg-blush-50"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        )}
        {bare && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full bg-ink-900/60 p-2 text-white"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
