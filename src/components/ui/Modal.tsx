import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Photos look better edge to edge. */
  bare?: boolean
  /**
   * Float in the middle of the screen instead of rising as a sheet from the
   * bottom edge. For panels that must not sit near the chrome at either end.
   */
  center?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  bare = false,
  center = false,
}: ModalProps) {
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

  /*
   * Portalled to the body on purpose: `.card` carries a backdrop-blur, and a
   * backdrop-filter makes its element the containing block for fixed children.
   * Rendered in place, a modal opened from inside a card would be pinned to
   * that card instead of the viewport — panel off-centre, backdrop too small.
   */
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center ${
        center ? 'items-center p-4' : 'items-end sm:items-center'
      }`}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-up relative z-10 max-h-[92vh] w-full overflow-y-auto sm:max-w-lg
                    ${center ? 'rounded-card' : 'rounded-t-card sm:rounded-card'} ${
                      bare ? 'bg-ink-900' : `bg-cream p-5 ${center ? '' : 'safe-bottom'}`
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
    </div>,
    document.body,
  )
}
