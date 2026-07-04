<template>
  <div class="page">
    <GlobeCanvas ref="globeRef" @select="onSelect" />

    <header class="hud hud-top">
      <div class="brand">{{ t('brand') }}</div>
      <nav class="lang-switch">
        <button
          v-for="l in SUPPORTED_LANGS"
          :key="l"
          class="lang-btn"
          :class="{ 'lang-active': lang === l }"
          @click="setLang(l)"
        >
          {{ l.toUpperCase() }}
        </button>
      </nav>
    </header>

    <section class="intro hud" :class="{ 'intro-hidden': started }">
      <p class="intro-kicker">{{ t('introKicker') }}</p>
      <h1>{{ t('introTitle') }}</h1>
      <p class="intro-sub">{{ t('introSub') }}</p>
    </section>

    <Transition name="card">
      <section v-if="selected" class="country-card hud">
        <div class="card-inner">
          <div class="card-head">
            <img
              v-if="selected.flag && !flagFailed"
              :src="selected.flag"
              :alt="t('flagAlt', selected.name)"
              class="card-flag"
              @error="flagFailed = true"
            />
            <div>
              <div class="card-index">{{ t('selectedCountry') }}</div>
              <h2 class="card-name">{{ selected.name }}</h2>
            </div>
          </div>
          <div class="card-meta">
            <span v-if="lang === 'tr' && selected.english && selected.english !== selected.name">{{ selected.english }}</span>
            <span v-if="selected.capital">{{ t('capital') }} · {{ selected.capital }}</span>
            <span v-if="selected.population">{{ t('population') }} · {{ selected.population }}</span>
            <span v-if="selected.area">{{ t('area') }} · {{ selected.area }}</span>
          </div>
          <p class="card-note">{{ t('cardNote') }}</p>
        </div>
      </section>
    </Transition>

    <div class="controls hud">
      <button class="ctrl-btn" :title="t('zoomIn')" @click="globeRef?.zoomBy(1.35)">＋</button>
      <button class="ctrl-btn" :title="t('zoomOut')" @click="globeRef?.zoomBy(1 / 1.35)">－</button>
      <button class="ctrl-btn" :title="t('resetView')" @click="globeRef?.resetView()">⟲</button>
    </div>

    <div class="hint-line hud">{{ t('hint') }}</div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import GlobeCanvas from './components/GlobeCanvas.vue'
import { flagUrlFor } from './lib/flagColor'
import { lang, setLang, t, SUPPORTED_LANGS } from './lib/i18n'
import { CAPITALS, CAPITALS_BY_NAME } from './data/capitals'
import { POPULATIONS, POPULATIONS_BY_NAME } from './data/populations'
import { AREAS, AREAS_BY_NAME } from './data/areas'

const globeRef = ref(null)
const selectedRaw = ref(null)
const flagFailed = ref(false)
const started = ref(false)
let introTimer = 0

// "1,41 milyar" / "1.41 billion" biçiminde, aktif dile göre nüfus
function formatPopulation(n) {
  if (!n) return ''
  const dec = (s) => (lang.value === 'tr' ? s.replace('.', ',') : s)
  if (n >= 1e9) return `${dec((n / 1e9).toFixed(2))} ${t('billion')}`
  if (n >= 1e6) {
    const m = n / 1e6
    return `${dec(m >= 100 ? String(Math.round(m)) : m.toFixed(1))} ${t('million')}`
  }
  return `${Math.round(n / 1e3)} ${t('thousand')}`
}

// "783.562 km²" / "783,562 km²" biçiminde yüzölçümü
function formatArea(n) {
  return n ? `${n.toLocaleString(lang.value === 'tr' ? 'tr-TR' : 'en-US')} km²` : ''
}

// kart içeriği dilden türetilir; dil değişince açık kart da kendini tazeler
const selected = computed(() => {
  const p = selectedRaw.value
  if (!p) return null
  const L = lang.value
  return {
    ...p,
    name: p.names?.[L] || p.english,
    capital: CAPITALS[L][p.id] || CAPITALS_BY_NAME[L][p.english] || '',
    population: formatPopulation(POPULATIONS[p.id] ?? POPULATIONS_BY_NAME[p.english] ?? 0),
    area: formatArea(AREAS[p.id] ?? AREAS_BY_NAME[p.english] ?? 0),
    flag: flagUrlFor(p),
  }
})

function onSelect(p) {
  flagFailed.value = false
  selectedRaw.value = p
}

