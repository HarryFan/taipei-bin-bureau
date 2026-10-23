<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import {
  clearLocalReports,
  lastSource,
  loadBins,
  loadFillLevels,
  loadGrid,
  loadReports,
  onLocalReportsChange,
  type DataSource,
} from '../lib/data'
import { nearestNeighborRoute } from '../lib/geo'
import { REPORT_LABEL, type Bin, type FillLevel, type GridData, type Report, type ReportKind } from '../types'

type Tab = 'gap' | 'route'

/** 儀表板輪詢間隔：手機回報後幾秒內會出現在大螢幕 */
const POLL_MS = 3000

const REPORT_COLOR: Record<ReportKind, string> = {
  full: '#d97706',
  missing: '#475569',
  need: '#7c3aed',
}

const mapEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const tab = ref<Tab>('gap')
const bins = ref<Bin[]>([])
const grid = ref<GridData>()
const fills = ref<FillLevel[]>([])
const reports = ref<Report[]>([])
const threshold = ref(0.8)
const source = ref<DataSource>(lastSource)
const updatedAt = ref<Date>()
const freshIds = ref(new Set<string>())
const toast = ref('')
let layer: L.LayerGroup | undefined
let timer: ReturnType<typeof setInterval> | undefined
let stopListening: (() => void) | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let loaded = false

const fillById = computed(() => new Map(fills.value.map((f) => [f.id, f.fill])))
const binById = computed(() => new Map(bins.value.map((b) => [b.id, b])))
const maxGap = computed(() => Math.max(0.0001, ...(grid.value?.cells.map((c) => c.gap) ?? [0])))
const suggestions = computed(() => {
  const byId = new Map(grid.value?.cells.map((c) => [c.id, c]))
  return (grid.value?.suggestions ?? []).map((id) => byId.get(id)!).filter(Boolean)
})
const fullBins = computed(() => bins.value.filter((b) => (fillById.value.get(b.id) ?? 0) >= threshold.value))
const route = computed(() => nearestNeighborRoute(TAIPEI, fullBins.value))
const reportCounts = computed(() => {
  const counts: Record<ReportKind, number> = { full: 0, missing: 0, need: 0 }
  for (const r of reports.value) counts[r.kind]++
  return counts
})

function gapColor(gap: number) {
  if (gap <= 0) return '#10b981'
  const t = Math.min(1, gap / maxGap.value)
  return t > 0.66 ? '#dc2626' : t > 0.33 ? '#f97316' : '#facc15'
}

function fillColor(fill: number) {
  return fill >= threshold.value ? '#dc2626' : fill >= 0.5 ? '#f59e0b' : '#10b981'
}

function reportPlace(r: Report) {
  const bin = r.binId ? binById.value.get(r.binId) : undefined
  return bin ? bin.road : `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`
}

function draw() {
  if (!map.value) return
  layer?.remove()
  layer = L.layerGroup().addTo(map.value)

  if (tab.value === 'gap' && grid.value) {
    const { lat: dLat, lng: dLng } = grid.value.cellSizeDeg
    for (const c of grid.value.cells) {
      L.rectangle(
        [
          [c.lat - dLat / 2, c.lng - dLng / 2],
          [c.lat + dLat / 2, c.lng + dLng / 2],
        ],
        { weight: 0.5, color: '#64748b', fillColor: gapColor(c.gap), fillOpacity: c.gap > 0 ? 0.45 : 0.15 },
      )
        .bindTooltip(`需求 ${c.demand.toFixed(2)}・垃圾桶 ${c.supply} 個・缺口 ${c.gap.toFixed(2)}`)
        .addTo(layer)
    }
    suggestions.value.forEach((c, i) => {
      L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [24, 24],
          html: `<div class="grid h-6 w-6 place-items-center rounded-full bg-red-600 text-xs font-bold text-white ring-2 ring-white">${i + 1}</div>`,
        }),
      })
        .bindTooltip(`建議新設點 #${i + 1}`)
        .addTo(layer!)
    })
  }

  if (tab.value === 'route') {
    for (const b of bins.value) {
      const fill = fillById.value.get(b.id) ?? 0
      L.circleMarker([b.lat, b.lng], { radius: 8, color: fillColor(fill), fillOpacity: 0.85 })
        .bindTooltip(`${b.road}・填滿 ${Math.round(fill * 100)}%`)
        .addTo(layer)
    }
    L.marker(TAIPEI, {
      icon: L.divIcon({
        className: '',
        iconSize: [28, 28],
        html: '<div class="grid h-7 w-7 place-items-center rounded-lg bg-blue-600 text-sm text-white shadow ring-2 ring-white">🚛</div>',
      }),
    })
      .bindTooltip('清潔隊出發點（示意）')
      .addTo(layer)
    if (route.value.length) {
      L.polyline([TAIPEI, ...route.value.map((b) => [b.lat, b.lng] as [number, number])], {
        color: '#2563eb',
        weight: 4,
        dashArray: '6 6',
      }).addTo(layer)
    }
  }

  for (const r of reports.value) {
    const fresh = freshIds.value.has(r.id)
    if (fresh) {
      L.marker([r.lat, r.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [40, 40],
          html: `<span class="tbb-ping" style="--c:${REPORT_COLOR[r.kind]}"></span>`,
        }),
        interactive: false,
      }).addTo(layer)
    }
    L.circleMarker([r.lat, r.lng], {
      radius: fresh ? 8 : 5,
      color: '#ffffff',
      weight: 2,
      fillColor: REPORT_COLOR[r.kind],
      fillOpacity: 1,
    })
      .bindTooltip(`市民回報：${REPORT_LABEL[r.kind]}・${reportPlace(r)}`)
      .addTo(layer)
  }
}

