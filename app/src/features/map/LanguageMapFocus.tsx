import { useAtomValue, useStore } from 'jotai'
import type { ExpressionSpecification } from 'maplibre-gl'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { languageArchiveUrl, loadGeometryBounds } from '../../data/atlasRepository'
import { selectGeometryArchives } from '../../data/geometryArchives'
import { geometryTileUrl } from '../../data/geometryProtocol'
import { combinedBounds, targetGeometry } from '../../domain/languageFocus'
import {
  atlasDataAtom,
  geographyAvailabilityAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
  selectedMapAreasAtom,
} from '../../state/atlasState'
import {
  languageKeyboardPreviewAtom,
  languageMapNavigationAtom,
  languagePanelAtom,
  languagePointerPreviewAtom,
} from '../../state/languageControls'
import { searchCoverageAtom } from '../../state/searchSelection'
import { createInspectionHighlight } from './inspectionHighlight'

export const LANGUAGE_PREVIEW_SOURCE = 'language-sidebar-preview'
const INSPECTED: ExpressionSpecification = ['boolean', ['feature-state', 'inspected'], false]

/** Independent tiles and paint keep previews out of selected coverage/cache identities. */
export const LanguageMapPreview = ({ mapInspectionActive }: { mapInspectionActive: boolean }) => {
  const { current } = useMap()
  const map = current?.getMap()
  const data = useAtomValue(atlasDataAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const selected = useAtomValue(selectedMapAreasAtom)
  const pointer = useAtomValue(languagePointerPreviewAtom)
  const keyboard = useAtomValue(languageKeyboardPreviewAtom)
  const panel = useAtomValue(languagePanelAtom)
  const target =
    pointer?.target ??
    (mapInspectionActive
      ? null
      : (keyboard?.target ??
        (panel.detailId
          ? {
              languageId: panel.detailId,
              ...(panel.detailEntryId ? { entryId: panel.detailEntryId } : {}),
              ...(panel.detailGroupId ? { groupId: panel.detailGroupId } : {}),
            }
          : null)))
  const variants = targetGeometry(target, data, availability, coverage, hierarchy, entries)
  const ids = [...new Set(variants.map(({ id }) => id))].sort()
  const key = JSON.stringify(ids)
  const sourceLayer = data.manifest.vectorLayer
  const highlightRef = useRef<ReturnType<typeof createInspectionHighlight> | null>(null)
  useLayoutEffect(() => {
    if (!map) return
    const highlight = createInspectionHighlight(map, LANGUAGE_PREVIEW_SOURCE, sourceLayer)
    highlightRef.current = highlight
    return () => {
      highlight.dispose()
      highlightRef.current = null
    }
  }, [map, sourceLayer])
  useLayoutEffect(() => {
    if (map && sourceLayer) highlightRef.current?.set(JSON.parse(key) as string[])
  }, [map, sourceLayer, key])
  if (!ids.length) return null
  const archiveUrl = languageArchiveUrl(
    selectGeometryArchives(data.manifest, data.variants, [], 'all', ids),
  ).replace(/^pmtiles:\/\//, '')
  return (
    <Source
      id={LANGUAGE_PREVIEW_SOURCE}
      type="vector"
      promoteId="variant_id"
      tiles={[geometryTileUrl(archiveUrl)]}
      minzoom={0}
      maxzoom={8}
    >
      <Layer
        id="language-preview-fill"
        type="fill"
        source={LANGUAGE_PREVIEW_SOURCE}
        source-layer={sourceLayer}
        paint={{
          'fill-color': '#cb5d3e',
          'fill-opacity': ['case', INSPECTED, selected.length ? 0 : 0.12, 0],
          'fill-opacity-transition': { duration: 0 },
        }}
      />
      <Layer
        id="language-preview-halo"
        type="line"
        source={LANGUAGE_PREVIEW_SOURCE}
        source-layer={sourceLayer}
        paint={{
          'line-color': '#fffdf7',
          'line-width': 5,
          'line-opacity': ['case', INSPECTED, 0.95, 0],
          'line-opacity-transition': { duration: 0 },
        }}
      />
      <Layer
        id="language-preview-outline"
        type="line"
        source={LANGUAGE_PREVIEW_SOURCE}
        source-layer={sourceLayer}
        paint={{
          'line-color': '#392a20',
          'line-width': 2.5,
          'line-opacity': ['case', INSPECTED, 1, 0],
          'line-opacity-transition': { duration: 0 },
        }}
      />
    </Source>
  )
}

/** A request is an explicit click/Enter, so filters, hover, and manual pans never recenter. */
export const LanguageMapCamera = () => {
  const { current } = useMap()
  const map = current?.getMap()
  const request = useAtomValue(languageMapNavigationAtom)
  const store = useStore()
  useEffect(() => {
    if (!map || !request) return
    let cancelled = false
    map.stop()
    const navigate = async () => {
      const data = await store.get(atlasDataAtom)
      if (cancelled) return
      const variants = targetGeometry(
        request.target,
        data,
        store.get(geographyAvailabilityAtom),
        store.get(searchCoverageAtom),
        store.get(languageHierarchyAtom),
        store.get(mapEntriesAtom),
      )
      if (!variants.length) return
      const index = await loadGeometryBounds(data.manifest)
      if (cancelled) return
      const currentVariants = targetGeometry(
        request.target,
        data,
        store.get(geographyAvailabilityAtom),
        store.get(searchCoverageAtom),
        store.get(languageHierarchyAtom),
        store.get(mapEntriesAtom),
      )
      if (
        JSON.stringify(variants.map(({ id }) => id)) !==
        JSON.stringify(currentVariants.map(({ id }) => id))
      )
        return
      const bounds = variants.map(({ id }) => index[id])
      if (bounds.some((bound) => !bound)) return
      const extent = combinedBounds(bounds.filter((bound) => bound !== undefined))
      if (!extent) return
      const canvas = map.getCanvas()
      const areaBounds: [[number, number], [number, number]] = [
        [extent[0], extent[1]],
        [extent[2], extent[3]],
      ]
      const padding = Math.min(48, canvas.clientWidth / 8, canvas.clientHeight / 8)
      const camera = map.cameraForBounds(areaBounds, { padding })
      if (camera?.zoom === undefined) return
      map.fitBounds(areaBounds, {
        padding,
        // Leave room for the surrounding region, even for a very small footprint.
        maxZoom: Math.max(map.getMinZoom(), Math.min(6, camera.zoom - 1)),
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450,
      })
    }
    // A failed optional camera index must not interrupt inspecting or selecting languages.
    void navigate().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [map, request, store])
  return null
}
