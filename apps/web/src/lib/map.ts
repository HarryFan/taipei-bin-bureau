import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from './geo'

/** 台北車站，定位失敗時的預設位置 */
export const TAIPEI: LatLng = [25.0478, 121.517]

/** 台北市大致範圍，避免地圖被拖到太遠 */
const TAIPEI_BOUNDS = L.latLngBounds([24.94, 121.43], [25.22, 121.68])

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
}

export function createMap(el: HTMLElement, opts: { center?: LatLng; zoom?: number; theme?: 'light' | 'dark' } = {}): L.Map {
  const map = L.map(el, {
    zoomControl: false,
    preferCanvas: true, // 800 個垃圾桶 + 數百個網格，用 canvas 才順
    maxBounds: TAIPEI_BOUNDS.pad(0.3),
    minZoom: 11,
  }).setView(opts.center ?? TAIPEI, opts.zoom ?? 15)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.tileLayer(TILES[opts.theme ?? 'light'], {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map)
  return map
}
