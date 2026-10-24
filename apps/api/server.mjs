// 選配的小 API：零相依，Node 22 直接跑。資料存在記憶體，重啟就清空。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.PORT ?? 8787)
const FILL_PATH = new URL('../web/public/data/fill_levels.json', import.meta.url)
const reports = []
const dispatches = []
const cases = new Map()

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,OPTIONS',
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
      if (!['full', 'missing', 'need', 'ok', 'dirty', 'dumping', 'broken', 'other'].includes(r.kind)) return send(res, 400, { error: 'kind 不正確' })
      if (r.note !== undefined) r.note = String(r.note).slice(0, 100)
      if (r.photo !== undefined && !(typeof r.photo === 'string' && r.photo.startsWith('data:image/') && r.photo.length < 400_000)) delete r.photo
      reports.unshift(r)
      return send(res, 201, r)
    }
    // 回報後補一張照片（查核用）
    const rm = pathname.match(/^\/api\/reports\/([^/]+)$/)
    if (rm && req.method === 'PATCH') {
      const r = reports.find((x) => x.id === decodeURIComponent(rm[1]))
      if (!r) return send(res, 404, { error: '找不到這筆回報' })
      const body = await readBody(req)
      if (!(typeof body.photo === 'string' && body.photo.startsWith('data:image/') && body.photo.length < 400_000)) return send(res, 400, { error: 'photo 不正確' })
      r.photo = body.photo
      return send(res, 200, r)
    }

    // 人工案件分流：確認、轉交、處理完成
    if (pathname === '/api/cases' && req.method === 'GET') return send(res, 200, [...cases.values()])
    const cm = pathname.match(/^\/api\/cases\/([^/]+)$/)
    if (cm && req.method === 'PUT') {
      const c = await readBody(req)
      if (!['confirmed', 'forwarded', 'done'].includes(c.step)) return send(res, 400, { error: 'step 不正確' })
      c.key = decodeURIComponent(cm[1])
      cases.set(c.key, c)
      return send(res, 200, c)
    }

    // 派車紀錄：出發時新增，返隊時補上 returnedAt
    if (pathname === '/api/dispatches' && req.method === 'GET') return send(res, 200, dispatches)
    if (pathname === '/api/dispatches' && req.method === 'POST') {
      const d = await readBody(req)
      if (!d.id || !d.district || !d.departedAt) return send(res, 400, { error: '缺少 id、district 或 departedAt' })
      dispatches.unshift(d)
      return send(res, 201, d)
    }
    const m = pathname.match(/^\/api\/dispatches\/([^/]+)$/)
    if (m && req.method === 'PATCH') {
      const d = dispatches.find((x) => x.id === decodeURIComponent(m[1]))
      if (!d) return send(res, 404, { error: '找不到這筆派車' })
      const body = await readBody(req)
      if (body.returnedAt) d.returnedAt = body.returnedAt
      if (typeof body.photo === 'string' && body.photo.startsWith('data:image/') && body.photo.length < 400_000) d.photo = body.photo
      if (!body.returnedAt && !body.photo) d.returnedAt = new Date().toISOString()
      return send(res, 200, d)
    }

    // 模擬 IoT：以靜態填滿率為基礎，被回報「滿了」的桶直接拉到 100%
    if (pathname === '/api/fill-levels') {
      const base = JSON.parse(await readFile(FILL_PATH, 'utf8'))
      const full = new Set(reports.filter((r) => r.kind === 'full' && r.binId).map((r) => r.binId))
      const checked = new Set(reports.filter((r) => r.binId).map((r) => r.binId))
      return send(
        res,
        200,
        base.map((f) => ({ ...f, ...(full.has(f.id) ? { fill: 1 } : {}), ...(checked.has(f.id) ? { checkedDaysAgo: 0 } : {}) })),
      )
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err) })
  }
}).listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
