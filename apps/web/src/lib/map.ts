import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from './geo'

/** 台北車站，定位失敗時的預設位置 */
export const TAIPEI: LatLng = [25.0478, 121.517]

/** 台北市大致範圍，避免地圖被拖到太遠 */
const TAIPEI_BOUNDS = L.latLngBounds([24.94, 121.43], [25.22, 121.68])

type Theme = 'light' | 'dark'

/** 底圖來源多久沒載入任何圖磚就換下一個 */
const TILE_TIMEOUT_MS = 5000

interface TileSource {
  name: string
  url: string
  options: L.TileLayerOptions
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * 底圖來源，依序嘗試：前一個連不上（網路擋、服務掛）就自動換下一個。
 * CARTO 配色最好；OpenStreetMap 最通用；國土測繪中心是政府圖資，公部門網路通常放行。
 */
function sources(theme: Theme): TileSource[] {
  return [
    {
      name: 'CARTO',
      url:
        theme === 'dark'
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      options: { subdomains: 'abcd', maxZoom: 19, attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>` },
    },
    {
      name: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: OSM_ATTR, className: theme === 'dark' ? 'tiles-dim' : 'tiles-soft' },
    },
    {
      name: '國土測繪中心',
      url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>',
        className: theme === 'dark' ? 'tiles-dim' : 'tiles-soft',
      },
    },
  ]
}

export function createMap(el: HTMLElement, opts: { center?: LatLng; zoom?: number; theme?: Theme } = {}): L.Map {
  const map = L.map(el, {
    zoomControl: false,
    preferCanvas: true, // 數百個垃圾桶與網格，用 canvas 才順
    maxBounds: TAIPEI_BOUNDS.pad(0.3),
    minZoom: 11,
  }).setView(opts.center ?? TAIPEI, opts.zoom ?? 15)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  useTilesWithFallback(map, opts.theme ?? 'light')
  return map
}

/**
 * 依序嘗試底圖來源；全部失敗時在地圖上明講，免得看的人以為程式壞了。
 * 只要某個來源有任一張圖磚載入成功，就固定用它。
 */
function useTilesWithFallback(map: L.Map, theme: Theme) {
  const list = sources(theme)
  const note = createNote(map, theme)
  let index = 0

  const tryNext = () => {
    const src = list[index]
    if (!src) {
      note.style.display = 'block'
      return
    }
    let loaded = 0
    let failed = 0
    let gaveUp = false
    const layer = L.tileLayer(src.url, src.options).addTo(map)
    const giveUp = (reason: string) => {
      if (gaveUp || loaded) return
      gaveUp = true
      clearTimeout(timer)
      console.warn(`[地圖] ${src.name} 底圖${reason}，改用下一個來源`)
      map.removeLayer(layer)
      index++
      tryNext()
    }
    // 有些網路會讓連線一直掛著、不會觸發 tileerror，所以也要設時限
    const timer = setTimeout(() => giveUp('逾時沒回應'), TILE_TIMEOUT_MS)
    layer.on('tileload', () => {
      loaded++
      clearTimeout(timer)
      note.style.display = 'none'
    })
    layer.on('tileerror', () => {
      failed++
      if (failed === 4) giveUp('連不上')
    })
  }
  tryNext()
}

function createNote(map: L.Map, theme: Theme): HTMLDivElement {
  const note = L.DomUtil.create('div') as HTMLDivElement
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
  return note
}
