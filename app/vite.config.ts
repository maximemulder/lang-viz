import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { maplibreTileRetention } from './build/maplibreTileRetention.ts'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/lang-viz/' : '/',
  // Preserve the worker's lazy geometry import as a separate production chunk.
  worker: { format: 'es' },
  // Apply the same narrow retention correction in development and production.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    maplibreTileRetention(),
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})
