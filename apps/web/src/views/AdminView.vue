<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import { loadBins, loadFillLevels, loadGrid, loadReports } from '../lib/data'
import { nearestNeighborRoute } from '../lib/geo'
import { REPORT_LABEL, type Bin, type FillLevel, type GridData, type Report } from '../types'

type Tab = 'gap' | 'route'

const mapEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const tab = ref<Tab>('gap')
const bins = ref<Bin[]>([])
const grid = ref<GridData>()
const fills = ref<FillLevel[]>([])
const reports = ref<Report[]>([])
const threshold = ref(0.8)
let layer: L.LayerGroup | undefined

const fillById = computed(() => new Map(fills.value.map((f) => [f.id, f.fill])))
const maxGap = computed(() => Math.max(0.0001, ...(grid.value?.cells.map((c) => c.gap) ?? [0])))
const suggestions = computed(() => {
  const byId = new Map(grid.value?.cells.map((c) => [c.id, c]))
  return (grid.value?.suggestions ?? []).map((id) => byId.get(id)!).filter(Boolean)
})
const fullBins = computed(() => bins.value.filter((b) => (fillById.value.get(b.id) ?? 0) >= threshold.value))
const route = computed(() => nearestNeighborRoute(TAIPEI, fullBins.value))

function gapColor(gap: number) {
  if (gap <= 0) return '#10b981'
  const t = Math.min(1, gap / maxGap.value)
  return t > 0.66 ? '#dc2626' : t > 0.33 ? '#f97316' : '#facc15'
}

function fillColor(fill: number) {
  return fill >= threshold.value ? '#dc2626' : fill >= 0.5 ? '#f59e0b' : '#10b981'
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
          html: `<div class="grid h-6 w-6 place-items-center rounded-full bg-red-600 text-xs font-bold text-white ring-2 ring-white">${i + 1}</div>`,
        }),
      }).addTo(layer!)
    })
  }

  if (tab.value === 'route') {
    for (const b of bins.value) {
      const fill = fillById.value.get(b.id) ?? 0
      L.circleMarker([b.lat, b.lng], { radius: 7, color: fillColor(fill), fillOpacity: 0.85 })
        .bindTooltip(`${b.road}・填滿 ${Math.round(fill * 100)}%`)
        .addTo(layer)
    }
    if (route.value.length) {
      L.polyline([TAIPEI, ...route.value.map((b) => [b.lat, b.lng] as [number, number])], {
        color: '#2563eb',
        weight: 4,
        dashArray: '6 6',
      }).addTo(layer)
    }
  }

  for (const r of reports.value) {
    L.circleMarker([r.lat, r.lng], { radius: 5, color: '#7c3aed', fillOpacity: 1 })
      .bindTooltip(`市民回報：${REPORT_LABEL[r.kind]}`)
      .addTo(layer)
  }
}

watch([tab, threshold, fills, reports], draw)

onMounted(async () => {
  map.value = createMap(mapEl.value!, TAIPEI, 15)
  ;[bins.value, grid.value, fills.value, reports.value] = await Promise.all([
    loadBins(),
    loadGrid(),
    loadFillLevels(),
    loadReports(),
  ])
  draw()
})

onBeforeUnmount(() => map.value?.remove())
</script>

<template>
  <div class="flex h-full flex-col md:flex-row">
    <aside class="order-2 max-h-[45%] w-full overflow-y-auto border-slate-200 bg-white p-4 md:order-1 md:max-h-none md:w-96 md:border-r">
      <div class="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button :class="['rounded-md py-1.5', tab === 'gap' && 'bg-white font-bold shadow']" @click="tab = 'gap'">垃圾桶沙漠</button>
        <button :class="['rounded-md py-1.5', tab === 'route' && 'bg-white font-bold shadow']" @click="tab = 'route'">滿溢與清運</button>
      </div>

      <template v-if="tab === 'gap'">
        <h2 class="font-bold">建議新設點 Top {{ suggestions.length }}</h2>
        <p class="mb-3 text-xs text-slate-500">缺口 = 人流需求 − 現有垃圾桶覆蓋，網格 {{ grid?.cellMeters }} 公尺</p>
        <ol class="space-y-1 text-sm">
          <li v-for="(c, i) in suggestions" :key="c.id" class="flex justify-between rounded-lg px-2 py-1 hover:bg-slate-50">
            <button @click="map?.setView([c.lat, c.lng], 17)">#{{ i + 1 }}　{{ c.lat.toFixed(4) }}, {{ c.lng.toFixed(4) }}</button>
            <span class="font-mono text-red-600">{{ c.gap.toFixed(2) }}</span>
          </li>
        </ol>
      </template>

      <template v-else>
        <h2 class="font-bold">需要清運：{{ fullBins.length }} / {{ bins.length }} 個</h2>
        <label class="my-3 block text-xs text-slate-500">
          填滿門檻 {{ Math.round(threshold * 100) }}%
          <input v-model.number="threshold" type="range" min="0.5" max="1" step="0.05" class="w-full" />
        </label>
        <ol class="space-y-1 text-sm">
          <li v-for="(b, i) in route" :key="b.id" class="flex justify-between">
            <span>{{ i + 1 }}. {{ b.road }}</span>
            <span class="font-mono text-red-600">{{ Math.round((fillById.get(b.id) ?? 0) * 100) }}%</span>
          </li>
        </ol>
        <p class="mt-3 text-xs text-slate-400">填滿率為模擬資料</p>
      </template>

      <h2 class="mt-6 font-bold">市民回報 {{ reports.length }} 筆</h2>
      <ul class="mt-2 space-y-1 text-xs text-slate-600">
        <li v-for="r in reports.slice(0, 10)" :key="r.id">
          {{ new Date(r.createdAt).toLocaleTimeString('zh-TW') }}・{{ REPORT_LABEL[r.kind] }}
        </li>
      </ul>
    </aside>
    <div ref="mapEl" class="order-1 min-h-0 flex-1 md:order-2" />
  </div>
</template>
