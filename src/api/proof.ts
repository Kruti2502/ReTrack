import { supabase } from '@/lib/supabase'
import { uploadProofPhoto } from '@/lib/cloudinary'
import { compressImage, type CompressedImage } from '@/lib/compressImage'
import { readExifSummary, type ExifSummary } from '@/lib/exif'
import type { Coordinates } from '@/lib/geolocation'
import type { ActivityProof } from '@/types/db'

export interface PreparedProof {
  compressed: CompressedImage
  exif: ExifSummary | null
  originalFilename: string
}

/**
 * Step one of the proof pipeline: everything that happens on the device.
 * The caller shows the result to the user before anything is uploaded.
 */
export async function prepareProof(file: File): Promise<PreparedProof> {
  // Read EXIF from the original first — re-encoding through a canvas drops it.
  const exif = await readExifSummary(file)
  const compressed = await compressImage(file)
  return { compressed, exif, originalFilename: file.name }
}

export interface UploadPreparedArgs {
  prepared: PreparedProof
  activityId: string
  sessionId?: string | null
  localDate: string
  owner: string
  /**
   * Only for an untimed activity that Kruti asked to see a location for. A
   * timed one captured its point when the timer opened, so it sends nothing.
   */
  coords?: Coordinates | null
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

/**
 * Step two: upload the COMPRESSED file only, then record the Cloudinary
 * reference in Supabase where the upload time is stamped by the server.
 * The original file never leaves the device.
 */
export async function uploadPreparedProof(args: UploadPreparedArgs): Promise<ActivityProof> {
  const { compressed, exif, originalFilename } = args.prepared

  const uploaded = await uploadProofPhoto(compressed.file, {
    localDate: args.localDate,
    activityId: args.activityId,
    sessionId: args.sessionId,
    owner: args.owner,
    onProgress: args.onProgress,
    signal: args.signal,
  })

  const { data, error } = await supabase.rpc('record_activity_proof', {
    p_activity_id: args.activityId,
    p_public_id: uploaded.public_id,
    p_secure_url: uploaded.secure_url,
    p_bytes: uploaded.bytes,
    p_session_id: args.sessionId ?? null,
    p_width: uploaded.width,
    p_height: uploaded.height,
    p_format: uploaded.format,
    p_original_filename: originalFilename,
    p_original_bytes: compressed.originalBytes,
    p_exif: exif,
    p_lat: args.coords?.lat ?? null,
    p_lng: args.coords?.lng ?? null,
    p_accuracy: args.coords?.accuracy ?? null,
  })
  if (error) throw error

  return data as ActivityProof
}

export async function deleteProof(proofId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_activity_proof', { p_proof_id: proofId })
  if (error) throw error
}

export interface GalleryFilters {
  activityId?: string | null
  from?: string | null
  to?: string | null
  limit?: number
}

export interface GalleryProof extends ActivityProof {
  activities: { id: string; name: string; icon: string } | null
}

/** Reads go straight through RLS — no RPC needed. */
export async function fetchGallery(filters: GalleryFilters = {}): Promise<GalleryProof[]> {
  let query = supabase
    .from('activity_proofs')
    .select('*, activities(id, name, icon)')
    .order('uploaded_at', { ascending: false })
    .limit(filters.limit ?? 200)

  if (filters.activityId) query = query.eq('activity_id', filters.activityId)
  if (filters.from) query = query.gte('local_date', filters.from)
  if (filters.to) query = query.lte('local_date', filters.to)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as GalleryProof[]
}
