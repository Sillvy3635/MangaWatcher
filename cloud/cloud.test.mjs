import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authConfig, finishLogin, getSession, requireMutation, startLogin } from './auth.mjs'
import { applyMutation, toState, validateSnapshot } from './model.mjs'
import { readSnapshot, storeConfig, writeSnapshot } from './store.mjs'
import handler from '../netlify/functions/api.mjs'

const snapshot = () => ({ schema_version: 2, exported_at: '2026-01-01T00:00:00Z', tables: { manga: [], sources: [], releases: [], translation_tasks: [], logs: [], settings: [{ key: 'refresh_mode', value: 'all' }] } })
const env = { MW_SITE_ORIGIN: 'https://test.netlify.app', MW_GITHUB_CLIENT_ID: 'client', MW_GITHUB_CLIENT_SECRET: 'secret', MW_ALLOWED_GITHUB_ID: '42', MW_SESSION_SECRET: 'a'.repeat(40), MW_DATA_OWNER: 'owner', MW_DATA_REPO: 'private', MW_DATA_TOKEN: 'store-secret' }

test('snapshot validation, mutation and state preserve relationships', () => {
  const data = snapshot()
  applyMutation(data, 'manga', { title: 'เรื่องจริง', tracked: true })
  applyMutation(data, 'source', { manga_id: 1, name: 'ผู้ใช้เพิ่ม', url: 'https://example.org/feed', kind: 'rss', lang: 'RAW', interval: 60, enabled: true })
  applyMutation(data, 'release', { source_id: 1, chapter: '01.50', url: 'https://example.org/1' })
  assert.equal(data.tables.releases[0].chapter, '1.5')
  assert.equal(data.tables.translation_tasks[0].release_id, 1)
  assert.equal(toState(data).releases[0].manga_title, 'เรื่องจริง')
  assert.throws(() => validateSnapshot({ ...data, tables: { ...data.tables, sources: [{ ...data.tables.sources[0], manga_id: 99 }] } }))
  assert.throws(() => validateSnapshot({ ...data, tables: { ...data.tables, releases: [{ ...data.tables.releases[0], url: 'javascript:alert(1)' }] } }))
  assert.throws(() => applyMutation(data, 'source', { manga_id: 1, name: 'bad', url: 'http://example.org', kind: 'rss', lang: 'RAW' }))
})

test('website registry is separate from per-series sources and survives schema 2 export', () => {
  const data = snapshot()
  applyMutation(data, 'website', { name: 'Example Catalog', url: 'https://example.org/catalog', lang: 'ENG' })
  assert.equal(toState(data).websites.length, 1)
  assert.equal(toState(data).sources.length, 0)
  assert.equal(toState(data).websites[0].status, 'รอ Adapter และตรวจสิทธิ์')
  assert.throws(() => applyMutation(data, 'website', { name: 'Duplicate', url: 'https://example.org/catalog', lang: 'ENG' }))
  assert.throws(() => applyMutation(data, 'website', { name: 'Duplicate slash', url: 'https://example.org/catalog/', lang: 'ENG' }))
  assert.throws(() => applyMutation(data, 'website', { name: 'Unsafe', url: 'http://example.org/catalog', lang: 'ENG' }))
  applyMutation(data, 'website', { id: 1, name: 'Renamed', url: 'https://example.org/catalog', lang: 'TH' })
  assert.equal(toState(data).websites[0].lang, 'TH')
  validateSnapshot(JSON.parse(JSON.stringify(data)))
  applyMutation(data, 'delete', { type: 'website', id: 1 })
  assert.equal(toState(data).websites.length, 0)
})

