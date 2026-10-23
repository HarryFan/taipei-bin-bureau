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
}

export interface GridCell {
  id: string
  lat: number
  lng: number
  demand: number
  supply: number
  gap: number
}

export interface GridData {
  cellMeters: number
  cellSizeDeg: { lat: number; lng: number }
  weights: Record<string, number>
  cells: GridCell[]
  suggestions: string[]
}

export type ReportKind = 'full' | 'missing' | 'need'

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
}
