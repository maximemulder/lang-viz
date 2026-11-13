import { useAtomValue, useStore } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'
import { Layer, useMap } from 'react-map-gl/maplibre'
import { loadGeometryBounds } from '../../data/atlasRepository'
import { combinedBounds } from '../../domain/languageFocus'
import { atlasDataAtom, languageColorsAtom } from '../../state/atlasState'
import { isolatedLanguageIdAtom } from '../../state/mapInteraction'
import { startOverlayCamera } from '../map/overlayCamera'
import { walsAreaMatchesAtom } from './areaState'
import { walsCameraBounds } from './mapGeometry'
import { walsCameraRequestAtom } from './state'
import './walsMap.css'

/** Paint the exact existing language polygons. No points, lines, country fills,
 * reconstructed boundaries, or writes to the pinned map selection.
 */
export default function WalsLayer() {
  const atlas = useAtomValue(atlasDataAtom)
  const matches = useAtomValue(walsAreaMatchesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const isolated = useAtomValue(isolatedLanguageIdAtom)
  const request = useAtomValue(walsCameraRequestAtom)
  const store = useStore()
  const focusedRequest = useRef<unknown>(null)
  const { current } = useMap()
  const map = current?.getMap()
  const variants = useMemo(() => matches?.variants ?? [], [matches])
  const ids = variants.filter((v) => !isolated || v.languageId === isolated).map((v) => v.id)
  const colorTable = Object.fromEntries(
    [...(matches?.mappedIds ?? [])].map((id) => [id, colors.get(id) ?? '#71ac85']),
  )
  useEffect(() => {
    if (!request || !map || focusedRequest.current === request) return
    let cancelled = false
    let stop: (() => void) | undefined
    void loadGeometryBounds(atlas.manifest)
      .then((index) => {
        if (cancelled || store.get(walsCameraRequestAtom) !== request) return
        const bounds = combinedBounds(
          variants.flatMap((v) => {
            const bounds = index[v.id]
            return bounds ? [bounds] : []
          }),
        )
        focusedRequest.current = request
        stop = startOverlayCamera({
          map,
          bounds: () =>
            walsCameraBounds(
              bounds,
              map.getProjection().type === 'mercator' && !map.getRenderWorldCopies(),
            ),
          isCurrent: () => !cancelled && store.get(walsCameraRequestAtom) === request,
          canStop: () => true,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          frames: {
            request: (callback) => window.requestAnimationFrame(callback),
            cancel: (id) => window.cancelAnimationFrame(id),
          },
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      stop?.()
    }
  }, [map, request, atlas, variants, store])
  if (!matches || !map) return null
  return (
    <Layer
      id="wals-language-areas"
      type="fill"
      source="language-areas"
      source-layer={atlas.manifest.vectorLayer}
      filter={['in', ['get', 'variant_id'], ['literal', ids]]}
      paint={{
        'fill-color': [
          'coalesce',
          ['get', ['get', 'language_id'], ['literal', colorTable]],
          '#71ac85',
        ],
        'fill-opacity': 0.78,
        'fill-opacity-transition': { duration: 180 },
      }}
    />
  )
}
