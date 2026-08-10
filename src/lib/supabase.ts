import { createClient } from '@supabase/supabase-js'
import { env, missingEnv } from './env'

// createClient throws on an empty URL, and it runs the moment this module is
// imported — which would happen before the app can render the setup screen.
// When configuration is missing we hand it harmless placeholders; main.tsx
// renders <SetupNotice> instead of the app, so this client is never used.
const url = missingEnv.length > 0 ? 'http://localhost:54321' : env.supabaseUrl
const anonKey = missingEnv.length > 0 ? 'placeholder-anon-key' : env.supabaseAnonKey

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/**
 * Turns a Postgres error into something worth reading on a phone screen.
 * The RPCs raise human-written messages, so we surface those directly.
 */
export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong.'
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

  if (message.includes('Invalid login credentials')) {
    return 'That email or password does not look right.'
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'No connection right now. Try again in a moment.'
  }
  // Strip the Postgres noise but keep our own wording.
  return message.replace(/^.*?(?:ERROR|error):\s*/i, '').trim() || 'Something went wrong.'
}
