<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import { useRoute } from 'vue-router'
import { isMock, loadBins, loadFillLevels, loadGrid, loadMeta, loadReports, submitReport } from '../lib/data'
import { shortCode, verifyBin } from '../lib/qr'
import { claim, POINTS, STALE_DAYS, totals } from '../lib/rewards'
import { bearingDeg, compassWord, distanceMeters, walkingMinutes, type LatLng } from '../lib/geo'
import { compressPhoto, loadDispatches, onLocalDispatchChange, type Dispatch } from '../lib/dispatch'
import { caseOfReport, groupIssueCases, ISSUE_STEPS, issueReached, loadCaseStates, onLocalCasesChange, type CaseState } from '../lib/cases'
import { badgeOf, myReports, nextBadge, progressOf, rememberReport, STEPS } from '../lib/tracking'
import { caseNo, FILL_META, fillState, REPORT_LABEL, type Bin, type GridCell, type GridData, type Report, type ReportKind } from '../types'
import type { City3D } from '../lib/city3d'

type LocateState = 'locating' | 'ok' | 'denied'

const mapEl = ref<HTMLElement>()
const sheetEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const bins = ref<Bin[]>([])
const fills = ref(new Map<string, number>())
const here = ref<LatLng>(TAIPEI)
const locateState = ref<LocateState>('locating')
const pickedId = ref<string>()
const reported = ref(new Set<string>())
const sending = ref<string>()
const toast = ref('')
const collapsed = ref(false)
const mock = ref(true)
const arrowDeg = ref(0)
const route = useRoute()
/** 掃碼開啟的垃圾桶；簽章不符時 scanValid = false */
const scannedId = ref<string>()
const scanValid = ref<boolean>()
const checkedDays = ref(new Map<string, number>())
const points = ref(totals())
const gapCells = ref<GridCell[]>([])
const mine = ref(myReports())
const dispatches = ref<Dispatch[]>([])
const allReports = ref<Report[]>([])
/**
 * 這桶 30 分鐘內已經有人回報「滿了」、還沒清運完成：告訴市民「處理中」（Kyra 提案）。
 * 再回報一樣會送出，戰情室會合併到同一個案件。
 */
const OPEN_CASE_MIN = 30
const openCase = computed(() => {
  const bin = target.value?.bin
  if (!bin) return undefined
  const since = now.value - OPEN_CASE_MIN * 60_000
  const mineIds = new Set(mine.value.map((r) => r.id))
  const list = allReports.value.filter((r) => r.binId === bin.id && r.kind === 'full' && Date.parse(r.createdAt) >= since && progressOf(r, dispatches.value).reached < 4)
  if (!list.length || list.every((r) => mineIds.has(r.id))) return undefined
  const enroute = list.some((r) => progressOf(r, dispatches.value).reached === 2)
  return { count: list.length, status: enroute ? '清運車已出發' : '已受理，等待派車' }
})
const now = ref(Date.now())
const badge = computed(() => badgeOf(mine.value.length))
const upcoming = computed(() => nextBadge(mine.value.length))
const binById = computed(() => new Map(bins.value.map((b) => [b.id, b])))
const caseStates = ref<CaseState[]>([])
const issueCases = computed(() => groupIssueCases(allReports.value, caseStates.value))
/**
 * 追蹤最近一筆回報（24 小時內）。
 * 「滿了」走派車流程（五步驟）；周邊髒亂、損壞、其他走人工分流（四步驟：已回報、已確認、已轉交、處理完成）。
 */
const TRACKABLE: ReportKind[] = ['full', 'dirty', 'broken', 'other']
const tracked = computed(() => {
  const r = mine.value.find((x) => TRACKABLE.includes(x.kind) && (x.kind !== 'full' || x.binId) && now.value - Date.parse(x.createdAt) < 86_400_000)
  if (!r) return undefined
  const bin = r.binId ? binById.value.get(r.binId) : undefined
  if (r.kind === 'full') return { type: 'full' as const, report: r, bin, no: caseNo(r), progress: progressOf(r, dispatches.value, now.value) }
  const c = caseOfReport(r.id, issueCases.value)
  return { type: 'issue' as const, report: r, bin, no: c?.no ?? caseNo(r), issue: c, reached: issueReached(c) }
})
let trackTimer: ReturnType<typeof setInterval> | undefined
let stopDispatchListen: (() => void) | undefined
let stopCasesListen: (() => void) | undefined
async function refreshTracking() {
  now.value = Date.now()
  loadReports().then((r) => (allReports.value = r)).catch(() => {})
  if (!tracked.value) return
  if (tracked.value.type === 'issue') {
    caseStates.value = await loadCaseStates()
    return
  }
  // 清運完成後仍繼續更新一陣子，才收得到清潔隊補傳的照片
  if (tracked.value.progress.reached >= 4 && tracked.value.progress.dispatch?.photo) return
  dispatches.value = await loadDispatches()
}

let binLayer: L.LayerGroup | undefined
let focusLayer: L.LayerGroup | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined

