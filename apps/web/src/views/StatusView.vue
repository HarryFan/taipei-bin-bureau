<script setup lang="ts">
/**
 * 公開處理成績單（/#/status）：不用登入，市民、議員、媒體都能看各區處理得多快。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isMock, loadBins, loadMeta, loadReports, onLocalReportsChange } from '../lib/data'
import { loadDispatches, onLocalDispatchChange, type Dispatch } from '../lib/dispatch'
import { buildCases, districtScores, FAST_MIN } from '../lib/scoreboard'
import { groupIssueCases, issueReached, loadCaseStates, onLocalCasesChange, type CaseState } from '../lib/cases'
import { REPORT_COLOR, REPORT_LABEL, type Bin, type Report, type ReportKind } from '../types'

const DISTRICTS = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區']
const bins = ref<Bin[]>([])
const reports = ref<Report[]>([])
const dispatches = ref<Dispatch[]>([])
const caseStates = ref<CaseState[]>([])
const mock = ref(true)
let timer: ReturnType<typeof setInterval> | undefined
const stops: (() => void)[] = []

const binById = computed(() => new Map(bins.value.map((b) => [b.id, b])))
const cases = computed(() => buildCases(reports.value, dispatches.value, binById.value))
const withData = computed(() => new Set(bins.value.map((b) => b.district)))
const scores = computed(() => districtScores(cases.value, reports.value, binById.value, DISTRICTS.filter((d) => withData.value.has(d))))
const closed = computed(() => cases.value.filter((c) => c.minutes !== undefined))
const avg = computed(() => (closed.value.length ? Math.round(closed.value.reduce((s, c) => s + c.minutes!, 0) / closed.value.length) : undefined))
/** 其他三類問題（髒亂、損壞、其他）的人工分流案件 */
const issues = computed(() => groupIssueCases(reports.value, caseStates.value))
const issueDone = computed(() => issues.value.filter((c) => issueReached(c) === 3).length)
/** 回報類型分布（7 天內） */
const KINDS: ReportKind[] = ['full', 'dirty', 'broken', 'other', 'need', 'missing', 'ok']
const byKind = computed(() => {
  const weekAgo = Date.now() - 7 * 86_400_000
  const recent = reports.value.filter((r) => Date.parse(r.createdAt) >= weekAgo)
  const max = Math.max(1, ...KINDS.map((k) => recent.filter((r) => r.kind === k).length))
  return KINDS.map((k) => ({ kind: k, n: recent.filter((r) => r.kind === k).length, share: recent.filter((r) => r.kind === k).length / max })).filter((x) => x.n)
})
/** 重複出問題的點位：被回報最多次的垃圾桶（不含「狀況良好」） */
const hotspots = computed(() => {
  const count = new Map<string, number>()
  for (const r of reports.value) if (r.binId && r.kind !== 'ok') count.set(r.binId, (count.get(r.binId) ?? 0) + 1)
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => ({ bin: binById.value.get(id), n }))
})
const timeFmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

async function refresh() {
  const [r, d, c] = await Promise.all([loadReports(), loadDispatches(), loadCaseStates()])
  reports.value = r
  dispatches.value = d
  caseStates.value = c
}

