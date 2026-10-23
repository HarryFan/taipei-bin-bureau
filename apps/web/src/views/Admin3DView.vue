<script setup lang="ts">
/**
 * 3D 戰情室（實驗分支 feat/3d）：和 2D 戰情室讀同一份資料、同一套派車邏輯，
 * 只是把地圖換成由資料長出來的 3D 城市。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { City3D, type HoverInfo } from '../lib/city3d'
import { isMock, loadBins, loadFillLevels, loadGrid, loadMeta, loadReports, onLocalReportsChange } from '../lib/data'
import { createDispatch, estimateMinutes, loadDispatches, markReturned, minutesBetween, onLocalDispatchChange, type Dispatch } from '../lib/dispatch'
import { loopMeters, splitRoutes, type LatLng } from '../lib/geo'
import { FILL_META, fillState, REPORT_COLOR, REPORT_LABEL, type Bin, type FillLevel, type GridData, type Report } from '../types'

const DISTRICTS = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區']
const TRUCK_COLORS = ['#ffb200', '#2f9be0', '#e0559f']
const ORIGIN = { lat: 25.05, lng: 121.545 }
const POLL_MS = 3000

const routeQ = useRoute()
const router = useRouter()
const stage = ref<HTMLElement>()
const city = shallowRef<City3D>()
const mode = ref<'gap' | 'route'>('route')
const night = ref(false)
const district = ref<string>(typeof routeQ.query.d === 'string' && DISTRICTS.includes(routeQ.query.d) ? routeQ.query.d : '')
const trucks = ref(1)
const threshold = 0.8
const bins = ref<Bin[]>([])
const grid = ref<GridData>()
const fills = ref<FillLevel[]>([])
const reports = ref<Report[]>([])
const dispatches = ref<Dispatch[]>([])
const mock = ref(true)
const hover = ref<HoverInfo>()
const selected = ref<Bin>()
const selectedReports = computed(() => (selected.value ? reports.value.filter((r) => r.binId === selected.value!.id).slice(0, 3) : []))
const selectedStatus = computed(() => {
  const b = selected.value
  if (!b) return ''
  if (onDuty.value.some((d) => d.stops.includes(b.id)) || dispatches.value.some((d) => !d.returnedAt && d.stops.includes(b.id))) return '清運車已出發'
  return isDue(b) ? '超過門檻，待派車' : ''
})
const loading = ref(true)
/** 進場標題：城市長出來的那幾秒顯示 */
const intro = ref(true)
let loaded = false
let pollTimer: ReturnType<typeof setInterval> | undefined
const cleanups: (() => void)[] = []

const binById = computed(() => new Map(bins.value.map((b) => [b.id, b])))
const binCount = computed(() => {
  const m = new Map<string, number>()
  for (const b of bins.value) m.set(b.district, (m.get(b.district) ?? 0) + 1)
  return m
})
const emptiedAt = computed(() => {
  const m = new Map<string, string>()
  for (const d of dispatches.value) if (d.returnedAt) for (const id of d.stops) if (!m.has(id) || m.get(id)! < d.returnedAt) m.set(id, d.returnedAt)
  return m
})
const fillById = computed(
  () =>
    new Map(
      fills.value.map((f) => {
        const t = emptiedAt.value.get(f.id)
        return [f.id, t && (!f.updatedAt || Date.parse(f.updatedAt) < Date.parse(t)) ? 0.05 : f.fill]
      }),
    ),
)
const assigned = computed(() => new Set(dispatches.value.filter((d) => !d.returnedAt).flatMap((d) => d.stops)))
const isDue = (b: Bin) => (fillById.value.get(b.id) ?? 0) >= threshold
const dueByDistrict = computed(() => {
  const m = new Map<string, number>()
  for (const b of bins.value) if (isDue(b) && !assigned.value.has(b.id)) m.set(b.district, (m.get(b.district) ?? 0) + 1)
  return m
})
const visibleBins = computed(() => (district.value ? bins.value.filter((b) => b.district === district.value) : bins.value))
const fullBins = computed(() => visibleBins.value.filter((b) => isDue(b) && !assigned.value.has(b.id)))
const depot = computed<LatLng>(() => {
  const l = visibleBins.value
  return l.length ? [l.reduce((s, b) => s + b.lat, 0) / l.length, l.reduce((s, b) => s + b.lng, 0) / l.length] : [ORIGIN.lat, ORIGIN.lng]
})
const plans = computed(() =>
  district.value && fullBins.value.length
    ? splitRoutes(depot.value, fullBins.value, trucks.value).map((stops, i) => {
        const km = loopMeters(depot.value, stops) / 1000
        return { truck: i + 1, color: TRUCK_COLORS[i % 3], stops, km, estMin: estimateMinutes(km, stops.length) }
      })
    : [],
)
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
const onDuty = computed(() => dispatches.value.filter((d) => !d.returnedAt && isToday(d.departedAt) && (!district.value || d.district === district.value)))

