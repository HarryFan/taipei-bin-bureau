<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import gsap from 'gsap'
import { createMap, TAIPEI } from '../lib/map'
import {
  clearLocalReports,
  isMock,
  lastSource,
  loadBins,
  loadFillLevels,
  loadGrid,
  loadMeta,
  loadOfficial,
  type OfficialCounts,
  loadReports,
  onLocalReportsChange,
  type DataSource,
} from '../lib/data'
import { distanceMeters, nearestNeighborRoute, pathMeters, type LatLng } from '../lib/geo'
import { FILL_META, fillState, REPORT_COLOR, REPORT_LABEL, type Bin, type FillLevel, type GridCell, type GridData, type Report } from '../types'

type Mode = 'gap' | 'route'

const POLL_MS = 3000
/** 清潔隊出發點（示意） */
const DEPOT: LatLng = TAIPEI

const mapEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const mode = ref<Mode>('gap')
const bins = ref<Bin[]>([])
const grid = ref<GridData>()
const fills = ref<FillLevel[]>([])
const reports = ref<Report[]>([])
const threshold = ref(0.8)
const source = ref<DataSource>(lastSource)
const mock = ref(true)
const official = ref<OfficialCounts>()
const now = ref(new Date())
const freshIds = ref(new Set<string>())
const confirmReset = ref(false)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

let baseLayer: L.LayerGroup | undefined
let overlayLayer: L.LayerGroup | undefined
let reportLayer: L.LayerGroup | undefined
let truck: L.Marker | undefined
let truckFrame = 0
let pollTimer: ReturnType<typeof setInterval> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
let stopListening: (() => void) | undefined
let loaded = false
const svgRenderer = L.svg({ padding: 0.5 })

// ---------- 衍生資料 ----------
const fillById = computed(() => new Map(fills.value.map((f) => [f.id, f.fill])))
const binById = computed(() => new Map(bins.value.map((b) => [b.id, b])))

