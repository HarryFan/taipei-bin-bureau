<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import { createMap, TAIPEI } from '../lib/map'
import { useRoute } from 'vue-router'
import { isMock, loadBins, loadFillLevels, loadGrid, loadMeta, submitReport } from '../lib/data'
import { shortCode, verifyBin } from '../lib/qr'
import { claim, POINTS, STALE_DAYS, totals } from '../lib/rewards'
import { bearingDeg, compassWord, distanceMeters, walkingMinutes, type LatLng } from '../lib/geo'
import { FILL_META, fillState, REPORT_LABEL, type Bin, type GridCell, type ReportKind } from '../types'

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

function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

const keyOf = (kind: ReportKind, bin?: Bin) => `${bin?.id ?? 'here'}:${kind}`

async function report(kind: ReportKind, bin?: Bin) {
  const key = keyOf(kind, bin)
  if (sending.value || reported.value.has(key)) return
  sending.value = key
  try {
    const at: LatLng = bin ? [bin.lat, bin.lng] : here.value
    await submitReport({ kind, lat: at[0], lng: at[1], binId: bin?.id })
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
    const sent = kind === 'need' ? '已回報這裡需要垃圾桶，市府會看到' : `已回報「${REPORT_LABEL[kind]}」`
    showToast(reward.points ? `${sent}，${reward.message}` : sent)
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
})

onMounted(async () => {
  map.value = createMap(mapEl.value!, { zoom: 16 })
  const [b, f, meta, g] = await Promise.all([loadBins(), loadFillLevels(), loadMeta(), loadGrid()])
  mock.value = isMock(meta)
  fills.value = new Map(f.map((x) => [x.id, x.fill]))
  checkedDays.value = new Map(f.map((x) => [x.id, x.checkedDaysAgo ?? 0]))
  gapCells.value = g.cells.filter((c) => c.gap > 0)
  bins.value = b
  applyScan()
  locate()
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
  clearTimeout(toastTimer)
  map.value?.remove()
})
</script>

<template>
  <div class="relative h-full overflow-hidden bg-paper">
    <div ref="mapEl" class="absolute inset-0" />

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
      </div>
      <div class="pointer-events-auto flex items-center gap-2">
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
                  <span class="text-sm">公尺</span>
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
