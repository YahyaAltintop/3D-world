import { ref, watch } from 'vue'

export const SUPPORTED_LANGS = ['tr', 'en']
const STORAGE_KEY = 'world-lang'

// İlk açılışta tarayıcı dili esas alınır (tr dışındaki her şey en'e düşer);
// kullanıcı elle dil seçtiyse kayıtlı tercih kazanır.
function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (SUPPORTED_LANGS.includes(saved)) return saved
  } catch {
    // localStorage kullanılamıyor (gizli mod vb.) — tarayıcı diline düş
  }
  const nav = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase()
  return nav.startsWith('tr') ? 'tr' : 'en'
}

export const lang = ref(detectLang())

export function setLang(l) {
  if (!SUPPORTED_LANGS.includes(l)) return
  lang.value = l
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    // saklanamazsa sorun değil, oturum boyunca geçerli kalır
  }
}

const MESSAGES = {
  tr: {
    brand: '3B DÜNYA ATLASI',
    introKicker: 'İnteraktif Küre',
    introTitle: 'DÜNYA',
    introSub: 'Sürükle, yakınlaştır, ülkelere tıkla',
    selectedCountry: 'Seçili Ülke',
    capital: 'Başkent',
    population: 'Nüfus',
    area: 'Yüzölçümü',
    cardNote: 'Kapatmak için okyanusa tıkla ya da ESC',
    zoomIn: 'Yakınlaştır (tekerlek)',
    zoomOut: 'Uzaklaştır',
    resetView: 'Görünümü sıfırla',
    hint: 'sürükle: döndür · tekerlek: zum · ülkeye tıkla: bilgi',
    flagAlt: (name) => `${name} bayrağı`,
    webglError: 'Tarayıcınız WebGL desteklemiyor — 3B küre görüntülenemiyor.',
    docTitle: 'Dünya · 3B Keşif',
    metaDescription: 'Dünyayı 3B keşfet — interaktif 3B dünya atlası',
    billion: 'milyar',
    million: 'milyon',
    thousand: 'bin',
  },
  en: {
    brand: '3D WORLD ATLAS',
    introKicker: 'Interactive Globe',
    introTitle: 'EARTH',
    introSub: 'Drag, zoom, click a country',
    selectedCountry: 'Selected Country',
    capital: 'Capital',
    population: 'Population',
    area: 'Area',
    cardNote: 'Click the ocean or press ESC to close',
    zoomIn: 'Zoom in (wheel)',
    zoomOut: 'Zoom out',
    resetView: 'Reset view',
    hint: 'drag: rotate · wheel: zoom · click a country: info',
    flagAlt: (name) => `Flag of ${name}`,
    webglError: 'Your browser does not support WebGL — the 3D globe cannot be displayed.',
    docTitle: 'Earth · 3D Explorer',
    metaDescription: 'Explore the world in 3D — an interactive 3D world atlas',
    billion: 'billion',
    million: 'million',
    thousand: 'thousand',
  },
}

export function t(key, ...args) {
  const table = MESSAGES[lang.value] || MESSAGES.en
  const entry = table[key] ?? MESSAGES.en[key] ?? key
  return typeof entry === 'function' ? entry(...args) : entry
}

// dil değişince sekme başlığı, meta açıklama ve <html lang> güncellenir
watch(
  lang,
  (l) => {
    document.documentElement.lang = l
    document.title = t('docTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('metaDescription'))
  },
  { immediate: true },
)
