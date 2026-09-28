import * as THREE from 'three'
import { latLonToVec3, pipRing } from './geo'

// Bayrak ülke kutusuna oturtulurken en fazla bu oranda esnetilir;
// oran farkı daha büyükse (ör. Şili) taşan kısım kırpılır.
const MAX_STRETCH = 1.6

// Kenar uzunluğu (derece, boylam kutba doğru daraldığı için cos(lat) düzeltmeli)
function edgeLen(p, q) {
  const midLat = (((p.y + q.y) / 2) * Math.PI) / 180
  const dx = (p.x - q.x) * Math.cos(midLat)
  const dy = p.y - q.y
  return Math.hypot(dx, dy)
}

function mid(p, q) {
  return new THREE.Vector2((p.x + q.x) / 2, (p.y + q.y) / 2)
}

// Büyük üçgenler küre yüzeyinin altına gömülmesin diye en uzun kenardan böl
function subdivide(a, b, c, out, depth) {
  const ab = edgeLen(a, b)
  const bc = edgeLen(b, c)
  const ca = edgeLen(c, a)
  const maxE = Math.max(ab, bc, ca)
  if (maxE > 4 && depth < 9) {
    if (ab >= bc && ab >= ca) {
      const m = mid(a, b)
      subdivide(a, m, c, out, depth + 1)
      subdivide(m, b, c, out, depth + 1)
    } else if (bc >= ab && bc >= ca) {
      const m = mid(b, c)
      subdivide(a, b, m, out, depth + 1)
      subdivide(a, m, c, out, depth + 1)
    } else {
      const m = mid(c, a)
      subdivide(a, b, m, out, depth + 1)
      subdivide(b, c, m, out, depth + 1)
    }
    return
  }
  const f = out.frame
  for (const p of [a, b, c]) {
    const v = latLonToVec3(p.y, p.x, out.radius)
    out.positions.push(v.x, v.y, v.z)
    out.uvs.push((p.x - f.minLon) / f.lonSpan, (p.y - f.minLat) / f.latSpan)
  }
}

// kapalı halka -> Vector2 dizisi (tekrarlanan son nokta atılır)
function toVec2(ring) {
  const pts = []
  for (let i = 0; i < ring.length - 1; i++) pts.push(new THREE.Vector2(ring[i][0], ring[i][1]))
  return pts
}

function triangulatePolygon(outer, holes, out) {
  const contour = toVec2(outer)
  if (contour.length < 3) return
  const holeVecs = holes.map(toVec2).filter((h) => h.length >= 3)
  let tris
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holeVecs)
  } catch {
    return // bozuk halkada dolguyu atla (sınır çizgisi yine görünür)
  }
  const all = contour.concat(...holeVecs)
  for (const [a, b, c] of tris) {
    subdivide(all[a], all[b], all[c], out, 0)
  }
}

// enlem düzeltmeli yaklaşık halka alanı (derece²) — ana kara parçasını seçmek için
function ringArea(ring, box) {
  let a2 = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  const midLat = (((box.minLat + box.maxLat) / 2) * Math.PI) / 180
  return (Math.abs(a2) / 2) * Math.cos(midLat)
}

// Bayrağın kutuya yerleşeceği çerçeve (lon/lat): kutuyu tamamen kaplar,
// bayrak oranı MAX_STRETCH'e kadar esner, gerisi ortadan kırpılır.
function flagFrame(b, aspect) {
  const k = Math.max(0.2, Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180))
  const w = Math.max((b.maxLon - b.minLon) * k, 1e-6)
  const h = Math.max(b.maxLat - b.minLat, 1e-6)
  const stretch = Math.min(MAX_STRETCH, Math.max(1 / MAX_STRETCH, w / h / aspect))
  const target = aspect * stretch
  const fw = w / h > target ? w : h * target
  const fh = w / h > target ? w / target : h
  const lonSpan = fw / k
  return {
    minLon: (b.minLon + b.maxLon) / 2 - lonSpan / 2,
    lonSpan,
    minLat: (b.minLat + b.maxLat) / 2 - fh / 2,
    latSpan: fh,
  }
}

