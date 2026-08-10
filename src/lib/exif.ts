/**
 * A deliberately small EXIF reader.
 *
 * Re-encoding through a canvas strips EXIF, so we read the few informative
 * tags out of the ORIGINAL file before compressing and store them alongside
 * the proof.
 *
 * This is extra context only. EXIF is trivially editable, so it is never
 * treated as evidence — the server upload timestamp is what counts.
 */

export interface ExifSummary {
  taken_at?: string
  camera_make?: string
  camera_model?: string
  has_gps?: boolean
  orientation?: number
}

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_ORIENTATION = 0x0112
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME_ORIGINAL = 0x9003

export async function readExifSummary(file: File): Promise<ExifSummary | null> {
  if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null

  try {
    // The EXIF block lives near the start; 256 KB is far more than enough.
    const head = await file.slice(0, 256 * 1024).arrayBuffer()
    const view = new DataView(head)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null

    let offset = 2
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      const size = view.getUint16(offset + 2)
      if (marker === 0xe1) {
        const app1 = offset + 4
        // "Exif\0\0"
        if (view.getUint32(app1) !== 0x45786966) return null
        return parseTiff(view, app1 + 6)
      }
      if (marker === 0xda) break // start of scan — no EXIF ahead
      offset += 2 + size
    }
  } catch {
    // EXIF is a nice-to-have; never let it block an upload.
  }
  return null
}

function parseTiff(view: DataView, tiffStart: number): ExifSummary | null {
  if (tiffStart + 8 > view.byteLength) return null

  const byteOrder = view.getUint16(tiffStart)
  const little = byteOrder === 0x4949
  if (!little && byteOrder !== 0x4d4d) return null
  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null

  const summary: ExifSummary = {}
  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little)
  const pointers = readIfd(view, tiffStart, ifd0, little, summary)

  if (pointers.exif) readIfd(view, tiffStart, tiffStart + pointers.exif, little, summary)
  if (pointers.gps) summary.has_gps = true

  return Object.keys(summary).length ? summary : null
}

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdStart: number,
  little: boolean,
  out: ExifSummary,
): { exif?: number; gps?: number } {
  const pointers: { exif?: number; gps?: number } = {}
  if (ifdStart + 2 > view.byteLength) return pointers

  const count = view.getUint16(ifdStart, little)
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12
    if (entry + 12 > view.byteLength) break

    const tag = view.getUint16(entry, little)
    const type = view.getUint16(entry + 2, little)
    const length = view.getUint32(entry + 4, little)

    switch (tag) {
      case TAG_ORIENTATION:
        out.orientation = view.getUint16(entry + 8, little)
        break
      case TAG_EXIF_IFD:
        pointers.exif = view.getUint32(entry + 8, little)
        break
      case TAG_GPS_IFD:
        pointers.gps = view.getUint32(entry + 8, little)
        break
      case TAG_MAKE:
      case TAG_MODEL:
      case TAG_DATETIME_ORIGINAL: {
        if (type !== 2) break
        const value = readAscii(view, tiffStart, entry, length, little)
        if (!value) break
        if (tag === TAG_MAKE) out.camera_make = value
        else if (tag === TAG_MODEL) out.camera_model = value
        else out.taken_at = value
        break
      }
      default:
        break
    }
  }
  return pointers
}

function readAscii(
  view: DataView,
  tiffStart: number,
  entry: number,
  length: number,
  little: boolean,
): string | null {
  // Values longer than 4 bytes are stored out of line, behind an offset.
  const start = length <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little)
  if (start + length > view.byteLength) return null

  let text = ''
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(start + i)
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return text.trim() || null
}
