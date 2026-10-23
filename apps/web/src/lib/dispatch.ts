/**
 * 派車紀錄：市府人員按「派車」記下出發時間，車子回來按「返隊」記下返隊時間。
 * 累積下來就能比較各區、各趟的實際用時與預估，作為之後調度優化的依據。
 *
 * 和市民回報一樣離線優先：有 VITE_API_URL 就打 API，連不上就存瀏覽器。
 * 後端端點（Pamis 的 .NET 版照這個實作即可）：
 *   GET   /api/dispatches            → Dispatch[]（新到舊）
 *   POST  /api/dispatches            body: Dispatch → 201
 *   PATCH /api/dispatches/:id        body: { returnedAt?, photo? } → 200
 */
const API = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '') || undefined
const KEY = 'tbb-dispatches'

export interface Dispatch {
  id: string
  /** 行政區，一區一個清潔隊 */
  district: string
  /** 該區第幾台車（1 起算） */
  truck: number
  /** 停靠的垃圾桶 id，依順序 */
  stops: string[]
  km: number
  /** 預估分鐘：行駛 + 每桶作業時間 */
  estMin: number
  departedAt: string
  returnedAt?: string
  /** 清運完成照片（壓縮後的 JPEG data URL），市民端「清運完成」會顯示 */
  photo?: string
}

/** 預估用時：市區垃圾車平均時速約 18 公里，每桶清運約 3 分鐘（示意參數，之後用實際紀錄校正） */
export const AVG_KMH = 18
export const MIN_PER_STOP = 3
export const estimateMinutes = (km: number, stops: number) => Math.round((km / AVG_KMH) * 60 + stops * MIN_PER_STOP)

function readLocal(): Dispatch[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Dispatch[]
  } catch {
    return []
  }
}

function writeLocal(list: Dispatch[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300)))
  } catch {
    /* 存不了就算了 */
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

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function loadDispatches(): Promise<Dispatch[]> {
  if (API) {
    try {
      return await api<Dispatch[]>('/api/dispatches')
    } catch {
      /* 退回本機 */
    }
  }
  return readLocal()
}

export async function createDispatch(input: Omit<Dispatch, 'id' | 'departedAt'>): Promise<Dispatch> {
  const d: Dispatch = { ...input, id: uid(), departedAt: new Date().toISOString() }
  if (API) {
    try {
      await api('/api/dispatches', { method: 'POST', body: JSON.stringify(d) })
      return d
    } catch {
      /* 退回本機 */
    }
  }
  writeLocal([d, ...readLocal()])
  return d
}

export async function markReturned(id: string): Promise<void> {
  const returnedAt = new Date().toISOString()
  if (API) {
    try {
      await api(`/api/dispatches/${id}`, { method: 'PATCH', body: JSON.stringify({ returnedAt }) })
      return
    } catch {
      /* 退回本機 */
    }
  }
  writeLocal(readLocal().map((d) => (d.id === id ? { ...d, returnedAt } : d)))
}

/** 清運完成拍照回傳：補一張照片到這一趟（Kyra 提案「拍照打卡」） */
export async function attachPhoto(id: string, photo: string): Promise<void> {
  if (API) {
    try {
      await api(`/api/dispatches/${id}`, { method: 'PATCH', body: JSON.stringify({ photo }) })
      return
    } catch {
      /* 退回本機 */
    }
  }
  writeLocal(readLocal().map((d) => (d.id === id ? { ...d, photo } : d)))
}

/** 手機照片動輒好幾 MB，先縮到長邊 640px 的 JPEG（約 50KB）再存 */
export function compressPhoto(file: File, maxSide = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('讀不到這張照片'))
    }
    img.src = url
  })
}

export function clearLocalDispatches() {
  writeLocal([])
}

export function onLocalDispatchChange(cb: () => void): () => void {
  const h = (e: StorageEvent) => e.key === KEY && cb()
  addEventListener('storage', h)
  return () => removeEventListener('storage', h)
}

export const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