function nearestBin(lat: number, lng: number) {
  let best: Bin | undefined
  let bd = Infinity
  for (const b of bins.value) {
    const d = (b.lat - lat) ** 2 + (b.lng - lng) ** 2
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return best
}
const cellDistrict = computed(() => new Map((grid.value?.cells ?? []).map((c) => [c.id, nearestBin(c.lat, c.lng)?.district ?? ''])))
const candidates = computed(() => {
  const cells = (grid.value?.cells ?? []).filter((c) => c.gap > 0 && !c.missingData && (!district.value || cellDistrict.value.get(c.id) === district.value))
  return cells.sort((a, b) => b.gap - a.gap).slice(0, 10)
})
const todayReports = computed(() => reports.value.filter((r) => isToday(r.createdAt)))

// ---------- 畫面同步到 3D ----------
function syncLabels() {
  const c = city.value
  if (!c) return
  const items = DISTRICTS.filter((d) => binCount.value.get(d)).map((d) => {
    const l = bins.value.filter((b) => b.district === d)
    return { name: d, lat: l.reduce((s, b) => s + b.lat, 0) / l.length, lng: l.reduce((s, b) => s + b.lng, 0) / l.length, due: dueByDistrict.value.get(d) ?? 0, active: district.value === d }
  })
  c.setDistrictLabels(items, (d) => (district.value = district.value === d ? '' : d))
}
function syncScene() {
  const c = city.value
  if (!c) return
  c.updateBins(fillById.value, threshold, district.value || undefined)
  c.paintTiles(mode.value === 'gap' ? 'gap' : 'plain', district.value ? (id) => cellDistrict.value.get(id) === district.value : undefined)
  const loop = (stops: Bin[]): LatLng[] => [depot.value, ...stops.map((b) => [b.lat, b.lng] as LatLng), depot.value]
  c.setRoutes(
    mode.value === 'route'
      ? [
          ...plans.value.map((p) => ({ color: p.color, path: loop(p.stops) })),
          ...(district.value ? onDuty.value : []).map((d) => ({
            color: TRUCK_COLORS[(d.truck - 1) % 3],
            path: loop(d.stops.map((id) => binById.value.get(id)).filter((b): b is Bin => !!b)),
            active: true,
          })),
        ]
      : [],
    mode.value === 'route' && district.value ? depot.value : undefined,
  )
  c.setPins(mode.value === 'gap' ? candidates.value.map((x) => ({ lat: x.lat, lng: x.lng, label: `候選新設點，缺口 ${x.gap.toFixed(2)}` })) : [])
  syncLabels()
}
function focus() {
  const c = city.value
  if (!c) return
  const pts = visibleBins.value.map((b) => [b.lat, b.lng] as LatLng)
  c.flyToPoints(pts, district.value ? 130 : 240, district.value ? 1.9 : 1.25)
}

watch([mode, fills, dispatches, trucks], syncScene)
watch(district, (d) => {
  router.replace({ query: { ...routeQ.query, d: d || undefined } })
  trucks.value = 1
  syncScene()
  focus()
})
watch(night, (n) => city.value?.setNight(n))

async function refresh() {
  const [f, r, d] = await Promise.all([loadFillLevels(), loadReports(), loadDispatches()])
  if (JSON.stringify(f) !== JSON.stringify(fills.value)) fills.value = f
  if (JSON.stringify(d) !== JSON.stringify(dispatches.value)) dispatches.value = d
  const known = new Set(reports.value.map((x) => x.id))
  const added = r.filter((x) => !known.has(x.id))
  reports.value = r
  if (loaded && added.length) {
    for (const a of added) city.value?.ping(a.lat, a.lng, REPORT_COLOR[a.kind])
    const latest = added[0]
    if (latest.kind === 'full') {
      const d = (latest.binId && binById.value.get(latest.binId)?.district) || nearestBin(latest.lat, latest.lng)?.district
      mode.value = 'route'
      if (d && d !== district.value) district.value = d
    }
  }
}

async function dispatchAll() {
  for (const p of plans.value) await createDispatch({ district: district.value, truck: p.truck, stops: p.stops.map((b) => b.id), km: Math.round(p.km * 10) / 10, estMin: p.estMin })
  dispatches.value = await loadDispatches()
}
async function returnTruck(id: string) {
  await markReturned(id)
  dispatches.value = await loadDispatches()
}
const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })

