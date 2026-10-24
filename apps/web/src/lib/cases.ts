/**
 * 人工案件分流（Kyra 提案 MVP：管理端確認後轉交）。
 *
 * 「滿了」走派車流程（派車＝轉交清潔隊）。其他三類問題——周邊髒亂、損壞、其他——
 * 由管理端逐件處理：確認受理 → 轉交單位 → 處理完成（可附照片），每一步都留紀錄。
 *
 * 同一桶、同一類、還沒結案的回報合併成一個案件，案件的 key 是第一筆回報的 id。
 * 和派車紀錄一樣離線優先：有 API 用 API，連不上存瀏覽器。
 *   GET /api/cases → CaseState[]
 *   PUT /api/cases/:key  body: CaseState → 200
 */
import { caseNo, type Report, type ReportKind } from '../types'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '') || undefined
const KEY = 'tbb-cases'

export type CaseStep = 'confirmed' | 'forwarded' | 'done'
export const FORWARD_UNITS = ['清潔隊', '環保局維修', '其他局處'] as const

export interface CaseState {
  key: string
  step: CaseStep
  unit?: string
  photo?: string
  history: { step: CaseStep; unit?: string; at: string }[]
}

export interface IssueCase {
  key: string
  no: string
  kind: ReportKind
  binId?: string
  reports: Report[]
  latest: Report
  state?: CaseState
}

export const ISSUE_STEPS = [
  { key: 'reported', title: '已回報' },
  { key: 'confirmed', title: '已確認' },
  { key: 'forwarded', title: '已轉交' },
  { key: 'done', title: '處理完成' },
] as const

export const isIssue = (k: ReportKind) => k === 'dirty' || k === 'dumping' || k === 'broken' || k === 'other'

function readLocal(): CaseState[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CaseState[]
  } catch {
    return []
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`${API}${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error(`${path} 回應 ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function loadCaseStates(): Promise<CaseState[]> {
  if (API) {
    try {
      return await api<CaseState[]>('/api/cases')
    } catch {
      /* 退回本機 */
    }
  }
  return readLocal()
}

export async function advanceCase(key: string, step: CaseStep, extra: { unit?: string; photo?: string } = {}): Promise<void> {
  const list = readLocal()
  const prev = list.find((c) => c.key === key)
  const next: CaseState = {
    key,
    step,
    unit: extra.unit ?? prev?.unit,
    photo: extra.photo ?? prev?.photo,
    history: [...(prev?.history ?? []), { step, unit: extra.unit, at: new Date().toISOString() }],
  }
  if (API) {
    try {
      await api(`/api/cases/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(next) })
      return
    } catch {
      /* 退回本機 */
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([next, ...list.filter((c) => c.key !== key)].slice(0, 300)))
  } catch {
    /* 存不了就算了 */
  }
}

export function onLocalCasesChange(cb: () => void): () => void {
  const h = (e: StorageEvent) => e.key === KEY && cb()
  addEventListener('storage', h)
  return () => removeEventListener('storage', h)
}

/** 把這幾類問題的回報合併成案件：同一桶（或同一地點）、同一類、還沒結案的回報算同一件 */
export function groupIssueCases(reports: Report[], states: CaseState[]): IssueCase[] {
  const byKey = new Map(states.map((s) => [s.key, s]))
  const open = new Map<string, IssueCase>()
  const all: IssueCase[] = []
  for (const r of [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!isIssue(r.kind)) continue
    const where = r.binId ?? `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`
    const g = `${where}:${r.kind}`
    const cur = open.get(g)
    if (cur && cur.state?.step !== 'done') {
      cur.reports.push(r)
      cur.latest = r
      continue
    }
    const c: IssueCase = { key: r.id, no: caseNo(r), kind: r.kind, binId: r.binId, reports: [r], latest: r, state: byKey.get(r.id) }
    open.set(g, c)
    all.push(c)
  }
  return all.reverse()
}

/** 某筆回報屬於哪個案件 */
export function caseOfReport(reportId: string, cases: IssueCase[]) {
  return cases.find((c) => c.reports.some((r) => r.id === reportId))
}

/** 0 已回報、1 已確認、2 已轉交、3 處理完成 */
export function issueReached(c?: IssueCase) {
  return !c?.state ? 0 : c.state.step === 'confirmed' ? 1 : c.state.step === 'forwarded' ? 2 : 3
}
