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

export type ReportKind = 'full' | 'missing' | 'need' | 'ok'

export interface Report {
  id: string
  kind: ReportKind
  lat: number
  lng: number
  binId?: string
  createdAt: string
}

export const REPORT_LABEL: Record<ReportKind, string> = {
  full: '滿了',
  missing: '不見了',
  need: '這裡需要一個',
  ok: '狀況良好',
}

export const REPORT_COLOR: Record<ReportKind, string> = {
  full: '#e5484d',
  missing: '#9aa9a1',
  need: '#ffc72c',
  ok: '#7fd6a4',
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