function nearestBin(lat: number, lng: number): Bin | undefined {
  let best: Bin | undefined
  let bestD = Infinity
  for (const b of bins.value) {
    const d = (b.lat - lat) ** 2 + (b.lng - lng) ** 2
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

const gapCells = computed(() => (grid.value?.cells ?? []).filter((c) => c.gap > 0))
const maxGap = computed(() => Math.max(0.0001, ...gapCells.value.map((c) => c.gap)))

/** 網格沒有地名，用最近的垃圾桶位置當作地標描述 */
const suggestions = computed(() => {
  const byId = new Map(grid.value?.cells.map((c) => [c.id, c]))
  return (grid.value?.suggestions ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is GridCell => !!c)
    .map((c) => {
      const near = nearestBin(c.lat, c.lng)
      return { cell: c, place: near ? near.road.replace(/第 \d+ 組$|散點 \d+$/, '').trim() : '未命名區域', district: near?.district ?? '' }
    })
})

const DISTRICTS = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區']

/**
 * 各區缺口。資料裡某區 0 個點位時視為「資料缺漏」，不排名：
 * 開放資料 121355 的北投區就是 0 筆，不能解讀成北投最缺垃圾桶
 */
const districtGaps = computed(() => {
  const binCount = new Map<string, number>()
  for (const b of bins.value) binCount.set(b.district, (binCount.get(b.district) ?? 0) + 1)
  const sum = new Map<string, number>()
  for (const c of gapCells.value) {
    const d = nearestBin(c.lat, c.lng)?.district
    if (d) sum.set(d, (sum.get(d) ?? 0) + c.gap)
  }
  const ranked = DISTRICTS.filter((d) => (binCount.get(d) ?? 0) > 0)
    .map((district) => ({ district, gap: sum.get(district) ?? 0, missing: false }))
    .sort((a, b) => b.gap - a.gap)
  const max = Math.max(0.0001, ...ranked.map((r) => r.gap))
  const missing = DISTRICTS.filter((d) => !binCount.get(d)).map((district) => ({ district, gap: 0, missing: true }))
  return [...ranked, ...missing].map((r) => ({ ...r, share: r.gap / max }))
})

const fullBins = computed(() => bins.value.filter((b) => (fillById.value.get(b.id) ?? 0) >= threshold.value))
const route = computed(() => nearestNeighborRoute(DEPOT, fullBins.value))
const routePath = computed<LatLng[]>(() => [DEPOT, ...route.value.map((b) => [b.lat, b.lng] as LatLng)])
const routeKm = computed(() => pathMeters(routePath.value) / 1000)

const todayReports = computed(() => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return reports.value.filter((r) => new Date(r.createdAt) >= start)
})

// ---------- 頂部數字：GSAP 數字滾動 ----------
const shown = reactive({ bins: 0, pickup: 0, gaps: 0, reports: 0 })
const targets = computed(() => ({
  bins: official.value?.current.count ?? 0,
  pickup: fullBins.value.length,
  gaps: gapCells.value.length,
  reports: todayReports.value.length,
}))
watch(
  targets,
  (t) => {
    if (reduceMotion) return Object.assign(shown, t)
    gsap.to(shown, { ...t, duration: 1.1, ease: 'power3.out', snap: { bins: 1, pickup: 1, gaps: 1, reports: 1 } })
  },
  { deep: true },
)

// ---------- 地圖 ----------
function rampColor(t: number) {
  // 黃 → 橘 → 紅：缺口越大越紅
  return t > 0.66 ? '#e5484d' : t > 0.33 ? '#ff8a2a' : '#ffc72c'
}

function placeOf(r: Report) {
  const b = r.binId ? binById.value.get(r.binId) : undefined
  return b ? b.road : (nearestBin(r.lat, r.lng)?.road.replace(/第 \d+ 組$|散點 \d+$/, '').trim() ?? '地圖上的位置') + '附近'
}

function drawBase() {
  if (!map.value) return
  baseLayer?.remove()
  baseLayer = L.layerGroup().addTo(map.value)

  if (mode.value === 'gap' && grid.value) {
    // 以重疊的半透明光暈呈現缺口，相鄰的缺口會自然連成一片熱區
    const radius = (grid.value.cellMeters ?? 250) * 0.9
    const cells = [...gapCells.value].sort((a, b) => a.gap - b.gap)
    for (const c of cells) {
      const t = Math.min(1, c.gap / maxGap.value)
      if (t < 0.2) continue
      L.circle([c.lat, c.lng], { radius: radius * (1.6 - t * 0.4), stroke: false, fillColor: rampColor(t), fillOpacity: 0.06 + t * 0.12, interactive: false }).addTo(baseLayer)
      L.circle([c.lat, c.lng], { radius: radius * 0.55, stroke: false, fillColor: rampColor(t), fillOpacity: 0.12 + t * 0.4 })
        .bindTooltip(`缺口 ${c.gap.toFixed(2)}，這一格有 ${c.supply} 個垃圾桶`)
        .addTo(baseLayer)
    }
  }

  for (const b of bins.value) {
    const fill = fillById.value.get(b.id) ?? 0
    const routeMode = mode.value === 'route'
    const due = fill >= threshold.value
    L.circleMarker([b.lat, b.lng], {
      radius: routeMode ? (due ? 5 : 3) : 2.5,
      stroke: routeMode && due,
      color: '#0b1a14',
      weight: 1,
      fillColor: routeMode ? (due ? '#e5484d' : fill >= 0.5 ? '#c79400' : '#3f7a5c') : '#6f9a84',
      fillOpacity: routeMode ? 0.95 : 0.7,
    })
      .bindTooltip(`${b.road}<br>${FILL_META[fillState(fill)].label}，${Math.round(fill * 100)}%`)
      .addTo(baseLayer)
  }
}

function drawOverlay() {
  if (!map.value) return
  overlayLayer?.remove()
  overlayLayer = L.layerGroup().addTo(map.value)
  stopTruck()

  if (mode.value === 'gap') {
    suggestions.value.forEach((s, i) => {
      L.marker([s.cell.lat, s.cell.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          html: `<div style="width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:#ffc72c;color:#10251c;font:700 15px var(--font-num);box-shadow:0 0 0 3px rgb(11 26 20 / .9),0 0 22px rgb(255 199 44 / .55)">${i + 1}</div>`,
        }),
      })
        .bindTooltip(`候選新設點 #${i + 1}：${s.place}`)
        .addTo(overlayLayer!)
    })
    return
  }

  L.polyline(routePath.value, { renderer: svgRenderer, color: '#ffc72c', weight: 7, opacity: 0.18 }).addTo(overlayLayer)
  L.polyline(routePath.value, { renderer: svgRenderer, color: '#ffc72c', weight: 3, className: 'route-flow' }).addTo(overlayLayer)
  L.marker(DEPOT, {
    icon: L.divIcon({
      className: '',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      html: '<div style="width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#0b5d3b;border:2px solid #fff;color:#fff;font-size:12px;font-weight:700">隊</div>',
    }),
  })
    .bindTooltip('清潔隊出發點（示意）')
    .addTo(overlayLayer)
  startTruck()
}

