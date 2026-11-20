const TABLES = ['manga', 'sources', 'releases', 'translation_tasks', 'logs', 'settings']
const STAGES = new Set(['RAW', 'OCR', 'TRANSLATE', 'PROOFREAD', 'LETTERING', 'PUBLISHER', 'PUBLISHED'])
const LANGS = new Set(['RAW', 'ENG', 'TH', 'ALL'])
const KINDS = new Set(['mangadex', 'rss', 'manual', 'site_feed'])
const date = () => new Date().toISOString()
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error }
const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fail('ID ไม่ถูกต้อง')
const nextId = rows => Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1
const url = value => {
  const raw = text(value)
  let parsed
  try { parsed = new URL(raw) } catch { fail('URL ไม่ถูกต้อง') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('ต้องใช้ HTTPS URL')
  return parsed.href
}
const metadataUrl = value => {
  if (typeof value !== 'string' || value.length > 2000) return false
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password }
  catch { return false }
}
const chapter = value => {
  const raw = text(String(value ?? ''), 100)
  if (!raw) fail('กรุณากรอกเลขตอน')
  if (/^\d+(?:\.\d+)?$/.test(raw)) return String(Number(raw))
  return raw
}
const setting = (snapshot, key) => snapshot.tables.settings.find(row => row.key === key)?.value
const websiteRegistry = snapshot => {
  const raw = setting(snapshot, 'website_registry')
  if (raw === undefined) return []
  let items
  try { items = JSON.parse(raw) } catch { fail('รายการเว็บไซต์ไม่ถูกต้อง') }
  if (!Array.isArray(items) || items.length > 100) fail('รายการเว็บไซต์ไม่ถูกต้อง')
  const ids = new Set(), urls = new Set()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join('|') !== 'id|lang|name|status|url' || !Number.isSafeInteger(item.id) || item.id < 1 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 150 || !LANGS.has(item.lang) || item.lang === 'ALL' || typeof item.status !== 'string' || item.status.length > 150 || !metadataUrl(item.url) || new URL(item.url).protocol !== 'https:' || ids.has(item.id)) fail('รายการเว็บไซต์ไม่ถูกต้อง')
    const canonical = new URL(item.url).href.replace(/\/$/, '')
    if (urls.has(canonical)) fail('รายการเว็บไซต์ไม่ถูกต้อง')
    ids.add(item.id); urls.add(canonical)
  }
  return items
}
const saveWebsiteRegistry = (snapshot, items) => {
  const row = snapshot.tables.settings.find(item => item.key === 'website_registry')
  if (row) row.value = JSON.stringify(items)
  else snapshot.tables.settings.push({ key: 'website_registry', value: JSON.stringify(items) })
}
const logChange = (snapshot, message) => snapshot.tables.logs.push({ id: nextId(snapshot.tables.logs), source_id: null, at: date(), status: 'จัดการ', message })

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.schema_version !== 2 || !snapshot.tables || typeof snapshot.tables !== 'object') fail('ไฟล์ข้อมูลไม่ใช่ MangaWatcher schema 2')
  if (TABLES.some(table => !Array.isArray(snapshot.tables[table]) || snapshot.tables[table].length > 100000)) fail('ตารางข้อมูลไม่ครบหรือใหญ่เกินไป')
  const { manga, sources, releases, translation_tasks: tasks, logs, settings } = snapshot.tables
  const columns = {
    manga: ['id', 'title', 'aliases', 'raw_done', 'eng_done', 'th_done', 'translated', 'tracked'],
    sources: ['id', 'manga_id', 'name', 'url', 'kind', 'lang', 'interval', 'enabled', 'checked', 'status'],
    releases: ['id', 'source_id', 'chapter', 'title', 'url', 'published', 'detected', 'lang', 'external_id'],
    translation_tasks: ['release_id', 'stage', 'updated'],
    logs: ['id', 'source_id', 'at', 'status', 'message'],
    settings: ['key', 'value'],
  }
  for (const table of TABLES) {
    if (snapshot.tables[table].some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join('|') !== columns[table].sort().join('|'))) fail(`ข้อมูล ${table} ไม่ถูกต้อง`)
  }
  if (settings.find(row => row.key === 'refresh_mode')?.value !== 'all' && settings.find(row => row.key === 'refresh_mode')?.value !== 'tracked') fail('การตั้งค่าไม่ถูกต้อง')
  if (settings.some(row => typeof row.key !== 'string' || typeof row.value !== 'string') || new Set(settings.map(row => row.key)).size !== settings.length) fail('การตั้งค่าซ้ำหรือไม่ถูกต้อง')
  websiteRegistry(snapshot)
  for (const rows of [manga, sources, releases, logs]) {
    if (rows.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1) || new Set(rows.map(row => row.id)).size !== rows.length) fail('ID ซ้ำหรือไม่ถูกต้อง')
  }
  if (manga.some(row => ['title', 'aliases', 'translated', 'raw_done', 'eng_done', 'th_done'].some(key => typeof row[key] !== 'string') || ![0, 1].includes(row.tracked))) fail('ข้อมูลเรื่องไม่ถูกต้อง')
  if (sources.some(row => !KINDS.has(row.kind) || !LANGS.has(row.lang) || !Number.isInteger(row.interval) || row.interval < 30 || row.interval > 1440 || ![0, 1].includes(row.enabled) || typeof row.name !== 'string' || !metadataUrl(row.url) || typeof row.status !== 'string' || (row.checked !== null && (typeof row.checked !== 'string' || !Number.isFinite(Date.parse(row.checked)))))) fail('ข้อมูลแหล่งไม่ถูกต้อง')
  if (releases.some(row => !LANGS.has(row.lang) || row.lang === 'ALL' || typeof row.chapter !== 'string' || typeof row.title !== 'string' || !metadataUrl(row.url) || typeof row.external_id !== 'string' || typeof row.detected !== 'string' || (row.published !== null && typeof row.published !== 'string'))) fail('ข้อมูลตอนไม่ถูกต้อง')
  if (new Set(sources.map(row => `${row.manga_id}|${row.url}|${row.lang}`)).size !== sources.length || new Set(releases.map(row => `${row.source_id}|${row.external_id}|${row.lang}`)).size !== releases.length) fail('แหล่งข้อมูลหรือตอนซ้ำ')
  if (tasks.some(row => typeof row.updated !== 'string' || !Number.isSafeInteger(row.release_id))) fail('ข้อมูลคิวไม่ถูกต้อง')
  if (logs.some(row => typeof row.at !== 'string' || typeof row.status !== 'string' || typeof row.message !== 'string')) fail('ข้อมูลประวัติไม่ถูกต้อง')
  if (sources.some(row => !manga.some(parent => parent.id === row.manga_id))) fail('แหล่งข้อมูลไม่ผูกกับเรื่อง')
  if (releases.some(row => !sources.some(parent => parent.id === row.source_id))) fail('ตอนที่ไม่มีแหล่งข้อมูล')
  if (tasks.some(row => !releases.some(parent => parent.id === row.release_id) || !STAGES.has(row.stage)) || new Set(tasks.map(row => row.release_id)).size !== tasks.length) fail('คิวงานแปลไม่ถูกต้อง')
  if (logs.some(row => row.source_id !== null && !sources.some(parent => parent.id === row.source_id))) fail('ประวัติแหล่งข้อมูลไม่ถูกต้อง')
  return snapshot
}

