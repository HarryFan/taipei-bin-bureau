/**
 * 示範情境：錄影片或現場 Demo 前一鍵放好幾筆有真實感的回報、案件與派車紀錄，
 * 戰情室和成績單不會空空的。只寫進這個瀏覽器（離線模式），不會送到 API。
 * 點位用開放資料的真實垃圾桶，以西門町（試辦區）周邊為主。
 */
import type { Bin, Report, ReportKind } from '../types'
import type { Dispatch } from './dispatch'
import type { CaseState } from './cases'

const XIMEN: [number, number] = [25.0422, 121.5079]
const KEYS = ['tbb-reports', 'tbb-dispatches', 'tbb-cases', 'tbb-my-reports']

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
let seq = 0
const id = () => `demo-${Date.now().toString(36)}-${(seq++).toString(36)}`

function nearest(bins: Bin[], at: [number, number], n: number, district?: string) {
  return bins
    .filter((b) => !district || b.district === district)
    .map((b) => ({ b, d: (b.lat - at[0]) ** 2 + (b.lng - at[1]) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.b)
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不了就算了 */
  }
}

export function clearDemo() {
  for (const k of KEYS) write(k, [])
}

export function seedDemo(bins: Bin[]) {
  clearDemo()
  const ximen = nearest(bins, XIMEN, 8, '萬華區')
  const others = ['中正區', '大安區', '信義區', '中山區'].map((d) => nearest(bins, XIMEN, 1, d)[0]).filter(Boolean)
  const reports: Report[] = []
  const rep = (b: Bin, kind: ReportKind, min: number, note?: string): Report => {
    const r: Report = { id: id(), kind, lat: b.lat, lng: b.lng, binId: b.id, createdAt: ago(min), ...(note ? { note } : {}) }
    reports.push(r)
    return r
  }

  // 西門町：已清運完成的一件（3 人回報），清運中的一件，待派車的一件
  const [b0, b1, b2, b3, b4, b5] = ximen
  rep(b0, 'full', 95)
  rep(b0, 'full', 92)
  rep(b0, 'full', 88)
  rep(b1, 'full', 40)
  rep(b2, 'full', 35)
  rep(b2, 'full', 33)
  rep(b3, 'full', 6)
  // 其他三類問題：人工分流的不同階段
  const dirty = rep(b4, 'dirty', 50, '垃圾桶旁邊被放了一袋家庭垃圾')
  const broken = rep(b5, 'broken', 70, '桶蓋卡住打不開')
  const other = others[0] ? rep(others[0], 'other', 120, '附近人行道有碎玻璃') : undefined
  if (others[1]) rep(others[1], 'dirty', 12, '桶口周圍有飲料潑灑')
  if (others[2]) rep(others[2], 'full', 18)
  if (others[3]) rep(others[3], 'need', 25)

  const dispatches: Dispatch[] = [
    // 已返隊：回報到返隊 26 分鐘
    { id: id(), district: '萬華區', truck: 1, stops: [b0.id], km: 2.4, estMin: 24, departedAt: ago(80), returnedAt: ago(62) },
    // 出勤中
    { id: id(), district: '萬華區', truck: 2, stops: [b1.id, b2.id], km: 3.1, estMin: 30, departedAt: ago(12) },
  ]

  const at = (min: number) => ago(min)
  const cases: CaseState[] = [
    { key: dirty.id, step: 'forwarded', unit: '清潔隊', history: [{ step: 'confirmed', at: at(45) }, { step: 'forwarded', unit: '清潔隊', at: at(42) }] },
    { key: broken.id, step: 'done', unit: '環保局維修', history: [{ step: 'confirmed', at: at(65) }, { step: 'forwarded', unit: '環保局維修', at: at(60) }, { step: 'done', at: at(20) }] },
    ...(other ? [{ key: other.id, step: 'confirmed' as const, history: [{ step: 'confirmed' as const, at: at(100) }] }] : []),
  ]

  write('tbb-reports', reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  write('tbb-dispatches', dispatches)
  write('tbb-cases', cases)
}
