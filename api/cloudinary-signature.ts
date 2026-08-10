/**
 * Optional signed-upload endpoint (Vercel serverless function).
 *
 * Turn it on by setting VITE_CLOUDINARY_SIGNED_UPLOADS=true and adding the
 * server-only variables in Vercel:
 *
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET      <- never prefixed with VITE_, never in the browser
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *
 * The secret is used here and nowhere else. The caller must present a valid
 * Supabase access token, so this is not an open signing service.
 */

import { createHash } from 'node:crypto'

type Request = {
  method?: string
  body?: unknown
  headers: Record<string, string | string[] | undefined>
}

type Response = {
  status: (code: number) => Response
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

/** Cloudinary signs an alphabetically sorted `key=value&…` string. */
function signParams(params: Record<string, string>, secret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(`${toSign}${secret}`).digest('hex')
}

async function verifySupabaseUser(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) return false

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  return response.ok
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    res.status(500).json({ error: 'Cloudinary server credentials are not configured' })
    return
  }

  const authHeader = req.headers.authorization
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null
  if (!token || !(await verifySupabaseUser(token))) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    params?: Record<string, string>
  }

  // Only a small, known set of parameters is ever signed.
  const allowed = ['folder', 'tags', 'context', 'public_id'] as const
  const params: Record<string, string> = {
    timestamp: String(Math.floor(Date.now() / 1000)),
  }
  for (const key of allowed) {
    const value = body?.params?.[key]
    if (typeof value === 'string' && value.length > 0) params[key] = value
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    signature: signParams(params, apiSecret),
    timestamp: Number(params.timestamp),
    api_key: apiKey,
    cloud_name: cloudName,
  })
}
