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
