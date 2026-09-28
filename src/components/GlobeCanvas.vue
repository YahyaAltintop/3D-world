<template>
  <div ref="wrapEl" class="globe-wrap">
    <div v-if="webglError" class="webgl-error">
      {{ t('webglError') }}
    </div>
    <canvas v-show="!webglError" ref="canvasEl" class="globe-canvas"></canvas>
    <div ref="labelsEl" class="globe-labels" aria-hidden="true">
      <div ref="markerEl" class="focus-marker"><span class="pulse"></span></div>
      <div ref="selLabelEl" class="selected-label"></div>
      <div ref="tooltipEl" class="globe-tooltip"></div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { latLonToVec3, loadCountries, pipRing } from '../lib/geo'
import { buildFillGeometry } from '../lib/fill'
import { dominantFlagColor, flagUrlFor } from '../lib/flagColor'
import { lang, t } from '../lib/i18n'

const emit = defineEmits(['select'])

const wrapEl = ref(null)
const canvasEl = ref(null)
const labelsEl = ref(null)
const markerEl = ref(null)
const selLabelEl = ref(null)
const tooltipEl = ref(null)
const webglError = ref(false)

const LABEL_COUNT = 40
const BASE_LINE = new THREE.Color('#6b8fc2')
const HI_LINE = new THREE.Color('#ffd166')
const BASE_OPACITY = 0.42
const HI_OPACITY = 1

const BASE_DIST = 2.8
const ZOOM_MIN = 0.55
const ZOOM_MAX = 3.2
const HOME = { lat: 20, lon: 20, zoom: 0.8 }

let renderer = null
let scene = null
let camera = null
let globe = null
let stars = null
let oceanMesh = null
let countries = []
let countryMeshes = []
let labelPool = []
// seçili ülkenin sınırları içine giydirilen bayrak dolgusu
let fillMesh = null
let fillTargetOpacity = 0
let fillToken = 0 // her seçimde artar; geç yüklenen eski bayrakları ayıklar
const textureLoader = new THREE.TextureLoader().setCrossOrigin('anonymous')
const FILL_OPACITY = 0.95
let rafId = 0
let disposed = false

// görünüm durumu: hedefe yumuşakça yaklaşan serbest kamera
let viewLat = HOME.lat
let viewLon = HOME.lon
let targetLat = HOME.lat
let targetLon = HOME.lon
let zoomTarget = HOME.zoom
let zoomCur = HOME.zoom
let velLon = 0
let velLat = 0

let dragging = false
let dragMoved = 0
let pinchDist = null
let lastDragT = 0
let lastInteraction = 0
let hoverKey = -1
let selectedKey = -1
const selectedColor = new THREE.Color('#ffd166') // seçili ülkenin bayrağından gelen renk
const activePointers = new Map()

// fare konumu her olayda değil, karede en fazla bir kez taranır (performans)
let hoverPX = 0
let hoverPY = 0
let hoverDirty = false

let viewW = 1
let viewH = 1
let minDist = 0
let lastTime = 0
let resizeObserver = null

const tmpVec = new THREE.Vector3()
const tmpNormal = new THREE.Vector3()
const camDir = new THREE.Vector3()
const tmpColor = new THREE.Color()
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()