onMounted(async () => {
  const c = new City3D(stage.value!, ORIGIN)
  c.onHover = (h) => (hover.value = h)
  c.onPick = (b) => {
    selected.value = b
    c.flyToBin(b)
  }
  c.setInsetLeft(340)
  city.value = c
  // 方便在瀏覽器 console 操作與自動化測試
  ;(window as unknown as { __city3d?: City3D }).__city3d = c
  const [b, g, meta] = await Promise.all([loadBins(), loadGrid(), loadMeta()])
  bins.value = b
  grid.value = g
  mock.value = isMock(meta)
  c.build(b, g)
  await refresh()
  syncScene()
  focus()
  loading.value = false
  setTimeout(() => (intro.value = false), 2600)
  loaded = true
  pollTimer = setInterval(refresh, POLL_MS)
  cleanups.push(onLocalReportsChange(refresh), onLocalDispatchChange(refresh))
})
onBeforeUnmount(() => {
  clearInterval(pollTimer)
  cleanups.forEach((f) => f())
  city.value?.dispose()
})
</script>

<template>
  <div class="city3d-sky relative h-full overflow-hidden text-ink" :class="night ? 'city3d-night' : ''">
    <!-- isolate：CSS2D 標籤會自帶很大的 z-index，關在自己的堆疊層，才不會蓋到面板 -->
    <div ref="stage" class="absolute inset-0 isolate" />
    <div v-if="loading" class="absolute inset-0 grid place-items-center text-sm text-mute">城市生成中…</div>
    <Transition name="intro3d">
      <div v-if="intro && !loading" class="pointer-events-none absolute inset-x-0 top-[30%] flex flex-col items-center gap-3 text-center">
        <div class="rounded-[16px] bg-sign p-[5px] shadow-2xl">
          <div class="rounded-[12px] border-[3px] border-white/90 px-8 py-3 text-4xl font-black tracking-[0.12em] text-white">台北桶報局</div>
        </div>
        <p class="rounded-full bg-white/85 px-4 py-1.5 text-sm font-bold tracking-[0.2em] text-ink backdrop-blur">661 個真實垃圾桶點位・即時清運調度</p>
      </div>
    </Transition>

    <!-- 左上：品牌 -->
    <div class="pointer-events-none absolute top-4 left-4 flex items-center gap-3">
      <div class="pointer-events-auto rounded-[12px] bg-sign p-[4px] shadow-lg">
        <div class="rounded-[9px] border-2 border-white/90 px-3 py-1.5 text-base font-bold tracking-[0.08em] text-white">台北桶報局</div>
      </div>
      <div class="rounded-[12px] bg-white/90 px-3.5 py-1.5 leading-tight shadow-lg backdrop-blur">
        <div class="text-lg font-bold">3D 城市戰情室</div>
        <div class="text-xs text-mute">市府端・內部使用</div>
      </div>
      <span v-if="mock" class="rounded-full bg-white/70 px-2.5 py-0.5 text-xs text-mute">部分模擬資料</span>
    </div>

    <!-- 上方：模式與日夜 -->
    <div class="absolute top-4 left-1/2 flex -translate-x-1/2 gap-2">
      <div class="flex rounded-full bg-white/90 p-1 text-sm shadow-lg backdrop-blur">
        <button
          v-for="m in (['route', 'gap'] as const)"
          :key="m"
          class="rounded-full px-4 py-1.5 transition"
          :class="mode === m ? 'bg-ink font-bold text-white' : 'text-mute hover:text-ink'"
          @click="mode = m"
        >
          {{ m === 'route' ? '清運調度' : '缺口熱區' }}
        </button>
      </div>
      <button class="rounded-full bg-white/90 px-3 text-sm shadow-lg backdrop-blur" :aria-pressed="night" @click="night = !night">{{ night ? '夜間' : '白天' }}</button>
    </div>

    <!-- 右上：切回 2D -->
    <div class="absolute top-4 right-4 flex gap-2">
      <RouterLink :to="{ path: '/admin', query: district ? { d: district } : {} }" class="rounded-full bg-white/90 px-3.5 py-2 text-sm font-bold shadow-lg backdrop-blur hover:bg-white">2D 戰情室</RouterLink>
      <RouterLink to="/" class="rounded-full bg-white/90 px-3.5 py-2 text-sm font-bold shadow-lg backdrop-blur hover:bg-white">市民端</RouterLink>
    </div>

    <!-- 左：面板 -->
    <aside class="absolute top-20 bottom-4 left-4 flex w-[320px] flex-col overflow-hidden rounded-[18px] bg-white/92 shadow-xl backdrop-blur">
      <div class="flex flex-wrap gap-1.5 border-b border-hair p-3">
        <button
          v-for="d in ['', ...DISTRICTS]"
          :key="d || 'all'"
          class="rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-35"
          :class="district === d ? 'border-ink bg-ink font-bold text-white' : 'border-hair hover:bg-paper'"
          :disabled="!!d && !binCount.get(d)"
          @click="district = d"
        >
          {{ d || '全市' }}<span v-if="d && dueByDistrict.get(d)" class="num ml-1 text-alert" :class="district === d ? 'text-[#ffb3b5]' : ''">{{ dueByDistrict.get(d) }}</span>
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <p class="text-xs font-bold tracking-[0.12em] text-[#c4621f]">{{ mode === 'route' ? 'DISPATCH · 清運調度' : 'GAP · 缺口熱區' }}</p>
        <h2 class="mt-1 text-xl leading-snug font-black">{{ district || '全市' }}</h2>
        <dl class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-[10px] bg-paper py-2"><dt class="text-[11px] text-mute">點位</dt><dd class="num text-lg font-semibold">{{ visibleBins.length }}</dd></div>
          <div class="rounded-[10px] bg-paper py-2"><dt class="text-[11px] text-mute">待清運</dt><dd class="num text-lg font-semibold text-alert">{{ fullBins.length }}</dd></div>
          <div class="rounded-[10px] bg-paper py-2"><dt class="text-[11px] text-mute">今日回報</dt><dd class="num text-lg font-semibold">{{ todayReports.length }}</dd></div>
        </dl>

        <template v-if="mode === 'route'">
          <p v-if="!district" class="mt-4 text-sm leading-relaxed text-mute">每區有自己的清潔隊。點城市上的行政區標籤，或上方的區名，進去排路線、派車。</p>
          <template v-else>
            <div class="mt-4 flex items-center justify-between text-xs text-mute">
              <span>派幾台車</span>
              <span class="flex gap-1">
                <button
                  v-for="n in 3"
                  :key="n"
                  class="num h-7 w-8 rounded-[6px] text-sm"
                  :class="trucks === n ? 'bg-ink font-bold text-white' : 'bg-paper'"
                  :disabled="n > Math.max(1, fullBins.length)"
                  @click="trucks = n"
                >{{ n }}</button>
              </span>
            </div>
            <ul class="mt-3 space-y-1.5">
              <li v-for="p in plans" :key="p.truck" class="flex items-center gap-2 rounded-[10px] bg-paper px-3 py-2 text-sm">
                <span class="h-2.5 w-2.5 rounded-full" :style="{ background: p.color }" />
                <span class="font-bold">第 {{ p.truck }} 車</span>
                <span class="num ml-auto text-xs text-mute">{{ p.stops.length }} 桶 · {{ p.km.toFixed(1) }} km · 約 {{ p.estMin }} 分</span>
              </li>
            </ul>
            <button class="mt-3 w-full rounded-[10px] bg-truck py-2.5 text-sm font-bold disabled:opacity-40" :disabled="!plans.length" @click="dispatchAll">
              {{ plans.length ? `派出 ${plans.length} 台車` : '目前沒有要清運的桶' }}
            </button>
            <ul v-if="onDuty.length" class="mt-3 space-y-1.5">
              <li v-for="d in onDuty" :key="d.id" class="flex items-center gap-2 rounded-[10px] border border-hair px-3 py-2 text-sm">
                <span class="min-w-0 flex-1">第 {{ d.truck }} 車出勤中 · {{ d.stops.length }} 桶<span class="num block text-xs text-mute">{{ timeFmt(d.departedAt) }} 出發，已 {{ minutesBetween(d.departedAt, new Date().toISOString()) }} 分</span></span>
                <button class="rounded-full bg-[#7fd6a4] px-2.5 py-1 text-xs font-bold" @click="returnTruck(d.id)">返隊</button>
              </li>
            </ul>
          </template>
        </template>

        <template v-else>
          <p class="mt-4 text-sm leading-relaxed text-mute">地面顏色越紅，代表人流與陳情越多、垃圾桶越少。房子高度代表需求量。黃色編號是候選新設點，仍需現場會勘。</p>
          <ol class="mt-3">
            <li v-for="(c, i) in candidates" :key="c.id" class="flex items-center gap-2 border-t border-hair py-2 text-sm first:border-t-0">
              <span class="num grid h-6 w-6 place-items-center rounded-[6px] bg-truck text-xs font-bold">{{ i + 1 }}</span>
              <span class="min-w-0 flex-1 truncate">{{ nearestBin(c.lat, c.lng)?.road ?? '未命名區域' }}附近</span>
              <span class="num text-xs text-[#c4621f]">{{ c.gap.toFixed(2) }}</span>
            </li>
          </ol>
        </template>
      </div>

      <div class="border-t border-hair p-3">
        <p class="mb-1.5 text-xs font-bold">最新回報</p>
        <p v-if="!reports.length" class="text-xs text-mute">還沒有回報。用手機掃 QR Code 按「這桶滿了」，城市上會升起光柱。</p>
        <ul class="space-y-1">
          <li v-for="r in reports.slice(0, 3)" :key="r.id" class="flex items-center gap-2 text-xs">
            <span class="h-2 w-2 rounded-full" :style="{ background: REPORT_COLOR[r.kind] }" />
            <span class="font-bold" :style="{ color: REPORT_COLOR[r.kind] }">{{ REPORT_LABEL[r.kind] }}</span>
            <span class="min-w-0 flex-1 truncate text-mute">{{ (r.binId && binById.get(r.binId)?.road) || '地圖上的位置' }}</span>
            <time class="num text-mute">{{ timeFmt(r.createdAt) }}</time>
          </li>
        </ul>
      </div>
    </aside>

    <!-- 右下：圖例 -->
    <div class="absolute right-4 bottom-4 rounded-[14px] bg-white/90 px-4 py-3 text-xs shadow-lg backdrop-blur">
      <p class="mb-1.5 font-bold">垃圾桶</p>
      <p v-for="s in (['ok', 'busy', 'full'] as const)" :key="s" class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-full" :style="{ background: FILL_META[s].color }" />{{ FILL_META[s].label }}
      </p>
      <p class="mt-1 flex items-center gap-2"><span class="text-alert">▼</span>超過門檻、待清運</p>
      <p class="mt-2 text-mute">拖曳旋轉 · 滾輪縮放 · 右鍵平移</p>
    </div>

    <!-- 點選的垃圾桶 -->
    <Transition name="drop3d">
      <div v-if="selected" class="absolute top-20 right-4 w-[300px] rounded-[18px] bg-white/95 p-4 shadow-xl backdrop-blur">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-xs text-mute">{{ selected.district }} · {{ selected.id.replace('bin-', '#') }}</p>
            <p class="mt-0.5 text-base leading-snug font-bold">{{ selected.road }}</p>
          </div>
          <button class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper text-mute hover:text-ink" aria-label="關閉" @click="selected = undefined">✕</button>
        </div>
        <div class="mt-3 flex items-center gap-3">
          <div class="flex flex-1 gap-[3px]" aria-hidden="true">
            <span
              v-for="i in 10"
              :key="i"
              class="h-2 flex-1 rounded-[2px]"
              :style="{ background: i <= Math.round((fillById.get(selected.id) ?? 0) * 10) ? FILL_META[fillState(fillById.get(selected.id) ?? 0)].color : '#e3e9e5' }"
            />
          </div>
          <span class="num shrink-0 text-sm font-bold">{{ Math.round((fillById.get(selected.id) ?? 0) * 100) }}%</span>
        </div>
        <p class="mt-1 text-xs text-mute">{{ FILL_META[fillState(fillById.get(selected.id) ?? 0)].label }}<template v-if="selectedStatus"> · <span class="font-bold text-ink">{{ selectedStatus }}</span></template></p>
        <p class="mt-3 text-xs font-bold">市民回報</p>
        <p v-if="!selectedReports.length" class="mt-1 text-xs text-mute">今天還沒有人回報這一桶。</p>
        <ul class="mt-1 space-y-1">
          <li v-for="r in selectedReports" :key="r.id" class="flex items-center gap-2 text-xs">
            <span class="h-2 w-2 rounded-full" :style="{ background: REPORT_COLOR[r.kind] }" />
            <span class="font-bold">{{ REPORT_LABEL[r.kind] }}</span>
            <time class="num ml-auto text-mute">{{ timeFmt(r.createdAt) }}</time>
          </li>
        </ul>
        <button v-if="selected.district !== district" class="mt-3 w-full rounded-[10px] bg-ink py-2 text-sm font-bold text-white" @click="district = selected.district">看{{ selected.district }}的清運調度</button>
      </div>
    </Transition>

    <!-- 滑過垃圾桶 -->
    <div
      v-if="hover"
      class="pointer-events-none absolute z-10 max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-[10px] bg-ink px-3 py-2 text-xs text-white shadow-lg"
      :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
    >
      <p class="font-bold">{{ hover.bin.road }}</p>
      <p class="mt-0.5 text-white/75">
        {{ hover.bin.district }} · {{ FILL_META[fillState(fillById.get(hover.bin.id) ?? 0)].label }}
        {{ Math.round((fillById.get(hover.bin.id) ?? 0) * 100) }}%
      </p>
    </div>
  </div>
