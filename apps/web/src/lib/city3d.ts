/**
 * 3D 城市戰情場景（實驗分支 feat/3d）。
 *
 * 場景完全由資料長出來，沒有外部模型檔：
 *   - 地面：缺口模型的 250 公尺網格，往外擴一圈當作陸地
 *   - 建築：每格的需求分數（人流、陳情）越高，房子越多越高
 *   - 樹：需求低的格子
 *   - 垃圾桶：開放資料 121355 的真實點位，顏色代表填滿程度
 *   - 垃圾車：清運路線，沿路行駛
 * 全部用 InstancedMesh，幾千個物件也只有十幾個 draw call，筆電內顯可跑。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { Bin, GridData } from '../types'
import type { LatLng } from './geo'

/** 1 個場景單位 = 50 公尺 */
const M_PER_UNIT = 50
const M_PER_DEG_LAT = 111_320
const TILE_H = 1
const BIN_SCALE = 1.6

const PALETTE = {
  water: '#8cc7d6',
  waterNight: '#16324a',
  land: '#efe3c6',
  landAlt: '#e3d6b5',
  grass: '#bcd59a',
  walls: ['#fbf6ec', '#f3e7d3', '#e9dcc6', '#f6efe4', '#dfe8ea'],
  roofs: ['#d9614c', '#c4553f', '#5f7f9a', '#7a9a6a', '#e0a24a'],
  tree: ['#5f9a54', '#6fae5c', '#4f8a4a'],
  trunk: '#8a6a4a',
  fill: { ok: new THREE.Color('#2f8a5b'), busy: new THREE.Color('#e0a91c'), full: new THREE.Color('#e5484d') },
}

/** 固定亂數種子：同一份資料每次長出一樣的城市 */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RoutePlan3D {
  color: string
  path: LatLng[]
}

export interface HoverInfo {
  bin: Bin
  x: number
  y: number
}

export class City3D {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly labels: CSS2DRenderer
  readonly controls: OrbitControls
  onHover?: (info: HoverInfo | undefined) => void

