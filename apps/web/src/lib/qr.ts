/**
 * 垃圾桶 QR Code 的網址與簽章。
 *
 * 【示意】這裡的簽章在前端計算，只用來示範「QR Code 帶簽章、掃開時核對」的流程，
 * 防得了亂改網址，防不了看過原始碼的人。正式版要由後端用私鑰簽章、後端驗證，
 * 見 docs/REWARDS.md。
 */
const DEMO_SECRET = 'tbb-demo-2026'

/** FNV-1a 32-bit，輸出 8 碼 16 進位 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function signBin(binId: string): string {
  return fnv1a(`${DEMO_SECRET}:${binId}`)
}

export function verifyBin(binId: string, sig: string | undefined): boolean {
  return !!sig && sig === signBin(binId)
}

/** 掃碼後開啟的網址：同一個網站、hash 路由，不需要安裝 App */
export function binUrl(binId: string): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#/bin/${encodeURIComponent(binId)}?s=${signBin(binId)}`
}

/** 貼紙上印的短編號，掃開的頁面也顯示同一組，讓民眾自己核對 */
export function shortCode(binId: string): string {
  return binId.replace(/^bin-/, '').toUpperCase()
}
