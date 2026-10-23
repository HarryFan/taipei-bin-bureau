/**
 * 公開處理成績單：每一區回報後多快清運完成。
 *
 * 10/23 晚上松前小聚其他組的共識：市民要看得到後續（不是回報完就像丟進黑洞），
 * 議員、媒體、市民都能公開看到改善進度；處理夠快的單位給時效勳章（類似 CI 綠勾）。
 * 案件的定義和戰情室一致：同一桶、同一趟處理中的「滿了」回報合併成一個案件。
 */
import type { Dispatch } from './dispatch'
import { progressOf } from './tracking'
import type { Bin, Report } from '../types'

/** 時效勳章門檻（示範參數）：平均 60 分鐘內清運完成 */
export const FAST_MIN = 60

export interface CaseRecord {
  key: string
  binId: string
  district: string
  road: string
  reportedAt: string
  reporters: number
  closedAt?: string
  minutes?: number
  photo?: string
}

export interface DistrictScore {
  district: string
  reports: number
  open: number
  closed: number
  avgMin?: number
  fast: boolean
}

export function buildCases(reports: Report[], dispatches: Dispatch[], bins: Map<string, Bin>): CaseRecord[] {
  const map = new Map<string, CaseRecord>()
  // 由舊到新，案件的回報時間取第一筆
  for (const r of [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (r.kind !== 'full' || !r.binId) continue
    const p = progressOf(r, dispatches)
    const key = `${r.binId}:${p.dispatch?.id ?? 'open'}`
    const c = map.get(key)
    if (c) {
      c.reporters++
      continue
    }
    const bin = bins.get(r.binId)
    const done = p.reached === 4 ? p.dispatch : undefined
    map.set(key, {
      key,
      binId: r.binId,
      district: bin?.district ?? '',
      road: bin?.road ?? '',
      reportedAt: r.createdAt,
      reporters: 1,
      closedAt: done?.returnedAt,
      minutes: done?.returnedAt ? Math.max(1, Math.round((Date.parse(done.returnedAt) - Date.parse(r.createdAt)) / 60000)) : undefined,
      photo: done?.photo,
    })
  }
  return [...map.values()].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
}

export function districtScores(cases: CaseRecord[], reports: Report[], bins: Map<string, Bin>, districts: string[]): DistrictScore[] {
  const weekAgo = Date.now() - 7 * 86_400_000
  return districts
    .map((district) => {
      const mine = cases.filter((c) => c.district === district)
      const closed = mine.filter((c) => c.minutes !== undefined)
      const avgMin = closed.length ? Math.round(closed.reduce((s, c) => s + c.minutes!, 0) / closed.length) : undefined
      return {
        district,
        reports: reports.filter((r) => Date.parse(r.createdAt) >= weekAgo && r.binId && bins.get(r.binId)?.district === district).length,
        open: mine.length - closed.length,
        closed: closed.length,
        avgMin,
        fast: avgMin !== undefined && avgMin <= FAST_MIN,
      }
    })
    .sort((a, b) => (a.avgMin ?? Infinity) - (b.avgMin ?? Infinity) || b.reports - a.reports)
}
