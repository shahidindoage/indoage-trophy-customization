/**
 * One-time helper: exchange a Dropbox OAuth code for a long-lived refresh token.
 *
 * Usage:
 *   1. Add DROPBOX_API_KEY and DROPBOX_API_SECRET to .env
 *   2. In the Dropbox app console (https://www.dropbox.com/developers/apps),
 *      open the "OAuth 2" section -> Redirect URIs and add exactly:
 *          http://localhost:53682/callback
 *   3. Run:
 *          npm run dropbox:auth
 *   4. Approve access in the browser that opens.
 *   5. The refresh token is printed and written to .env automatically.
 *
 * Requires Node 20.6+ (uses --env-file).
 */

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { exec } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const ENV_PATH = resolve(process.cwd(), '.env')

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

const APP_KEY = process.env.DROPBOX_API_KEY || (await ask('Dropbox App Key: '))
const APP_SECRET = process.env.DROPBOX_API_SECRET || (await ask('Dropbox App Secret: '))

if (!APP_KEY || !APP_SECRET) {
  console.error('\n! DROPBOX_API_KEY / DROPBOX_API_SECRET missing.\n')
  console.error('  Add them to .env, then run again:  npm run dropbox:auth\n')
  process.exit(1)
}

if (!process.env.DROPBOX_API_KEY) upsertEnv('DROPBOX_API_KEY', APP_KEY)
if (!process.env.DROPBOX_API_SECRET) upsertEnv('DROPBOX_API_SECRET', APP_SECRET)

const state = randomBytes(16).toString('hex')

const authorizeUrl =
  'https://www.dropbox.com/oauth2/authorize?' +
  new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    token_access_type: 'offline',
    redirect_uri: REDIRECT_URI,
    state,
  }).toString()

function upsertEnv(key, value) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(text)) {
    text = text.replace(re, line)
  } else {
    if (text.length && !text.endsWith('\n')) text += '\n'
    text += line + '\n'
  }
  writeFileSync(ENV_PATH, text, 'utf8')
}

function send(res, code, title, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8">
    <body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">
    <h2>${title}</h2>${body}</body>`)
}

async function exchange(code) {
  const basic = Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64')
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `HTTP ${res.status}`)
  }
  return json
}

async function whoAmI(refreshToken) {
  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: APP_KEY,
      client_secret: APP_SECRET,
    }).toString(),
  })
  const tokenJson = await tokenRes.json()
  if (!tokenRes.ok) {
    throw new Error(tokenJson.error_description || tokenJson.error || 'refresh failed')
  }
  const meRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  const me = await meRes.json()
  return me?.name?.display_name || me?.email || 'unknown'
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found')
    return
  }

  const err = url.searchParams.get('error')
  if (err) {
    send(res, 400, 'Authorization denied',
      `<p>Dropbox returned: <code>${err}</code></p><p>You can close this tab.</p>`)
    console.error(`\n! Authorization denied: ${err}\n`)
    setTimeout(() => process.exit(1), 300)
    return
  }

  if (url.searchParams.get('state') !== state) {
    send(res, 400, 'State mismatch', '<p>Aborting for safety. You can close this tab.</p>')
    console.error('\n! OAuth state mismatch — aborting\n')
    setTimeout(() => process.exit(1), 300)
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    send(res, 400, 'Missing code', '<p>Dropbox did not return a code.</p>')
    setTimeout(() => process.exit(1), 300)
    return
  }

  try {
    const tokens = await exchange(code)
    const refreshToken = tokens.refresh_token
    if (!refreshToken) {
      throw new Error('No refresh_token returned — make sure token_access_type=offline')
    }
    const name = await whoAmI(refreshToken)

    upsertEnv('DROPBOX_REFRESH_TOKEN', refreshToken)
    upsertEnv('DROPBOX_ACCESS_TOKEN', '')

    console.log('\n  ✓ Refresh token obtained and saved to .env')
    console.log(`  ✓ Account: ${name}`)
    console.log(`\n  DROPBOX_REFRESH_TOKEN=${refreshToken}\n`)
    console.log('  This token does not expire. Restart the dev server to pick it up.\n')

    send(res, 200, 'Dropbox connected',
      `<p>Account: <strong>${name}</strong></p>
       <p>Refresh token saved to <code>.env</code>. You can close this tab and return to the terminal.</p>`)
    setTimeout(() => process.exit(0), 500)
  } catch (e) {
    console.error(`\n! Token exchange failed: ${e.message}\n`)
    send(res, 500, 'Token exchange failed', `<pre>${e.message}</pre>`)
    setTimeout(() => process.exit(1), 500)
  }
})

server.listen(PORT, () => {
  console.log('\n  Dropbox long-lived token setup')
  console.log('  ----------------------------------------')
  console.log(`  Redirect URI (must be registered in the app console):\n    ${REDIRECT_URI}`)
  console.log('\n  Opening browser... if it does not open, visit:\n')
  console.log(`  ${authorizeUrl}\n`)
  console.log('  Waiting for authorization...\n')

  const cmd =
    process.platform === 'win32'
      ? `start "" "${authorizeUrl}"`
      : process.platform === 'darwin'
        ? `open "${authorizeUrl}"`
        : `xdg-open "${authorizeUrl}"`
  exec(cmd, () => {})
})

setTimeout(() => {
  console.error('\n! Timed out after 5 minutes. Run the script again.\n')
  process.exit(1)
}, 5 * 60 * 1000).unref?.()
