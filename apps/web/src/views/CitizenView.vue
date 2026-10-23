<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import { loadBins, submitReport } from '../lib/data'
import { distanceMeters, walkingMinutes, type LatLng } from '../lib/geo'
import { REPORT_LABEL, type Bin, type ReportKind } from '../types'

type LocateState = 'idle' | 'locating' | 'ok' | 'denied'

const mapEl = ref<HTMLElement>()
const sheetEl = ref<HTMLElement>()
const map = shallowRef<L.Map>()
const bins = ref<Bin[]>([])
const here = ref<LatLng>(TAIPEI)
const locateState = ref<LocateState>('idle')
const toast = ref('')
/** 已回報過的 `${binId}:${kind}`，避免同一桶連按好幾次 */
const reported = ref(new Set<string>())
const sending = ref<string>()
let layer: L.LayerGroup | undefined
const markers = new Map<string, L.CircleMarker>()
let toastTimer: ReturnType<typeof setTimeout> | undefined

const nearest = computed(() =>
  bins.value
    .map((bin) => ({ bin, meters: distanceMeters(here.value, [bin.lat, bin.lng]) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 5),
)

const locateHint = computed(
  () =>
    ({
      idle: '正在取得你的位置…',
      locating: '正在取得你的位置…',
      ok: '已使用你的位置',
      denied: '無法取得定位，先以台北車站為例',
    })[locateState.value],
)

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function draw() {
  if (!map.value) return
  layer?.remove()
  markers.clear()
  layer = L.layerGroup().addTo(map.value)
  const nearestId = nearest.value[0]?.bin.id
  for (const b of bins.value) {
    const isNearest = b.id === nearestId
    const m = L.circleMarker([b.lat, b.lng], {
      radius: isNearest ? 10 : 7,
      color: '#ffffff',
      weight: 2,
      fillColor: isNearest ? '#E8833A' : '#14302A',
      fillOpacity: 0.9,
    })
      .bindPopup(`<b>${escapeHtml(b.road)}</b><br>${escapeHtml(b.note || b.district)}`)
      .addTo(layer)
    markers.set(b.id, m)
  }
  L.circleMarker(here.value, { radius: 9, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
    .bindTooltip('你在這裡')
    .addTo(layer)
}

function locate() {
  if (!navigator.geolocation) {
    locateState.value = 'denied'
    return
  }
  locateState.value = 'locating'
  navigator.geolocation.getCurrentPosition(
    (p) => {
      here.value = [p.coords.latitude, p.coords.longitude]
      locateState.value = 'ok'
      draw()
      centerOn(here.value, 17)
    },
    () => (locateState.value = 'denied'),
    { enableHighAccuracy: true, timeout: 8000 },
  )
}

/** 手機版下方清單會蓋住地圖下半部，把焦點點往上推到看得見的區域 */
function centerOn(at: LatLng, zoom: number) {
  if (!map.value) return
  map.value.setView(at, zoom, { animate: false })
  const sheet = sheetEl.value
  if (sheet && innerWidth < 768) map.value.panBy([0, sheet.offsetHeight / 2], { animate: false })
}

function focus(bin: Bin) {
  centerOn([bin.lat, bin.lng], 18)
  markers.get(bin.id)?.openPopup()
}

function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2500)
}

const keyOf = (kind: ReportKind, bin?: Bin) => `${bin?.id ?? 'here'}:${kind}`

async function report(kind: ReportKind, bin?: Bin) {
  const key = keyOf(kind, bin)
  if (sending.value || (bin && reported.value.has(key))) return
  sending.value = key
  try {
    const at: LatLng = bin ? [bin.lat, bin.lng] : here.value
    await submitReport({ kind, lat: at[0], lng: at[1], binId: bin?.id })
    if (bin) reported.value = new Set([...reported.value, key])
    showToast(`已回報「${REPORT_LABEL[kind]}」，謝謝！`)
  } catch {
    showToast('回報失敗，請稍後再試')
  } finally {
    sending.value = undefined
  }
}

onMounted(async () => {
  map.value = createMap(mapEl.value!)
  bins.value = await loadBins()
  draw()
  centerOn(here.value, 17)
  locate()
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  map.value?.remove()
})
</script>

<template>
  <div class="relative h-full">
    <div ref="mapEl" class="h-full w-full" />

    <section ref="sheetEl" class="absolute inset-x-0 bottom-0 z-[1000] max-h-[50%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:inset-x-auto md:bottom-4 md:left-4 md:w-96 md:rounded-2xl">
      <div class="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 class="text-base font-bold">離你最近的垃圾桶</h2>
          <p class="text-xs text-slate-500">{{ locateHint }}</p>
        </div>
        <button
          v-if="locateState === 'denied' || locateState === 'ok'"
          class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600"
          @click="locate"
        >
          重新定位
        </button>
      </div>

      <ul class="space-y-2">
        <li v-for="({ bin, meters }, i) in nearest" :key="bin.id" class="rounded-xl border p-3" :class="i === 0 ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200'">
          <button class="w-full text-left" @click="focus(bin)">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-medium">{{ bin.road }}</span>
              <span class="shrink-0 text-sm font-bold text-emerald-700">步行 {{ walkingMinutes(meters) }} 分</span>
            </div>
            <p class="text-xs text-slate-500">{{ bin.note || bin.district }}・{{ Math.round(meters) }} 公尺</p>
          </button>
          <div class="mt-2 flex gap-2">
            <button
              v-for="kind in (['full', 'missing'] as const)"
              :key="kind"
              class="rounded-lg px-3 py-1 text-xs transition disabled:cursor-default"
              :class="
                reported.has(keyOf(kind, bin))
                  ? 'bg-emerald-100 text-emerald-800'
                  : kind === 'full'
                    ? 'bg-amber-100 text-amber-800 active:scale-95'
                    : 'bg-slate-100 text-slate-700 active:scale-95'
              "
              :disabled="reported.has(keyOf(kind, bin)) || !!sending"
              @click="report(kind, bin)"
            >
              {{ reported.has(keyOf(kind, bin)) ? `已回報${REPORT_LABEL[kind]} ✓` : sending === keyOf(kind, bin) ? '送出中…' : REPORT_LABEL[kind] }}
            </button>
          </div>
        </li>
      </ul>

      <button
        class="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
        :disabled="!!sending"
        @click="report('need')"
      >
        {{ sending === keyOf('need') ? '送出中…' : '我這裡需要一個垃圾桶' }}
      </button>
    </section>

    <Transition name="toast">
      <div v-if="toast" class="absolute top-4 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm whitespace-nowrap text-white shadow-lg">
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  /* Tailwind v4 的 -translate-x-1/2 用的是 translate 屬性，這裡只動 transform 不會互相覆蓋 */
  transform: translateY(-8px);
}
</style>
