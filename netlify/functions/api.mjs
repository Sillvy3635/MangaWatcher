import { authConfig, finishLogin, getSession, logout, requireMutation, startLogin } from '../../cloud/auth.mjs'
import { applyMutation, toState, validateSnapshot } from '../../cloud/model.mjs'
import { readSnapshot, storeConfig, StoreError, writeSnapshot } from '../../cloud/store.mjs'

export const config = { path: '/api/*', rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] } }
const MUTATIONS = new Set(['manga', 'source', 'release', 'task', 'bulk-track', 'settings', 'delete'])
const baseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

function withCors(response, request, auth) {
  if (auth?.frontend && request.headers.get('origin') === auth.frontend.origin) {
    response.headers.set('Access-Control-Allow-Origin', auth.frontend.origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match')
    response.headers.set('Access-Control-Expose-Headers', 'ETag')
    response.headers.set('Access-Control-Max-Age', '600')
    response.headers.set('Vary', 'Origin')
  }
  return response
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra } })
}

async function payload(request, maxBytes = 100_000) {
  const declared = Number(request.headers.get('content-length'))
  if (declared > maxBytes) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 })
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 })
  try { return JSON.parse(raw) } catch { throw Object.assign(new Error('JSON ไม่ถูกต้อง'), { status: 400 }) }
}

export default async function handler(request) {
  let auth
  try {
    const url = new URL(request.url)
    const route = url.pathname.replace(/^\/api\/?/, '')
    auth = authConfig()
    if (url.origin !== auth.origin) return json(403, { error: 'origin ไม่ถูกต้อง' })
    const requestOrigin = request.headers.get('origin')
    if (requestOrigin && requestOrigin !== auth.origin && requestOrigin !== auth.frontend?.origin) return json(403, { error: 'origin ไม่ได้รับอนุญาต' })
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204, headers: baseHeaders }), request, auth)
    if (request.method === 'GET' && route === 'auth/start') return startLogin(request, auth)
    if (request.method === 'GET' && route === 'auth/callback') return await finishLogin(request, auth)
    const session = getSession(request, auth)
    const reply = (status, body, extra) => withCors(json(status, body, extra), request, auth)
    if (!session) return reply(401, { error: 'กรุณาเข้าสู่ระบบด้วย GitHub' })
    if (request.method === 'GET' && route === 'session') return reply(200, { authenticated: true, csrf: session.csrf })
    if (request.method === 'POST') {
      requireMutation(request, auth, session)
      if (route === 'logout') return withCors(logout(request, auth, session), request, auth)
      if (route === 'refresh') return reply(501, { error: 'ตรวจตอนใหม่ผ่าน GitHub Actions ตามรอบ' })
      if (route !== 'import' && !MUTATIONS.has(route)) return reply(404, { error: 'ไม่พบ endpoint' })
      const input = await payload(request, route === 'import' ? 900_000 : 100_000)
      const storage = storeConfig()
      if (route === 'import') {
        validateSnapshot(input)
        let current = null
        try { current = await readSnapshot(storage) } catch (error) { if (!(error instanceof StoreError) || error.status !== 404) throw error }
        const expected = current ? `"${current.sha}"` : '*'
        const supplied = current ? request.headers.get('if-match') : request.headers.get('if-none-match')
        if (supplied !== expected) return reply(409, { error: 'ข้อมูลในคลังเปลี่ยนแล้ว กรุณาส่งออกและตรวจสอบอีกครั้ง' })
        const sha = await writeSnapshot(storage, input, current?.sha)
        return reply(200, { ok: true, backup: current ? 'GitHub commit history' : 'ไฟล์เริ่มต้น', sha })
      }
      const { snapshot, sha } = await readSnapshot(storage)
      const changed = applyMutation(structuredClone(snapshot), route, input)
      const nextSha = await writeSnapshot(storage, changed, sha)
      return reply(200, { ok: true, sha: nextSha })
    }
    if (request.method === 'GET' && (route === 'state' || route === 'export')) {
      const { snapshot, sha } = await readSnapshot(storeConfig())
      return reply(200, route === 'state' ? toState(snapshot) : snapshot, { ETag: `"${sha}"` })
    }
    return reply(404, { error: 'ไม่พบ endpoint' })
  } catch (error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500
    return withCors(json(status, { error: status === 500 ? 'เซิร์ฟเวอร์ทำงานผิดพลาด' : error.message }), request, auth)
  }
}
