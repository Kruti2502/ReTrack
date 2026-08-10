/**
 * Cloudinary upload — proof photos only.
 *
 * The browser only ever sees the cloud name and the upload preset. The API
 * secret lives on the server (see api/cloudinary-signature.ts) and is only
 * involved when VITE_CLOUDINARY_SIGNED_UPLOADS is turned on.
 *
 * The file handed to `uploadProofPhoto` has already been compressed by
 * src/lib/compressImage.ts — the original never leaves the device.
 */

import { env } from './env'
import { supabase } from './supabase'

export interface CloudinaryUploadResult {
  public_id: string
  secure_url: string
  width: number
  height: number
  format: string
  bytes: number
}

export interface UploadOptions {
  /** Server-provided date (YYYY-MM-DD) — the device clock is not used. */
  localDate: string
  activityId: string
  sessionId?: string | null
  /** Folder segment for the person, e.g. "dharmik". */
  owner: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

/** our-90-days/dharmik/2026/08/09 */
export function buildFolder(owner: string, localDate: string): string {
  const [year, month, day] = localDate.split('-')
  const safeOwner = owner.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'user'
  return `${env.cloudinaryFolder}/${safeOwner}/${year}/${month}/${day}`
}

interface SignaturePayload {
  signature: string
  timestamp: number
  api_key: string
  cloud_name: string
}

async function fetchSignature(params: Record<string, string>): Promise<SignaturePayload> {
  // The endpoint only signs for a signed-in user, so send the access token.
  const { data } = await supabase.auth.getSession()
  const response = await fetch('/api/cloudinary-signature', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ params }),
  })
  if (!response.ok) {
    throw new Error('Could not authorise the upload. Please try again.')
  }
  return (await response.json()) as SignaturePayload
}

function postForm(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CloudinaryUploadResult)
        } catch {
          reject(new Error('Cloudinary sent back something unexpected.'))
        }
        return
      }
      let detail = ''
      try {
        detail = JSON.parse(xhr.responseText)?.error?.message ?? ''
      } catch {
        /* keep the generic message */
      }
      reject(new Error(detail || `Upload failed (${xhr.status}). Check the upload preset.`))
    }

    xhr.onerror = () => reject(new Error('The upload could not reach Cloudinary.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

export async function uploadProofPhoto(
  file: File,
  options: UploadOptions,
): Promise<CloudinaryUploadResult> {
  const folder = buildFolder(options.owner, options.localDate)
  const context = `activity_id=${options.activityId}|session_id=${options.sessionId ?? ''}|local_date=${options.localDate}`
  const tags = ['proof', options.localDate].join(',')

  const url = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`
  const form = new FormData()
  form.append('file', file)
  form.append('folder', folder)
  form.append('tags', tags)
  form.append('context', context)

  if (env.useSignedUploads) {
    // Cloudinary signs the exact parameter set, so it must match what we send.
    const signed = await fetchSignature({ folder, tags, context })
    form.append('api_key', signed.api_key)
    form.append('timestamp', String(signed.timestamp))
    form.append('signature', signed.signature)
  } else {
    form.append('upload_preset', env.cloudinaryUploadPreset)
  }

  return postForm(url, form, options.onProgress, options.signal)
}
