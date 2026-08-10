/**
 * Every environment variable the browser is allowed to see.
 *
 * Nothing secret belongs in here. The Cloudinary API secret and the Supabase
 * service-role key must never reach this file — see README → Security.
 */

const raw = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
  cloudinaryUploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
}

const NAMES: Record<keyof typeof raw, string> = {
  supabaseUrl: 'VITE_SUPABASE_URL',
  supabaseAnonKey: 'VITE_SUPABASE_ANON_KEY',
  cloudinaryCloudName: 'VITE_CLOUDINARY_CLOUD_NAME',
  cloudinaryUploadPreset: 'VITE_CLOUDINARY_UPLOAD_PRESET',
}

/** Anything still missing, so the app can explain itself instead of going blank. */
export const missingEnv: string[] = (Object.keys(raw) as Array<keyof typeof raw>)
  .filter((key) => !raw[key])
  .map((key) => NAMES[key])

/**
 * The Supabase dashboard shows several URLs on the same page. Copying the
 * "RESTful endpoint" (…supabase.co/rest/v1) instead of the "Project URL"
 * sends auth calls to /rest/v1/auth/v1/token, which PostgREST rejects with
 * PGRST125. Trim the known suffixes so either value works.
 */
function normaliseSupabaseUrl(value: string | undefined): string {
  if (!value) return ''
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+$/i, '')
}

export const env = {
  supabaseUrl: normaliseSupabaseUrl(raw.supabaseUrl),
  supabaseAnonKey: raw.supabaseAnonKey ?? '',
  cloudinaryCloudName: raw.cloudinaryCloudName ?? '',
  cloudinaryUploadPreset: raw.cloudinaryUploadPreset ?? '',
  /** Root folder for every upload, e.g. "our-90-days". */
  cloudinaryFolder: import.meta.env.VITE_CLOUDINARY_FOLDER ?? 'our-90-days',
  /**
   * Turn on to route uploads through /api/cloudinary-signature (Vercel function)
   * instead of using an unsigned preset. Requires the server-side secret to be
   * configured in Vercel — never in the browser.
   */
  useSignedUploads: import.meta.env.VITE_CLOUDINARY_SIGNED_UPLOADS === 'true',
}
