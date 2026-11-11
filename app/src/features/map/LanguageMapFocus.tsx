import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { loadGeometryBounds } from '../../data/atlasRepository'
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
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { searchCoverageAtom } from '../../state/searchSelection'
import { GeometryHighlight } from './GeometryHighlight'
import { useGeometryDisplay } from './geometry/display'
import { GeometryPreview } from './geometry/GeometryPreview'

/** Independent tiles and paint keep previews out of selected coverage/cache identities. */
export const LanguageMapPreview = ({ mapInspectionActive }: { mapInspectionActive: boolean }) => {
  const data = useAtomValue(atlasDataAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const selected = useAtomValue(selectedMapAreasAtom)
  const { state } = useGeometryDisplay()
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
  if (!ids.length) return null
  const groupEntries = target?.groupId
    ? new Set(
        entries.filter((entry) => entry.group?.id === target.groupId).map((entry) => entry.id),
      )
    : null
  const candidates = selected.filter((area) =>
    target?.entryId
      ? area.id === target.entryId
      : groupEntries
        ? groupEntries.has(area.id)
        : area.variants.every((variant) => ids.includes(variant.id)),
  )
  const represented = [
    ...new Set(candidates.flatMap((area) => area.variants.map((variant) => variant.id))),
  ].sort()
  if (
    state.source &&
    (state.snapshot?.composed || candidates.length === 1) &&
    JSON.stringify(represented) === JSON.stringify(ids)
  )
    return (
      <GeometryHighlight
        key={state.source}
        id="language-preview"
        source={state.source}
        groups={[candidates.map((area) => area.id)]}
        variants={ids}
        halo
      />
    )
  return (
    <GeometryPreview key={JSON.stringify(ids)} ids={ids} fillOpacity={selected.length ? 0 : 0.12} />
  )
}

/** A request is an explicit click/Enter, so filters, hover, and manual pans never recenter. */
export const LanguageMapCamera = () => {
  const { current } = useMap()
  const map = current?.getMap()
  const request = useAtomValue(languageMapNavigationAtom)
  const store = useStore()
  const intent = useAtomValue(mapCameraIntentAtom)
  useEffect(() => {
    if (!map || !request || intent !== request) return
    let cancelled = false
    let moved = false
    const settled = () => {
      moved = false
    }
    map.on('moveend', settled)
    const current = () => !cancelled && store.get(mapCameraIntentAtom) === request
    map.stop()
    const navigate = async () => {
      const data = await store.get(atlasDataAtom)
      if (!current()) return
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
      if (!current()) return
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
      if (!current()) return
      moved = true
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
      map.off('moveend', settled)
      if (moved && (!store.get(mapCameraIntentAtom) || store.get(mapCameraIntentAtom) === request))
        map.stop()
    }
  }, [map, request, store, intent])
  return null
}
