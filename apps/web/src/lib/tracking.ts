/**
 * 回報追蹤：像追外送一樣看得到進度（Kyra 10/23 提案）。
 *
 *   已回報 → 已受理 → 已派車 → 前往中 → 清運完成
 *
 * 進度不是假的動畫，而是接戰情室的派車紀錄：
 *   - 已受理：回報進到戰情室（送出成功即算，戰情室三秒內會看到）
 *   - 已派車／前往中：有一趟出勤中的車，停靠點包含這一桶
 *   - 清運完成：那趟車按了「返隊」，且返隊時間晚於回報時間；顯示市府花了幾分鐘
 *
 * 「我的回報」只存在這個瀏覽器，不需要註冊；回報徽章也從這裡算。
 */
import type { Dispatch } from './dispatch'
import type { ReportKind } from '../types'

const KEY = 'tbb-my-reports'

export interface MyReport {
  id: string
  kind: ReportKind
  binId?: string
  createdAt: string
}

export function myReports(): MyReport[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyReport[]
  } catch {
    return []
  }
}

export function rememberReport(r: MyReport) {
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...myReports()].slice(0, 200)))
  } catch {
    /* 存不了就算了 */
  }
}

export type StepKey = 'reported' | 'accepted' | 'dispatched' | 'enroute' | 'done'

export const STEPS: { key: StepKey; title: string; voice: string }[] = [
  { key: 'reported', title: '已回報', voice: '桶：「我滿了！」' },
  { key: 'accepted', title: '已受理', voice: '桶報局：「收到！」' },
  { key: 'dispatched', title: '已派車', voice: '垃圾車：「出發啦」' },
  { key: 'enroute', title: '前往中', voice: '垃圾車：「快到了」' },
  { key: 'done', title: '清運完成', voice: '桶：「重生了！」' },
]

export interface Progress {
  /** 最後一個已完成的步驟（0 起算）；下一步就是進行中的步驟 */
  reached: number
  dispatch?: Dispatch
  /** 前往中：預估幾分鐘到這一桶 */
  etaMin?: number
  /** 清運完成：從回報到返隊花了幾分鐘 */
  tookMin?: number
}

export function progressOf(r: MyReport, dispatches: Dispatch[], now = Date.now()): Progress {
  if (!r.binId) return { reached: 1 }
  const t = Date.parse(r.createdAt)
  // 回報之後才返隊的那一趟：清運完成
  const done = dispatches.find((d) => d.stops.includes(r.binId!) && d.returnedAt && Date.parse(d.returnedAt) >= t)
  if (done) return { reached: 4, dispatch: done, tookMin: Math.max(1, Math.round((Date.parse(done.returnedAt!) - t) / 60000)) }
  // 還在路上的那一趟（回報前就出發、正好會經過也算）
  const active = dispatches.find((d) => d.stops.includes(r.binId!) && !d.returnedAt)
  if (active) {
    const idx = active.stops.indexOf(r.binId)
    const perStop = active.estMin / Math.max(1, active.stops.length + 1)
    const elapsed = (now - Date.parse(active.departedAt)) / 60000
    const etaMin = Math.max(0, Math.round((idx + 1) * perStop - elapsed))
    return { reached: 2, dispatch: active, etaMin }
  }
  return { reached: 1 }
}

/** 回報徽章：榮譽優先，次數門檻照 Kyra 提案（示範參數） */
export const BADGES = [
  { min: 10, name: '區域守護者', note: '年度表揚候選' },
  { min: 3, name: '巡守員', note: '進入區級月榜' },
  { min: 1, name: '新手小尖兵', note: '拿到第一枚徽章' },
]

export function badgeOf(count: number) {
  return BADGES.find((b) => count >= b.min)
}

export function nextBadge(count: number) {
  return [...BADGES].reverse().find((b) => count < b.min)
}
