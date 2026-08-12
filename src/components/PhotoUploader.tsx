import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, MapPin, RotateCcw, Upload } from 'lucide-react'
import { prepareProof, uploadPreparedProof, type PreparedProof } from '@/api/proof'
import { ALLOWED_IMAGE_TYPES, formatBytes } from '@/lib/compressImage'
import type { Coordinates } from '@/lib/geolocation'
import { friendlyError } from '@/lib/supabase'
import { useToast } from '@/context/ToastProvider'
import { LocationGate } from './LocationGate'

type Stage = 'idle' | 'compressing' | 'ready' | 'uploading' | 'done'

interface PhotoUploaderProps {
  activityId: string
  activityName: string
  sessionId?: string | null
  localDate: string
  owner: string
  /**
   * An untimed activity Kruti asked to see a location for. There is no timer to
   * gate, so the point is taken here and saved with the photo.
   */
  needsLocation?: boolean
  onUploaded: () => void
}

/**
 * Shoot a photo with the camera → compress it on the device → look at it →
 * upload the compressed copy. Gallery picks are deliberately not offered: the
 * proof has to be taken there and then. The 4 MB original never touches the
 * network and is dropped from memory as soon as the compressed version exists.
 */
export function PhotoUploader({
  activityId,
  activityName,
  sessionId,
  localDate,
  owner,
  needsLocation = false,
  onUploaded,
}: PhotoUploaderProps) {
  const { toast } = useToast()
  const [stage, setStage] = useState<Stage>('idle')
  const [prepared, setPrepared] = useState<PreparedProof | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  // Read before the camera opens, so the point is where he took the photo.
  const [coords, setCoords] = useState<Coordinates | null>(null)

  const cameraInput = useRef<HTMLInputElement>(null)
  const awaitingLocation = needsLocation && coords === null

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  /** `keepLocation` is for a retake: same place, seconds later, no second ask. */
  function reset(keepLocation = false) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPrepared(null)
    setProgress(0)
    setError(null)
    setStage('idle')
    if (!keepLocation) setCoords(null)
    if (cameraInput.current) cameraInput.current.value = ''
  }

  function openCamera() {
    cameraInput.current?.click()
  }

  /**
   * The gate resolves only on a real fix. The camera is opened straight after
   * it, so one tap covers both — but finding a location takes seconds, and a
   * browser may have let go of the tap that started this by the time it lands.
   * If it refuses, the button below is already sitting there ready to shoot.
   */
  async function shareThenShoot(point: Coordinates) {
    setCoords(point)
    setGateOpen(false)
    toast('Location captured ❤️', 'love')
    window.setTimeout(openCamera, 0)
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setStage('compressing')
    try {
      const result = await prepareProof(file)
      setPrepared(result)
      setPreviewUrl(URL.createObjectURL(result.compressed.file))
      setStage('ready')
    } catch (caught) {
      setError(friendlyError(caught))
      setStage('idle')
    } finally {
      // Release the original immediately — we only keep the compressed copy.
      event.target.value = ''
    }
  }

  async function onUpload() {
    if (!prepared) return
    setStage('uploading')
    setProgress(0)
    try {
      await uploadPreparedProof({
        prepared,
        activityId,
        sessionId,
        localDate,
        owner,
        coords,
        onProgress: setProgress,
      })
      setStage('done')
      toast('Proof uploaded ❤️', 'success')
      onUploaded()
      // Wrapped: setTimeout would otherwise hand `reset` the timer id, which
      // would read as `keepLocation` and carry the point into the next photo.
      window.setTimeout(() => reset(), 1200)
    } catch (caught) {
      setError(friendlyError(caught))
      setStage('ready')
    }
  }

  const accept = ALLOWED_IMAGE_TYPES.join(',')

  return (
    <div className="card p-4">
      <h3 className="text-lg font-extrabold">Upload proof 📷</h3>
      <p className="mt-0.5 text-sm text-ink-400">
        {awaitingLocation
          ? 'Your location is read as the camera opens, then the photo is compressed on your phone.'
          : 'Snap it with your camera — it is compressed on your phone before it is uploaded.'}
      </p>

      <input
        ref={cameraInput}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      {stage === 'idle' && (
        <div className="mt-4">
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              if (awaitingLocation) {
                setGateOpen(true)
                return
              }
              openCamera()
            }}
          >
            {awaitingLocation ? <MapPin size={18} /> : <Camera size={18} />}
            {awaitingLocation ? 'Share location & take photo' : 'Take photo'}
          </button>

          {needsLocation && coords && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-sage-700">
              <MapPin size={12} /> Location captured — it goes to Kruti with the photo
            </p>
          )}
        </div>
      )}

      {stage === 'compressing' && (
        <div className="mt-5 flex items-center justify-center gap-2 py-6 text-ink-600">
          <Loader2 size={20} className="animate-spin" />
          <span className="font-bold">Compressing photo…</span>
        </div>
      )}

      {previewUrl && (stage === 'ready' || stage === 'uploading' || stage === 'done') && (
        <div className="mt-4 space-y-3">
          <img
            src={previewUrl}
            alt="Compressed proof preview"
            className="w-full rounded-2xl object-contain"
          />

          {prepared && (
            <p className="text-center text-xs text-ink-400">
              {prepared.compressed.skipped ? (
                <>Already small — kept as is · {formatBytes(prepared.compressed.bytes)}</>
              ) : (
                <>
                  {formatBytes(prepared.compressed.originalBytes)} →{' '}
                  <span className="font-extrabold text-sage-700">
                    {formatBytes(prepared.compressed.bytes)}
                  </span>{' '}
                  · {prepared.compressed.width}×{prepared.compressed.height}
                </>
              )}
            </p>
          )}

          {stage === 'uploading' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-center gap-2 text-ink-600">
                <Loader2 size={18} className="animate-spin" />
                <span className="font-bold">Uploading proof… {progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blush-100">
                <div
                  className="h-full rounded-full bg-blush-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {stage === 'done' && (
            <p className="flex items-center justify-center gap-1.5 font-extrabold text-sage-700">
              <Check size={18} /> Proof uploaded
            </p>
          )}

          {stage === 'ready' && (
            <div className="grid grid-cols-2 gap-3">
              {/* The point was taken at this spot moments ago — keep it. */}
              <button type="button" className="btn-secondary" onClick={() => reset(true)}>
                <RotateCcw size={16} /> Retake
              </button>
              <button type="button" className="btn-primary" onClick={() => void onUpload()}>
                <Upload size={16} /> Upload
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-2xl bg-blush-50 px-3 py-2 text-sm font-bold text-blush-700">
          {error}
        </p>
      )}

      <LocationGate
        open={gateOpen}
        activityName={activityName}
        intent="photo"
        onCancel={() => setGateOpen(false)}
        onShare={shareThenShoot}
      />
    </div>
  )
}