const TRUCK_HTML = `
  <div style="width:40px;height:40px;display:grid;place-items:center;border-radius:9999px;background:#ffc72c;box-shadow:0 0 0 3px #0b1a14,0 6px 18px rgb(0 0 0 / .45)">
    <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <path d="M3 9h15v12H3zM18 13h6l4 4v4H18z" fill="#10251c"/>
      <circle cx="9" cy="23" r="3" fill="#10251c" stroke="#ffc72c" stroke-width="1.5"/>
      <circle cx="23" cy="23" r="3" fill="#10251c" stroke="#ffc72c" stroke-width="1.5"/>
    </svg>
  </div>`

/** 垃圾車沿路線行駛：戰情室唯一一個持續的動態 */
function startTruck() {
  if (!map.value || !overlayLayer || routePath.value.length < 2) return
  const pts = routePath.value
  const seg: number[] = [0]
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + distanceMeters(pts[i - 1], pts[i]))
  const total = seg[seg.length - 1]
  truck = L.marker(pts[0], {
    icon: L.divIcon({ className: '', html: TRUCK_HTML, iconSize: [40, 40], iconAnchor: [20, 20] }),
    interactive: false,
    zIndexOffset: 1000,
  }).addTo(overlayLayer)
  if (reduceMotion) return
  const duration = Math.min(40000, Math.max(14000, total * 1.2))
  const t0 = performance.now()
  const step = (t: number) => {
    const d = (((t - t0) % duration) / duration) * total
    let i = 1
    while (i < seg.length - 1 && seg[i] < d) i++
    const k = (d - seg[i - 1]) / Math.max(1, seg[i] - seg[i - 1])
    const [a, b] = [pts[i - 1], pts[i]]
    truck?.setLatLng([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k])
    truckFrame = requestAnimationFrame(step)
  }
  truckFrame = requestAnimationFrame(step)
}

function stopTruck() {
  cancelAnimationFrame(truckFrame)
  truck = undefined
}

function drawReports() {
  if (!map.value) return
  reportLayer?.remove()
  reportLayer = L.layerGroup().addTo(map.value)
  for (const r of reports.value) {
    if (freshIds.value.has(r.id)) {
      L.marker([r.lat, r.lng], {
        icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18], html: `<span class="ping-ring" style="--c:${REPORT_COLOR[r.kind]}"></span>` }),
        interactive: false,
      }).addTo(reportLayer)
    }
    L.circleMarker([r.lat, r.lng], { radius: 6, color: '#0b1a14', weight: 2, fillColor: REPORT_COLOR[r.kind], fillOpacity: 1 })
      .bindTooltip(`市民回報：${REPORT_LABEL[r.kind]}<br>${placeOf(r)}`)
      .addTo(reportLayer)
  }
}

function flyTo(lat: number, lng: number, zoom = 17) {
  map.value?.flyTo([lat, lng], zoom, { duration: reduceMotion ? 0 : 0.8 })
}

