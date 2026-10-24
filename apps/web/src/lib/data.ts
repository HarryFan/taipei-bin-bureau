import type { Bin, FillLevel, GridData, Report } from '../types'

const BASE = import.meta.env.BASE_URL
const API = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '') || undefined
const LOCAL_KEY = 'tbb-reports'
/** 免費主機冷啟動可能很慢，超過就先退回本機資料，畫面不卡住 */
const API_TIMEOUT_MS = 4000

export type DataSource = 'api' | 'local'

/** 最近一次讀取實際用到的資料來源，給畫面顯示「即時 / 離線」 */
export let lastSource: DataSource = API ? 'api' : 'local'

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`)
  if (!res.ok) throw new Error(`讀取 ${name} 失敗：${res.status}`)
  return res.json() as Promise<T>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API}${path}`, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`${path} 回應 ${res.status}`)
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  } finally {
    clearTimeout(timer)
  }
}

/** crypto.randomUUID 只在 HTTPS / localhost 可用；手機用區網 IP 連 dev server 時要有備案 */
function uid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      /* 非安全環境會丟錯 */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const loadBins = () => getJson<Bin[]>('bins.json')
export const loadGrid = () => getJson<GridData>('grid.json')

export interface DataMeta {
  bins?: { kind: 'mock' | 'real'; source: string }
  demand?: { kind: 'mock' | 'real'; source: string }
}
/** 前端顯示「模擬資料」標記用；讀不到就當作模擬，寧可多標示 */
export const loadMeta = () => getJson<DataMeta>('meta.json').catch((): DataMeta => ({}))
export interface OfficialCount {
  date: string
  count: number
  unit: string
  boxes?: number
  source: string
}
export interface OfficialCounts {
  current: OfficialCount
  history: OfficialCount[]
  openData: { date: string; records: number; unit: string; missingDistricts: string[]; source: string }
}
/** 官方公布的數量（含單位），畫面上的「官方統計」只能從這裡來 */
export const loadOfficial = () => getJson<OfficialCounts>('official_counts.json').catch(() => undefined)

export const isMock = (m: DataMeta) => m.bins?.kind !== 'real' || m.demand?.kind !== 'real'

function readLocal(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Report[]
  } catch {
    return []
  }
}

function writeLocal(reports: Report[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(reports.slice(0, 500)))
  } catch {
    /* 無痕模式等情況存不了就算了 */
  }
}

export async function loadFillLevels(): Promise<FillLevel[]> {
  if (API) {
    try {
      const levels = await api<FillLevel[]>('/api/fill-levels')
      lastSource = 'api'
      return levels
    } catch {
      /* API 沒開就退回靜態資料 */
    }
  }
  lastSource = 'local'
  // 離線模式也模擬 API 的行為：被回報「滿了」的桶直接視為 100%
  const [base, local] = [await getJson<FillLevel[]>('fill_levels.json'), readLocal()]
  const full = new Map(local.filter((r) => r.kind === 'full' && r.binId).map((r) => [r.binId!, r.createdAt]))
  const checked = new Set(local.filter((r) => r.binId).map((r) => r.binId!))
  return base.map((f) => ({
    ...f,
    ...(full.has(f.id) ? { fill: 1, updatedAt: full.get(f.id)! } : {}),
    // 只要有人回報過這桶，就算今天有人確認
    ...(checked.has(f.id) ? { checkedDaysAgo: 0 } : {}),
  }))
}

export async function submitReport(input: Omit<Report, 'id' | 'createdAt'>): Promise<Report> {
  const report: Report = { ...input, id: uid(), createdAt: new Date().toISOString() }
  if (API) {
    try {
      await api('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })
      lastSource = 'api'
      return report
    } catch {
      /* 退回本機儲存 */
    }
  }
  lastSource = 'local'
  writeLocal([report, ...readLocal()])
  return report
}

/** 回報後補一張照片：讓戰情室能查核桶的實際狀況，避免誤報或惡搞 */
export async function attachReportPhoto(id: string, photo: string): Promise<void> {
  if (API) {
    try {
      await api(`/api/reports/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo }),
      })
      lastSource = 'api'
      return
    } catch {
      /* 退回本機儲存 */
    }
  }
  lastSource = 'local'
  writeLocal(readLocal().map((r) => (r.id === id ? { ...r, photo } : r)))
}

export async function loadReports(): Promise<Report[]> {
  if (API) {
    try {
      const reports = await api<Report[]>('/api/reports')
      lastSource = 'api'
      return reports
    } catch {
      /* 退回本機儲存 */
    }
  }
  lastSource = 'local'
  return readLocal()
}

/** 同一瀏覽器的其他分頁新增回報時通知（Demo 備案：一台筆電開兩個分頁） */
export function onLocalReportsChange(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === LOCAL_KEY) cb()
  }
  addEventListener('storage', handler)
  return () => removeEventListener('storage', handler)
}

/** 清空本機回報（Demo 前重置用） */
export function clearLocalReports() {
  writeLocal([])
}
