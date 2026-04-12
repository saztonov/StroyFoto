import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Эмитирует pdfjs worker как .js-ассет (вместо .mjs) через Rollup emitFile.
 * Это решает проблему MIME-типов: серверы часто не знают .mjs → application/javascript,
 * а .js отдают корректно. Поскольку файл эмитируется ДО хэширования чанков,
 * хэши всех зависимых чанков автоматически корректны (нет кэш-коллизий).
 */
function pdfjsWorkerFix(): Plugin {
  let workerRefId: string
  return {
    name: 'pdfjs-worker-fix',
    enforce: 'pre',
    buildStart() {
      const workerPath = path.resolve(
        __dirname,
        'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      )
      workerRefId = this.emitFile({
        type: 'asset',
        name: 'pdf.worker.min.js',
        source: fs.readFileSync(workerPath),
      })
    },
    resolveId(source) {
      if (source === 'virtual:pdfjs-worker') return '\0pdfjs-worker'
    },
    load(id) {
      if (id === '\0pdfjs-worker') {
        return `export default import.meta.ROLLUP_FILE_URL_${workerRefId}`
      }
    },
    transform(code, _id) {
      if (code.includes('pdfjs-dist/build/pdf.worker.min.mjs?url')) {
        return code.replace(
          /from\s*['"]pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url['"]/g,
          `from 'virtual:pdfjs-worker'`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [
    pdfjsWorkerFix(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'СтройФото',
        short_name: 'СтройФото',
        description: 'Фотоконтроль строительства: отчёты, планы, метки на чертежах',
        theme_color: '#1677ff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ru',
        dir: 'ltr',
        categories: ['productivity', 'business', 'utilities'],
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Supabase REST/Auth — свежие данные приоритетнее, но при оффлайне отдаём кэш.
            urlPattern: ({ url }) => /\.supabase\.co\/(rest|auth)\/v1\//.test(url.href),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Изображения по presigned URL из R2 — кэшируем по pathname (querystring игнорим).
            urlPattern: ({ request, url }) =>
              request.destination === 'image' && /r2\.cloudflarestorage\.com|\.r2\.dev/.test(url.host),
            handler: 'CacheFirst',
            options: {
              cacheName: 'r2-images',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    // Разбиваем крупные vendor-библиотеки на отдельные чанки, чтобы:
    //  - pdfjs-dist грузился только при открытии формы/детали отчёта (там используется PdfPlanCanvas);
    //  - antd попадал в свой long-lived чанк и кэшировался между релизами;
    //  - основной entry оставался маленьким.
    // Админские/reports-lazy чанки уже настроены через React.lazy в router.tsx.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs'
          // antd-icons → тот же vendor-antd, чтобы избежать циклической
          // зависимости между чанками (antd тянет иконки, а часть пакетов
          // иконок импортирует утилиты из antd).
          if (
            id.includes('@ant-design/icons') ||
            id.includes('antd') ||
            id.includes('rc-') ||
            id.includes('@rc-component')
          ) {
            return 'vendor-antd'
          }
          if (id.includes('@supabase') || id.includes('supabase-js')) return 'vendor-supabase'
          if (id.includes('idb')) return 'vendor-idb'
          if (id.includes('browser-image-compression')) return 'vendor-image'
          return undefined
        },
      },
    },
    // vendor-antd кэшируется Workbox и long-lived — под него поднимаем порог.
    // Основной app-entry (`index-*.js`) при этом ≈38 KB gzip, что на порядок
    // ниже цели из плана (≤500 KB gzip main).
    chunkSizeWarningLimit: 1500,
  },
})