// ---------- 資料更新 ----------
async function refresh() {
  try {
    const [nextFills, nextReports] = await Promise.all([loadFillLevels(), loadReports()])
    source.value = lastSource
    if (JSON.stringify(nextFills) !== JSON.stringify(fills.value)) fills.value = nextFills

    const known = new Set(reports.value.map((r) => r.id))
    const added = nextReports.filter((r) => !known.has(r.id))
    if (added.length || nextReports.length !== reports.value.length) {
      reports.value = nextReports
      if (loaded && added.length) {
        freshIds.value = new Set([...freshIds.value, ...added.map((r) => r.id)])
        const latest = added[0]
        if (latest.kind === 'full') mode.value = 'route'
        flyTo(latest.lat, latest.lng, 16)
        setTimeout(() => {
          freshIds.value = new Set([...freshIds.value].filter((id) => !added.some((r) => r.id === id)))
        }, 20000)
      }
    }
  } catch (err) {
    console.warn('更新失敗', err)
  }
}

function resetDemo() {
  if (!confirmReset.value) {
    confirmReset.value = true
    setTimeout(() => (confirmReset.value = false), 3000)
    return
  }
  confirmReset.value = false
  clearLocalReports()
  freshIds.value = new Set()
  refresh()
}

const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })

watch([mode, threshold, fills, grid, bins], () => {
  drawBase()
  drawOverlay()
})
watch([reports, freshIds], drawReports)

onMounted(async () => {
  map.value = createMap(mapEl.value!, { theme: 'dark', zoom: 13, center: [25.05, 121.545] })
  const [b, g, meta, off] = await Promise.all([loadBins(), loadGrid(), loadMeta(), loadOfficial()])
  official.value = off
  mock.value = isMock(meta)
  bins.value = b
  grid.value = g
  await refresh()
  loaded = true
  pollTimer = setInterval(refresh, POLL_MS)
  clockTimer = setInterval(() => (now.value = new Date()), 1000)
  stopListening = onLocalReportsChange(refresh)
})

onBeforeUnmount(() => {
  clearInterval(pollTimer)
  clearInterval(clockTimer)
  stopListening?.()
  stopTruck()
  gsap.killTweensOf(shown)
  map.value?.remove()
})
</script>