const ranked = computed(() =>
  bins.value
    .map((bin) => ({ bin, meters: distanceMeters(here.value, [bin.lat, bin.lng]) }))
    .sort((a, b) => a.meters - b.meters),
)
const target = computed(() => ranked.value.find((r) => r.bin.id === pickedId.value) ?? ranked.value[0])
const fillOf = (id: string) => fills.value.get(id) ?? 0
const targetFill = computed(() => (target.value ? fillOf(target.value.bin.id) : 0))
const targetState = computed(() => fillState(targetFill.value))
/** 目標快滿時，推薦最近一個還有空間的 */
const alternative = computed(() =>
  targetState.value === 'full'
    ? ranked.value.find((r) => r.bin.id !== target.value?.bin.id && fillState(fillOf(r.bin.id)) !== 'full')
    : undefined,
)
/** 最近的垃圾桶太遠（鏟屎特工隊的做法）：直接請市民回報這裡需要一個 */
const FAR_M = 300
const tooFar = computed(() => !scanValid.value && !!ranked.value[0] && ranked.value[0].meters > FAR_M)
const nearby = computed(() => ranked.value.filter((r) => r.bin.id !== target.value?.bin.id).slice(0, 5))
const isScanned = (bin?: Bin) => !!bin && scanValid.value === true && scannedId.value === bin.id
const isStale = (id: string) => (checkedDays.value.get(id) ?? 0) >= STALE_DAYS

/**
 * 巡桶任務：依「資料價值」排序，不是依距離。
 * 很久沒人確認的桶、附近疑似沒有垃圾桶的地方，最值得去看。
 */
const quests = computed(() => {
  const staleBins = ranked.value
    .slice(0, 40)
    .filter((r) => isStale(r.bin.id) && r.meters < 1200)
    .slice(0, 2)
    .map((r) => ({
      id: r.bin.id,
      title: r.bin.road,
      detail: `${checkedDays.value.get(r.bin.id)} 天沒人確認`,
      meters: r.meters,
      reward: POINTS.scan + POINTS.staleBonus,
      bin: r.bin,
    }))
  const maxGap = Math.max(0.0001, ...gapCells.value.map((c) => c.gap))
  const desert = gapCells.value
    .filter((c) => c.supply === 0 && c.gap / maxGap > 0.4)
    .map((c) => ({ c, meters: distanceMeters(here.value, [c.lat, c.lng]) }))
    .filter((x) => x.meters < 1500)
    .sort((a, b) => a.meters - b.meters)[0]
  return { staleBins, desert }
})

const bearing = computed(() => (target.value ? bearingDeg(here.value, [target.value.bin.lat, target.value.bin.lng]) : 0))

const locateText = computed(
  () =>
    ({
      locating: '正在找你的位置',
      ok: '依你目前的位置',
      denied: '沒有定位權限，先以台北車站示範',
    })[locateState.value],
)

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function drawBins() {
  if (!map.value) return
  binLayer?.remove()
  binLayer = L.layerGroup().addTo(map.value)
  for (const b of bins.value) {
    const state = fillState(fillOf(b.id))
    L.circleMarker([b.lat, b.lng], {
      radius: 6,
      color: '#ffffff',
      weight: 1.5,
      fillColor: FILL_META[state].color,
      fillOpacity: 0.95,
    })
      .bindTooltip(`${escapeHtml(b.road)}<br>${FILL_META[state].label}`, { direction: 'top', offset: [0, -6] })
      .on('click', () => pick(b.id))
      .addTo(binLayer)
  }
}

const PIN_HTML = `
  <div style="width:44px;height:52px;filter:drop-shadow(0 6px 10px rgb(16 37 28 / .35))">
    <svg viewBox="0 0 44 52" width="44" height="52" aria-hidden="true">
      <path d="M22 51 L12 38 H6 a6 6 0 0 1 -6 -6 V6 a6 6 0 0 1 6 -6 H38 a6 6 0 0 1 6 6 V32 a6 6 0 0 1 -6 6 H32 Z" fill="#0b5d3b"/>
      <rect x="3" y="3" width="38" height="32" rx="4" fill="none" stroke="#fff" stroke-width="2"/>
      <path d="M14 13 H30 M17 13 V10 H27 V13 M15.5 16 L17 29 H27 L28.5 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>`

function drawFocus() {
  if (!map.value || !target.value) return
  focusLayer?.remove()
  focusLayer = L.layerGroup().addTo(map.value)
  const t: LatLng = [target.value.bin.lat, target.value.bin.lng]
  L.polyline([here.value, t], { color: '#0b5d3b', weight: 4, dashArray: '2 10', lineCap: 'round', opacity: 0.9 }).addTo(focusLayer)
  L.circleMarker(here.value, { radius: 16, stroke: false, fillColor: '#2f6fed', fillOpacity: 0.18 }).addTo(focusLayer)
  L.circleMarker(here.value, { radius: 7, color: '#ffffff', weight: 3, fillColor: '#2f6fed', fillOpacity: 1 })
    .bindTooltip('你在這裡')
    .addTo(focusLayer)
  L.marker(t, { icon: L.divIcon({ className: '', html: PIN_HTML, iconSize: [44, 52], iconAnchor: [22, 51] }), keyboard: false }).addTo(focusLayer)
}