  private origin: { lat: number; lng: number }
  private cosLat: number
  private hemi = new THREE.HemisphereLight('#ffffff', '#b9a98a', 1.1)
  private sun = new THREE.DirectionalLight('#fff1d6', 2.2)
  private water: THREE.Mesh
  private tiles?: THREE.InstancedMesh
  private tileCells: { id: string; gap: number; land: boolean }[] = []
  private wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: '#ffcf7a', emissiveIntensity: 0 })
  private binMesh?: THREE.InstancedMesh
  private binLidMesh?: THREE.InstancedMesh
  private bins: Bin[] = []
  private dueMarkers?: THREE.InstancedMesh
  private dueIdx: number[] = []
  private routeGroup = new THREE.Group()
  private trucks: { obj: THREE.Object3D; pts: THREE.Vector3[]; seg: number[]; duration: number }[] = []
  private pings: { group: THREE.Group; born: number }[] = []
  private labelGroup = new THREE.Group()
  private pinGroup = new THREE.Group()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2(9, 9)
  private frame = 0
  private flight?: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t0: number; dur: number }
  private resizeObs: ResizeObserver
  private clock = new THREE.Clock()
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(
    private el: HTMLElement,
    origin: { lat: number; lng: number },
  ) {
    this.origin = origin
    this.cosLat = Math.cos((origin.lat * Math.PI) / 180)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    el.appendChild(this.labels.domElement)

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 4000)
    this.camera.position.set(170, 230, 260)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.42
    this.controls.minDistance = 25
    this.controls.maxDistance = 700
    this.controls.screenSpacePanning = false

    this.scene.add(this.hemi)
    this.sun.position.set(-120, 220, 90)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 700 })
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun)

    this.water = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.6 }))
    this.water.rotation.x = -Math.PI / 2
    this.water.position.y = -1.4
    this.water.receiveShadow = true
    this.scene.add(this.water, this.routeGroup, this.labelGroup, this.pinGroup)
    this.setNight(false)

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(el)
    this.resize()
    this.loop()
  }

  project(lat: number, lng: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3(
      ((lng - this.origin.lng) * M_PER_DEG_LAT * this.cosLat) / M_PER_UNIT,
      y,
      (-(lat - this.origin.lat) * M_PER_DEG_LAT) / M_PER_UNIT,
    )
  }

  /** 由資料建出靜態城市：地面、建築、樹、垃圾桶、行政區標籤 */
  build(bins: Bin[], grid: GridData) {
    this.bins = bins
    const rand = seeded(20261024)
    const cellUnits = grid.cellMeters / M_PER_UNIT
    const { lat: dLat, lng: dLng } = grid.cellSizeDeg
    const key = (lat: number, lng: number) => `${Math.floor(lat / dLat)}_${Math.floor(lng / dLng)}`

    // 陸地：有資料的網格 + 外擴一圈，讓城市連成一片
    const cells = new Map<string, { lat: number; lng: number; demand: number; gap: number; id: string; land: boolean }>()
    for (const c of grid.cells) cells.set(key(c.lat, c.lng), { lat: c.lat, lng: c.lng, demand: c.demand, gap: c.missingData ? 0 : c.gap, id: c.id, land: false })
    for (const b of bins) {
      const k = key(b.lat, b.lng)
      if (!cells.has(k)) cells.set(k, { lat: (Math.floor(b.lat / dLat) + 0.5) * dLat, lng: (Math.floor(b.lng / dLng) + 0.5) * dLng, demand: 0, gap: 0, id: k, land: false })
    }
    for (const c of [...cells.values()]) {
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const lat = c.lat + i * dLat
          const lng = c.lng + j * dLng
          const k = key(lat, lng)
          if (!cells.has(k)) cells.set(k, { lat, lng, demand: 0, gap: 0, id: k, land: true })
        }
    }
    const all = [...cells.values()]
    this.tileCells = all.map((c) => ({ id: c.id, gap: c.gap, land: c.land }))

    const tileGeo = new THREE.BoxGeometry(cellUnits * 0.97, TILE_H, cellUnits * 0.97)
    tileGeo.translate(0, -TILE_H / 2, 0)
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), all.length)
    this.tiles.receiveShadow = true
    const m = new THREE.Matrix4()
    all.forEach((c, i) => {
      m.makeTranslation(this.project(c.lat, c.lng))
      this.tiles!.setMatrixAt(i, m)
    })
    this.scene.add(this.tiles)
    this.paintTiles('plain')

    // 建築與樹
    const maxDemand = Math.max(0.0001, ...all.map((c) => c.demand))
    const houses: { x: number; z: number; w: number; d: number; h: number; wall: string; roof: string }[] = []
    const trees: { x: number; z: number; s: number; color: string }[] = []
    for (const c of all) {
      const p = this.project(c.lat, c.lng)
      const t = c.demand / maxDemand
      const n = c.land ? (rand() < 0.12 ? 1 : 0) : t > 0.02 ? 1 + Math.floor(t * 5) : rand() < 0.5 ? 1 : 0
      for (let i = 0; i < n; i++) {
        const w = 1.1 + rand() * 1.1
        houses.push({
          x: p.x + (rand() - 0.5) * cellUnits * 0.7,
          z: p.z + (rand() - 0.5) * cellUnits * 0.7,
          w,
          d: w * (0.7 + rand() * 0.6),
          h: 1 + t * 9 + rand() * 1.6,
          wall: PALETTE.walls[Math.floor(rand() * PALETTE.walls.length)],
          roof: PALETTE.roofs[Math.floor(rand() * PALETTE.roofs.length)],
        })
      }
      const nt = c.land ? 1 + Math.floor(rand() * 3) : t < 0.25 ? Math.floor(rand() * 3) : 0
      for (let i = 0; i < nt; i++)
        trees.push({ x: p.x + (rand() - 0.5) * cellUnits * 0.85, z: p.z + (rand() - 0.5) * cellUnits * 0.85, s: 0.7 + rand() * 0.6, color: PALETTE.tree[Math.floor(rand() * 3)] })
    }

    const box = new THREE.BoxGeometry(1, 1, 1)
    box.translate(0, 0.5, 0)
    const walls = new THREE.InstancedMesh(box, this.wallMat, houses.length)
    const roofGeo = new THREE.ConeGeometry(0.75, 1, 4)
    roofGeo.rotateY(Math.PI / 4)
    roofGeo.translate(0, 0.5, 0)
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), houses.length)
    const q = new THREE.Quaternion()
    houses.forEach((h, i) => {
      m.compose(new THREE.Vector3(h.x, 0, h.z), q, new THREE.Vector3(h.w, h.h, h.d))
      walls.setMatrixAt(i, m)
      walls.setColorAt(i, new THREE.Color(h.wall))
      // 高樓用平頂（壓扁的屋頂），矮房子用斜屋頂
      const roofH = h.h > 5 ? 0.15 : 0.9
      m.compose(new THREE.Vector3(h.x, h.h, h.z), q, new THREE.Vector3(h.w * 1.08, roofH, h.d * 1.08))
      roofs.setMatrixAt(i, m)
      roofs.setColorAt(i, new THREE.Color(h.roof))
    })
    for (const mesh of [walls, roofs]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }

    const crownGeo = new THREE.IcosahedronGeometry(0.9, 0)
    crownGeo.translate(0, 1.6, 0)
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.9, 5)
    trunkGeo.translate(0, 0.45, 0)
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length)
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: PALETTE.trunk }), trees.length)
    trees.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s))
      crowns.setMatrixAt(i, m)
      crowns.setColorAt(i, new THREE.Color(t.color))
      trunks.setMatrixAt(i, m)
    })
    crowns.castShadow = true
    trunks.castShadow = true
    this.scene.add(crowns, trunks)

    // 垃圾桶：桶身 + 蓋子，顏色代表填滿程度
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.27, 0.9, 10)
    bodyGeo.translate(0, 0.45, 0)
    const lidGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.12, 10)
    lidGeo.translate(0, 0.96, 0)
    this.binMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0 }), bins.length)
    this.binLidMesh = new THREE.InstancedMesh(lidGeo, new THREE.MeshStandardMaterial({ color: '#24402f', roughness: 0.4 }), bins.length)
    bins.forEach((b, i) => {
      m.compose(this.project(b.lat, b.lng), q, new THREE.Vector3(BIN_SCALE, BIN_SCALE, BIN_SCALE))
      this.binMesh!.setMatrixAt(i, m)
      this.binLidMesh!.setMatrixAt(i, m)
      this.binMesh!.setColorAt(i, PALETTE.fill.ok)
    })
    this.binMesh.castShadow = true
    this.scene.add(this.binMesh, this.binLidMesh)

    // 快滿的桶上方浮著倒三角警示
    const markGeo = new THREE.ConeGeometry(0.55, 1.1, 3)
    markGeo.rotateX(Math.PI)
    this.dueMarkers = new THREE.InstancedMesh(markGeo, new THREE.MeshStandardMaterial({ color: '#e5484d', emissive: '#e5484d', emissiveIntensity: 0.35 }), bins.length)
    this.dueMarkers.count = 0
    this.scene.add(this.dueMarkers)
  }

  /** 行政區名稱標籤，點了會呼叫 onPick */
  setDistrictLabels(items: { name: string; lat: number; lng: number; due: number; active: boolean }[], onPick: (name: string) => void) {
    this.labelGroup.clear()
    for (const it of items) {
      const el = document.createElement('button')
      el.className = `city3d-label${it.active ? ' is-active' : ''}`
      el.innerHTML = `<span>${it.name}</span>${it.due ? `<b>${it.due}</b>` : ''}`
      el.style.pointerEvents = 'auto'
      el.addEventListener('click', () => onPick(it.name))
      const obj = new CSS2DObject(el)
      obj.position.copy(this.project(it.lat, it.lng, 14))
      this.labelGroup.add(obj)
    }
  }

  /** 候選新設點：黃色編號圖釘 */
  setPins(items: { lat: number; lng: number; label: string }[]) {
    this.pinGroup.clear()
    items.forEach((it, i) => {
      const el = document.createElement('div')
      el.className = 'city3d-pin'
      el.textContent = String(i + 1)
      el.title = it.label
      const obj = new CSS2DObject(el)
      obj.position.copy(this.project(it.lat, it.lng, 5))
      this.pinGroup.add(obj)
    })
  }

  /** 地面顏色：一般模式是土地色，缺口模式依缺口分數由黃到紅 */
  paintTiles(mode: 'plain' | 'gap', district?: (cellId: string) => boolean) {
    if (!this.tiles) return
    const maxGap = Math.max(0.0001, ...this.tileCells.map((c) => c.gap))
    const c = new THREE.Color()
    this.tileCells.forEach((cell, i) => {
      if (cell.land) c.set(i % 3 ? PALETTE.grass : PALETTE.landAlt)
      else c.set(i % 2 ? PALETTE.land : PALETTE.landAlt)
      if (mode === 'gap' && cell.gap > 0 && (!district || district(cell.id))) {
        const t = Math.min(1, cell.gap / maxGap)
        c.lerp(new THREE.Color(t > 0.66 ? '#e5484d' : t > 0.33 ? '#ff8a2a' : '#ffc72c'), 0.35 + t * 0.6)
      }
      this.tiles!.setColorAt(i, c)
    })
    this.tiles.instanceColor!.needsUpdate = true
  }

  /** 依填滿程度上色；focus 指定行政區時，其他區的桶縮小變淡 */
  updateBins(fillById: Map<string, number>, threshold: number, focus?: string) {
    if (!this.binMesh || !this.dueMarkers) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const grey = new THREE.Color('#b9c4bd')
    this.dueIdx = []
    this.bins.forEach((b, i) => {
      const fill = fillById.get(b.id) ?? 0
      const inFocus = !focus || b.district === focus
      const col = fill >= 0.8 ? PALETTE.fill.full : fill >= 0.5 ? PALETTE.fill.busy : PALETTE.fill.ok
      this.binMesh!.setColorAt(i, inFocus ? col : grey)
      const s = inFocus ? BIN_SCALE : BIN_SCALE * 0.6
      m.compose(this.project(b.lat, b.lng), q, new THREE.Vector3(s, s, s))
      this.binMesh!.setMatrixAt(i, m)
      this.binLidMesh!.setMatrixAt(i, m)
      if (inFocus && fill >= threshold) this.dueIdx.push(i)
    })
    this.binMesh.instanceColor!.needsUpdate = true
    this.binMesh.instanceMatrix.needsUpdate = true
    this.binLidMesh!.instanceMatrix.needsUpdate = true
    this.dueMarkers.count = this.dueIdx.length
  }

  /** 清運路線與垃圾車 */
  setRoutes(plans: RoutePlan3D[], depot?: LatLng) {
    this.routeGroup.clear()
    this.trucks = []
    if (depot && plans.length) {
      const hq = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2), new THREE.MeshStandardMaterial({ color: '#0b5d3b' }))
      hq.position.copy(this.project(depot[0], depot[1], 1.1))
      hq.castShadow = true
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 3.6), new THREE.MeshStandardMaterial({ color: '#ffffff' }))
      roof.position.copy(hq.position).setY(2.35)
      this.routeGroup.add(hq, roof)
    }
    for (const plan of plans) {
      const pts = plan.path.map(([lat, lng]) => this.project(lat, lng, 0.35))
      if (pts.length < 2) continue
      const curve = new THREE.CurvePath<THREE.Vector3>()
      for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]))
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, pts.length * 8, 0.32, 6, false),
        new THREE.MeshStandardMaterial({ color: plan.color, emissive: plan.color, emissiveIntensity: 0.35 }),
      )
      this.routeGroup.add(tube)
      const truck = this.makeTruck(plan.color)
      this.routeGroup.add(truck)
      const seg = [0]
      for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + pts[i].distanceTo(pts[i - 1]))
      this.trucks.push({ obj: truck, pts, seg, duration: Math.min(45, Math.max(16, seg[seg.length - 1] / 6)) })
    }
  }

  private makeTruck(color: string) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 1.4), new THREE.MeshStandardMaterial({ color }))
    body.position.set(-0.4, 1.05, 0)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 1.35), new THREE.MeshStandardMaterial({ color: '#ffffff' }))
    cab.position.set(1.4, 0.9, 0)
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.5, 10)
    wheelGeo.rotateX(Math.PI / 2)
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1d2a24' })
    for (const x of [-1.1, 1.3]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat)
      w.position.set(x, 0.32, 0)
      g.add(w)
    }
    g.add(body, cab)
    g.traverse((o) => (o.castShadow = true))
    g.scale.setScalar(1.3)
    return g
  }

  /** 新的市民回報：從地面升起一道光柱，20 秒後消失 */
  ping(lat: number, lng: number, color: string) {
    const group = new THREE.Group()
    const p = this.project(lat, lng)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    )
    beam.position.set(p.x, 20, p.z)
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.8, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(p.x, 0.1, p.z)
    group.add(beam, ring)
    this.scene.add(group)
    this.pings.push({ group, born: this.clock.getElapsedTime() })
  }

  /** 鏡頭飛到一組點的範圍 */
  flyToPoints(points: LatLng[], minDist = 60) {
    if (!points.length) return
    const box = new THREE.Box3()
    for (const [lat, lng] of points) box.expandByPoint(this.project(lat, lng))
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const dist = Math.max(minDist, Math.max(size.x, size.z) * 1.35)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    const to = center.clone().add(dir.multiplyScalar(dist))
    this.flight = { from: this.camera.position.clone(), to, fromT: this.controls.target.clone(), toT: center, t0: performance.now(), dur: this.reduceMotion ? 1 : 1100 }
  }

  setNight(night: boolean) {
    const bg = new THREE.Color(night ? '#0e1a26' : '#cfe8ee')
    this.scene.background = bg
    this.scene.fog = new THREE.Fog(bg, 500, 1300)
    this.hemi.intensity = night ? 0.35 : 1.1
    this.hemi.color.set(night ? '#8fa6c8' : '#ffffff')
    this.sun.intensity = night ? 0.45 : 2.2
    this.sun.color.set(night ? '#9fb6ff' : '#fff1d6')
    ;(this.water.material as THREE.MeshStandardMaterial).color.set(night ? PALETTE.waterNight : PALETTE.water)
    this.wallMat.emissiveIntensity = night ? 0.22 : 0
    if (this.binMesh) (this.binMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 0.25 : 0
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.hoverAt = { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  private onPointerLeave = () => {
    this.pointer.set(9, 9)
    this.onHover?.(undefined)
  }
  private hoverAt = { x: 0, y: 0 }
  private lastHover = -1

  private pick() {
    if (!this.binMesh || this.pointer.x > 2) return
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.binMesh, false)[0]
    const id = hit?.instanceId ?? -1
    if (id === this.lastHover) return
    this.lastHover = id
    this.onHover?.(id >= 0 ? { bin: this.bins[id], ...this.hoverAt } : undefined)
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.el
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop)
    const t = this.clock.getElapsedTime()

    if (this.flight) {
      const k = Math.min(1, (performance.now() - this.flight.t0) / this.flight.dur)
      const e = 1 - Math.pow(1 - k, 3)
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, e)
      this.controls.target.lerpVectors(this.flight.fromT, this.flight.toT, e)
      if (k >= 1) this.flight = undefined
    }
    this.controls.update()

    // 快滿的桶：警示標記上下浮動
    if (this.dueMarkers && this.dueIdx.length) {
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 1.5)
      this.dueIdx.forEach((bi, i) => {
        const b = this.bins[bi]
        const p = this.project(b.lat, b.lng, 3.4 + (this.reduceMotion ? 0 : Math.sin(t * 3 + bi) * 0.35))
        m.compose(p, q, new THREE.Vector3(1, 1, 1))
        this.dueMarkers!.setMatrixAt(i, m)
      })
      this.dueMarkers.instanceMatrix.needsUpdate = true
    }

    // 垃圾車沿路線繞行
    for (const tr of this.trucks) {
      const total = tr.seg[tr.seg.length - 1]
      const d = this.reduceMotion ? 0 : ((t % tr.duration) / tr.duration) * total
      let i = 1
      while (i < tr.seg.length - 1 && tr.seg[i] < d) i++
      const k = (d - tr.seg[i - 1]) / Math.max(0.001, tr.seg[i] - tr.seg[i - 1])
      const a = tr.pts[i - 1]
      const b = tr.pts[i]
      tr.obj.position.lerpVectors(a, b, k).setY(0)
      tr.obj.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x)
    }

    // 回報光柱淡出
    this.pings = this.pings.filter((p) => {
      const age = t - p.born
      if (age > 20) {
        this.scene.remove(p.group)
        return false
      }
      const fade = 1 - age / 20
      p.group.children.forEach((c, idx) => {
        const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial
        mat.opacity = (idx === 0 ? 0.55 : 0.9) * fade
        if (idx === 1) c.scale.setScalar(1 + ((age * 1.5) % 3))
      })
      return true
    })

    this.pick()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resizeObs.disconnect()
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    this.el.innerHTML = ''
  }
}
