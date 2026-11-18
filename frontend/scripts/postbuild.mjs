import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'dist')
const base = process.env.VITE_BASE_PATH || '/'
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)) throw new Error('VITE_BASE_PATH ไม่ถูกต้อง')

async function files(directory, relative = '') {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative + entry.name
    if (entry.isDirectory()) output.push(...await files(join(directory, entry.name), name + '/'))
    else if (entry.isFile()) output.push(name)
  }
  return output
}

const assets = (await files(dist)).filter(name => !['sw.js', '404.html'].includes(name)).sort()
const staticPaths = assets.map(name => base + name)
const apiOrigin = process.env.VITE_API_MODE === 'pages' ? process.env.VITE_API_BASE_URL : ''
if (process.env.VITE_API_MODE === 'pages' && (!apiOrigin || new URL(apiOrigin).origin !== apiOrigin)) throw new Error('Pages API origin ไม่ถูกต้อง')
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`
const indexPath = join(dist, 'index.html')
const html = (await readFile(indexPath, 'utf8')).replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
await writeFile(indexPath, html)
const index = Buffer.from(html)
const version = createHash('sha256').update(index).update(JSON.stringify(staticPaths)).digest('hex').slice(0, 12)
const template = await readFile(join(root, 'sw.template.js'), 'utf8')
const sw = template.replace('__CACHE_VERSION__', version).replace('__APP_BASE__', base).replace('__STATIC_ASSETS__', JSON.stringify(staticPaths))
await writeFile(join(dist, 'sw.js'), sw)

const routeNames = ['dashboard', 'updates', 'raw', 'library', 'watchlist', 'discover', 'queue', 'calendar', 'sources', 'notifications', 'logs', 'database', 'settings']
const fallback = `<!doctype html><html lang="th"><meta charset="utf-8"><title>MangaWatcher</title><script>const base=${JSON.stringify(base)},routes=${JSON.stringify(routeNames)};const part=location.pathname.startsWith(base)?location.pathname.slice(base.length).replace(/\\/$/,''):'';const next=new URL(base,location.origin);if(routes.includes(part))next.searchParams.set('view',part);location.replace(next.href+location.hash);</script></html>`
await writeFile(join(dist, '404.html'), fallback)
console.log(`PWA static cache ${version}: ${assets.length} files`)
