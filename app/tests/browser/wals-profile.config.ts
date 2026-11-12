import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/lang-viz/',
  publicDir: false,
  plugins: [react()],
  build: {
    rolldownOptions: { input: fileURLToPath(new URL('wals-profile.html', import.meta.url)) },
  },
})
