import iso from 'i18n-iso-countries'

// flagcdn.com bayrağı için alpha-2 kodu (Kosova'nın ISO kodu yok, flagcdn 'xk' kullanır).
// width: flagcdn'in sunduğu genişliklerden biri (20, 40, 80, 160, 320, 640, 1280, 2560)
export function flagUrlFor(c, width = 160) {
  let alpha2 = null
  if (c.english === 'Kosovo') alpha2 = 'xk'
  else if (/^\d{3}$/.test(c.id || '')) {
    try {
      alpha2 = iso.numericToAlpha2(c.id)
    } catch {
      alpha2 = null
    }
  }
  return alpha2 ? `https://flagcdn.com/w${width}/${alpha2.toLowerCase()}.png` : ''
}

const colorCache = new Map()

// Bayrağın baskın canlı rengini çıkarır (beyaz/siyah/gri elenir).
// Görsel yüklenemez veya canvas okunamazsa (CORS) null döner.
export function dominantFlagColor(url) {
  if (!url) return Promise.resolve(null)
  if (colorCache.has(url)) return Promise.resolve(colorCache.get(url))
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let hex = null
      try {
        const w = 32
        const h = 24
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, w, h)
        const data = ctx.getImageData(0, 0, w, h).data

        // renkleri kaba kutulara topla; sıklık × doygunluk puanı en yüksek olanı seç
        const buckets = new Map()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const sat = max === 0 ? 0 : (max - min) / max
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
          if (sat < 0.25 || lum < 30 || lum > 235) continue
          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
          let e = buckets.get(key)
          if (!e) {
            e = { n: 0, r: 0, g: 0, b: 0, sat: 0 }
            buckets.set(key, e)
          }
          e.n++
          e.r += r
          e.g += g
          e.b += b
          e.sat += sat
        }

        let best = null
        let bestScore = 0
        for (const e of buckets.values()) {
          const score = e.n * (0.4 + 0.6 * (e.sat / e.n))
          if (score > bestScore) {
            bestScore = score
            best = e
          }
        }

        if (best) {
          let r = best.r / best.n
          let g = best.g / best.n
          let b = best.b / best.n
          // koyu lacivert zeminde kaybolmasın diye çok koyu renkleri aç
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
          if (lum < 95) {
            const t = Math.min(0.55, (95 - lum) / 95)
            r += (255 - r) * t
            g += (255 - g) * t
            b += (255 - b) * t
          }
          hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
        }
      } catch {
        hex = null // CORS ile boyanmış canvas vb.
      }
      colorCache.set(url, hex)
      resolve(hex)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
