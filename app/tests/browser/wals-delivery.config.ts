import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/** Separate test artifact; this entry is never included in the application build. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/lang-viz/',
  publicDir: false,
  build: {
    rolldownOptions: { input: fileURLToPath(new URL('wals-delivery.html', import.meta.url)) },
  },
})