export function toState(snapshot) {
  validateSnapshot(snapshot)
  const t = snapshot.tables
  const mangaById = new Map(t.manga.map(row => [row.id, row]))
  const sourceById = new Map(t.sources.map(row => [row.id, row]))
  const sources = t.sources.map(row => {
    const errors = t.logs.filter(log => log.source_id === row.id).sort((a, b) => b.id - a.id)
    let failures = 0
    for (const log of errors) { if (log.status !== 'ผิดพลาด') break; failures++; if (failures === 4) break }
    const wait = Math.min(1440, row.interval * 2 ** failures)
    const next_due = row.enabled && row.kind !== 'manual' && row.checked ? new Date(Date.parse(row.checked) + wait * 60000).toISOString() : null
    return { ...row, next_due }
  }).sort((a, b) => b.id - a.id)
  const releases = t.releases.map(row => {
    const source = sourceById.get(row.source_id), manga = mangaById.get(source.manga_id)
    return { ...row, manga_id: manga.id, manga_title: manga.title, source_name: source.name }
  }).sort((a, b) => b.detected.localeCompare(a.detected) || b.id - a.id)
  const releaseById = new Map(t.releases.map(row => [row.id, row]))
  const tasks = t.translation_tasks.map(row => {
    const release = releaseById.get(row.release_id), source = sourceById.get(release.source_id), manga = mangaById.get(source.manga_id)
    return { id: row.release_id, ...row, chapter: release.chapter, url: release.url, lang: release.lang, source_name: source.name, manga_id: manga.id, manga_title: manga.title }
  }).sort((a, b) => b.updated.localeCompare(a.updated) || b.id - a.id)
  const logs = t.logs.map(row => ({ ...row, source_name: row.source_id === null ? 'ระบบ' : sourceById.get(row.source_id)?.name || 'ลบแล้ว' })).sort((a, b) => b.id - a.id).slice(0, 100)
  return { manga: [...t.manga].sort((a, b) => a.title.localeCompare(b.title, 'th')), sources, websites: websiteRegistry(snapshot), releases, tasks, logs, refresh_mode: setting(snapshot, 'refresh_mode'), busy: false }
}