<template>
  <div class="theme-dark flex h-full flex-col bg-night text-night-text">
    <!-- 頂部 -->
    <header class="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-night-line px-4 py-3 lg:flex-nowrap lg:px-5">
      <div class="flex items-center gap-3">
        <div class="rounded-[9px] bg-sign p-[3px]">
          <div class="rounded-[6px] border-[1.5px] border-white/90 px-2.5 py-1 text-sm font-bold tracking-[0.08em] text-white">台北桶報局</div>
        </div>
        <h1 class="text-lg font-bold">市府戰情</h1>
      </div>

      <dl class="order-3 flex w-full gap-6 overflow-x-auto lg:order-none lg:w-auto lg:flex-1 lg:justify-center lg:gap-10">
        <div class="shrink-0">
          <dt class="text-xs text-night-mute" :title="official?.current.source">官方統計{{ official ? `（${official.current.date.replace('-', '/')}）` : '' }}</dt>
          <dd class="num text-[30px] leading-tight font-semibold">{{ shown.bins.toLocaleString() }}<span class="ml-1 font-sans text-sm font-normal text-night-mute">{{ official?.current.unit }}</span></dd>
        </div>
        <div class="shrink-0">
          <dt class="text-xs text-night-mute">待清運</dt>
          <dd class="num text-[30px] leading-tight font-semibold text-truck">{{ shown.pickup }}</dd>
        </div>
        <div class="shrink-0">
          <dt class="text-xs text-night-mute">缺垃圾桶的網格</dt>
          <dd class="num text-[30px] leading-tight font-semibold">{{ shown.gaps }}</dd>
        </div>
        <div class="shrink-0">
          <dt class="text-xs text-night-mute">今天的市民回報</dt>
          <dd class="num text-[30px] leading-tight font-semibold">{{ shown.reports }}</dd>
        </div>
      </dl>

      <div class="ml-auto flex items-center gap-3 text-sm lg:ml-0">
        <span v-if="mock" class="rounded-full border border-night-line px-2.5 py-0.5 text-xs text-night-mute">模擬資料</span>
        <span class="flex items-center gap-1.5 text-xs" :class="source === 'api' ? 'text-[#7fd6a4]' : 'text-truck'">
          <span class="h-2 w-2 rounded-full" :class="source === 'api' ? 'bg-[#7fd6a4]' : 'bg-truck'" />
          {{ source === 'api' ? '即時連線' : '離線模式' }}
        </span>
        <time class="num text-lg text-night-mute">{{ now.toLocaleTimeString('zh-TW', { hour12: false }) }}</time>
        <RouterLink to="/" class="rounded-full bg-night-3 px-3 py-1.5 text-xs font-bold hover:bg-night-line">市民端</RouterLink>
      </div>
    </header>

    <!-- 主體 -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[340px_1fr_320px] lg:overflow-hidden">
      <!-- 左：模式 -->
      <aside class="order-2 flex flex-col border-night-line lg:order-1 lg:min-h-0 lg:border-r">
        <div class="p-4 pb-0">
          <div class="grid grid-cols-2 rounded-[10px] bg-night-2 p-1 text-sm" role="tablist">
            <button
              v-for="m in (['gap', 'route'] as const)"
              :key="m"
              role="tab"
              :aria-selected="mode === m"
              class="rounded-[7px] py-2 transition"
              :class="mode === m ? 'bg-night-3 font-bold text-white shadow-[inset_0_-2px_0_#ffc72c]' : 'text-night-mute hover:text-night-text'"
              @click="mode = m"
            >
              {{ m === 'gap' ? '缺口熱區' : '清運調度' }}
            </button>
          </div>
        </div>

        <div class="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <template v-if="mode === 'gap'">
            <h2 class="text-base font-bold">哪裡最缺垃圾桶</h2>
            <p class="mt-1 text-sm leading-relaxed text-night-mute">人流和陳情多、垃圾桶少的地方。每格 {{ grid?.cellMeters ?? 250 }} 公尺見方，地圖上共 {{ bins.length }} 個垃圾桶點位。</p>
            <div class="mt-3 flex items-center gap-2 text-xs text-night-mute">
              <span>缺口小</span>
              <span class="h-2 flex-1 rounded-full bg-gradient-to-r from-[#ffc72c] via-[#ff8a2a] to-[#e5484d]" />
              <span>缺口大</span>
            </div>

            <h3 class="mt-6 text-sm font-bold">候選新設點</h3>
            <p class="mb-2 text-xs leading-relaxed text-night-mute">實際設置仍要符合設置原則，並經現場會勘。</p>
            <ol>
              <li v-for="(s, i) in suggestions" :key="s.cell.id">
                <button class="group flex w-full items-center gap-3 border-t border-night-line py-2.5 text-left first:border-t-0" @click="flyTo(s.cell.lat, s.cell.lng)">
                  <span class="num grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-truck text-[15px] font-bold text-ink">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm group-hover:text-truck">{{ s.place }}</span>
                    <span class="block text-xs text-night-mute">{{ s.district }}<template v-if="s.cell.supply === 0">，這一格沒有垃圾桶點位</template><template v-else>，這一格只有 {{ s.cell.supply }} 個點位</template></span>
                  </span>
                  <span class="num shrink-0 text-right text-sm text-[#ffb27a]" :title="'缺口分數'">{{ s.cell.gap.toFixed(2) }}</span>
                </button>
              </li>
            </ol>
          </template>

          <template v-else>
            <h2 class="text-base font-bold">今天要先收哪些</h2>
            <p class="mt-1 text-sm leading-relaxed text-night-mute">
              <span class="num text-lg font-semibold text-truck">{{ fullBins.length }}</span> 桶超過門檻，路線約
              <span class="num text-lg font-semibold text-night-text">{{ routeKm.toFixed(1) }}</span> 公里
            </p>
            <label class="mt-4 block text-xs text-night-mute">
              <span class="flex justify-between"><span>填滿多少就派車</span><span class="num text-sm text-night-text">{{ Math.round(threshold * 100) }}%</span></span>
              <input v-model.number="threshold" type="range" min="0.5" max="1" step="0.05" class="mt-2 w-full accent-[#ffc72c]" />
            </label>

            <h3 class="mt-6 mb-2 text-sm font-bold">停靠順序</h3>
            <ol>
              <li v-for="(b, i) in route" :key="b.id">
                <button class="group flex w-full items-center gap-3 border-t border-night-line py-2 text-left first:border-t-0" @click="flyTo(b.lat, b.lng, 18)">
                  <span class="num w-6 shrink-0 text-right text-sm text-night-mute">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate text-sm group-hover:text-truck">{{ b.road }}</span>
                  <span class="num shrink-0 text-sm text-[#ff8a8d]">{{ Math.round((fillById.get(b.id) ?? 0) * 100) }}%</span>
                </button>
              </li>
            </ol>
            <p class="mt-4 text-xs leading-relaxed text-night-mute">路線用最近距離排序，示意用。填滿率是模擬的感測資料，市民回報「滿了」會直接計為 100%。</p>
          </template>
        </div>
      </aside>

      <!-- 中：地圖 -->
      <div class="relative order-1 h-[52vh] shrink-0 lg:order-2 lg:h-auto lg:min-h-0">
        <div ref="mapEl" class="absolute inset-0" />
      </div>

      <!-- 右：回報動態與行政區 -->
      <aside class="order-3 flex flex-col border-t border-night-line lg:min-h-0 lg:border-t-0 lg:border-l">
        <section class="flex flex-col p-4 lg:min-h-0 lg:flex-1">
          <div class="flex items-baseline justify-between">
            <h2 class="text-base font-bold">市民回報</h2>
            <button
              v-if="source === 'local' && reports.length"
              class="text-xs"
              :class="confirmReset ? 'font-bold text-alert' : 'text-night-mute hover:text-night-text'"
              @click="resetDemo"
            >
              {{ confirmReset ? '再按一次清空' : '清空' }}
            </button>
          </div>
          <TransitionGroup v-if="reports.length" tag="ol" name="feed" class="mt-3 max-h-80 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
            <li v-for="r in reports.slice(0, 30)" :key="r.id">
              <button
                class="flex w-full gap-3 rounded-[8px] px-2 py-2 text-left transition"
                :class="freshIds.has(r.id) ? 'bg-night-3' : 'hover:bg-night-2'"
                @click="flyTo(r.lat, r.lng)"
              >
                <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: REPORT_COLOR[r.kind] }" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-bold" :style="{ color: REPORT_COLOR[r.kind] }">{{ REPORT_LABEL[r.kind] }}</span>
                  <span class="block truncate text-xs text-night-mute">{{ placeOf(r) }}</span>
                </span>
                <time class="num shrink-0 text-sm text-night-mute">{{ timeFmt(r.createdAt) }}</time>
              </button>
            </li>
          </TransitionGroup>
          <p v-else class="mt-3 rounded-[10px] border border-dashed border-night-line p-4 text-sm leading-relaxed text-night-mute">
            還沒有回報。用手機打開市民端，按「這桶滿了」，三秒內會出現在這裡。
          </p>
        </section>

        <section class="border-t border-night-line p-4">
          <h2 class="text-base font-bold">各區缺口</h2>
          <p class="mt-1 text-xs text-night-mute">各網格缺口分數加總，越長越缺垃圾桶</p>
          <ul class="mt-3 space-y-1.5">
            <li v-for="d in districtGaps" :key="d.district" class="grid grid-cols-[3.5rem_1fr] items-center gap-2 text-sm">
              <span class="text-night-mute">{{ d.district }}</span>
              <span v-if="d.missing" class="text-xs text-night-mute">資料缺漏，不列入排名</span>
              <span v-else class="block h-2.5 rounded-r-full bg-night-2">
                <span class="block h-full rounded-r-full bg-truck/85" :style="{ width: `${d.share * 100}%` }" />
              </span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<style>
.feed-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s ease;
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.feed-move {
  transition: transform 0.4s ease;
}
</style>
