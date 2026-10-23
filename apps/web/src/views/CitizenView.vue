<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import { loadBins, submitReport } from '../lib/data'
import { distanceMeters, walkingMinutes, type LatLng } from '../lib/geo'
import { REPORT_LABEL, type Bin, type ReportKind } from '../types'

const mapEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const bins = ref<Bin[]>([])
const here = ref<LatLng>(TAIPEI)
const located = ref(false)
const toast = ref('')
let layer: L.LayerGroup | undefined

const nearest = computed(() =>
  bins.value
    .map((bin) => ({ bin, meters: distanceMeters(here.value, [bin.lat, bin.lng]) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 5),
)

function draw() {
  if (!map.value) return
  layer?.remove()
  layer = L.layerGroup().addTo(map.value)
  L.circleMarker(here.value, { radius: 9, color: '#2563eb', fillOpacity: 0.9 }).bindTooltip('你在這裡').addTo(layer)
  for (const b of bins.value) {
    L.circleMarker([b.lat, b.lng], { radius: 7, color: '#059669', fillOpacity: 0.8 })
      .bindPopup(`<b>${b.road}</b><br>${b.note || b.district}`)
      .addTo(layer)
  }
  map.value.setView(here.value, 16)
}

function locate() {
  navigator.geolocation?.getCurrentPosition(
    (p) => {
      here.value = [p.coords.latitude, p.coords.longitude]
      located.value = true
      draw()
    },
    () => {},
    { enableHighAccuracy: true, timeout: 8000 },
  )
}

function focus(bin: Bin) {
  map.value?.setView([bin.lat, bin.lng], 18)
}

async function report(kind: ReportKind, bin?: Bin) {
  const at: LatLng = bin ? [bin.lat, bin.lng] : here.value
  await submitReport({ kind, lat: at[0], lng: at[1], binId: bin?.id })
  toast.value = `已回報「${REPORT_LABEL[kind]}」，謝謝！`
  setTimeout(() => (toast.value = ''), 2500)
}

onMounted(async () => {
  map.value = createMap(mapEl.value!)
  bins.value = await loadBins()
  draw()
  locate()
})

onBeforeUnmount(() => map.value?.remove())
</script>

<template>
  <div class="relative h-full">
    <div ref="mapEl" class="h-full w-full" />

    <section class="absolute inset-x-0 bottom-0 z-[1000] max-h-[55%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:inset-x-auto md:bottom-4 md:left-4 md:w-96 md:rounded-2xl">
      <h2 class="mb-1 text-base font-bold">離你最近的垃圾桶</h2>
      <p class="mb-3 text-xs text-slate-500">{{ located ? '已使用你的位置' : '未取得定位，先以台北車站為例' }}</p>

      <ul class="space-y-2">
        <li v-for="{ bin, meters } in nearest" :key="bin.id" class="rounded-xl border border-slate-200 p-3">
          <button class="w-full text-left" @click="focus(bin)">
            <div class="flex items-baseline justify-between">
              <span class="font-medium">{{ bin.road }}</span>
              <span class="text-sm font-bold text-emerald-700">步行 {{ walkingMinutes(meters) }} 分</span>
            </div>
            <p class="text-xs text-slate-500">{{ bin.note || bin.district }}・{{ Math.round(meters) }} 公尺</p>
          </button>
          <div class="mt-2 flex gap-2">
            <button class="rounded-lg bg-amber-100 px-3 py-1 text-xs text-amber-800" @click="report('full', bin)">滿了</button>
            <button class="rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-700" @click="report('missing', bin)">不見了</button>
          </div>
        </li>
      </ul>

      <button class="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white" @click="report('need')">
        我這裡需要一個垃圾桶
      </button>
    </section>

    <div v-if="toast" class="absolute top-4 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white">
      {{ toast }}
    </div>
  </div>
</template>