// Ana kara ve yakınındaki adalar tek bayrağı paylaşır; uzaktaki parçalar
// (Alaska, Fransız Guyanası, Svalbard...) kendi bayraklarını alır.
function assignFrames(polys, aspect) {
  const main = polys.reduce((best, p) => (p.area > best.area ? p : best))
  const mb = main.box
  const padLon = (mb.maxLon - mb.minLon) * 0.25 + 0.5
  const padLat = (mb.maxLat - mb.minLat) * 0.25 + 0.5
  const near = (p) => {
    const cx = (p.box.minLon + p.box.maxLon) / 2
    const cy = (p.box.minLat + p.box.maxLat) / 2
    return cx >= mb.minLon - padLon && cx <= mb.maxLon + padLon && cy >= mb.minLat - padLat && cy <= mb.maxLat + padLat
  }
  const cluster = polys.filter(near)
  const union = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
  for (const p of cluster) {
    union.minLon = Math.min(union.minLon, p.box.minLon)
    union.maxLon = Math.max(union.maxLon, p.box.maxLon)
    union.minLat = Math.min(union.minLat, p.box.minLat)
    union.maxLat = Math.max(union.maxLat, p.box.maxLat)
  }
  const mainFrame = flagFrame(union, aspect)
  for (const p of polys) p.frame = cluster.includes(p) ? mainFrame : flagFrame(p.box, aspect)
}

// Ülkenin çokgenlerini üçgenleyip küre yüzeyine oturan dolgu geometrisi üretir.
// Halkalar düz liste geldiği için dış halka / delik ayrımı kapsama sayısıyla yapılır.
// Halkaların antimeridyen sarmalı loadCountries'te (geo.js) zaten açılmıştır.
// UV'ler, en/boy oranı `flagAspect` olan bayrak dokusunu ülke sınırlarına oturtur.
export function buildFillGeometry(country, radius = 1.0015, flagAspect = 1.5) {
  const rings = country.rings
  const n = rings.length

  // sarmalı açılmış halkalar için yerel sınır kutuları
  const boxes = rings.map((ring) => {
    const b = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
    for (const [x, y] of ring) {
      if (x < b.minLon) b.minLon = x
      if (x > b.maxLon) b.maxLon = x
      if (y < b.minLat) b.minLat = y
      if (y > b.maxLat) b.maxLat = y
    }
    return b
  })

  const containedCount = new Array(n).fill(0)
  const parentOf = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    // Koordinatlar sabit bir ızgarada; yarım adım kaydırınca ışın testi
    // köşelerle tam çakışamaz (çakışma yanlış delik tespitine yol açabilir)
    const px = rings[i][0][0] + 0.005
    const py = rings[i][0][1] + 0.005
    let bestParent = -1
    let bestArea = Infinity
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const b = boxes[j]
      if (px < b.minLon || px > b.maxLon || py < b.minLat || py > b.maxLat) continue
      if (pipRing(rings[j], px, py)) {
        containedCount[i]++
        const area = (b.maxLon - b.minLon) * (b.maxLat - b.minLat)
        if (area < bestArea) {
          bestArea = area
          bestParent = j
        }
      }
    }
    parentOf[i] = bestParent
  }

  const polys = []
  for (let i = 0; i < n; i++) {
    if (containedCount[i] % 2 !== 0) continue // delik; dış halkasıyla birlikte işlenir
    const holes = []
    for (let k = 0; k < n; k++) {
      if (k !== i && parentOf[k] === i && containedCount[k] % 2 === 1) holes.push(rings[k])
    }
    polys.push({ outer: rings[i], holes, box: boxes[i], area: ringArea(rings[i], boxes[i]) })
  }

  const out = { positions: [], uvs: [], radius, frame: null }
  if (polys.length) assignFrames(polys, flagAspect)
  for (const p of polys) {
    out.frame = p.frame
    triangulatePolygon(p.outer, p.holes, out)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2))
  return geo
}
