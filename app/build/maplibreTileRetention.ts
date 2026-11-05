import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const library = new URL('../node_modules/maplibre-gl/package.json', import.meta.url)
const helper = fileURLToPath(
  new URL('../src/features/map/overlap/tileRetention.ts', import.meta.url),
)

/** A version-checked upstream workaround, confined to atlas overlap sources.
 * Preserve MapLibre's public module and worker setup; do not mutate node_modules
 * or patch live map instances. Review/remove this when upgrading MapLibre.
 */
export const patchTileRetention = (code: string): string => {
  const method = /_retainLoadedChildren\(([^,]+),\s*([^)]+)\)\s*\{/g
  const matches = [...code.matchAll(method)]
  if (matches.length !== 1)
    throw new Error('MapLibre tile retention method changed; review workaround')
  return (
    `import { retainCoverageChildren as atlasRetainChildren } from ${JSON.stringify(helper)};\n` +
    code.replace(
      method,
      (signature, retained, targets) =>
        `${signature}
      if (this.id.startsWith('language-overlap-')) {
        return atlasRetainChildren(${retained}, ${targets}, this._getLoadedDescendents(${targets}));
      }
      `,
    )
  )
}

export const maplibreTileRetention = (): Plugin => ({
  name: 'atlas-maplibre-tile-retention',
  enforce: 'pre',
  configResolved() {
    const { version } = JSON.parse(readFileSync(library, 'utf8')) as { version: string }
    if (version !== '6.14.0')
      throw new Error('Review the tile retention workaround before upgrading MapLibre')
  },
  transform(code, id) {
    // Vite adds a dependency version query when serving unoptimized modules.
    const path = id.split('?')[0] ?? ''
    if (!/\/maplibre-gl\/dist\/maplibre-gl(?:-dev)?\.mjs$/.test(path)) return
    return { code: patchTileRetention(code), map: null }
  },
})