onMounted(async () => {
  const [b, meta] = await Promise.all([loadBins(), loadMeta()])
  bins.value = b
  mock.value = isMock(meta)
  await refresh()
  timer = setInterval(refresh, 5000)
  stops.push(onLocalReportsChange(refresh), onLocalDispatchChange(refresh), onLocalCasesChange(refresh))
})
onBeforeUnmount(() => {
  clearInterval(timer)
  stops.forEach((f) => f())
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-paper text-ink">
    <div class="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <div class="flex items-center gap-3">
        <RouterLink to="/" class="rounded-[10px] bg-sign p-[3px] shadow-lg shadow-ink/20">
          <span class="block rounded-[7px] border-[1.5px] border-white/90 px-3 py-1.5 text-[15px] font-bold tracking-[0.08em] text-white">台北桶報局</span>
        </RouterLink>
        <span v-if="mock" class="rounded-full bg-white px-2.5 py-1 text-xs text-mute">示範資料</span>
      </div>

      <h1 class="mt-6 text-3xl leading-tight font-black md:text-4xl">處理成績單</h1>
      <p class="mt-2 text-sm leading-relaxed text-mute">
        市民回報「滿了」之後，各區多久清運完成。不用登入，誰都看得到。同一桶的重複回報合併成一個案件；平均 {{ FAST_MIN }} 分鐘內完成的區，拿到時效勳章。
      </p>

      <dl class="mt-6 grid grid-cols-3 gap-2">
        <div class="rounded-[14px] bg-white p-4"><dt class="text-xs text-mute">滿溢案件</dt><dd class="num mt-1 text-3xl font-semibold">{{ cases.length }}</dd></div>
        <div class="rounded-[14px] bg-white p-4"><dt class="text-xs text-mute">已清運</dt><dd class="num mt-1 text-3xl font-semibold text-sign">{{ closed.length }}</dd></div>
        <div class="rounded-[14px] bg-white p-4">
          <dt class="text-xs text-mute">平均處理</dt>
          <dd class="num mt-1 text-3xl font-semibold">{{ avg ?? '—' }}<span v-if="avg !== undefined" class="ml-1 font-sans text-sm font-normal text-mute">分鐘</span></dd>
        </div>
      </dl>

      <p v-if="issues.length" class="mt-2 text-sm text-mute">
        上面是「垃圾桶滿了」的清運案件。
        另有周邊髒亂、損壞等其他問題 <span class="num font-bold text-ink">{{ issues.length }}</span> 件，已處理完成
        <span class="num font-bold text-sign">{{ issueDone }}</span> 件。
      </p>

      <div v-if="byKind.length || hotspots.length" class="mt-8 grid gap-4 md:grid-cols-2">
        <section v-if="byKind.length" class="rounded-[14px] bg-white p-4">
          <h2 class="text-base font-bold">7 天回報類型</h2>
          <ul class="mt-3 space-y-2">
            <li v-for="k in byKind" :key="k.kind" class="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm">
              <span class="truncate">{{ REPORT_LABEL[k.kind] }}</span>
              <span class="block h-2.5 rounded-r-full bg-paper"><span class="block h-full rounded-r-full" :style="{ width: `${k.share * 100}%`, background: REPORT_COLOR[k.kind] }" /></span>
              <span class="num text-right">{{ k.n }}</span>
            </li>
          </ul>
        </section>
        <section v-if="hotspots.length" class="rounded-[14px] bg-white p-4">
          <h2 class="text-base font-bold">重複出問題的點位</h2>
          <p class="mt-1 text-xs text-mute">被回報兩次以上的垃圾桶，可以檢討清運頻率或增設</p>
          <ol class="mt-2 space-y-1.5">
            <li v-for="h in hotspots" :key="h.bin?.id" class="flex items-center gap-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ h.bin?.road ?? '未知點位' }}<span class="ml-1 text-xs text-mute">{{ h.bin?.district }}</span></span>
              <span class="num shrink-0 font-bold text-[#a3262b]">{{ h.n }} 次</span>
            </li>
          </ol>
        </section>
      </div>

      <h2 class="mt-8 text-lg font-bold">各區排行</h2>
      <div class="mt-2 overflow-hidden rounded-[14px] bg-white">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-mute">
            <tr class="border-b border-hair">
              <th class="px-4 py-2.5 font-normal">行政區</th>
              <th class="px-2 py-2.5 text-right font-normal">7 天回報</th>
              <th class="px-2 py-2.5 text-right font-normal">處理中</th>
              <th class="px-2 py-2.5 text-right font-normal">已清運</th>
              <th class="px-4 py-2.5 text-right font-normal">平均處理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in scores" :key="s.district" class="border-b border-hair last:border-0">
              <td class="px-4 py-2.5 font-bold">
                {{ s.district }}
                <span v-if="s.fast" class="ml-1.5 rounded-full bg-sign px-2 py-0.5 text-[11px] font-bold text-white" :title="`平均 ${FAST_MIN} 分鐘內清運完成`">✓ 時效勳章</span>
              </td>
              <td class="num px-2 py-2.5 text-right">{{ s.reports }}</td>
              <td class="num px-2 py-2.5 text-right" :class="s.open ? 'font-bold text-[#a3262b]' : 'text-mute'">{{ s.open }}</td>
              <td class="num px-2 py-2.5 text-right">{{ s.closed }}</td>
              <td class="num px-4 py-2.5 text-right">{{ s.avgMin !== undefined ? `${s.avgMin} 分` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-mute">北投區在開放資料沒有垃圾桶點位，暫不列入。</p>

      <h2 class="mt-8 text-lg font-bold">最近完成的案件</h2>
      <p v-if="!closed.length" class="mt-2 rounded-[14px] border border-dashed border-hair p-4 text-sm text-mute">還沒有完成的案件。市民回報、戰情室派車並返隊後，會出現在這裡。</p>
      <ul class="mt-2 space-y-2">
        <li v-for="c in closed.slice(0, 8)" :key="c.key" class="flex gap-3 rounded-[14px] bg-white p-3">
          <img v-if="c.photo" :src="c.photo" alt="清運完成照片" class="h-16 w-20 shrink-0 rounded-[8px] object-cover" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold">{{ c.road }}</p>
            <p class="mt-0.5 text-xs text-mute">{{ c.district }} · {{ timeFmt(c.reportedAt) }} 回報<template v-if="c.reporters > 1"> · {{ c.reporters }} 人回報</template></p>
            <p class="mt-1 text-sm">市府花了 <span class="num text-base font-bold text-sign">{{ c.minutes }}</span> 分鐘完成清運</p>
          </div>
        </li>
      </ul>

      <div class="mt-8 flex gap-2">
        <RouterLink to="/" class="rounded-full bg-sign px-4 py-2 text-sm font-bold text-white">回市民端</RouterLink>
        <RouterLink to="/admin" class="rounded-full border border-hair bg-white px-4 py-2 text-sm font-bold">市府戰情室</RouterLink>
      </div>
    </div>
  </div>
</template>
