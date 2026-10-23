<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import QRCode from 'qrcode'
import { loadBins } from '../lib/data'
import { distanceMeters } from '../lib/geo'
import { TAIPEI } from '../lib/map'
import { binUrl, shortCode } from '../lib/qr'
import type { Bin } from '../types'

/**
 * Demo 用的 QR Code 貼紙列印頁。
 * 預設印台北車站附近 6 桶，也可以用 ?ids=bin-0001,bin-0002 指定。
 * 最後一張是故意簽章錯誤的「被替換的貼紙」，示範掃到假貼紙時的畫面。
 */
interface Sticker {
  bin: Bin
  url: string
  img: string
  fake?: boolean
}

const route = useRoute()
const stickers = ref<Sticker[]>([])
const host = computed(() => location.host)
const printPage = () => window.print()

onMounted(async () => {
  const bins = await loadBins()
  const ids = String(route.query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const picked = ids.length
    ? bins.filter((b) => ids.includes(b.id))
    : [...bins].sort((a, b) => distanceMeters(TAIPEI, [a.lat, a.lng]) - distanceMeters(TAIPEI, [b.lat, b.lng])).slice(0, 6)

  const opts = { margin: 1, width: 360, color: { dark: '#10251c', light: '#ffffff' } }
  const list: Sticker[] = []
  for (const bin of picked) {
    const url = binUrl(bin.id)
    list.push({ bin, url, img: await QRCode.toDataURL(url, opts) })
  }
  if (picked[0]) {
    const url = binUrl(picked[0].id).replace(/s=[0-9a-f]+$/, 's=00000000')
    list.push({ bin: picked[0], url, img: await QRCode.toDataURL(url, opts), fake: true })
  }
  stickers.value = list
})
</script>

<template>
  <div class="qr-page min-h-full bg-paper p-6 print:bg-white print:p-0">
    <header class="mx-auto mb-6 flex max-w-4xl flex-wrap items-end justify-between gap-3 print:hidden">
      <div>
        <h1 class="text-2xl font-bold">垃圾桶 QR Code 貼紙</h1>
        <p class="mt-1 text-sm text-mute">Demo 用。列印後拿手機掃描，會直接開到那一桶的回報頁。最後一張是被替換的假貼紙。</p>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/admin" class="rounded-full border-2 border-hair px-4 py-2 text-sm font-bold">回市府戰情</RouterLink>
        <button class="rounded-full bg-sign px-4 py-2 text-sm font-bold text-white" @click="printPage">列印</button>
      </div>
    </header>

    <div class="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 print:max-w-none print:grid-cols-2 print:gap-4">
      <article
        v-for="s in stickers"
        :key="s.url"
        :data-url="s.url"
        class="sticker break-inside-avoid rounded-[16px] bg-sign p-[5px] text-white"
        :class="s.fake && 'bg-alert'"
      >
        <div class="flex h-full gap-4 rounded-[12px] border-2 border-white/90 p-4">
          <img :src="s.img" :alt="`垃圾桶 ${shortCode(s.bin.id)} 的 QR Code`" class="h-36 w-36 shrink-0 rounded-[6px] bg-white" />
          <div class="flex min-w-0 flex-col">
            <p class="text-sm font-bold tracking-[0.08em]">台北桶報局</p>
            <p class="num mt-1 text-4xl leading-none font-bold">{{ shortCode(s.bin.id) }}</p>
            <p class="mt-2 text-sm leading-snug">{{ s.bin.road }}</p>
            <p class="mt-auto pt-2 text-xs leading-snug text-white/85">
              <template v-if="s.fake">示範：被替換的假貼紙，掃描會顯示驗證失敗</template>
              <template v-else>掃描回報這桶的狀況。掃開的頁面編號應與上方相同，且不會要求登入。</template>
            </p>
            <p class="num mt-1 text-[11px] text-white/70">{{ host }}</p>
          </div>
        </div>
      </article>
    </div>
    <p v-if="!stickers.length" class="mx-auto max-w-4xl text-sm text-mute">產生中…</p>
  </div>
</template>

<style>
@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  .sticker {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
