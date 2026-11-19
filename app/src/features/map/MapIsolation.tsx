import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect } from 'react'
import { Layer, useMap } from 'react-map-gl/maplibre'
import { loadGeometryBounds } from '../../data/atlasRepository'
import { combinedBounds } from '../../domain/languageFocus.ts'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  languageHierarchyAtom,
  temporalViewAtom,
} from '../../state/atlasState'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import {
  clearMapIsolationAtom,
  isolationOverviewRequestAtom,
  mapIsolationAtom,
  mapSelectionFocusAtom,
  setIsolationColorAtom,
} from '../../state/mapInteraction.ts'
import { boundaryIndexAtom } from '../administrative/state.ts'
import { focusBounds } from './focusBounds.ts'
import { isolatedLanguageIds } from './interactionRules.ts'

/** Paint the supplied atlas polygons directly; administrative geometry is kept separate. */
export function IsolatedLanguageLayer() {
  const isolation = useAtomValue(mapIsolationAtom)
  const data = useAtomValue(atlasDataAtom)
  const datasets = useAtomValue(geographyDatasetFilterAtom)
  const period = useAtomValue(temporalViewAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  if (isolation?.kind !== 'language') return null
  const languages = isolatedLanguageIds(
    isolation.id,
    data.languageById.get(isolation.id)?.level,
    data.variants.some(
      (v) =>
        v.languageId === isolation.id &&
        (datasets === 'all' || datasets.includes(v.datasetId)) &&
        (period === 'all' || v.temporalCoverage.viewId === period),
    ),
    hierarchy.childrenById,
  )
  const ids = data.variants
    .filter(
      (variant) =>
        languages.has(variant.languageId) &&
        (datasets === 'all' || datasets.includes(variant.datasetId)) &&
        (period === 'all' || variant.temporalCoverage.viewId === period),
    )
    .map((variant) => variant.id)
  return (
    <>
      <Layer
        beforeId="language-highlight-anchor"
        id="isolated-language-fill"
        type="fill"
        source="language-areas"
        source-layer={data.manifest.vectorLayer}
        filter={['in', ['get', 'variant_id'], ['literal', ids]]}
        paint={{
          'fill-color': isolation.color,
          'fill-opacity': 0.82,
          'fill-opacity-transition': { duration: 150 },
        }}
      />
      <Layer
        id="isolated-language-outline"
        type="line"
        source="language-areas"
        source-layer={data.manifest.vectorLayer}
        filter={['in', ['get', 'variant_id'], ['literal', ids]]}
        paint={{ 'line-color': isolation.color, 'line-width': 1.25, 'line-opacity': 1 }}
      />
    </>
  )
}

export function IsolationOverview() {
  const { current } = useMap()
  const request = useAtomValue(isolationOverviewRequestAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const index = useAtomValue(boundaryIndexAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const store = useStore()
  useEffect(() => {
    const map = current?.getMap()
    if (!map || !request || intent !== request) return
    if (isolation?.kind === 'region' && index) {
      const bounds = combinedBounds(
        index.features
          .filter((feature) => isolation.featureIds.includes(feature.featureId))
          .map((feature) => feature.bounds),
      )
      if (bounds) {
        map.resize()
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            padding: 32,
            maxZoom: 6,
            duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
          },
        )
      }
      store.set(mapCameraIntentAtom, null)
      return
    }
    // A world overview, in the user's current projection. No replay after resizing or colour edits.
    map.easeTo({
      center: [0, 18],
      zoom: map.getMinZoom(),
      bearing: 0,
      pitch: 0,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
    })
    store.set(mapCameraIntentAtom, null)
  }, [current, request, intent, store, isolation, index])
  return null
}

export function IsolationControls() {
  const isolation = useAtomValue(mapIsolationAtom)
  const clear = useSetAtom(clearMapIsolationAtom)
  const setColor = useSetAtom(setIsolationColorAtom)
  if (!isolation) return null
  return (
    <section className="map-isolation" aria-label="Isolated map area">
      <strong>Only {isolation.label}</strong>
      {isolation.kind === 'language' && (
        <label>
          Colour{' '}
          <input
            type="color"
            aria-label="Highlight colour"
            value={isolation.color}
            onInput={(event) => setColor(event.currentTarget.value)}
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        </label>
      )}
      <button type="button" onClick={() => clear()}>
        Show all again
      </button>
    </section>
  )
}

/** Showing a chosen set frames that set, including choices on different continents. */
export function MapSelectionCamera() {
  const { current } = useMap()
  const request = useAtomValue(mapSelectionFocusAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const data = useAtomValue(atlasDataAtom)
  const store = useStore()
  useEffect(() => {
    const map = current?.getMap()
    if (!map || !request || intent !== request) return
    let cancelled = false
    void loadGeometryBounds(data.manifest)
      .then((index) => {
        if (cancelled || store.get(mapCameraIntentAtom) !== request) return
        const bounds = combinedBounds(
          request.variantIds.flatMap((id) => (index[id] ? [index[id]] : [])),
        )
        if (bounds) focusBounds(map, bounds[2] > 180 ? [-180, bounds[1], 180, bounds[3]] : bounds)
        store.set(mapCameraIntentAtom, null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [current, request, intent, data, store])
  return null
}
