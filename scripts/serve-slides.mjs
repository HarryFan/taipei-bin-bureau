// 零相依的靜態伺服器，Windows / macOS 都能跑：npm run slides
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../docs/slides', import.meta.url)))
const PORT = Number(process.env.PORT ?? 4321)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { code: 403 })
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(await readFile(file))
  } catch (err) {
    res.writeHead(err.code === 403 ? 403 : 404).end('not found')
  }
}).listen(PORT, '127.0.0.1', () => console.log(`簡報：http://localhost:${PORT}（← → 翻頁、F 全螢幕、R 重播動畫）`))
