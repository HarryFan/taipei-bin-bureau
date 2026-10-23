// 選配的小 API：零相依，Node 22 直接跑。資料存在記憶體，重啟就清空。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.PORT ?? 8787)
const FILL_PATH = new URL('../web/public/data/fill_levels.json', import.meta.url)
const reports = []

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw || '{}')
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (req.method === 'OPTIONS') return send(res, 204)
    if (pathname === '/api/health') return send(res, 200, { ok: true })

    if (pathname === '/api/reports' && req.method === 'GET') return send(res, 200, reports)
    if (pathname === '/api/reports' && req.method === 'POST') {
      const r = await readBody(req)
      if (!['full', 'missing', 'need'].includes(r.kind)) return send(res, 400, { error: 'kind 不正確' })
      reports.unshift(r)
      return send(res, 201, r)
    }

    // 模擬 IoT：以靜態填滿率為基礎，被回報「滿了」的桶直接拉到 100%
    if (pathname === '/api/fill-levels') {
      const base = JSON.parse(await readFile(FILL_PATH, 'utf8'))
      const full = new Set(reports.filter((r) => r.kind === 'full' && r.binId).map((r) => r.binId))
      return send(res, 200, base.map((f) => (full.has(f.id) ? { ...f, fill: 1 } : f)))
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err) })
  }
}).listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