test('GitHub store uses SHA and reports concurrent writes', async () => {
  const config = storeConfig(env)
  const data = snapshot()
  let written
  const read = await readSnapshot(config, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer store-secret')
    return Response.json({ type: 'file', sha: 'old-sha', encoding: 'base64', size: 100, content: Buffer.from(JSON.stringify(data)).toString('base64') })
  })
  assert.equal(read.sha, 'old-sha')
  await writeSnapshot(config, data, read.sha, async (_url, options) => {
    written = JSON.parse(options.body)
    return Response.json({ content: { sha: 'new-sha' } })
  })
  assert.equal(written.sha, 'old-sha')
  assert.equal(JSON.parse(Buffer.from(written.content, 'base64').toString()).schema_version, 2)
  await assert.rejects(writeSnapshot(config, data, 'stale', async () => Response.json({}, { status: 409 })), error => error.status === 409)
})

test('OAuth state, owner allowlist and CSRF guard', async () => {
  const config = authConfig(env)
  const login = startLogin(new Request(`${env.MW_SITE_ORIGIN}/api/auth/start`), config)
  const target = new URL(login.headers.get('location'))
  assert.equal(target.hostname, 'github.com')
  assert.ok(target.searchParams.get('code_challenge'))
  const pending = login.headers.get('set-cookie').split(';')[0]
  const callback = new Request(`${env.MW_SITE_ORIGIN}/api/auth/callback?state=${target.searchParams.get('state')}&code=sample`, { headers: { Cookie: pending } })
  const calls = []
  const fetcher = async (url, options) => {
    calls.push([url, options])
    return url.includes('access_token') ? Response.json({ access_token: 'oauth-token', token_type: 'bearer' }) : Response.json({ id: 42 })
  }
  const result = await finishLogin(callback, config, fetcher)
  assert.equal(calls.length, 2)
  assert.equal(result.status, 302)
  const sessionCookie = result.headers.getSetCookie().find(value => value.startsWith('__Host-mw_session=')).split(';')[0]
  const session = getSession(new Request(`${env.MW_SITE_ORIGIN}/api/state`, { headers: { Cookie: sessionCookie } }), config)
  assert.equal(session.id, 42)
  const allowed = new Request(`${env.MW_SITE_ORIGIN}/api/manga`, { method: 'POST', headers: { Cookie: sessionCookie, Origin: env.MW_SITE_ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: '{}' })
  assert.doesNotThrow(() => requireMutation(allowed, config, session))
  assert.throws(() => requireMutation(new Request(allowed, { headers: { Origin: 'https://evil.example' } }), config, session))
  await assert.rejects(finishLogin(new Request(`${env.MW_SITE_ORIGIN}/api/auth/callback?state=wrong&code=sample`, { headers: { Cookie: pending } }), config, fetcher))
  await assert.rejects(finishLogin(callback, config, async url => url.includes('access_token') ? Response.json({ access_token: 'oauth-token', token_type: 'bearer' }) : Response.json({ id: 7 })), error => error.status === 403)
})

test('cloud API requires session and CSRF, imports once, reads and mutates private data', async () => {
  const oldEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  const oldFetch = globalThis.fetch
  Object.assign(process.env, env)
  let file = null, sha = 'sha-1', puts = 0
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/contents/')) {
      if (options.method === 'GET') return file ? Response.json({ type: 'file', sha, encoding: 'base64', size: Buffer.byteLength(JSON.stringify(file)), content: Buffer.from(JSON.stringify(file)).toString('base64') }) : Response.json({}, { status: 404 })
      const body = JSON.parse(options.body)
      if (file && body.sha !== sha) return Response.json({}, { status: 409 })
      file = JSON.parse(Buffer.from(body.content, 'base64').toString())
      sha = `sha-${++puts}`
      return Response.json({ content: { sha } })
    }
    return String(url).includes('access_token') ? Response.json({ access_token: 'oauth-token', token_type: 'bearer' }) : Response.json({ id: 42 })
  }
  try {
    const unauthorized = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/state`))
    assert.equal(unauthorized.status, 401)
    const login = startLogin(new Request(`${env.MW_SITE_ORIGIN}/api/auth/start`), authConfig(env))
    const state = new URL(login.headers.get('location')).searchParams.get('state')
    const pending = login.headers.get('set-cookie').split(';')[0]
    const callback = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/auth/callback?state=${state}&code=test`, { headers: { Cookie: pending } }))
    assert.equal(callback.status, 302)
    const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-mw_session=')).split(';')[0]
    const session = await (await handler(new Request(`${env.MW_SITE_ORIGIN}/api/session`, { headers: { Cookie: sessionCookie } }))).json()
    const headers = { Cookie: sessionCookie, Origin: env.MW_SITE_ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }
    const denied = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/import`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'wrong' }, body: JSON.stringify(snapshot()) }))
    assert.equal(denied.status, 403)
    const imported = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/import`, { method: 'POST', headers: { ...headers, 'If-None-Match': '*' }, body: JSON.stringify(snapshot()) }))
    assert.equal(imported.status, 200)
    assert.equal(puts, 1)
    const stateResult = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/state`, { headers: { Cookie: sessionCookie } }))
    assert.equal(stateResult.status, 200)
    assert.deepEqual((await stateResult.json()).manga, [])
    const created = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/manga`, { method: 'POST', headers, body: JSON.stringify({ title: 'เรื่องจริง', tracked: true }) }))
    assert.equal(created.status, 200)
    assert.equal(file.tables.manga[0].title, 'เรื่องจริง')
    assert.equal(puts, 2)
    const website = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/website`, { method: 'POST', headers, body: JSON.stringify({ name: 'Example Catalog', url: 'https://example.org/catalog', lang: 'ENG' }) }))
    assert.equal(website.status, 200)
    assert.equal(JSON.parse(file.tables.settings.find(row => row.key === 'website_registry').value).length, 1)
    assert.equal(puts, 3)
    const staleImport = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/import`, { method: 'POST', headers: { ...headers, 'If-Match': '"sha-1"' }, body: JSON.stringify(snapshot()) }))
    assert.equal(staleImport.status, 409)
  } finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
})

