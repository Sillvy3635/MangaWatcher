import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export class AuthError extends Error {
  constructor(message, status = 401) { super(message); this.status = status }
}

export function authConfig(env = process.env) {
  const origin = env.MW_SITE_ORIGIN, clientId = env.MW_GITHUB_CLIENT_ID, clientSecret = env.MW_GITHUB_CLIENT_SECRET
  const sessionSecret = env.MW_SESSION_SECRET, allowedId = Number(env.MW_ALLOWED_GITHUB_ID)
  let parsed, frontend = null
  try { parsed = new URL(origin) } catch { throw new AuthError('ยังไม่ตั้งค่า site origin', 503) }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || !clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !Number.isSafeInteger(allowedId) || allowedId < 1) throw new AuthError('ยังไม่ตั้งค่า GitHub OAuth', 503)
  if (env.MW_FRONTEND_ORIGIN) {
    let frontendUrl
    try { frontendUrl = new URL(env.MW_FRONTEND_ORIGIN) } catch { throw new AuthError('frontend origin ไม่ถูกต้อง', 503) }
    const basePath = env.MW_FRONTEND_BASE_PATH || '/MangaWatcher/'
    if (frontendUrl.protocol !== 'https:' || frontendUrl.origin !== env.MW_FRONTEND_ORIGIN || frontendUrl.origin === origin || !/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(basePath) || basePath.includes('..')) throw new AuthError('frontend origin หรือ base path ไม่ถูกต้อง', 503)
    frontend = { origin: frontendUrl.origin, basePath, url: frontendUrl.origin + basePath }
  }
  return { origin, clientId, clientSecret, sessionSecret, allowedId, redirectUri: `${origin}/api/auth/callback`, frontend }
}

function seal(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}
function unseal(raw, secret) {
  if (!raw || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return null
  const [body, mac] = raw.split('.')
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
}
function cookie(request, name) {
  const raw = request.headers.get('cookie') || ''
  return raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || null
}
const secureCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
const random = () => randomBytes(32).toString('base64url')
const sameOrigin = (request, config) => new URL(request.url).origin === config.origin

export function startLogin(request, config) {
  if (!sameOrigin(request, config)) throw new AuthError('origin ไม่ถูกต้อง', 403)
  const state = random(), verifier = random()
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const pending = seal({ state, verifier, exp: Date.now() + 10 * 60_000 }, config.sessionSecret)
  const target = new URL('https://github.com/login/oauth/authorize')
  target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'read:user', state, code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'false' }).toString()
  return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': secureCookie('__Host-mw_oauth', pending, 600), 'Cache-Control': 'no-store' } })
}

export async function finishLogin(request, config, fetcher = fetch) {
  if (!sameOrigin(request, config)) throw new AuthError('origin ไม่ถูกต้อง', 403)
  const query = new URL(request.url).searchParams
  const pending = unseal(cookie(request, '__Host-mw_oauth'), config.sessionSecret)
  if (!pending || pending.exp < Date.now() || !query.get('state') || query.get('state') !== pending.state || !query.get('code') || query.get('error')) throw new AuthError('การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง', 400)
  const exchange = await fetcher('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MangaWatcher-cloud' }, body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code: query.get('code'), redirect_uri: config.redirectUri, code_verifier: pending.verifier }) })
  if (!exchange.ok) throw new AuthError('GitHub ไม่ยืนยันการเข้าสู่ระบบ', 502)
  const token = await exchange.json()
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new AuthError('GitHub ไม่ส่ง token ที่ใช้ได้', 502)
  const userResponse = await fetcher('https://api.github.com/user', { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`, 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'MangaWatcher-cloud' } })
  if (!userResponse.ok) throw new AuthError('ตรวจบัญชี GitHub ไม่สำเร็จ', 502)
  const user = await userResponse.json()
  if (user.id !== config.allowedId) throw new AuthError('บัญชีนี้ไม่ได้รับอนุญาต', 403)
  const session = seal({ id: user.id, csrf: random(), exp: Date.now() + (config.frontend ? 4 : 24) * 60 * 60_000 }, config.sessionSecret)
  const destination = config.frontend ? `${config.frontend.url}#mw_session=${encodeURIComponent(session)}` : config.origin
  const headers = new Headers({ Location: destination, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  if (!config.frontend) headers.append('Set-Cookie', secureCookie('__Host-mw_session', session, 86400))
  headers.append('Set-Cookie', secureCookie('__Host-mw_oauth', '', 0))
  return new Response(null, { status: 302, headers })
}

export function getSession(request, config) {
  if (!sameOrigin(request, config)) return null
  const bearer = request.headers.get('authorization')
  const crossOrigin = request.headers.get('origin') === config.frontend?.origin
  const raw = bearer?.startsWith('Bearer ') && crossOrigin ? bearer.slice(7) : bearer ? null : cookie(request, '__Host-mw_session')
  const value = unseal(raw, config.sessionSecret)
  if (!value || !Number.isSafeInteger(value.exp) || value.exp < Date.now() || value.id !== config.allowedId || typeof value.csrf !== 'string') return null
  return value
}

export function requireMutation(request, config, session) {
  const origin = request.headers.get('origin')
  const bearer = request.headers.get('authorization')?.startsWith('Bearer ')
  const valid = session && request.headers.get('content-type')?.split(';')[0] === 'application/json' && (bearer ? origin === config.frontend?.origin : origin === config.origin && request.headers.get('x-csrf-token') === session.csrf)
  if (!valid) throw new AuthError('คำขอไม่ได้รับอนุญาต', 403)
}

export function logout(request, config, session) {
  requireMutation(request, config, session)
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  if (!request.headers.get('authorization')) headers['Set-Cookie'] = secureCookie('__Host-mw_session', '', 0)
  return new Response(JSON.stringify({ ok: true }), { headers })
}
