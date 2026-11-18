import { validateSnapshot } from './model.mjs'

export class StoreError extends Error {
  constructor(message, status = 502) { super(message); this.status = status }
}

export function storeConfig(env = process.env) {
  const owner = env.MW_DATA_OWNER, repo = env.MW_DATA_REPO, path = env.MW_DATA_PATH || 'mangawatcher.json', token = env.MW_DATA_TOKEN
  if (!owner || !repo || !token || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(path) || path.includes('..') || path.startsWith('/')) throw new StoreError('ยังไม่ตั้งค่าคลังข้อมูล private', 503)
  return { url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, token, branch: env.MW_DATA_BRANCH || undefined }
}

async function github(config, method, body, fetcher = fetch) {
  let response
  try {
    response = await fetcher(method === 'GET' && config.branch ? `${config.url}?ref=${encodeURIComponent(config.branch)}` : config.url, {
      method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', 'User-Agent': 'MangaWatcher-cloud' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new StoreError('ติดต่อ GitHub ไม่สำเร็จ') }
  if (response.status === 429 || response.status >= 500) throw new StoreError('GitHub ไม่พร้อมหรือเกินอัตราที่กำหนด', 503)
  if (response.status === 401 || response.status === 403) throw new StoreError('สิทธิ์เข้าถึงคลังข้อมูลไม่ถูกต้อง', 503)
  return response
}

export async function readSnapshot(config, fetcher = fetch) {
  const response = await github(config, 'GET', null, fetcher)
  if (response.status === 404) throw new StoreError('ยังไม่มีไฟล์ข้อมูลใน private repository กรุณานำเข้า backup ก่อน', 404)
  if (!response.ok) throw new StoreError('อ่านคลังข้อมูลไม่สำเร็จ')
  const file = await response.json()
  if (file.type !== 'file' || typeof file.sha !== 'string' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.size > 900_000) throw new StoreError('ไฟล์ข้อมูลเกินขนาดที่รองรับหรือรูปแบบไม่ถูกต้อง')
  try { return { snapshot: validateSnapshot(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))), sha: file.sha } }
  catch { throw new StoreError('ไฟล์ข้อมูลใน private repository ไม่ถูกต้อง') }
}

export async function writeSnapshot(config, snapshot, sha, fetcher = fetch) {
  validateSnapshot(snapshot)
  const raw = JSON.stringify(snapshot)
  if (Buffer.byteLength(raw, 'utf8') > 900_000) throw new StoreError('ไฟล์ข้อมูลใหญ่เกินขนาดที่รองรับ', 413)
  const content = Buffer.from(raw).toString('base64')
  const body = { message: 'MangaWatcher: update metadata', content, ...(sha ? { sha } : {}), ...(config.branch ? { branch: config.branch } : {}) }
  const response = await github(config, 'PUT', body, fetcher)
  if (response.status === 409 || response.status === 422) throw new StoreError('ข้อมูลเปลี่ยนระหว่างบันทึก กรุณาโหลดใหม่', 409)
  if (!response.ok) throw new StoreError('บันทึกคลังข้อมูลไม่สำเร็จ')
  const result = await response.json()
  return result.content?.sha || null
}