function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4000)
}

/** 輪詢：只有資料真的變了才更新，避免地圖每 3 秒閃一次 */
async function refresh() {
  try {
    const [nextFills, nextReports] = await Promise.all([loadFillLevels(), loadReports()])
    source.value = lastSource
    updatedAt.value = new Date()

    if (JSON.stringify(nextFills) !== JSON.stringify(fills.value)) fills.value = nextFills

    const known = new Set(reports.value.map((r) => r.id))
    const added = nextReports.filter((r) => !known.has(r.id))
    if (added.length || nextReports.length !== reports.value.length) {
      if (loaded && added.length) {
        freshIds.value = new Set([...freshIds.value, ...added.map((r) => r.id)])
        const latest = added[0]
        showToast(`新回報：${REPORT_LABEL[latest.kind]}・${reportPlace(latest)}`)
        if (tab.value === 'gap' && latest.kind === 'full') tab.value = 'route'
        map.value?.panTo([latest.lat, latest.lng], { animate: true })
        setTimeout(() => {
          freshIds.value = new Set([...freshIds.value].filter((id) => !added.some((r) => r.id === id)))
        }, 15000)
      }
      reports.value = nextReports
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
const confirmReset = ref(false)

watch([tab, threshold, fills, reports, freshIds], draw)

onMounted(async () => {
  map.value = createMap(mapEl.value!, TAIPEI, 15)
  ;[bins.value, grid.value] = await Promise.all([loadBins(), loadGrid()])
  await refresh()
  loaded = true
  if (bins.value.length) {
    map.value.fitBounds(L.latLngBounds(bins.value.map((b) => [b.lat, b.lng] as [number, number])), { padding: [40, 40] })
  }
  draw()
  timer = setInterval(refresh, POLL_MS)
  stopListening = onLocalReportsChange(refresh)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(toastTimer)
  stopListening?.()
  map.value?.remove()
})
</script>

<template>
  <div class="relative flex h-full flex-col md:flex-row">
    <aside class="order-2 max-h-[45%] w-full overflow-y-auto border-slate-200 bg-white p-4 md:order-1 md:max-h-none md:w-96 md:border-r">
      <div class="mb-4 flex items-center justify-between text-xs">
        <span class="flex items-center gap-1.5" :class="source === 'api' ? 'text-emerald-700' : 'text-amber-700'">
          <span class="relative flex h-2.5 w-2.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" :class="source === 'api' ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full" :class="source === 'api' ? 'bg-emerald-600' : 'bg-amber-600'" />
          </span>
          {{ source === 'api' ? '即時連線' : '離線模式（本機資料）' }}
        </span>
        <span class="text-slate-400">{{ updatedAt ? `更新 ${updatedAt.toLocaleTimeString('zh-TW')}` : '載入中…' }}</span>
      </div>

      <div class="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button :class="['rounded-md py-1.5', tab === 'gap' && 'bg-white font-bold shadow']" @click="tab = 'gap'">垃圾桶沙漠</button>
        <button :class="['rounded-md py-1.5', tab === 'route' && 'bg-white font-bold shadow']" @click="tab = 'route'">滿溢與清運</button>
      </div>

      <template v-if="tab === 'gap'">
        <h2 class="font-bold">建議新設點 Top {{ suggestions.length }}</h2>
        <p class="mb-3 text-xs text-slate-500">缺口 = 人流需求 − 現有垃圾桶覆蓋，網格 {{ grid?.cellMeters }} 公尺</p>
        <ol class="space-y-1 text-sm">
          <li v-for="(c, i) in suggestions" :key="c.id">
            <button class="flex w-full justify-between rounded-lg px-2 py-1 text-left hover:bg-slate-50" @click="map?.setView([c.lat, c.lng], 17)">
              <span>#{{ i + 1 }}　{{ c.lat.toFixed(4) }}, {{ c.lng.toFixed(4) }}</span>
              <span class="font-mono text-red-600">{{ c.gap.toFixed(2) }}</span>
            </button>
          </li>
        </ol>
      </template>

      <template v-else>
        <h2 class="font-bold">需要清運：{{ fullBins.length }} / {{ bins.length }} 個</h2>
        <label class="my-3 block text-xs text-slate-500">
          填滿門檻 {{ Math.round(threshold * 100) }}%
          <input v-model.number="threshold" type="range" min="0.5" max="1" step="0.05" class="w-full" />
        </label>
        <p class="mb-1 text-xs text-slate-500">🚛 從清潔隊出發，依最近距離排序</p>
        <ol class="space-y-1 text-sm">
          <li v-for="(b, i) in route" :key="b.id">
            <button class="flex w-full justify-between rounded-lg px-2 py-1 text-left hover:bg-slate-50" @click="map?.setView([b.lat, b.lng], 18)">
              <span>{{ i + 1 }}. {{ b.road }}</span>
              <span class="font-mono text-red-600">{{ Math.round((fillById.get(b.id) ?? 0) * 100) }}%</span>
            </button>
          </li>
        </ol>
        <p class="mt-3 text-xs text-slate-400">填滿率為模擬資料；市民回報「滿了」的桶會直接變成 100%</p>
      </template>

      <div class="mt-6 flex items-baseline justify-between">
        <h2 class="font-bold">市民回報 {{ reports.length }} 筆</h2>
        <button
          v-if="source === 'local' && reports.length"
          class="text-xs"
          :class="confirmReset ? 'font-bold text-red-600' : 'text-slate-400 hover:text-slate-600'"
          @click="resetDemo"
        >
          {{ confirmReset ? '再按一次清空' : '清空' }}
        </button>
      </div>
      <div class="mt-2 flex gap-3 text-xs">
        <span v-for="kind in (['full', 'missing', 'need'] as const)" :key="kind" class="flex items-center gap-1">
          <span class="h-2.5 w-2.5 rounded-full" :style="{ background: REPORT_COLOR[kind] }" />
          {{ REPORT_LABEL[kind] }} {{ reportCounts[kind] }}
        </span>
      </div>
      <TransitionGroup tag="ul" name="report" class="mt-3 space-y-1 text-xs text-slate-600">
        <li
          v-for="r in reports.slice(0, 12)"
          :key="r.id"
          class="flex gap-2 rounded-md px-2 py-1"
          :class="freshIds.has(r.id) ? 'bg-amber-50 font-medium text-slate-900' : ''"
        >
          <span class="text-slate-400">{{ new Date(r.createdAt).toLocaleTimeString('zh-TW') }}</span>
          <span :style="{ color: REPORT_COLOR[r.kind] }">{{ REPORT_LABEL[r.kind] }}</span>
          <span class="truncate">{{ reportPlace(r) }}</span>
        </li>
      </TransitionGroup>
      <p v-if="!reports.length" class="mt-2 text-xs text-slate-400">還沒有回報。用手機打開市民端，按「滿了」試試看。</p>
    </aside>

    <div ref="mapEl" class="order-1 min-h-0 flex-1 md:order-2" />

    <Transition name="toast">
      <div v-if="toast" class="absolute top-4 right-4 z-[1100] rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
        🔔 {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style>
.tbb-ping {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: var(--c);
  opacity: 0.5;
  animation: tbb-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes tbb-ping {
  75%,
  100% {
    transform: scale(2);
    opacity: 0;
  }
}
.report-enter-active {
  transition: all 0.4s ease;
}
.report-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
