/**
 * Browser-side proof-photo compression.
 *
 * A 4 MB phone photo becomes roughly 100–300 KB *before* it ever leaves the
 * device. Cloudinary only ever receives the compressed file, and no
 * Cloudinary transformation is used for normal viewing.
 *
 * Rules this file honours:
 *   • never crop, never change composition — aspect ratio is preserved exactly
 *   • only reduce resolution when quality alone cannot reach the target
 *   • leave already-small images alone rather than degrading them twice
 *   • if the target is unreachable without making the proof unreadable,
 *     keep the quality and accept the larger file
 */

/**
 * What the file picker offers.
 *
 * HEIC is deliberately absent. iPhones shoot HEIC by default, but when the
 * accept list contains only these types iOS converts the photo to JPEG as it
 * hands it over — which is exactly what we want. Listing HEIC here would make
 * iOS pass the raw HEIC instead, which desktop browsers cannot decode.
 */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * What we will actually attempt to decode.
 *
 * Wider than the picker list on purpose: iOS still delivers HEIC by some
 * routes (the Files app, iCloud shared albums, some share sheets), and Safari
 * decodes HEIC natively — so we compress it rather than refusing a photo the
 * user can plainly see. Output is always WebP or JPEG regardless of input.
 */
const DECODABLE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]
const DECODABLE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i

function isHeic(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

/** Upper edge of the desired band. */
const TARGET_MAX_BYTES = 300 * 1024
/** Below this we stop trying to squeeze further. */
const TARGET_MIN_BYTES = 100 * 1024
/** Anything already this small is passed through untouched. */
const SKIP_BYTES = 260 * 1024
/** Long edge for a photo that still needs to read clearly on a phone. */
const MAX_EDGE = 1600
/** Never go below this long edge — readability wins over the byte target. */
const MIN_EDGE = 900

const MAX_QUALITY = 0.92
const MIN_QUALITY = 0.45
const QUALITY_STEPS = 6

export interface CompressedImage {
  /** The file to upload. May be the original when it was already small. */
  file: File
  width: number
  height: number
  originalBytes: number
  bytes: number
  /** True when the original was small enough to pass through as-is. */
  skipped: boolean
}

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedImageError'
  }
}

export function isAllowedImage(file: File): boolean {
  const type = file.type.toLowerCase()
  // iOS sometimes hands over a File with an empty MIME type; trust the name.
  if (!type) return DECODABLE_EXTENSIONS.test(file.name)
  return DECODABLE_TYPES.includes(type)
}

/** WebP encodes photos noticeably smaller; fall back to JPEG where it is missing. */
let webpSupport: boolean | null = null
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport
  try {
    const probe = document.createElement('canvas')
    probe.width = 1
    probe.height = 1
    webpSupport = probe.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupport = false
  }
  return webpSupport
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      type,
      quality,
    )
  })
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // `from-image` applies the EXIF rotation, so portrait photos stay portrait.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older Safari ignores the options bag — fall through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not read that photo'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawTo(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not process the photo')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/**
 * Compress a photo chosen by the user.
 *
 * @param file  the File straight out of an <input type="file">
 * @returns the compressed file plus what it cost, ready to upload
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (!isAllowedImage(file)) {
    throw new UnsupportedImageError('Please choose a JPG, PNG or WebP photo.')
  }

  const originalBytes = file.size

  let source: ImageBitmap | HTMLImageElement
  try {
    source = await decode(file)
  } catch (caught) {
    // Safari decodes HEIC; most other browsers do not. Say which it is.
    if (isHeic(file)) {
      throw new UnsupportedImageError(
        'This browser cannot read iPhone HEIC photos. Open the app in Safari, ' +
          'or save the photo as JPEG and try again.',
      )
    }
    throw caught
  }
  const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
  if (!naturalWidth || !naturalHeight) {
    throw new UnsupportedImageError('That photo could not be read.')
  }

  const longEdge = Math.max(naturalWidth, naturalHeight)

  // Already small and already sensibly sized: don't re-compress it.
  if (originalBytes <= SKIP_BYTES && longEdge <= MAX_EDGE) {
    if ('close' in source) source.close()
    return {
      file,
      width: naturalWidth,
      height: naturalHeight,
      originalBytes,
      bytes: originalBytes,
      skipped: true,
    }
  }

  const outputType = supportsWebp() ? 'image/webp' : 'image/jpeg'
  const extension = outputType === 'image/webp' ? 'webp' : 'jpg'

  // Aspect ratio is fixed for the whole search: we only ever scale, never crop.
  const ratio = naturalHeight / naturalWidth
  let targetLongEdge = Math.min(longEdge, MAX_EDGE)
  // A photo that is already smaller than the floor still gets one pass at its
  // own size, rather than falling through with nothing to upload.
  const floorEdge = Math.min(MIN_EDGE, targetLongEdge)

  let best: { blob: Blob; width: number; height: number } | null = null

  while (targetLongEdge >= floorEdge) {
    const width =
      naturalWidth >= naturalHeight ? targetLongEdge : Math.round(targetLongEdge / ratio)
    const height =
      naturalWidth >= naturalHeight ? Math.round(targetLongEdge * ratio) : targetLongEdge

    const canvas = drawTo(source, width, height)

    // Binary search for the highest quality that still fits the band.
    let low = MIN_QUALITY
    let high = MAX_QUALITY
    let fit: Blob | null = null
    let smallest: Blob | null = null

    for (let step = 0; step < QUALITY_STEPS; step++) {
      const quality = (low + high) / 2
      const blob = await canvasToBlob(canvas, outputType, quality)

      if (!smallest || blob.size < smallest.size) smallest = blob

      if (blob.size > TARGET_MAX_BYTES) {
        high = quality
      } else {
        fit = blob
        // Good enough: inside the band, no point spending more steps.
        if (blob.size >= TARGET_MIN_BYTES) break
        low = quality
      }
    }

    release(canvas)

    if (fit) {
      best = { blob: fit, width, height }
      break
    }

    // Even the lowest quality overshot — the photo is genuinely detailed.
    // Remember the smallest attempt in case we run out of room to scale.
    if (smallest && (!best || smallest.size < best.blob.size)) {
      best = { blob: smallest, width, height }
    }
    targetLongEdge = Math.round(targetLongEdge * 0.8)
  }

  if ('close' in source) source.close()

  if (!best) {
    throw new Error('The photo could not be compressed. Try another one.')
  }

  const name = file.name.replace(/\.[^.]+$/, '') || 'proof'
  const compressed = new File([best.blob], `${name}.${extension}`, {
    type: outputType,
    lastModified: Date.now(),
  })

  // If compression somehow made things worse (tiny, already-optimal source),
  // keep whichever file is smaller.
  if (compressed.size >= originalBytes) {
    return {
      file,
      width: naturalWidth,
      height: naturalHeight,
      originalBytes,
      bytes: originalBytes,
      skipped: true,
    }
  }

  return {
    file: compressed,
    width: best.width,
    height: best.height,
    originalBytes,
    bytes: compressed.size,
    skipped: false,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