/** 把「你」和目標都框進畫面，並避開清單面板 */
function frame(animate = false) {
  if (!map.value || !target.value) return
  // 前一個動畫還沒跑完時再呼叫 fitBounds 會被吃掉，先停掉
  map.value.stop()
  const sheet = sheetEl.value
  const mobile = innerWidth < 768
  const pad = 56
  const bounds = L.latLngBounds([here.value, [target.value.bin.lat, target.value.bin.lng]])
  map.value.fitBounds(bounds, {
    paddingTopLeft: [mobile ? pad : (sheet?.offsetWidth ?? 0) + 32 + pad, pad + 48],
    paddingBottomRight: [pad, mobile ? (sheet?.offsetHeight ?? 0) + pad : pad],
    maxZoom: 18,
    animate,
  })
}

let animateNextFrame = false
function pick(id?: string) {
  animateNextFrame = true
  pickedId.value = id
}

function locate() {
  if (!navigator.geolocation) {
    locateState.value = 'denied'
    return
  }
  locateState.value = 'locating'
  navigator.geolocation.getCurrentPosition(
    (p) => {
      locateState.value = 'ok'
      // 掃碼開啟時，人就在那一桶旁邊，保留掃到的位置與目標
      if (scanValid.value) return
      here.value = [p.coords.latitude, p.coords.longitude]
      pickedId.value = undefined
    },
    () => (locateState.value = 'denied'),
    { enableHighAccuracy: true, timeout: 8000 },
  )
}

/** 回報完成可以分享到社群（Kyra 提案：我為台北做了一件小事） */
async function share() {
  const url = `${location.origin}${location.pathname}`
  const text = '我為台北做了一件小事：回報了一個滿出來的垃圾桶。台北市是大家的，乾淨也是。'
  try {
    if (navigator.share) {
      await navigator.share({ title: '台北桶報局', text, url })
      return
    }
    await navigator.clipboard.writeText(`${text} ${url}`)
    showToast('已複製分享文字，貼到社群就可以')
  } catch {
    /* 使用者取消分享 */
  }
}

function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

const keyOf = (kind: ReportKind, bin?: Bin) => `${bin?.id ?? 'here'}:${kind}`

// ---------- 四類問題都能報：描述與照片選填 ----------
const showIssue = ref(false)
const issueKind = ref<'dirty' | 'broken' | 'other'>('dirty')
const issueNote = ref('')
const issuePhoto = ref<string>()
async function pickIssuePhoto(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    issuePhoto.value = await compressPhoto(file)
  } catch {
    showToast('讀不到這張照片，換一張試試')
  }
}
async function sendIssue() {
  await report(issueKind.value, target.value?.bin, { note: issueNote.value.trim() || undefined, photo: issuePhoto.value })
  if (reported.value.has(keyOf(issueKind.value, target.value?.bin))) {
    showIssue.value = false
    issueNote.value = ''
    issuePhoto.value = undefined
  }
}

async function report(kind: ReportKind, bin?: Bin, extra: { note?: string; photo?: string } = {}) {
  const key = keyOf(kind, bin)
  if (sending.value || reported.value.has(key)) return
  sending.value = key
  try {
    const at: LatLng = bin ? [bin.lat, bin.lng] : here.value
    const sent = await submitReport({ kind, lat: at[0], lng: at[1], binId: bin?.id, ...extra })
    allReports.value = [sent, ...allReports.value]
    const before = badgeOf(mine.value.length)
    rememberReport({ id: sent.id, kind, binId: bin?.id, createdAt: sent.createdAt })
    mine.value = myReports()
    const after = badgeOf(mine.value.length)
    if (after && after !== before) setTimeout(() => showToast(`獲得徽章「${after.name}」`), 4400)
    reported.value = new Set([...reported.value, key])
    navigator.vibrate?.(30)
    if (kind === 'full' && bin) fills.value = new Map(fills.value).set(bin.id, 1)
    // 綠點：回報什麼狀態都一樣，只看有沒有掃碼、這桶多久沒人確認
    const reward = claim({
      kind,
      binId: bin?.id,
      scanned: isScanned(bin),
      located: locateState.value === 'ok' || scanValid.value === true,
      stale: bin ? isStale(bin.id) : false,
      lat: at[0],
      lng: at[1],
    })
    points.value = totals()
    if (bin) checkedDays.value = new Map(checkedDays.value).set(bin.id, 0)
    const msg = kind === 'need' ? '已回報這裡需要垃圾桶，市府會看到' : `已回報「${REPORT_LABEL[kind]}」`
    showToast(reward.points ? `${msg}，${reward.message}` : msg)
    if (!reward.points) setTimeout(() => showToast(reward.message), 2200)
  } catch {
    showToast('沒有送出去，請確認網路後再按一次')
  } finally {
    sending.value = undefined
  }
}

watch([bins, fills], drawBins)
watch([target, here], async () => {
  drawFocus()
  await nextTick()
  sync3d()
  frame(animateNextFrame)
  animateNextFrame = false
})
watch(bearing, (deg) => {
  // 走最短的旋轉方向，箭頭不會繞一大圈
  const cur = arrowDeg.value
  const delta = ((deg - cur + 540) % 360) - 180
  arrowDeg.value = cur + delta
})
watch(collapsed, async () => {
  await nextTick()
  frame(true)
  sync3d()
})

