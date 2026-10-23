/**
 * 巡桶綠點（示意）
 *
 * Demo 版只存在這個瀏覽器，不連任何點數系統。規則刻意示範正式版的防弊原則：
 * 1. 回報什麼狀態都拿一樣的點數：說「滿了」不會比較多，沒有說謊的誘因
 * 2. 要掃垃圾桶上的 QR Code 才給點：只看地圖按按鈕不給點
 * 3. 同一桶每天只算一次、每天有上限
 * 4. 點數先列為「待確認」，要有其他人的回報或清潔隊紀錄吻合才發放
 * 5. 丟垃圾不給點：只獎勵檢查和回報
 * 詳見 docs/REWARDS.md
 */

import type { ReportKind } from '../types'

export const POINTS = {
  scan: 5, // 掃碼回報一桶
  staleBonus: 5, // 這桶超過 STALE_DAYS 天沒人確認
  desert: 3, // 在沒有垃圾桶的地方回報「這裡需要一個」（需要定位）
  dailyCap: 30,
}
export const STALE_DAYS = 14

export type RewardStatus = 'pending' | 'confirmed'

export interface RewardEntry {
  id: string
  target: string // binId 或 'here:<lat>,<lng>'
  at: string
  points: number
  reason: string
  status: RewardStatus
}

export interface ClaimInput {
  kind: ReportKind
  binId?: string
  scanned: boolean
  located: boolean
  stale: boolean
  lat: number
  lng: number
}

export interface ClaimResult {
  points: number
  message: string
}

const KEY = 'tbb-rewards'

function read(): RewardEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RewardEntry[]
  } catch {
    return []
  }
}

function write(entries: RewardEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 500)))
  } catch {
    /* 無痕模式存不了就算了 */
  }
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export function ledger(): RewardEntry[] {
  return read()
}

export function totals(entries = read()) {
  const today = new Date()
  return {
    confirmed: entries.filter((e) => e.status === 'confirmed').reduce((s, e) => s + e.points, 0),
    pending: entries.filter((e) => e.status === 'pending').reduce((s, e) => s + e.points, 0),
    today: entries.filter((e) => sameDay(new Date(e.at), today)).reduce((s, e) => s + e.points, 0),
  }
}

/** 試算這次回報能拿幾點，並說明原因；回報本身不受影響，一律會送出 */
export function claim(input: ClaimInput): ClaimResult {
  const entries = read()
  const now = new Date()
  const target = input.binId ?? `here:${input.lat.toFixed(3)},${input.lng.toFixed(3)}`

  let points = 0
  let reason = ''
  if (input.kind === 'need') {
    if (!input.located) return { points: 0, message: '開啟定位後，回報「這裡需要垃圾桶」才能領點' }
    points = POINTS.desert
    reason = '回報這裡需要垃圾桶'
  } else {
    if (!input.scanned) return { points: 0, message: '掃描垃圾桶上的 QR Code 回報，才能領綠點' }
    points = POINTS.scan + (input.stale ? POINTS.staleBonus : 0)
    reason = input.stale ? '確認了很久沒人確認的垃圾桶' : '確認垃圾桶狀況'
  }

  if (entries.some((e) => e.target === target && sameDay(new Date(e.at), now))) {
    return { points: 0, message: '這個地點今天已經領過綠點，明天再來' }
  }
  const left = POINTS.dailyCap - totals(entries).today
  if (left <= 0) return { points: 0, message: `今天已達上限 ${POINTS.dailyCap} 點` }
  points = Math.min(points, left)

  const entry: RewardEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    target,
    at: now.toISOString(),
    points,
    reason,
    status: 'pending',
  }
  write([entry, ...entries])
  return { points, message: `+${points} 綠點，待確認` }
}
