export type LatLng = [number, number]

const R = 6_371_000
const WALK_M_PER_MIN = 80

export function distanceMeters([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / WALK_M_PER_MIN))
}

/** 從 a 看 b 的方位角，0 = 正北、順時針 */
export function bearingDeg([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北']
export function compassWord(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]
}

/** 路線總長（公尺） */
export function pathMeters(points: LatLng[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += distanceMeters(points[i - 1], points[i])
  return sum
}

/** 最近鄰居法排清運順序：黑客松夠用，之後可換 OR-Tools */
export function nearestNeighborRoute<T extends { lat: number; lng: number }>(start: LatLng, stops: T[]): T[] {
  const left = [...stops]
  const route: T[] = []
  let cur = start
  while (left.length) {
    let best = 0
    let bestD = Infinity
    left.forEach((s, i) => {
      const d = distanceMeters(cur, [s.lat, s.lng])
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    const next = left.splice(best, 1)[0]
    route.push(next)
    cur = [next.lat, next.lng]
  }
  return route
}

/** 從出發點繞完所有停靠點再回到出發點的總長（公尺） */
export function loopMeters(start: LatLng, stops: { lat: number; lng: number }[]): number {
  return pathMeters([start, ...stops.map((s) => [s.lat, s.lng] as LatLng), start])
}

/**
 * 2-opt 改善路線：反覆把兩段交叉的路線「解開」，直到沒有可改善的地方。
 * 路線視為從出發點出發、最後回到出發點（垃圾車要返隊）。
 * 幾十到一兩百個點在瀏覽器裡幾毫秒內完成。
 */
export function twoOpt<T extends { lat: number; lng: number }>(start: LatLng, route: T[], maxRounds = 50): T[] {
  const pts: LatLng[] = [start, ...route.map((s) => [s.lat, s.lng] as LatLng), start]
  const order = route.map((_, i) => i + 1)
  const seq = () => [0, ...order, pts.length - 1]
  const d = (a: number, b: number) => distanceMeters(pts[a], pts[b])
  for (let round = 0; round < maxRounds; round++) {
    let improved = false
    const s = seq()
    for (let i = 1; i < s.length - 2; i++) {
      for (let k = i + 1; k < s.length - 1; k++) {
        const delta = d(s[i - 1], s[k]) + d(s[i], s[k + 1]) - d(s[i - 1], s[i]) - d(s[k], s[k + 1])
        if (delta < -0.5) {
          s.splice(i, k - i + 1, ...s.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
    order.splice(0, order.length, ...s.slice(1, -1))
    if (!improved) break
  }
  return order.map((i) => route[i - 1])
}

/**
 * 多台車分工：依「從出發點看過去的方位角」把停靠點切成扇形，每台車負責一個方向，
 * 再各自排最近鄰居 + 2-opt。示意等級，之後可換成 OR-Tools 的 VRP。
 */
export function splitRoutes<T extends { lat: number; lng: number }>(start: LatLng, stops: T[], trucks: number): T[][] {
  const n = Math.max(1, Math.min(trucks, stops.length || 1))
  if (n === 1) return [twoOpt(start, nearestNeighborRoute(start, stops))]
  const sorted = [...stops].sort((a, b) => bearingDeg(start, [a.lat, a.lng]) - bearingDeg(start, [b.lat, b.lng]))
  // 找方位角間距最大的地方當切點起始，避免把同一群點從中間切開
  let gapAt = 0
  let gapMax = -1
  sorted.forEach((s, i) => {
    const next = sorted[(i + 1) % sorted.length]
    const g = (bearingDeg(start, [next.lat, next.lng]) - bearingDeg(start, [s.lat, s.lng]) + 360) % 360
    if (g > gapMax) {
      gapMax = g
      gapAt = (i + 1) % sorted.length
    }
  })
  const ring = [...sorted.slice(gapAt), ...sorted.slice(0, gapAt)]
  const size = Math.ceil(ring.length / n)
  return Array.from({ length: n }, (_, i) => ring.slice(i * size, (i + 1) * size))
    .filter((g) => g.length)
    .map((g) => twoOpt(start, nearestNeighborRoute(start, g)))
}
