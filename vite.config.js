import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // harita verisi JS nesnesi yerine JSON.parse ile yüklenir (büyük veride daha hızlı ayrıştırılır)
  json: { stringify: true },
  build: {
    rollupOptions: {
      output: {
        // kütüphaneler ayrı parçalarda: uygulama kodu değişince tarayıcı önbelleği korunur
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules/')) return 'vendor'
        },
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5669,
  },
})