// ---------- 3D 城市：和市府戰情室同一個場景，three.js 只在打開時才載入 ----------
const show3d = ref(false)
const stage3d = ref<HTMLElement>()
let city: City3D | undefined
let grid: GridData | undefined
function sync3d() {
  if (!city || !target.value) return
  const t: LatLng = [target.value.bin.lat, target.value.bin.lng]
  const mobile = innerWidth < 768
  city.setInsetLeft(mobile ? 0 : (sheetEl.value?.offsetWidth ?? 0) + 32)
  city.setInsetBottom(mobile ? (sheetEl.value?.offsetHeight ?? 0) : 0)
  city.setWalk(here.value, t)
  city.flyToPoints([here.value, t], 75, 2.6)
}
watch(show3d, async (on) => {
  if (!on) {
    city?.dispose()
    city = undefined
    return
  }
  const { City3D } = await import('../lib/city3d')
  await nextTick()
  if (!show3d.value || city || !stage3d.value || !grid) return
  // 原點和戰情室一樣，光影範圍才會蓋住整個台北
  city = new City3D(stage3d.value, { lat: 25.05, lng: 121.545 })
  city.onPick = (b) => pick(b.id)
  city.build(bins.value, grid)
  city.updateBins(fills.value, 0.8)
  sync3d()
})
watch(fills, (f) => city?.updateBins(f, 0.8))

onMounted(async () => {
  map.value = createMap(mapEl.value!, { zoom: 16 })
  const [b, f, meta, g] = await Promise.all([loadBins(), loadFillLevels(), loadMeta(), loadGrid()])
  mock.value = isMock(meta)
  fills.value = new Map(f.map((x) => [x.id, x.fill]))
  checkedDays.value = new Map(f.map((x) => [x.id, x.checkedDaysAgo ?? 0]))
  gapCells.value = g.cells.filter((c) => c.gap > 0)
  grid = g
  bins.value = b
  applyScan()
  locate()
  dispatches.value = await loadDispatches()
  allReports.value = await loadReports().catch(() => [])
  trackTimer = setInterval(refreshTracking, 3000)
  stopDispatchListen = onLocalDispatchChange(refreshTracking)
  caseStates.value = await loadCaseStates()
  stopCasesListen = onLocalCasesChange(refreshTracking)
})

/** 掃碼開啟：核對簽章；通過就把目標設成這一桶，並當作人就在桶旁邊 */
function applyScan() {
  const id = route.params.id as string | undefined
  if (!id) {
    scannedId.value = undefined
    scanValid.value = undefined
    return
  }
  const bin = bins.value.find((b) => b.id === id)
  scannedId.value = id
  scanValid.value = !!bin && verifyBin(id, route.query.s as string | undefined)
  if (bin && scanValid.value) {
    here.value = [bin.lat, bin.lng]
    pickedId.value = id
  }
}
watch(() => route.fullPath, applyScan)

onBeforeUnmount(() => {
  clearInterval(trackTimer)
  stopDispatchListen?.()
  stopCasesListen?.()
  clearTimeout(toastTimer)
  map.value?.remove()
  city?.dispose()
})
</script>

