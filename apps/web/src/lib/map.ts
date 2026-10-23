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
  const tiles = L.tileLayer(TILES[opts.theme ?? 'light'], {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map)
  watchTiles(map, tiles, opts.theme ?? 'light')
  return map
}

/**
 * 底圖連不上時（網路不穩、預覽環境擋外部圖片）在地圖上明講，
 * 免得看的人以為程式壞了。只要有任一張圖磚載入成功就收起來。
 */
function watchTiles(map: L.Map, tiles: L.TileLayer, theme: 'light' | 'dark') {
  let loaded = 0
  let failed = 0
  const note = L.DomUtil.create('div')
  note.setAttribute('role', 'status')
  note.textContent = '地圖底圖載入失敗，請檢查網路'
  note.title = '垃圾桶位置與功能不受影響'
  Object.assign(note.style, {
    position: 'absolute',
    left: '50%',
    top: '72px', // 放上方：手機版下半部會被清單面板蓋住
    transform: 'translateX(-50%)',
    zIndex: '900',
    whiteSpace: 'nowrap',
    padding: '8px 14px',
    borderRadius: '9999px',
    fontSize: '13px',
    lineHeight: '1.4',
    textAlign: 'center',
    pointerEvents: 'none',
    display: 'none',
    background: theme === 'dark' ? 'rgb(17 37 28 / 0.92)' : 'rgb(255 255 255 / 0.95)',
    color: theme === 'dark' ? '#e6efe9' : '#10251c',
    boxShadow: '0 4px 16px rgb(16 37 28 / 0.18)',
  })
  map.getContainer().appendChild(note)
  tiles.on('tileload', () => {
    loaded++
    note.style.display = 'none'
  })
  tiles.on('tileerror', () => {
    failed++
    if (!loaded && failed >= 4) note.style.display = 'block'
  })
}