export function applyMutation(snapshot, action, payload) {
  validateSnapshot(snapshot)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('ข้อมูลไม่ถูกต้อง')
  const t = snapshot.tables
  if (action === 'settings') {
    if (!['all', 'tracked'].includes(payload.refresh_mode)) fail('โหมดตรวจไม่ถูกต้อง')
    t.settings.find(row => row.key === 'refresh_mode').value = payload.refresh_mode
  } else if (action === 'website') {
    const items = websiteRegistry(snapshot)
    const name = text(payload.name, 150), siteUrl = url(payload.url).replace(/\/$/, ''), lang = text(payload.lang)
    if (!name || !LANGS.has(lang) || lang === 'ALL') fail('ชื่อหรือภาษาเว็บไซต์ไม่ถูกต้อง')
    if (items.some(item => new URL(item.url).href.replace(/\/$/, '') === siteUrl && item.id !== Number(payload.id))) fail('เว็บไซต์นี้มีอยู่แล้ว')
    if (payload.id) {
      const item = items.find(row => row.id === id(payload.id))
      if (!item) fail('ไม่พบเว็บไซต์', 404)
      Object.assign(item, { name, url: siteUrl, lang })
    } else {
      if (items.length >= 100) fail('เว็บไซต์เต็มจำนวน')
      items.push({ id: nextId(items), name, url: siteUrl, lang, status: 'รอ Adapter และตรวจสิทธิ์' })
    }
    saveWebsiteRegistry(snapshot, items)
  } else if (action === 'manga') {
    const title = text(payload.title)
    if (!title) fail('กรุณากรอกชื่อเรื่อง')
    const values = { title, aliases: text(payload.aliases), translated: text(payload.translated, 100), tracked: payload.tracked ? 1 : 0 }
    if (payload.id) { const row = t.manga.find(row => row.id === id(payload.id)); if (!row) fail('ไม่พบเรื่อง', 404); Object.assign(row, values) }
    else t.manga.push({ id: nextId(t.manga), ...values, raw_done: '', eng_done: '', th_done: '' })
  } else if (action === 'bulk-track') {
    const ids = payload.ids
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(value => !Number.isSafeInteger(value) || value < 1) || new Set(ids).size !== ids.length || typeof payload.tracked !== 'boolean') fail('รายการติดตามไม่ถูกต้อง')
    if (ids.some(value => !t.manga.some(row => row.id === value))) fail('ไม่พบเรื่องบางรายการ', 404)
    for (const row of t.manga) if (ids.includes(row.id)) row.tracked = payload.tracked ? 1 : 0
  } else if (action === 'source') {
    const manga_id = id(payload.manga_id)
    if (!t.manga.some(row => row.id === manga_id)) fail('ไม่พบเรื่อง', 404)
    const kind = text(payload.kind), lang = text(payload.lang), name = text(payload.name), sourceUrl = url(payload.url)
    if (!KINDS.has(kind) || !LANGS.has(lang) || (lang === 'ALL' && kind !== 'mangadex') || !name) fail('ชนิด ภาษา หรือชื่อเว็บไซต์ไม่ถูกต้อง')
    if (kind === 'mangadex' && !/^https:\/\/(www\.)?mangadex\.org\/title\/[0-9a-f-]{36}(?:\/|$)/i.test(sourceUrl)) fail('URL MangaDex ไม่ถูกต้อง')
    if (kind === 'site_feed' && (lang !== 'ENG' || !/^https:\/\/(?:en-thunderscans\.com\/comics|qimanga\.com\/series)\/[a-z0-9-]+\/?$/i.test(sourceUrl))) fail('URL ฟีดเว็บไซต์ไม่ถูกต้อง')
    const interval = Math.max(30, Math.min(1440, Number(payload.interval || 60)))
    if (!Number.isInteger(interval)) fail('รอบตรวจไม่ถูกต้อง')
    const values = { manga_id, name, url: sourceUrl, kind, lang, interval, enabled: payload.enabled ? 1 : 0, checked: null }
    if (t.sources.some(row => row.manga_id === manga_id && row.url === sourceUrl && row.lang === lang && row.id !== Number(payload.id))) fail('แหล่งข้อมูลซ้ำ')
    if (payload.id) { const row = t.sources.find(row => row.id === id(payload.id)); if (!row) fail('ไม่พบแหล่งข้อมูล', 404); Object.assign(row, values) }
    else t.sources.push({ id: nextId(t.sources), ...values, status: 'ยังไม่ตรวจ' })
  } else if (action === 'release') {
    const source = t.sources.find(row => row.id === id(payload.source_id))
    if (!source) fail('ไม่พบแหล่งข้อมูล', 404)
    const releaseUrl = url(payload.url), lang = text(payload.lang || source.lang)
    if (!LANGS.has(lang) || lang === 'ALL') fail('ภาษาไม่ถูกต้อง')
    if (!t.releases.some(row => row.source_id === source.id && row.external_id === releaseUrl && row.lang === lang)) {
      const row = { id: nextId(t.releases), source_id: source.id, chapter: chapter(payload.chapter), title: text(payload.title, 500), url: releaseUrl, published: null, detected: date(), lang, external_id: releaseUrl }
      t.releases.push(row)
      if (lang === 'RAW' && t.manga.find(manga => manga.id === source.manga_id)?.tracked) t.translation_tasks.push({ release_id: row.id, stage: 'RAW', updated: date() })
    }
  } else if (action === 'task') {
    const release_id = id(payload.release_id), stage = text(payload.stage)
    if (!t.releases.some(row => row.id === release_id)) fail('ไม่พบตอน', 404)
    if (!STAGES.has(stage)) fail('ขั้นตอนงานแปลไม่ถูกต้อง')
    const row = t.translation_tasks.find(row => row.release_id === release_id)
    if (row) { row.stage = stage; row.updated = date() }
    else t.translation_tasks.push({ release_id, stage, updated: date() })
  } else if (action === 'delete') {
    const entityId = id(payload.id)
    if (payload.type === 'website') {
      const items = websiteRegistry(snapshot)
      if (!items.some(row => row.id === entityId)) fail('ไม่พบเว็บไซต์', 404)
      saveWebsiteRegistry(snapshot, items.filter(row => row.id !== entityId))
    } else if (payload.type === 'manga') {
      const sourceIds = t.sources.filter(row => row.manga_id === entityId).map(row => row.id)
      t.manga = t.manga.filter(row => row.id !== entityId)
      t.sources = t.sources.filter(row => row.manga_id !== entityId)
      t.releases = t.releases.filter(row => !sourceIds.includes(row.source_id))
      for (const log of t.logs) if (sourceIds.includes(log.source_id)) log.source_id = null
    } else if (payload.type === 'source') {
      t.sources = t.sources.filter(row => row.id !== entityId)
      t.releases = t.releases.filter(row => row.source_id !== entityId)
      for (const log of t.logs) if (log.source_id === entityId) log.source_id = null
    } else fail('ชนิดที่ลบไม่ถูกต้อง')
    t.translation_tasks = t.translation_tasks.filter(row => t.releases.some(release => release.id === row.release_id))
  } else fail('ไม่พบ endpoint', 404)
  logChange(snapshot, `cloud:${action}`)
  snapshot.exported_at = date()
  return validateSnapshot(snapshot)
}