<template>
  <div class="relative h-full overflow-hidden bg-paper">
    <div ref="mapEl" class="absolute inset-0" />
    <!-- 3D 城市蓋在地圖上；isolate 讓 CSS2D 標籤的 z-index 不會蓋過面板 -->
    <!-- z-[1000]：蓋過 Leaflet 的縮放鈕；面板同層但在後面，所以面板仍在上面 -->
    <div v-if="show3d" class="absolute inset-0 isolate z-[1000] grid place-items-center bg-paper text-sm text-mute">
      城市生成中…
      <div ref="stage3d" class="absolute inset-0" />
    </div>

    <!-- 頂部：品牌與工具 -->
    <header class="pointer-events-none absolute inset-x-0 top-0 z-[1001] flex items-start justify-between gap-2 p-3 md:p-4">
      <div class="pointer-events-auto flex items-center gap-2">
        <div class="rounded-[10px] bg-sign p-[3px] shadow-lg shadow-ink/20">
          <div class="rounded-[7px] border-[1.5px] border-white/90 px-3 py-1.5 text-[15px] font-bold tracking-[0.08em] whitespace-nowrap text-white">台北桶報局</div>
        </div>
        <span v-if="mock" class="hidden rounded-full bg-white/90 px-2.5 py-1 text-xs whitespace-nowrap text-mute shadow-sm backdrop-blur sm:inline">模擬資料</span>
      </div>
      <div
        class="pointer-events-auto ml-auto flex items-baseline gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs whitespace-nowrap text-sign shadow-sm backdrop-blur"
        :title="`已確認 ${points.confirmed} 點，待確認 ${points.pending} 點。示意功能，點數只存在這個瀏覽器`"
      >
        綠點
        <span class="num text-base font-bold">{{ points.confirmed + points.pending }}</span>
        <span class="text-[10px] text-mute">示意</span>
        <span
          v-if="badge"
          class="ml-1 rounded-full bg-truck px-2 py-0.5 text-[11px] font-bold text-ink"
          :title="`已回報 ${mine.length} 次。${badge.note}${upcoming ? `；再 ${upcoming.min - mine.length} 次升級「${upcoming.name}」` : ''}`"
        >{{ badge.name }}</span>
      </div>
      <div class="pointer-events-auto flex items-center gap-2">
        <button class="rounded-full bg-white/90 px-3 py-2 text-xs font-bold whitespace-nowrap text-sign shadow-sm backdrop-blur hover:bg-white" :aria-pressed="show3d" @click="show3d = !show3d">
          {{ show3d ? '2D 地圖' : '3D 城市' }}
        </button>
        <RouterLink to="/admin" class="rounded-full bg-white/90 px-3 py-2 text-xs font-bold whitespace-nowrap text-sign shadow-sm backdrop-blur hover:bg-white">市府戰情</RouterLink>
        <button
          class="grid h-10 w-10 place-items-center rounded-full bg-white text-sign shadow-md transition active:scale-95"
          :aria-label="locateState === 'locating' ? '定位中' : '重新定位'"
          @click="locate"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" :class="locateState === 'locating' && 'animate-spin'" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 面板：手機在下方、桌機在左側 -->
    <section
      ref="sheetEl"
      class="absolute inset-x-0 bottom-0 z-[1000] flex max-h-[64%] flex-col rounded-t-[22px] bg-white shadow-[0_-12px_40px_rgb(16_37_28/0.18)] md:inset-x-auto md:top-20 md:bottom-4 md:left-4 md:max-h-none md:w-[400px] md:rounded-[22px]"
    >
      <button class="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" :aria-label="collapsed ? '展開清單' : '收合清單'" @click="collapsed = !collapsed">
        <span class="h-1.5 w-10 rounded-full bg-hair" />
      </button>

      <div class="overflow-y-auto px-4 pb-4 md:pt-4">
        <div
          v-if="scanValid === true && scannedId"
          class="mb-3 flex items-center gap-3 rounded-[12px] border-2 border-sign bg-sign-soft px-3 py-2.5 text-sign"
          role="status"
        >
          <svg viewBox="0 0 24 24" class="h-6 w-6 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" stroke-linecap="round" />
          </svg>
          <p class="text-sm leading-snug">
            已掃描垃圾桶 <span class="num text-base font-bold">{{ shortCode(scannedId) }}</span><br />
            <span class="text-xs">請核對貼紙上的編號是否相同</span>
          </p>
        </div>
        <div v-else-if="scanValid === false" class="mb-3 rounded-[12px] border-2 border-alert bg-[#fdecec] px-3 py-2.5 text-sm leading-snug text-[#a3262b]" role="alert">
          <p class="font-bold">這張 QR Code 驗證失敗</p>
          <p class="mt-0.5 text-xs">貼紙可能被替換過。我們不會在掃碼頁要求登入或輸入任何資料，請不要在可疑頁面填寫個人資料。</p>
        </div>
        <p v-else class="mb-2 text-xs text-mute">{{ locateText }}<span v-if="mock" class="sm:hidden">，目前顯示模擬資料</span></p>

        <!-- 最近的垃圾桶太遠：一鍵回報這裡需要垃圾桶 -->
        <div v-if="tooFar && !reported.has(keyOf('need'))" class="mb-3 flex items-center gap-3 rounded-[12px] border-2 border-dashed border-truck bg-[#fff8e1] px-3 py-2.5">
          <p class="min-w-0 flex-1 text-sm leading-snug">
            最近的垃圾桶在 <span class="num font-bold">{{ Math.round(ranked[0].meters) }}</span> 公尺外。<br />
            <span class="text-xs text-mute">太遠了？回報這裡需要一個，會變成缺口熱區的證據。</span>
          </p>
          <button class="shrink-0 rounded-[10px] bg-truck px-3 py-2 text-sm font-bold text-ink" :disabled="!!sending" @click="report('need')">太遠了</button>
        </div>

        <!-- 路牌：最重要的資訊 -->
        <div v-if="target" class="rounded-[16px] bg-sign p-[5px] text-white shadow-lg shadow-sign/25">
          <div class="rounded-[12px] border-2 border-white/90 px-4 pt-3.5 pb-3">
            <div class="flex items-center gap-4">
              <svg
                viewBox="0 0 64 64"
                class="h-16 w-16 shrink-0 transition-transform duration-700 ease-out motion-reduce:transition-none"
                :style="{ transform: `rotate(${arrowDeg}deg)` }"
                role="img"
                :aria-label="`往${compassWord(bearing)}`"
              >
                <path d="M32 4 L54 30 H40 V60 H24 V30 H10 Z" fill="#ffffff" />
              </svg>
              <div class="min-w-0">
                <p class="text-xs text-white/75">{{ isScanned(target.bin) ? '你正在這桶旁邊' : pickedId ? '你選的垃圾桶' : '最近的垃圾桶' }}</p>
                <p class="truncate text-lg leading-snug font-bold">{{ target.bin.road }}</p>
                <p v-if="target.meters < 15" class="mt-1 text-[28px] leading-tight font-bold">就在你旁邊</p>
                <p v-else class="mt-0.5 flex items-baseline gap-1.5">
                  <span class="num text-[44px] leading-none font-bold">{{ Math.round(target.meters) }}</span>
                  <span class="text-sm whitespace-nowrap">公尺</span>
                  <span class="ml-1 text-sm text-white/85">步行 {{ walkingMinutes(target.meters) }} 分鐘，往{{ compassWord(bearing) }}</span>
                </p>
              </div>
            </div>

            <div class="mt-3 flex items-center gap-3 border-t border-white/25 pt-2.5">
              <div class="flex flex-1 gap-[3px]" aria-hidden="true">
                <span
                  v-for="i in 10"
                  :key="i"
                  class="h-2 flex-1 rounded-[2px]"
                  :style="{
                    background: i <= Math.round(targetFill * 10) ? (targetState === 'ok' ? '#ffffff' : targetState === 'busy' ? '#ffc72c' : '#ff8a8d') : 'rgb(255 255 255 / .2)',
                  }"
                />
              </div>
              <span class="shrink-0 text-sm">
                <span class="num font-bold">{{ Math.round(targetFill * 100) }}%</span>
                {{ FILL_META[targetState].label }}
              </span>
            </div>
          </div>
        </div>

        <!-- 快滿時推薦下一個 -->
        <button
          v-if="alternative"
          class="mt-2 flex w-full items-center justify-between gap-3 rounded-[12px] bg-truck px-4 py-3 text-left text-ink transition active:scale-[0.99]"
          @click="pick(alternative.bin.id)"
        >
          <span class="text-sm">
            這桶快滿了，下一個在
            <span class="num font-bold">{{ Math.round(alternative.meters) }}</span> 公尺
          </span>
          <span class="shrink-0 text-sm font-bold">改去這桶</span>
        </button>

        <!-- 這桶已經有人回報：處理中 -->
        <div v-if="openCase" class="mt-3 flex items-center gap-3 rounded-[12px] bg-sign-soft px-3 py-2.5 text-sign" role="status">
          <span class="relative flex h-3 w-3 shrink-0"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sign opacity-40" /><span class="relative inline-flex h-3 w-3 rounded-full bg-sign" /></span>
          <p class="text-sm leading-snug">
            這桶 {{ OPEN_CASE_MIN }} 分鐘內已有 <span class="num font-bold">{{ openCase.count }}</span> 人回報，<span class="font-bold">處理中</span>（{{ openCase.status }}）。<br />
            <span class="text-xs">你再回報也會合併到同一個案件。</span>
          </p>
        </div>

        <!-- 回報 -->
        <div v-if="target" class="mt-3 grid grid-cols-2 gap-2">
          <button
            v-for="kind in (isScanned(target.bin) ? (['ok', 'full'] as const) : (['full', 'missing'] as const))"
            :key="kind"
            class="flex h-14 items-center justify-center gap-2 rounded-[12px] text-[15px] font-bold transition active:scale-[0.98] disabled:active:scale-100"
            :class="
              reported.has(keyOf(kind, target.bin))
                ? 'bg-sign-soft text-sign'
                : kind === 'full'
                  ? 'bg-truck text-ink shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]'
                  : kind === 'ok'
                    ? 'bg-sign text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.2)]'
                    : 'border-2 border-hair bg-white text-ink'
            "
            :disabled="reported.has(keyOf(kind, target.bin)) || !!sending"
            @click="report(kind, target.bin)"
          >
            <svg v-if="reported.has(keyOf(kind, target.bin))" viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 10.5 8 14.5 16 5.5" />
            </svg>
            {{
              reported.has(keyOf(kind, target.bin))
                ? '已回報，謝謝'
                : sending === keyOf(kind, target.bin)
                  ? '送出中'
                  : kind === 'full'
                    ? '這桶滿了'
                    : kind === 'ok'
                      ? '還可以丟'
                      : '找不到這桶'
            }}
          </button>
        </div>
        <p v-if="target" class="mt-2 text-center text-xs text-mute">
          <template v-if="isScanned(target.bin)">
            回報哪一種狀態都是 <span class="num font-bold text-sign">+{{ POINTS.scan + (isStale(target.bin.id) ? POINTS.staleBonus : 0) }}</span> 綠點，照實回報就好
          </template>
          <template v-else>掃描垃圾桶上的 QR Code 回報，可以領綠點</template>
        </p>

        <!-- 其他問題：周邊髒亂、損壞、其他（描述與照片選填） -->
        <div v-if="target" class="mt-2">
          <button v-if="!showIssue" class="w-full rounded-[10px] py-2 text-sm text-sign underline underline-offset-4" @click="showIssue = true">回報其他問題（周邊髒亂、損壞…）</button>
          <form v-else class="rounded-[14px] border-2 border-hair p-3" @submit.prevent="sendIssue">
            <div class="flex items-baseline justify-between">
              <p class="text-sm font-bold">回報其他問題</p>
              <button type="button" class="text-xs text-mute" @click="showIssue = false">取消</button>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="問題類型">
              <button
                v-for="k in (['dirty', 'broken', 'other'] as const)"
                :key="k"
                type="button"
                role="radio"
                :aria-checked="issueKind === k"
                class="rounded-[10px] border-2 px-1 py-2 text-xs font-bold"
                :class="issueKind === k ? 'border-sign bg-sign-soft text-sign' : 'border-hair text-ink'"
                @click="issueKind = k"
              >{{ REPORT_LABEL[k] }}</button>
            </div>
            <textarea v-model="issueNote" maxlength="100" rows="2" placeholder="簡單描述（選填，最多 100 字）" class="mt-2 w-full resize-none rounded-[10px] border-2 border-hair px-3 py-2 text-sm outline-none focus:border-sign" />
            <div class="mt-1 flex items-center gap-2">
              <label class="cursor-pointer rounded-full border-2 border-hair px-3 py-1.5 text-xs font-bold">
                {{ issuePhoto ? '換一張照片' : '加照片（選填）' }}
                <input type="file" accept="image/*" capture="environment" class="sr-only" @change="pickIssuePhoto" />
              </label>
              <img v-if="issuePhoto" :src="issuePhoto" alt="要上傳的照片" class="h-10 w-14 rounded-[6px] object-cover" />
              <button v-if="issuePhoto" type="button" class="text-xs text-mute" @click="issuePhoto = undefined">移除</button>
            </div>
            <p class="mt-1.5 text-[11px] leading-snug text-mute">照片請避免拍到路人臉孔、車牌等個人資訊。我們不要求登入，也不收集個資。</p>
            <button type="submit" class="mt-2 h-11 w-full rounded-[10px] bg-sign text-sm font-bold text-white disabled:opacity-50" :disabled="!!sending">
              {{ sending ? '送出中' : `送出「${REPORT_LABEL[issueKind]}」` }}
            </button>
          </form>
        </div>

        <!-- 回報追蹤：像追外送一樣 -->
        <div v-if="tracked" class="mt-4 rounded-[16px] border-2 border-hair p-4" aria-live="polite">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="text-sm font-bold">你的回報進度</h2>
            <span class="num text-xs text-mute">{{ new Date(tracked.report.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }} 回報</span>
          </div>
          <p class="mt-0.5 truncate text-xs text-mute">
            <span class="num font-bold text-ink">{{ tracked.no }}</span> · {{ REPORT_LABEL[tracked.report.kind] }} · {{ tracked.bin?.road ?? '目前位置' }}
          </p>

          <!-- 其他問題：人工分流四步驟 -->
          <template v-if="tracked.type === 'issue'">
            <ol class="mt-3 grid grid-cols-4 gap-1">
              <li v-for="(st, i) in ISSUE_STEPS" :key="st.key" class="flex flex-col items-center text-center">
                <span class="grid h-7 w-7 place-items-center rounded-full text-xs font-bold" :class="i <= tracked.reached ? 'bg-sign text-white' : i === tracked.reached + 1 ? 'bg-truck text-ink ring-4 ring-truck/30' : 'bg-paper text-mute'">
                  <svg v-if="i <= tracked.reached" viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 8 14.5 16 5.5" /></svg>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="mt-1.5 text-[11px] leading-tight" :class="i <= tracked.reached + 1 ? 'font-bold text-ink' : 'text-mute'">{{ st.title }}</span>
              </li>
            </ol>
            <div class="mt-3 rounded-[10px] bg-paper px-3 py-2.5 text-sm">
              <template v-if="tracked.reached === 3">
                <p class="font-bold text-sign">處理完成</p>
                <p class="mt-0.5 text-xs text-mute">{{ tracked.issue?.state?.unit }}已處理完成，謝謝你讓這個問題被看見。</p>
                <img v-if="tracked.issue?.state?.photo" :src="tracked.issue.state.photo" alt="處理完成照片" class="mt-2 w-full rounded-[8px] object-cover" />
              </template>
              <template v-else-if="tracked.reached === 2">
                <p class="font-bold">已轉交{{ tracked.issue?.state?.unit }}</p>
                <p class="mt-0.5 text-xs text-mute">桶報局確認後已轉交負責單位處理。</p>
              </template>
              <template v-else-if="tracked.reached === 1">
                <p class="font-bold">桶報局：「確認了！」</p>
                <p class="mt-0.5 text-xs text-mute">正在判斷要轉交哪個單位。</p>
              </template>
              <template v-else>
                <p class="font-bold">已送出，等待桶報局確認</p>
                <p class="mt-0.5 text-xs text-mute">同一個問題有其他人回報，會合併成同一件處理<template v-if="(tracked.issue?.reports.length ?? 1) > 1">（目前 {{ tracked.issue!.reports.length }} 人回報）</template>。</p>
              </template>
            </div>
          </template>

          <template v-else>
          <ol class="mt-3 grid grid-cols-5 gap-1">
            <li v-for="(st, i) in STEPS" :key="st.key" class="flex flex-col items-center text-center">
              <span class="relative flex w-full items-center">
                <span class="h-[3px] flex-1 rounded-full" :class="i === 0 ? 'opacity-0' : i <= tracked.progress.reached + 1 ? 'bg-sign' : 'bg-hair'" />
                <span
                  class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition"
                  :class="
                    i <= tracked.progress.reached
                      ? 'bg-sign text-white'
                      : i === tracked.progress.reached + 1
                        ? 'bg-truck text-ink ring-4 ring-truck/30'
                        : 'bg-paper text-mute'
                  "
                >
                  <svg v-if="i <= tracked.progress.reached" viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 8 14.5 16 5.5" /></svg>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="h-[3px] flex-1 rounded-full" :class="i === 4 ? 'opacity-0' : i <= tracked.progress.reached ? 'bg-sign' : 'bg-hair'" />
              </span>
              <span class="mt-1.5 text-[11px] leading-tight" :class="i <= tracked.progress.reached + 1 ? 'font-bold text-ink' : 'text-mute'">{{ st.title }}</span>
            </li>
          </ol>
          <div class="mt-3 rounded-[10px] bg-paper px-3 py-2.5 text-sm">
            <template v-if="tracked.progress.reached === 4">
              <p class="font-bold text-sign">{{ STEPS[4].voice }}</p>
              <p class="mt-0.5 text-xs text-mute">
                市府花了 <span class="num text-base font-bold text-ink">{{ tracked.progress.tookMin }}</span> 分鐘完成清運，謝謝你讓這一桶被看見。
              </p>
              <img v-if="tracked.progress.dispatch?.photo" :src="tracked.progress.dispatch.photo" alt="清潔隊回傳的清運完成照片" class="mt-2 w-full rounded-[8px] object-cover" />
            </template>
            <template v-else-if="tracked.progress.reached === 2">
              <p class="font-bold">{{ STEPS[3].voice }}</p>
              <p class="mt-0.5 text-xs text-mute">
                {{ tracked.progress.dispatch?.district }}第 {{ tracked.progress.dispatch?.truck }} 車已出發，預估
                <span class="num text-sm font-bold text-ink">{{ tracked.progress.etaMin }}</span> 分鐘內到這一桶
              </p>
            </template>
            <template v-else>
              <p class="font-bold">{{ STEPS[1].voice }}</p>
              <p class="mt-0.5 text-xs text-mute">戰情室已經收到，等清潔隊排入下一趟清運。</p>
            </template>
          </div>
          </template>
          <button class="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] border-2 border-sign py-2 text-sm font-bold text-sign transition active:scale-[0.99]" @click="share">
            <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13V3M6 7l4-4 4 4M4 11v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" /></svg>
            分享：我為台北做了一件小事
          </button>
          <RouterLink to="/status" class="mt-2 block text-center text-xs text-sign underline underline-offset-2">看各區處理成績單</RouterLink>
        </div>

        <!-- 巡桶任務：帶大家去資料最缺的地方 -->
        <div v-show="!collapsed && (quests.staleBins.length || quests.desert)" class="mt-5">
          <div class="mb-1 flex items-baseline justify-between">
            <h2 class="text-sm font-bold">巡桶任務</h2>
            <span class="text-xs text-mute">每天上限 {{ POINTS.dailyCap }} 點</span>
          </div>
          <ul class="divide-y divide-hair">
            <li v-for="q in quests.staleBins" :key="q.id">
              <button class="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-paper/60" @click="pick(q.id)">
                <span class="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-truck text-ink" aria-hidden="true">
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[15px]">{{ q.title }}</span>
                  <span class="block text-xs text-mute">{{ q.detail }}，走過去掃碼確認</span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="num block text-base font-bold text-sign">+{{ q.reward }}</span>
                  <span class="num text-xs text-mute">{{ Math.round(q.meters) }} 公尺</span>
                </span>
              </button>
            </li>
            <li v-if="quests.desert">
              <button
                class="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-paper/60"
                @click="map?.flyTo([quests.desert.c.lat, quests.desert.c.lng], 17)"
              >
                <span class="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-alert text-white" aria-hidden="true">
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 17s5-4.5 5-8.5a5 5 0 0 0-10 0C5 12.5 10 17 10 17z" /><circle cx="10" cy="8.5" r="1.8" /></svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[15px]">這附近可能沒有垃圾桶</span>
                  <span class="block text-xs text-mute">走到那裡確認，用下方按鈕回報</span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="num block text-base font-bold text-sign">+{{ POINTS.desert }}</span>
                  <span class="num text-xs text-mute">{{ Math.round(quests.desert.meters) }} 公尺</span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <!-- 附近其他 -->
        <div v-show="!collapsed" class="mt-5">
          <div class="mb-1 flex items-baseline justify-between">
            <h2 class="text-sm font-bold">附近還有</h2>
            <button v-if="pickedId" class="text-xs text-sign underline underline-offset-2" @click="pick(undefined)">回到最近的</button>
          </div>
          <ul class="divide-y divide-hair">
            <li v-for="{ bin, meters } in nearby" :key="bin.id">
              <button class="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-paper/60" @click="pick(bin.id)">
                <span class="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" :style="{ background: FILL_META[fillState(fillOf(bin.id))].color }" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[15px]">{{ bin.road }}</span>
                  <span class="block text-xs text-mute">{{ bin.district }}，{{ FILL_META[fillState(fillOf(bin.id))].label }}</span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="num text-lg font-semibold">{{ Math.round(meters) }}</span>
                  <span class="text-xs text-mute"> 公尺</span>
                </span>
              </button>
            </li>
          </ul>

          <div class="mt-4 rounded-[12px] bg-paper px-4 py-3">
            <p class="text-sm">這附近都找不到垃圾桶？</p>
            <button
              class="mt-2 w-full rounded-[10px] border-2 border-sign px-3 py-2.5 text-sm font-bold text-sign transition active:scale-[0.99] disabled:border-transparent disabled:bg-sign-soft"
              :disabled="reported.has(keyOf('need')) || !!sending"
              @click="report('need')"
            >
              {{ reported.has(keyOf('need')) ? '已回報，謝謝' : sending === keyOf('need') ? '送出中' : '回報這裡需要垃圾桶' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <Transition name="drop">
      <div
        v-if="toast"
        role="status"
        class="absolute top-16 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-ink px-4 py-2.5 text-sm whitespace-nowrap text-white shadow-xl md:top-20"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style>
.drop-enter-active,
.drop-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
