import * as THREE from 'three'
import { latLonToVec3, pipRing } from './geo'

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
function subdivide(a, b, c, positions, radius, depth) {
  const ab = edgeLen(a, b)
  const bc = edgeLen(b, c)
  const ca = edgeLen(c, a)
  const maxE = Math.max(ab, bc, ca)
  if (maxE > 4 && depth < 9) {
    if (ab >= bc && ab >= ca) {
      const m = mid(a, b)
      subdivide(a, m, c, positions, radius, depth + 1)
      subdivide(m, b, c, positions, radius, depth + 1)
    } else if (bc >= ab && bc >= ca) {
      const m = mid(b, c)
      subdivide(a, b, m, positions, radius, depth + 1)
      subdivide(a, m, c, positions, radius, depth + 1)
    } else {
      const m = mid(c, a)
      subdivide(a, b, m, positions, radius, depth + 1)
      subdivide(b, c, m, positions, radius, depth + 1)
    }
    return
  }
  for (const p of [a, b, c]) {
    const v = latLonToVec3(p.y, p.x, radius)
    positions.push(v.x, v.y, v.z)
  }
}

// Antimeridyeni (±180) ham sıçramayla geçen halkaların boylamını sürekli hale getirir.
// world-atlas halkaları 180'de bölünmez; 2B üçgenleme için sarmalın açılması şarttır
// (projeksiyon periyodik olduğundan lon > 180 değerler sorunsuz küreye oturur).
function unwrapRing(ring) {
  const out = [ring[0]]
  let offset = 0
  let prev = ring[0][0]
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0] + offset
    const d = lon - prev
    if (d > 180) {
      offset -= 360
      lon -= 360
    } else if (d < -180) {
      offset += 360
      lon += 360
    }
    prev = lon
    out.push([lon, ring[i][1]])
  }
  return out
}

// kapalı halka -> Vector2 dizisi (tekrarlanan son nokta atılır)
function toVec2(ring) {
  const pts = []
  for (let i = 0; i < ring.length - 1; i++) pts.push(new THREE.Vector2(ring[i][0], ring[i][1]))
  return pts
}

function triangulatePolygon(outer, holes, positions, radius) {
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
    subdivide(all[a], all[b], all[c], positions, radius, 0)
  }
}

// Ülkenin çokgenlerini üçgenleyip küre yüzeyine oturan dolgu geometrisi üretir.
// Halkalar düz liste geldiği için dış halka / delik ayrımı kapsama sayısıyla yapılır.
export function buildFillGeometry(country, radius = 1.0015) {
  const rings = country.rings.map(unwrapRing)
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

  const positions = []
  for (let i = 0; i < n; i++) {
    if (containedCount[i] % 2 !== 0) continue // delik; dış halkasıyla birlikte işlenir
    const holes = []
    for (let k = 0; k < n; k++) {
      if (k !== i && parentOf[k] === i && containedCount[k] % 2 === 1) holes.push(rings[k])
    }
    triangulatePolygon(rings[i], holes, positions, radius)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}