test('Pages OAuth returns app session and CORS allows only configured origin', async () => {
  const pagesEnv = { ...env, MW_FRONTEND_ORIGIN: 'https://sillvy3635.github.io', MW_FRONTEND_BASE_PATH: '/MangaWatcher/' }
  const oldEnv = Object.fromEntries(Object.keys(pagesEnv).map(key => [key, process.env[key]]))
  const oldFetch = globalThis.fetch
  Object.assign(process.env, pagesEnv)
  globalThis.fetch = async url => String(url).includes('access_token') ? Response.json({ access_token: 'oauth-token', token_type: 'bearer' }) : Response.json({ id: 42 })
  try {
    const origin = pagesEnv.MW_FRONTEND_ORIGIN
    const preflight = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/state`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } }))
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
    const blocked = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/state`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }))
    assert.equal(blocked.status, 403)
    assert.equal(blocked.headers.get('access-control-allow-origin'), null)
    const login = startLogin(new Request(`${env.MW_SITE_ORIGIN}/api/auth/start`), authConfig(pagesEnv))
    const state = new URL(login.headers.get('location')).searchParams.get('state')
    const pending = login.headers.get('set-cookie').split(';')[0]
    const callback = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/auth/callback?state=${state}&code=test`, { headers: { Cookie: pending } }))
    assert.equal(callback.status, 302)
    assert.ok(callback.headers.get('location').startsWith(`${origin}/MangaWatcher/#mw_session=`))
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer')
    const token = decodeURIComponent(callback.headers.get('location').split('#mw_session=')[1])
    const sessionBody = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
    assert.deepEqual(Object.keys(sessionBody).sort(), ['csrf', 'exp', 'id'])
    assert.ok(sessionBody.exp - Date.now() > 13 * 24 * 60 * 60_000)
    assert.ok(sessionBody.exp - Date.now() <= 14 * 24 * 60 * 60_000)
    const allowed = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/session`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } }))
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('access-control-allow-origin'), origin)
    const denied = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/session`, { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` } }))
    assert.equal(denied.status, 403)
    const mutation = await handler(new Request(`${env.MW_SITE_ORIGIN}/api/settings`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }))
    assert.equal(mutation.status, 502)
    assert.equal(mutation.headers.get('access-control-allow-origin'), origin)
  } finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
})
