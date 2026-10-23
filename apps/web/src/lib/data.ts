import type { Bin, FillLevel, GridData, Report } from '../types'

const BASE = import.meta.env.BASE_URL
const API = (import.meta.env.VITE_API_URL as string | undefined) || undefined
const LOCAL_KEY = 'tbb-reports'

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`)
  if (!res.ok) throw new Error(`讀取 ${name} 失敗：${res.status}`)
  return res.json() as Promise<T>
}

export const loadBins = () => getJson<Bin[]>('bins.json')
export const loadGrid = () => getJson<GridData>('grid.json')

export async function loadFillLevels(): Promise<FillLevel[]> {
  if (API) {
    try {
      const res = await fetch(`${API}/api/fill-levels`)
      if (res.ok) return res.json()
    } catch {
      /* API 沒開就退回靜態資料 */
    }
  }
  return getJson<FillLevel[]>('fill_levels.json')
}

function readLocal(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Report[]
  } catch {
    return []
  }
}

export async function submitReport(input: Omit<Report, 'id' | 'createdAt'>): Promise<Report> {
  const report: Report = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  if (API) {
    try {
      await fetch(`${API}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })
      return report
    } catch {
      /* 退回本機儲存 */
    }
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([report, ...readLocal()]))
  } catch {
    /* 無痕模式等情況存不了就算了 */
  }
  return report
}

export async function loadReports(): Promise<Report[]> {
  if (API) {
    try {
      const res = await fetch(`${API}/api/reports`)
      if (res.ok) return res.json()
    } catch {
      /* 退回本機儲存 */
    }
  }
  return readLocal()
}
