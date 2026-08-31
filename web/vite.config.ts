import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'logo.svg',
        'logo.png',
        'favicon-32.png',
        'icons/apple-touch-180.png',
        'icons/apple-splash-1170x2532.png',
        'icons/apple-splash-1290x2796.png',
        'icons/apple-splash-1284x2778.png',
        'icons/apple-splash-828x1792.png',
        'icons/apple-splash-750x1334.png',
      ],
      manifest: {
        name: '墨问',
        short_name: '墨问',
        description: '把和 Agent 沟通的结果存进表格与笔记',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#f7f7f5',
        icons: [
          { src: '/icons/splash-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/splash-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/splash-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\//, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // 开发时将 /api 代理到本地 Node 服务
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18085',
        changeOrigin: true,
      },
    },
  },
  // 构建输出到 Node 服务静态资源目录
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