// aktif dildeki ülke adı
function nameOf(c) {
  return c.names?.[lang.value] || c.english
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function wrap180(x) {
  return ((x + 540) % 360) - 180
}

function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

// ülke alanına göre rahat izleme mesafesi
function distForArea(area) {
  return Math.min(3.0, Math.max(2.2, 2.15 + Math.sqrt(area) * 0.02))
}

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true, alpha: true })
  } catch {
    webglError.value = true
    return false
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
  camera.position.set(0, 0, BASE_DIST / HOME.zoom)

  globe = new THREE.Group()
  scene.add(globe)

  // okyanus küresi (tıklama algılama için de kullanılır)
  oceanMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1830, roughness: 0.95, metalness: 0 }),
  )
  globe.add(oceanMesh)

  // atmosfer parıltısı
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { glowColor: { value: new THREE.Color(0x3f7fff) } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        uniform vec3 glowColor;
        void main() {
          float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
          gl_FragColor = vec4(glowColor, 1.0) * max(intensity, 0.0);
        }`,
    }),
  )
  atmosphere.scale.setScalar(1.16)
  globe.add(atmosphere)

  // enlem/boylam ızgarası
  globe.add(buildGraticule(1.0005))

  scene.add(new THREE.HemisphereLight(0xaecdff, 0x0a1020, 1.1))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(3, 2, 2.5)
  scene.add(dirLight)

  stars = buildStars()
  scene.add(stars)

  return true
}

function buildGraticule(r) {
  const pts = []
  for (let lat = -60; lat <= 60; lat += 20) {
    for (let lon = -180; lon < 180; lon += 4) {
      pts.push(latLonToVec3(lat, lon, r), latLonToVec3(lat, lon + 4, r))
    }
  }
  for (let lon = -180; lon < 180; lon += 20) {
    for (let lat = -80; lat < 80; lat += 4) {
      pts.push(latLonToVec3(lat, lon, r), latLonToVec3(lat + 4, lon, r))
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({ color: 0x24406b, transparent: true, opacity: 0.3 })
  return new THREE.LineSegments(geo, mat)
}

function buildStars() {
  const count = 1500
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(28 + Math.random() * 40)
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xbdd2ff,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  })
  return new THREE.Points(geo, mat)
}

function buildCountries() {
  countries = loadCountries()
  for (const c of countries) {
    const pts = []
    for (const ring of c.rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        pts.push(
          latLonToVec3(ring[i][1], ring[i][0], 1.002),
          latLonToVec3(ring[i + 1][1], ring[i + 1][0], 1.002),
        )
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: BASE_LINE.clone(),
      transparent: true,
      opacity: BASE_OPACITY,
    })
    const mesh = new THREE.LineSegments(geo, mat)
    // sınır çizgileri dolgunun üzerine çizilsin
    mesh.renderOrder = 2
    globe.add(mesh)
    countryMeshes.push(mesh)
    // etiket çapası: ülke merkezinin kürenin hemen üstündeki noktası
    c.local = latLonToVec3(c.lat, c.lon, 1.02)
  }
}

function buildLabels() {
  const holder = labelsEl.value
  for (let i = 0; i < LABEL_COUNT; i++) {
    const el = document.createElement('div')
    el.className = 'country-label'
    holder.appendChild(el)
    labelPool.push(el)
  }
}

function onResize() {
  const w = wrapEl.value?.clientWidth || 1
  const h = wrapEl.value?.clientHeight || 1
  viewW = w
  viewH = h
  renderer.setSize(w, h, false)
  const aspect = w / h
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  // dar ekranda küre yatayda taşmasın diye alt sınır
  minDist = 1.12 / (halfTan * aspect)
  // küre artık serbest gezilebilir olduğu için ortada durur
  globe.position.x = 0
}

// ---- tıklama / sürükleme / kıstırma ----

function onPointerDown(e) {
  if (e.target.closest('button')) return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  lastInteraction = performance.now()
  if (activePointers.size === 2) {
    // kıstırma (pinch) başlıyor
    const [a, b] = [...activePointers.values()]
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    dragging = false
  } else if (activePointers.size === 1) {
    dragging = true
    dragMoved = 0
    velLon = 0
    velLat = 0
    lastDragT = performance.now()
    setHover(-1, 0, 0)
    document.body.classList.add('globe-dragging')
  }
}

function onPointerMove(e) {
  const p = activePointers.get(e.pointerId)
  if (!p) {
    // basılı olmayan fare hareketi: sadece konumu kaydet, tarama tick içinde yapılır
    if (e.pointerType === 'mouse' && activePointers.size === 0) {
      hoverPX = e.clientX
      hoverPY = e.clientY
      hoverDirty = true
      lastInteraction = performance.now()
    }
    return
  }

  const dx = e.clientX - p.x
  const dy = e.clientY - p.y
  p.x = e.clientX
  p.y = e.clientY
  lastInteraction = performance.now()

  if (activePointers.size === 2 && pinchDist != null) {
    const [a, b] = [...activePointers.values()]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchDist > 0 && d > 0) zoomTarget = clampZoom((zoomTarget * d) / pinchDist)
    pinchDist = d
    return
  }
  if (!dragging) return

  dragMoved += Math.abs(dx) + Math.abs(dy)
  // kameraya yaklaştıkça hassasiyeti düşür
  const sens = (0.22 * Math.max(camera.position.z - 1, 0.35)) / 1.6
  targetLon = wrap180(targetLon - dx * sens)
  targetLat = Math.min(85, Math.max(-85, targetLat + dy * sens))

  const now = performance.now()
  const dtm = Math.max(now - lastDragT, 1) / 1000
  velLon = ((-dx * sens) / dtm) * 0.5 + velLon * 0.5
  velLat = ((dy * sens) / dtm) * 0.5 + velLat * 0.5
  lastDragT = now
}

function onPointerUp(e) {
  const wasTracked = activePointers.has(e.pointerId)
  activePointers.delete(e.pointerId)
  if (activePointers.size < 2) pinchDist = null
  if (activePointers.size === 0) {
    const wasDrag = dragging
    dragging = false
    document.body.classList.remove('globe-dragging')
    // neredeyse hiç hareket yoksa bu bir tıklamadır: ülke seç / seçimi kaldır
    if (wasTracked && wasDrag && dragMoved < 6) {
      const hit = pickAt(e.clientX, e.clientY, true)
      if (hit && hit.country) focusCountry(hit.country)
      else clearSelection()
    }
  }
}

function onWheel(e) {
  e.preventDefault()
  lastInteraction = performance.now()
  zoomTarget = clampZoom(zoomTarget * Math.exp(-e.deltaY * 0.0016))
}

// ekran koordinatından küre üzerindeki noktayı ve aktif katmandaki ülkeyi bul.
// Kanvas tam ekran ve sabit olduğu için dikdörtgen sorgusu yerine viewW/viewH kullanılır.
function pickAt(clientX, clientY, refreshMatrices = false) {
  if (!oceanMesh || viewW < 2 || viewH < 2) return null
  if (refreshMatrices) {
    // tık anında henüz kare çizilmemiş olabilir; matrisleri tazele
    camera.updateMatrixWorld()
    globe.updateMatrixWorld()
  }
  pointerNdc.x = (clientX / viewW) * 2 - 1
  pointerNdc.y = -(clientY / viewH) * 2 + 1
  raycaster.setFromCamera(pointerNdc, camera)
  const hit = raycaster.intersectObject(oceanMesh, false)[0]
  if (!hit) return null
  const p = globe.worldToLocal(hit.point.clone()).normalize()
  const lat = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.max(-1, p.y))))
  const lon = THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z))
  return { country: countryAt(lat, lon), lat, lon }
}

function countryAt(lat, lon) {
  for (const c of countries) {
    const bb = c.bbox
    if (lat < bb.minLat || lat > bb.maxLat) continue
    // halkalar sarmal açıldığı için boylam 180 dışına taşabilir; ±360 adaylarıyla dene
    for (const cand of [lon, lon + 360, lon - 360]) {
      if (cand < bb.minLon || cand > bb.maxLon) continue
      let inside = false
      for (let ri = 0; ri < c.rings.length; ri++) {
        const rb = c.ringBoxes[ri]
        if (cand < rb.minLon || cand > rb.maxLon || lat < rb.minLat || lat > rb.maxLat) continue
        if (pipRing(c.rings[ri], cand, lat)) inside = !inside
      }
      if (inside) return c
    }
  }
  return null
}

function setHover(key, x, y) {
  hoverKey = key
  const tip = tooltipEl.value
  if (!tip) return
  if (key >= 0 && countries[key]) {
    tip.textContent = nameOf(countries[key])
    tip.style.transform = `translate(-50%, -140%) translate(${x}px, ${y}px)`
    tip.style.opacity = '1'
    document.body.classList.add('globe-hover')
  } else {
    tip.style.opacity = '0'
    document.body.classList.remove('globe-hover')
  }
}

// seçili ülkenin sınırları içine bayrağını giydir; bayrak yüklenemezse (çevrimdışı,
// bayrağı olmayan bölge) içi bayrağın baskın rengiyle boyanır
function setFill(c) {
  removeFill()
  const token = ++fillToken
  const build = (tex) => {
    // bu arada seçim değiştiyse ya da kaldırıldıysa geç gelen bayrağı at
    if (disposed || token !== fillToken || selectedKey !== c.key) {
      tex?.dispose()
      return
    }
    const geo = buildFillGeometry(c, 1.0015, tex ? tex.image.width / tex.image.height : 1.5)
    if (geo.getAttribute('position').count === 0) {
      geo.dispose()
      tex?.dispose()
      return
    }
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace
      // küre kenarına doğru eğik bakışta bayrak bulanıklaşmasın
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      // dikkat: three.js rengi kopyalar, paylaşmaz — bayrak rengi gelince focusCountry ayrıca günceller
      color: tex ? 0xffffff : selectedColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    fillMesh = new THREE.Mesh(geo, mat)
    fillMesh.renderOrder = 1
    globe.add(fillMesh)
    fillTargetOpacity = FILL_OPACITY
  }
  const url = flagUrlFor(c, 640)
  if (url) textureLoader.load(url, build, undefined, () => build(null))
  else build(null)
}

function removeFill() {
  if (!fillMesh) return
  globe.remove(fillMesh)
  fillMesh.geometry.dispose()
  fillMesh.material.map?.dispose()
  fillMesh.material.dispose()
  fillMesh = null
  fillTargetOpacity = 0
}

// ülkeyi seç: öne çevir, boyutuna göre yaklaş, içini bayrak rengine boya, App'e bildir
function focusCountry(c) {
  selectedKey = c.key
  targetLat = Math.min(85, Math.max(-85, c.lat))
  targetLon = wrap180(targetLon + wrap180(c.lon - targetLon))
  zoomTarget = clampZoom(BASE_DIST / distForArea(c.area))
  velLon = 0
  velLat = 0

  // haritadaki büyük isim etiketi
  if (selLabelEl.value) selLabelEl.value.textContent = nameOf(c)

  // sınır, dolgu ve işaretçi rengi: bayrağın baskın rengi (yüklenene kadar altın)
  selectedColor.set('#ffd166')
  markerEl.value?.style.setProperty('--marker-color', '#ffd166')
  dominantFlagColor(flagUrlFor(c)).then((hex) => {
    if (hex && selectedKey === c.key) {
      selectedColor.set(hex)
      // bayrak dokusu yoksa dolgu düz renktir; onu da bayrağın rengine çevir
      if (fillMesh && !fillMesh.material.map) fillMesh.material.color.copy(selectedColor)
      markerEl.value?.style.setProperty('--marker-color', hex)
    }
  })

  setFill(c)
  emit('select', { key: c.key, id: c.id, names: c.names, english: c.english })
}

function clearSelection() {
  if (selectedKey < 0) return
  selectedKey = -1
  fillTargetOpacity = 0 // dolgu tick içinde sönerek kaldırılır
  emit('select', null)
}

// App'teki butonlar ve klavye için dışa açılan kontroller
function zoomBy(factor) {
  lastInteraction = performance.now()
  zoomTarget = clampZoom(zoomTarget * factor)
}

function rotateBy(dLon, dLat) {
  lastInteraction = performance.now()
  targetLon = wrap180(targetLon + dLon)
  targetLat = Math.min(85, Math.max(-85, targetLat + dLat))
}

function resetView() {
  lastInteraction = performance.now()
  zoomTarget = HOME.zoom
  targetLat = HOME.lat
  targetLon = wrap180(targetLon + wrap180(HOME.lon - targetLon))
  velLon = 0
  velLat = 0
  clearSelection()
}

defineExpose({ zoomBy, rotateBy, resetView, clearSelection })

// dil değişince ekranda asılı duran seçim etiketi ve tooltip metni tazelenir
// (küçük etiket havuzu zaten her karede metin karşılaştırmasıyla güncellenir)
watch(lang, () => {
  if (selectedKey >= 0 && countries[selectedKey] && selLabelEl.value) {
    selLabelEl.value.textContent = nameOf(countries[selectedKey])
  }
  if (hoverKey >= 0 && countries[hoverKey] && tooltipEl.value) {
    tooltipEl.value.textContent = nameOf(countries[hoverKey])
  }
})

function updateHighlights() {
  for (let k = 0; k < countryMeshes.length; k++) {
    const mat = countryMeshes[k].material
    const amt = k === selectedKey ? 1 : k === hoverKey ? 0.45 : 0
    if (k === selectedKey) tmpColor.copy(selectedColor)
    else tmpColor.copy(BASE_LINE).lerp(HI_LINE, amt)
    mat.color.lerp(tmpColor, 0.14)
    const targetOp = BASE_OPACITY + (HI_OPACITY - BASE_OPACITY) * amt
    mat.opacity += (targetOp - mat.opacity) * 0.14
  }
}

// alanına ve yakınlaşmaya göre etiket boyutu
function fontSizeFor(area) {
  const base = 9 + Math.sqrt(area) * 0.09
  const zoomBoost = 1 + (zoomCur - 1) * 0.12
  return Math.max(10.5, Math.min(14.5, base * zoomBoost))
}

function updateLabels() {
  camDir.copy(camera.position).sub(globe.position).normalize()

  // seçili ülke: işaretçi + haritadaki büyük isim etiketi için projeksiyon
  let sel = null
  if (selectedKey >= 0 && countries[selectedKey]) {
    const c = countries[selectedKey]
    tmpVec.copy(c.local).applyMatrix4(globe.matrixWorld)
    tmpNormal.copy(tmpVec).sub(globe.position).normalize()
    const facing = Math.max(0, tmpNormal.dot(camDir))
    tmpVec.project(camera)
    sel = {
      facing,
      x: (tmpVec.x * 0.5 + 0.5) * viewW,
      y: (-tmpVec.y * 0.5 + 0.5) * viewH,
      name: nameOf(c),
    }
  }

  const candidates = []
  for (const c of countries) {
    if (c.key === selectedKey) continue // seçili ülkeyi büyük kart gösteriyor
    tmpVec.copy(c.local).applyMatrix4(globe.matrixWorld)
    tmpNormal.copy(tmpVec).sub(globe.position).normalize()
    const facing = tmpNormal.dot(camDir)
    if (facing < 0.3) continue
    tmpVec.project(camera)
    if (tmpVec.z > 1) continue
    const x = (tmpVec.x * 0.5 + 0.5) * viewW
    const y = (-tmpVec.y * 0.5 + 0.5) * viewH
    // ekran dışındaki ülkeler kota harcamasın (yakınlaşınca küçük ülkelere yer açılır)
    if (x < -40 || x > viewW + 40 || y < -25 || y > viewH + 25) continue
    candidates.push({ c, facing, x, y })
  }

  // öncelik büyük ülkede; çakışmayanlar sırayla yerleşir,
  // böylece yakınlaştıkça Avrupa gibi sık bölgelerin tüm isimleri belirir
  candidates.sort((a, b) => b.c.area - a.c.area)
  const placed = []
  // küçük etiketler seçili ülkenin isminin üstüne binmesin
  if (sel && sel.facing > 0.25) {
    placed.push({ x: sel.x, y: sel.y + 26, w: sel.name.length * 13 + 24, h: 52 })
  }
  const shown = []
  for (const item of candidates) {
    if (shown.length >= LABEL_COUNT) break
    const fs = fontSizeFor(item.c.area)
    const txt = nameOf(item.c)
    const w = txt.length * fs * 0.72 + 14
    const h = fs * 1.9
    let collides = false
    for (const r of placed) {
      if (Math.abs(item.x - r.x) * 2 < w + r.w && Math.abs(item.y - r.y) * 2 < h + r.h) {
        collides = true
        break
      }
    }
    if (collides) continue
    placed.push({ x: item.x, y: item.y, w, h })
    item.fs = fs
    item.txt = txt
    shown.push(item)
  }

  for (let i = 0; i < labelPool.length; i++) {
    const el = labelPool[i]
    const item = shown[i]
    if (!item) {
      el.style.opacity = '0'
      continue
    }
    if (el.__txt !== item.txt) {
      el.textContent = item.txt
      el.__txt = item.txt
    }
    const fade = smoothstep(0.3, 0.55, item.facing)
    el.style.opacity = String(fade * 0.85)
    el.style.fontSize = `${item.fs.toFixed(1)}px`
    el.style.transform = `translate(-50%, -50%) translate(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px)`
  }

  // seçili ülke işaretçisi ve haritadaki büyük isim etiketi
  const marker = markerEl.value
  if (marker) {
    if (sel) {
      marker.style.transform = `translate(-50%, -50%) translate(${sel.x.toFixed(1)}px, ${sel.y.toFixed(1)}px)`
      marker.style.opacity = String(sel.facing)
    } else {
      marker.style.opacity = '0'
    }
  }
  const sl = selLabelEl.value
  if (sl) {
    if (sel) {
      // isim, işaretçi noktasının hemen altında durur
      sl.style.transform = `translate(-50%, 0) translate(${sel.x.toFixed(1)}px, ${(sel.y + 13).toFixed(1)}px)`
      sl.style.opacity = String(smoothstep(0.2, 0.45, sel.facing))
    } else {
      sl.style.opacity = '0'
    }
  }
}

function tick(now) {
  if (disposed) return
  rafId = requestAnimationFrame(tick)

  // gizli sekmede mount olma vb. durumlara karşı boyutu tazele
  const wrap = wrapEl.value
  if (wrap && (wrap.clientWidth !== viewW || wrap.clientHeight !== viewH)) onResize()

  const dt = Math.min((now - lastTime) / 1000 || 0.016, 0.05)
  lastTime = now

  // sürükleme ataleti
  if (!dragging) {
    targetLon = wrap180(targetLon + velLon * dt)
    targetLat = Math.min(85, Math.max(-85, targetLat + velLat * dt))
    const vDecay = Math.exp(-2.5 * dt)
    velLon *= vDecay
    velLat *= vDecay
  }

  // boşta kalınca yavaşça kendi etrafında dön
  if (!dragging && selectedKey < 0 && now - lastInteraction > 4000) {
    targetLon = wrap180(targetLon + 2.0 * dt)
  }

  // görünümü hedefe yumuşakça yaklaştır (sürüklerken daha sıkı takip)
  const k = 1 - Math.exp(-(dragging ? 20 : 7) * dt)
  viewLon = wrap180(viewLon + wrap180(targetLon - viewLon) * k)
  viewLat += (targetLat - viewLat) * k
  zoomCur += (zoomTarget - zoomCur) * (1 - Math.exp(-8 * dt))

  globe.rotation.x = THREE.MathUtils.degToRad(viewLat)
  globe.rotation.y = -THREE.MathUtils.degToRad(viewLon)

  // kamera yalnızca sürükleme/zum ile hareket eder (fare gezdirmek modeli oynatmaz)
  const dist = Math.min(7, Math.max(1.15, Math.max(BASE_DIST, minDist) / zoomCur))
  camera.position.z += (dist - camera.position.z) * 0.07
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  stars.rotation.y += dt * 0.008

  globe.updateMatrixWorld()

  // fare hangi ülkenin üzerinde? (karede en fazla bir tarama)
  if (hoverDirty && !dragging && activePointers.size === 0) {
    hoverDirty = false
    const hit = pickAt(hoverPX, hoverPY)
    setHover(hit && hit.country ? hit.country.key : -1, hoverPX, hoverPY)
  }

  // dolgu yumuşakça belirir / söner
  if (fillMesh) {
    const m = fillMesh.material
    m.opacity += (fillTargetOpacity - m.opacity) * 0.16
    if (fillTargetOpacity === 0 && m.opacity < 0.02) removeFill()
  }

  updateHighlights()
  updateLabels()

  renderer.render(scene, camera)
}

onMounted(() => {
  if (!init()) return
  buildCountries()
  buildLabels()
  onResize()
  globe.updateMatrixWorld(true)
  window.addEventListener('resize', onResize)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('wheel', onWheel, { passive: false })
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => onResize())
    resizeObserver.observe(wrapEl.value)
  }
  lastInteraction = performance.now()
  lastTime = performance.now()
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('wheel', onWheel)
  document.body.classList.remove('globe-dragging')
  document.body.classList.remove('globe-hover')
  if (resizeObserver) resizeObserver.disconnect()
  if (renderer) {
    removeFill() // bayrak dokusunu da serbest bırakır
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
        else o.material.dispose()
      }
    })
    renderer.dispose()
  }
})
</script>

<style>
.globe-wrap {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: radial-gradient(1100px 700px at 50% 42%, #0c1a36 0%, #060d1e 50%, #030610 100%);
  cursor: grab;
  touch-action: none;
}

body.globe-dragging .globe-wrap {
  cursor: grabbing;
}

body.globe-hover .globe-wrap {
  cursor: pointer;
}

.globe-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.globe-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.country-label {
  position: absolute;
  top: 0;
  left: 0;
  color: rgba(186, 209, 245, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 500;
  white-space: nowrap;
  text-shadow: 0 1px 10px rgba(2, 6, 16, 0.95);
  opacity: 0;
  will-change: transform, opacity;
}

.selected-label {
  position: absolute;
  top: 0;
  left: 0;
  color: #f6f9ff;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
  opacity: 0;
  /* dolgu hangi renk olursa olsun okunsun diye beyaz + koyu gölge */
  text-shadow:
    0 1px 3px rgba(3, 7, 18, 0.95),
    0 2px 18px rgba(3, 7, 18, 0.85);
  will-change: transform, opacity;
}

.globe-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 209, 102, 0.55);
  /* dikkat: backdrop-filter kullanma — tam ekran WebGL üzerinde her karede
     blur hesaplatıp fareyle gezinirken kasmaya yol açıyor */
  background: rgba(8, 16, 34, 0.92);
  color: #ffd166;
  font-size: 13px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
  will-change: transform, opacity;
}

.focus-marker {
  --marker-color: #ffd166;
  position: absolute;
  top: 0;
  left: 0;
  width: 12px;
  height: 12px;
  opacity: 0;
  will-change: transform, opacity;
}

.focus-marker::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--marker-color);
  box-shadow: 0 0 12px var(--marker-color);
}

.focus-marker .pulse {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1.5px solid var(--marker-color);
  animation: marker-pulse 1.8s ease-out infinite;
}

@keyframes marker-pulse {
  0% {
    transform: scale(0.5);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

.webgl-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9db4d8;
  font-size: 15px;
  text-align: center;
  padding: 24px;
}
</style>