// ilk etkileşimde karşılama yazısını gizle
function markStarted() {
  started.value = true
  window.removeEventListener('pointerdown', markStarted)
  window.removeEventListener('wheel', markStarted)
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const step = 18
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    globeRef.value?.rotateBy(step, 0)
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    globeRef.value?.rotateBy(-step, 0)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    globeRef.value?.rotateBy(0, 12)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    globeRef.value?.rotateBy(0, -12)
  } else if (e.key === 'Escape') {
    globeRef.value?.clearSelection()
  }
  if (!started.value) markStarted()
}

onMounted(() => {
  window.addEventListener('pointerdown', markStarted)
  window.addEventListener('wheel', markStarted)
  window.addEventListener('keydown', onKeyDown)
  introTimer = window.setTimeout(markStarted, 7000)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', markStarted)
  window.removeEventListener('wheel', markStarted)
  window.removeEventListener('keydown', onKeyDown)
  window.clearTimeout(introTimer)
})
</script>

<style>
.page {
  position: relative;
  user-select: none;
}

.hud {
  pointer-events: none;
}

.hud-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 22px clamp(20px, 4vw, 48px);
}

.brand {
  font-size: 12px;
  letter-spacing: 0.42em;
  color: #8fa8cc;
  font-weight: 500;
}

/* ---- dil seçici ---- */
.lang-switch {
  display: flex;
  gap: 6px;
}

.lang-btn {
  pointer-events: auto;
  padding: 6px 13px;
  border-radius: 999px;
  border: 1px solid rgba(143, 168, 204, 0.35);
  background: rgba(10, 20, 40, 0.72);
  color: #8fa8cc;
  font-size: 11px;
  letter-spacing: 0.18em;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.lang-btn:hover {
  border-color: #ffd166;
  color: #ffd166;
}

.lang-active {
  border-color: #ffd166;
  color: #ffd166;
}

/* ---- karşılama ---- */
.intro {
  position: fixed;
  inset: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  transition: opacity 0.9s ease;
}

.intro-hidden {
  opacity: 0;
}

.intro h1 {
  font-size: clamp(64px, 15vw, 190px);
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
  color: #f2f6ff;
  margin: 10px 0;
  text-shadow: 0 0 60px rgba(80, 140, 255, 0.35);
}

.intro-kicker {
  font-size: 13px;
  letter-spacing: 0.5em;
  text-transform: uppercase;
  color: #ffd166;
}

.intro-sub {
  color: #9db4d8;
  font-size: 15px;
  letter-spacing: 0.12em;
}

/* ---- seçili ülke kartı ---- */
.country-card {
  position: fixed;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: flex-end;
  padding: 0 clamp(20px, 5vw, 90px) clamp(56px, 9vh, 90px);
}

.card-inner {
  max-width: min(60vw, 640px);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-bottom: 14px;
}

.card-flag {
  width: 76px;
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid rgba(143, 168, 204, 0.3);
  box-shadow: 0 8px 24px rgba(2, 6, 16, 0.55);
  display: block;
}

.card-index {
  color: #ffd166;
  letter-spacing: 0.3em;
  font-size: 12px;
  margin-bottom: 8px;
  font-weight: 500;
  text-transform: uppercase;
}

.card-name {
  font-size: clamp(38px, 6vw, 88px);
  line-height: 0.98;
  font-weight: 700;
  color: #f4f7ff;
  margin: 0;
  letter-spacing: -0.01em;
  text-shadow: 0 6px 40px rgba(3, 8, 20, 0.8);
}

.card-meta {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  color: #9db4d8;
  font-size: 14px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.card-note {
  margin-top: 12px;
  color: rgba(157, 180, 216, 0.55);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.card-enter-active,
.card-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(22px);
}

/* ---- kontrol butonları ---- */
.controls {
  position: fixed;
  right: clamp(16px, 3vw, 36px);
  bottom: clamp(20px, 5vh, 48px);
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ctrl-btn {
  pointer-events: auto;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(143, 168, 204, 0.35);
  /* backdrop-filter yok: canvas üstünde sürekli blur maliyeti yaratıyor */
  background: rgba(10, 20, 40, 0.72);
  color: #cfe0ff;
  font-size: 19px;
  line-height: 1;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.ctrl-btn:hover {
  border-color: #ffd166;
  color: #ffd166;
  background: rgba(20, 32, 58, 0.75);
}

.hint-line {
  position: fixed;
  left: clamp(16px, 3vw, 36px);
  bottom: 12px;
  z-index: 25;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: rgba(143, 168, 204, 0.55);
}

/* ---- mobil ---- */
@media (max-width: 820px) {
  .hint-line {
    display: none;
  }

  .card-inner {
    max-width: calc(100vw - 110px);
  }

  .card-name {
    font-size: clamp(34px, 9vw, 56px);
  }

  .card-flag {
    width: 54px;
  }

  .card-head {
    gap: 14px;
  }

  .card-note {
    display: none;
  }
}
</style>
