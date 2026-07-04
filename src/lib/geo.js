import { feature } from 'topojson-client'
import worldTopo from 'world-atlas/countries-110m.json'
import iso from 'i18n-iso-countries'
import { MathUtils, Vector3 } from 'three'

// Coğrafi koordinat -> 3B nokta (Y ekseni kuzey, lon 0 kameraya bakar)
export function latLonToVec3(lat, lon, radius) {
  const la = MathUtils.degToRad(lat)
  const lo = MathUtils.degToRad(lon)
  return new Vector3(
    radius * Math.cos(la) * Math.sin(lo),
    radius * Math.sin(la),
    radius * Math.cos(la) * Math.cos(lo),
  )
}

// Ülke adları desteklenen her dil için üretilir (bkz. src/lib/i18n.js)
const NAME_LANGS = ['tr', 'en']
const displayNames = {}
for (const L of NAME_LANGS) {
  try {
    displayNames[L] = new Intl.DisplayNames([L], { type: 'region' })
  } catch {
    displayNames[L] = null
  }
}

// Intl çevirisinin üstüne yazılan özel adlar
const NAME_BY_ID = {
  // tam resmî ad başlık ve etiketler için çok uzun
  '840': { tr: 'ABD', en: 'USA' },
}
// world-atlas'ta ISO kodu olmayan (-99) bölgeler, İngilizce ada göre
const NAME_BY_ENGLISH = {
  'Kosovo': { tr: 'Kosova', en: 'Kosovo' },
  'N. Cyprus': { tr: 'Kuzey Kıbrıs', en: 'Northern Cyprus' },
  'W. Sahara': { tr: 'Batı Sahra', en: 'Western Sahara' },
}

// ISO sayısal koddan istenen dilde ülke adı; çevrilemezse İngilizce adı kullan.
// Intl.DisplayNames sayısal kod kabul etmediği için önce alpha-2'ye çevrilir.
function localizedName(L, id, fallback) {
  if (displayNames[L] && /^\d{3}$/.test(id)) {
    try {
      const alpha2 = iso.numericToAlpha2(id)
      if (alpha2) {
        const name = displayNames[L].of(alpha2)
        if (name && name !== alpha2) return name
      }
    } catch {
      // geçersiz bölge kodu (ör. tartışmalı bölgeler)
    }
  }
  return fallback
}

function normLon(lon) {
  return ((lon + 540) % 360) - 180
}

// Antimeridyeni (±180) ham sıçramayla geçen halkaların boylamını sürekli hale getirir.
// world-atlas halkaları 180'de bölünmez; hem 2B üçgenleme hem nokta-çokgen testi
// için sarmalın açılması şarttır (3B projeksiyon periyodik olduğundan görüntü değişmez).
export function unwrapRing(ring) {
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

// nokta-çokgen testi (even-odd): delikli ve çok parçalı ülkelerle uyumlu
export function pipRing(ring, lon, lat) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Halkanın shoelace alanı ve ağırlık merkezi.
// Antimeridyeni (±180) geçen halkalar için boylamlar açılarak hesaplanır.
function ringMetrics(ring) {
  const pts = []
  let offset = 0
  let prev = ring[0][0]
  for (const [rawLon, lat] of ring) {
    let lon = rawLon + offset
    const d = lon - prev
    if (d > 180) {
      offset -= 360
      lon -= 360
    } else if (d < -180) {
      offset += 360
      lon += 360
    }
    prev = lon
    pts.push([lon, lat])
  }

  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const cross = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    area2 += cross
    cx += (pts[i][0] + pts[i + 1][0]) * cross
    cy += (pts[i][1] + pts[i + 1][1]) * cross
  }

  if (Math.abs(area2) < 1e-7) {
    let sx = 0
    let sy = 0
    for (const [x, y] of pts) {
      sx += x
      sy += y
    }
    return { area: 0, lon: normLon(sx / pts.length), lat: sy / pts.length }
  }

  const a = area2 / 2
  cx /= 6 * a
  cy /= 6 * a
  // enlem düzeltmesi: kutba yakın ülkelerin alanı derece kareden gerçeğe yaklaştırılır
  const weighted = Math.abs(a) * Math.max(0.12, Math.cos(MathUtils.degToRad(cy)))
  return { area: weighted, lon: normLon(cx), lat: cy }
}

// Halka listesi için ortak istatistikler: sınır kutuları, alan, merkez.
// Hem güncel harita hem tarihî sınır katmanları bunu kullanır.
export function buildShapeStats(rings) {
  const ringBoxes = []
  const bbox = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
  let areaSum = 0
  let best = null
  for (const ring of rings) {
    const rb = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
    for (const [x, y] of ring) {
      if (x < rb.minLon) rb.minLon = x
      if (x > rb.maxLon) rb.maxLon = x
      if (y < rb.minLat) rb.minLat = y
      if (y > rb.maxLat) rb.maxLat = y
    }
    ringBoxes.push(rb)
    if (rb.minLon < bbox.minLon) bbox.minLon = rb.minLon
    if (rb.maxLon > bbox.maxLon) bbox.maxLon = rb.maxLon
    if (rb.minLat < bbox.minLat) bbox.minLat = rb.minLat
    if (rb.maxLat > bbox.maxLat) bbox.maxLat = rb.maxLat
    if (ring.length >= 4) {
      const m = ringMetrics(ring)
      areaSum += m.area
      if (!best || m.area > best.area) best = m
    }
  }
  return {
    ringBoxes,
    bbox,
    area: areaSum,
    lat: best ? best.lat : 0,
    lon: best ? best.lon : 0,
  }
}

let countriesCache = null

// world-atlas TopoJSON -> [{ key, id, names: {tr, en}, english, rings, area, lat, lon }]
// Sonuç önbelleğe alınır; App ve GlobeCanvas aynı diziyi paylaşır.
export function loadCountries() {
  if (countriesCache) return countriesCache
  const fc = feature(worldTopo, worldTopo.objects.countries)
  const out = []
  for (const f of fc.features) {
    const geomType = f.geometry?.type
    if (!geomType) continue
    const polys = geomType === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates

    const rings = []
    for (const poly of polys) {
      for (const ring of poly) rings.push(unwrapRing(ring))
    }
    if (!rings.length) continue
    const stats = buildShapeStats(rings)

    const id = f.id != null ? String(f.id) : ''
    const english = f.properties?.name || 'Unknown'
    const names = {}
    for (const L of NAME_LANGS) {
      names[L] = NAME_BY_ID[id]?.[L] || NAME_BY_ENGLISH[english]?.[L] || localizedName(L, id, english)
    }
    out.push({
      key: out.length,
      id,
      names,
      english,
      rings,
      ...stats,
    })
  }
  countriesCache = out
  return out
}
