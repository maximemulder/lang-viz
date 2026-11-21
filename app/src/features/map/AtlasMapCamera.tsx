import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { loadGeometryBounds } from '../../data/atlasRepository'
import {
  boundsForVariants,
  type GeographicBounds,
  targetGeometry,
} from '../../domain/languageFocus'
import {
  atlasDataAtom,
  datasetMapNavigationAtom,
  geographyAvailabilityAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
} from '../../state/atlasState'
import { languageMapNavigationAtom } from '../../state/languageControls'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent'
import { searchCoverageAtom } from '../../state/searchSelection'
import { focusBounds } from './focusBounds'

/** A request is an explicit action, so browsing and hover do not recenter the map. */
export const AtlasMapCamera = () => {
  const { current } = useMap()
  const map = current?.getMap()
  const languageRequest = useAtomValue(languageMapNavigationAtom)
  const datasetRequest = useAtomValue(datasetMapNavigationAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const request =
    intent === datasetRequest ? datasetRequest : intent === languageRequest ? languageRequest : null
  const store = useStore()
  useEffect(() => {
    if (!map || !request || store.get(mapCameraIntentAtom) !== request) return
    let cancelled = false
    let moved = false
    const settled = () => {
      moved = false
    }
    map.on('moveend', settled)
    const isCurrent = () => !cancelled && store.get(mapCameraIntentAtom) === request
    map.stop()

    const fit = (bounds: GeographicBounds) => {
      // Full dataset views use the padded fit. Zooming out further can shift the center
      // away from the dataset where the flat map constrains the camera near the world edge.
      const extraZoomOut = 'target' in request ? undefined : 0
      moved = focusBounds(map, bounds, extraZoomOut) && map.isMoving()
    }
    const navigate = async () => {
      if (!isCurrent()) return
      if ('bounds' in request) {
        fit(request.bounds)
        return
      }
      const data = await store.get(atlasDataAtom)
      if (!isCurrent()) return
      const currentVariantIds = () => {
        if (!('target' in request)) return request.variantIds
        if (request.variantIds) return request.variantIds
        return targetGeometry(
          request.target,
          data,
          store.get(geographyAvailabilityAtom),
          store.get(searchCoverageAtom),
          store.get(languageHierarchyAtom),
          store.get(mapEntriesAtom),
        ).map(({ id }) => id)
      }
      const variantIds = currentVariantIds()
      if (!variantIds.length) return
      const index = await loadGeometryBounds(data.manifest)
      if (!isCurrent()) return
      if (JSON.stringify(variantIds) !== JSON.stringify(currentVariantIds())) return
      const bounds = boundsForVariants(variantIds, index)
      if (bounds) fit(bounds)
    }
    // Camera metadata is optional for inspecting languages and showing datasets.
    void navigate().catch(() => {})
    return () => {
      cancelled = true
      map.off('moveend', settled)
      const latest = store.get(mapCameraIntentAtom)
      if (moved && (!latest || latest === request)) map.stop()
    }
  }, [map, request, store])
  return null
}
