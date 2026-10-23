import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from './geo'

/** 台北車站，定位失敗時的預設位置 */
export const TAIPEI: LatLng = [25.0478, 121.517]

export function createMap(el: HTMLElement, center: LatLng = TAIPEI, zoom = 15): L.Map {
  const map = L.map(el, { zoomControl: false }).setView(center, zoom)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  return map
}
