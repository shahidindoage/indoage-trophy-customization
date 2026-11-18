/**
 * Dropbox upload helper.
 * Uploads files to a Dropbox App Folder and returns shareable direct image links.
 *
 * Auth (preferred order):
 *  1. DROPBOX_REFRESH_TOKEN + DROPBOX_API_KEY + DROPBOX_API_SECRET
 *     -> tokens refreshed automatically, never expires. Get one with:
 *        npm run dropbox:auth
 *  2. DROPBOX_ACCESS_TOKEN (short-lived, legacy fallback)
 *
 * Flow:
 *  1. base64 data URL -> Buffer
 *  2. filesUpload to /customizations/<timestamp>_<name>
 *  3. Permanent shared link (?raw=1) if `sharing.write` is granted,
 *     otherwise a ~4h temporary direct link.
 */

import { Dropbox } from 'dropbox'

const dbx = () => {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN
  const appKey = process.env.DROPBOX_API_KEY
  const appSecret = process.env.DROPBOX_API_SECRET

  if (refreshToken && appKey && appSecret) {
    return new Dropbox({ refreshToken, clientId: appKey, clientSecret: appSecret })
  }

  return new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN || '' })
}

function hasCredentials(): boolean {
  const hasRefresh = Boolean(
    process.env.DROPBOX_REFRESH_TOKEN &&
      process.env.DROPBOX_API_KEY &&
      process.env.DROPBOX_API_SECRET,
  )
  return hasRefresh || Boolean(process.env.DROPBOX_ACCESS_TOKEN)
}

function safeName(s: string): string {
  return (s || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface UploadedFile {
  name: string
  path: string
  shareUrl: string // direct image URL
  size: number
}

/**
 * Get a URL that renders the image inline.
 * Tries a permanent shared link first, then falls back to a temporary link.
 */
async function resolveViewUrl(client: Dropbox, path: string): Promise<string> {
  try {
    const sharedRes = await client.sharingCreateSharedLinkWithSettings({
      path,
      settings: { requested_visibility: { '.tag': 'public' } },
    })
    return sharedRes.result.url.replace(/dl=0$/, 'raw=1').replace(/dl=1$/, 'raw=1')
  } catch {
    // Either the scope is missing or a link already exists — try listing.
    try {
      const links = await client.sharingListSharedLinks({ path, direct_only: false })
      const existing = links.result.links[0]
      if (existing) {
        return existing.url.replace(/dl=0$/, 'raw=1').replace(/dl=1$/, 'raw=1')
      }
    } catch {
      // sharing.read also unavailable — fall through to temp link
    }

    const temp = await client.filesGetTemporaryLink({ path })
    return temp.result.link
  }
}

/**
 * Upload a base64 data URL to Dropbox.
 * @param dataUrl e.g. "data:image/png;base64,iVBORw0K..."
 * @param filename desired file name (without extension)
 */
export async function uploadDataUrl(
  dataUrl: string,
  filename: string,
): Promise<UploadedFile> {
  if (!hasCredentials()) {
    throw new Error(
      'Dropbox not configured: set DROPBOX_REFRESH_TOKEN + DROPBOX_API_KEY + DROPBOX_API_SECRET (run `npm run dropbox:auth`), or DROPBOX_ACCESS_TOKEN',
    )
  }

  // Parse data URL
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/)
  if (!match) throw new Error('Invalid data URL')
  const mime = match[1]
  const base64 = match[2]
  const buf = Buffer.from(base64, 'base64')

  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  const ts = Date.now()
  const path = `/customizations/${ts}_${safeName(filename)}.${ext}`

  const client = dbx()

  // 1. Upload
  const uploadRes = await client.filesUpload({
    path,
    contents: buf,
    mode: { '.tag': 'overwrite' },
    mute: true,
  })

  // 2. Create a viewable link.
  //    Preferred: permanent shared link (needs `sharing.write`).
  //    Fallback: temporary direct link (needs only `files.content.read`),
  //    valid ~4 hours — fine because the email is sent immediately.
  const viewUrl = await resolveViewUrl(client, path)

  return {
    name: filename,
    path: uploadRes.result.path_lower || path,
    shareUrl: viewUrl,
    size: buf.length,
  }
}
