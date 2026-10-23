export interface Bin {
  id: string
  district: string
  road: string
  note: string
  lat: number
  lng: number
}

/** 模擬資料：0 = 空、1 = 滿 */
export interface FillLevel {
  id: string
  fill: number
  updatedAt: string
  /** 模擬：幾天前有人確認過這桶 */
  checkedDaysAgo?: number
  simulated?: boolean
}

export interface GridCell {
  id: string
  lat: number
  lng: number
  demand: number
  supply: number
  gap: number
  /** 位於開放資料缺漏的區域（例如北投區 0 筆），缺口無法判斷 */
  missingData?: boolean
}

export interface GridData {
  cellMeters: number
  cellSizeDeg: { lat: number; lng: number }
  weights: Record<string, number>
  cells: GridCell[]
  suggestions: string[]
}

/**
 * 回報類型。full／dirty／broken／other 是 Kyra 提案的「四類問題都能報」：
 * 垃圾桶已滿或溢出、周邊髒亂、損壞或無法使用、其他公共環境問題。
 */
export type ReportKind = 'full' | 'missing' | 'need' | 'ok' | 'dirty' | 'broken' | 'other'

export interface Report {
  id: string
  kind: ReportKind
  lat: number
  lng: number
  binId?: string
  createdAt: string
  /** 選填描述（最多 100 字） */
  note?: string
  /** 選填照片（壓縮後的 JPEG data URL） */
  photo?: string
}

/** 市民可以回報的四類問題 */
export const ISSUE_KINDS = ['full', 'dirty', 'broken', 'other'] as const

/** 案件編號：TBB-月日-四碼，由回報 id 算出，同一筆回報永遠是同一個編號 */
export function caseNo(r: Pick<Report, 'id' | 'createdAt'>): string {
  let h = 2166136261
  for (const ch of r.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const d = new Date(r.createdAt)
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `TBB-${md}-${(h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4)}`
}

export const REPORT_LABEL: Record<ReportKind, string> = {
  full: '滿了',
  missing: '不見了',
  need: '這裡需要一個',
  ok: '狀況良好',
  dirty: '周邊髒亂',
  broken: '損壞或無法使用',
  other: '其他環境問題',
}

export const REPORT_COLOR: Record<ReportKind, string> = {
  full: '#e5484d',
  missing: '#9aa9a1',
  need: '#ffc72c',
  ok: '#7fd6a4',
  dirty: '#a1887f',
  broken: '#9575cd',
  other: '#78909c',
}

export type FillState = 'ok' | 'busy' | 'full'

/** 填滿程度分三級；顏色之外一定搭配文字，不只靠顏色辨識 */
export function fillState(fill: number): FillState {
  return fill >= 0.8 ? 'full' : fill >= 0.5 ? 'busy' : 'ok'
}

export const FILL_META: Record<FillState, { label: string; color: string }> = {
  ok: { label: '還有空間', color: '#0b5d3b' },
  busy: { label: '半滿', color: '#c79400' },
  full: { label: '快滿了', color: '#e5484d' },
}
