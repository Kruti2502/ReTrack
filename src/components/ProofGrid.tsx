import { useState } from 'react'
import { MapPin, Trash2 } from 'lucide-react'
import type { ActivityProof } from '@/types/db'
import { Modal } from './ui/Modal'
import { SessionLocation } from './SessionLocation'
import { formatBytes } from '@/lib/compressImage'
import { formatTimestamp } from '@/lib/format'

interface ProofGridProps {
  proofs: ActivityProof[]
  onDelete?: (proof: ActivityProof) => void
  columns?: 2 | 3
}

/**
 * Proof photos are displayed exactly as stored — no Cloudinary transformation
 * on view, because the file was already made small before it was uploaded.
 */
export function ProofGrid({ proofs, onDelete, columns = 3 }: ProofGridProps) {
  const [open, setOpen] = useState<ActivityProof | null>(null)

  if (proofs.length === 0) return null

  return (
    <>
      <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {proofs.map((proof) => (
          <button
            key={proof.id}
            type="button"
            onClick={() => setOpen(proof)}
            className="relative aspect-square overflow-hidden rounded-2xl bg-blush-50"
          >
            <img
              src={proof.cloudinary_secure_url}
              alt="Proof"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} bare>
        {open && (
          <div>
            <img
              src={open.cloudinary_secure_url}
              alt="Proof"
              className="max-h-[70vh] w-full object-contain"
            />
            <div className="space-y-1 bg-cream p-4 safe-bottom">
              <p className="text-sm font-extrabold">Proof uploaded</p>
              <p className="text-sm text-ink-600">{formatTimestamp(open.uploaded_at)}</p>
              <p className="text-xs text-ink-400">
                {formatBytes(open.bytes)}
                {open.width && open.height ? ` · ${open.width}×${open.height}` : ''}
                {open.original_bytes ? ` · from ${formatBytes(open.original_bytes)}` : ''}
              </p>
              {/* Where he was, for an activity Kruti asked to see a location for. */}
              {open.location_captured_at && (
                <p className="pt-1 text-xs">
                  <SessionLocation session={open} />
                </p>
              )}

              {open.exif?.taken_at ? (
                <p className="text-xs text-ink-400">
                  <MapPin size={11} className="mr-1 inline" />
                  Camera says: {String(open.exif.taken_at)} (extra info only)
                </p>
              ) : null}

              {onDelete && (
                <button
                  type="button"
                  className="btn-ghost mt-2 text-sm text-blush-600"
                  onClick={() => {
                    if (!window.confirm('Remove this photo?')) return
                    onDelete(open)
                    setOpen(null)
                  }}
                >
                  <Trash2 size={14} /> Remove photo
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