</template>

<style>
.intro3d-leave-active {
  transition:
    opacity 0.8s ease,
    transform 0.8s ease;
}
.intro3d-leave-to {
  opacity: 0;
  transform: translateY(-24px) scale(0.96);
}
.drop3d-enter-active,
.drop3d-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.drop3d-enter-from,
.drop3d-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.city3d-sky {
  background:
    radial-gradient(120% 80% at 50% 110%, rgb(255 236 200 / 0.55), transparent 60%),
    linear-gradient(180deg, #bfe1ea 0%, #d7ecef 45%, #eef4ef 100%);
  transition: background 0.6s;
}
.city3d-sky.city3d-night {
  background:
    radial-gradient(120% 80% at 50% 110%, rgb(255 190 110 / 0.18), transparent 60%),
    linear-gradient(180deg, #08111c 0%, #13253a 55%, #1d3047 100%);
}
.city3d-sky::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(140% 100% at 50% 45%, transparent 55%, rgb(16 37 28 / 0.18) 100%);
}
.city3d-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.92);
  color: #10251c;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 6px 18px rgb(16 37 28 / 0.18);
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.15s;
}
.city3d-label:hover {
  transform: translateY(-2px);
}
.city3d-label b {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  background: #e5484d;
  color: #fff;
  font: 600 12px/18px var(--font-num);
  text-align: center;
}
.city3d-label.is-active {
  background: #10251c;
  color: #fff;
}
.city3d-pin {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: #ffc72c;
  color: #10251c;
  font: 700 14px var(--font-num);
  box-shadow:
    0 0 0 3px #fff,
    0 6px 16px rgb(0 0 0 / 0.25);
}
.city3d-night .city3d-label:not(.is-active) {
  background: rgb(20 36 48 / 0.9);
  color: #e6efe9;
}
</style>
