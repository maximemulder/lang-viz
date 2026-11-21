import type { FeatureCollection, Point } from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Source, useMap } from 'react-map-gl/maplibre'
import {
  type GeometryProfile,
  type LanguageLabelProfile,
  loadLanguageLabels,
} from '../../../data/languageLabels.ts'
import type { MapArea } from '../../../domain/aggregation.ts'
import type { AtlasData } from '../../../domain/atlas.ts'
import { type GeometryDisplayState, geometryDisplay } from '../geometry/display.ts'
import { visibleColorLayers, visibleVariantIds } from '../inspection.ts'
import { type OverlapSelection, parseOverlapSelection } from '../overlap/types.ts'
import { labelViewport } from './labelViewport.ts'
import {
  languageLabelTree,
  type PlacedLanguageLabel,
  selectLanguageLabels,
} from './languageLabelSelection.ts'
import { MapLabelLayer } from './MapLabelLayer.tsx'

type Labels = FeatureCollection<
  Point,
  { labelId: string; labelName: string; labelRank: number; variantId: string; overview: boolean }
>

const ISOLATION_LAYER = 'isolated-language-fill'
const MAX_COVERAGE_PROBES = 240

function useLabelProfiles(data: AtlasData, variantIds: readonly string[]) {
  const requested = useMemo(() => {
    const selected = new Set(
      variantIds.flatMap((id) => {
        const variant = data.variantById.get(id)
        return variant ? [JSON.stringify([variant.datasetId, variant.temporalCoverage.viewId])] : []
      }),
    )
    return (data.manifest.geometryProfiles ?? []).filter(
      (profile): profile is GeometryProfile & { labels: string } =>
        !!profile.labels && selected.has(JSON.stringify([profile.datasetId, profile.viewId])),
    )
  }, [data, variantIds])
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LanguageLabelProfile>>(() => new Map())
  useEffect(() => {
    let active = true
    for (const profile of requested) {
      void loadLanguageLabels(profile)
        .then((table) => {
          if (active) {
            setLoaded((previous) =>
              previous.get(profile.labels) === table
                ? previous
                : new Map(previous).set(profile.labels, table),
            )
          }
        })
        .catch(() => {
          // Older and partially available data releases can still render their geometry.
        })
    }
    return () => {
      active = false
    }
  }, [requested])
  return useMemo(
    () =>
      requested.flatMap(({ labels }) => {
        const profile = loaded.get(labels)
        return profile ? [profile] : []
      }),
    [loaded, requested],
  )
}

export function LanguageLabels({
  data,
  areas,
  selectionKey,
  isolation,
}: {
  readonly data: AtlasData
  readonly areas: readonly MapArea[]
  readonly selectionKey: string
  readonly isolation: { readonly languageId: string; readonly variantIds: readonly string[] } | null
}) {
  const map = useMap().current?.getMap()
  const isolatedIds = isolation?.variantIds
  const isolatedLanguageId = isolation?.languageId
  const selection = useMemo<OverlapSelection>(
    () => (isolatedIds ? { variantIds: isolatedIds } : parseOverlapSelection(selectionKey)),
    [isolatedIds, selectionKey],
  )
  const profiles = useLabelProfiles(data, selection.variantIds)
  const roots = useMemo(
    () =>
      languageLabelTree(
        profiles,
        data.languageById,
        selection.variantIds,
        isolatedLanguageId ? { isolatedLanguageId } : { areas },
      ),
    [profiles, data, selection.variantIds, isolatedLanguageId, areas],
  )
  const previous = useRef<ReadonlyMap<string, PlacedLanguageLabel>>(new Map())
  const [placed, setPlaced] = useState<{ selection: OverlapSelection; labels: Labels } | null>(null)

  useEffect(() => {
    if (!map || !roots.size) return
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    const display = geometryDisplay(map)
    let frame: number | undefined
    let lastLayout: { geometry: GeometryDisplayState; inputs: string } | undefined
    const update = () => {
      frame = undefined
      if (map.isMoving()) return
      const zoom = map.getZoom()
      const geometry = display.getSnapshot()
      const lod = Math.min(
        data.manifest.geometryMaxZoom ?? 8,
        isolatedIds ? Math.floor(zoom) : geometry.zoom,
      )
      const layers = isolatedIds
        ? [ISOLATION_LAYER].filter((layer) => map.getLayer(layer))
        : geometry.selectionKey === selectionKey
          ? visibleColorLayers(map)
          : []
      const canvas = map.getCanvas()
      const center = map.getCenter()
      const inputs = [
        center.lng,
        center.lat,
        zoom,
        lod,
        map.getPitch(),
        map.getBearing(),
        map.getProjection().type,
        canvas.clientWidth,
        canvas.clientHeight,
        map.areTilesLoaded(),
        ...layers,
      ].join('|')
      // Publishing the label source can emit another idle event with identical
      // coverage and camera. Recheck when the committed tiles or their readiness change.
      if (lastLayout?.geometry === geometry && lastLayout.inputs === inputs) return
      lastLayout = { geometry, inputs }
      const { screenPoint, textBox } = labelViewport(map, context)
      const probeStride = 2 * canvas.clientWidth + 1
      const ownership = new Map<number, readonly string[]>()
      const visibleAt = (x: number, y: number) => {
        const key = Math.round(x * 2) + Math.round(y * 2) * probeStride
        const cached = ownership.get(key)
        if (cached) return cached
        if (ownership.size >= MAX_COVERAGE_PROBES) return []
        const visible = visibleVariantIds(
          map,
          [x, y],
          selection.refinements,
          selection.variantGroups,
          layers,
        )
        ownership.set(key, visible)
        return visible
      }
      const before = previous.current
      const next = layers.length
        ? selectLanguageLabels(
            roots,
            zoom,
            lod,
            {
              point: screenPoint,
              project: (language, { anchor }, spansAreas) =>
                textBox(anchor, language.name, spansAreas),
              visibleAt,
            },
            before,
          )
        : new Map<string, PlacedLanguageLabel>()
      previous.current = next
      const unchanged =
        before.size === next.size &&
        [...next].every(([id, { choice, variantId, overview }]) => {
          const prior = before.get(id)
          return (
            prior?.choice === choice && prior.variantId === variantId && prior.overview === overview
          )
        })
      if (unchanged) return
      setPlaced({
        selection,
        labels: {
          type: 'FeatureCollection',
          features: [...next.values()].map(
            ({ language, choice: { anchor }, variantId, overview }, rank) => ({
              type: 'Feature',
              id: language.id,
              geometry: { type: 'Point', coordinates: [anchor[0], anchor[1]] },
              properties: {
                labelId: language.id,
                labelName: language.name,
                labelRank: rank + (overview ? next.size : 0),
                variantId,
                overview,
              },
            }),
          ),
        },
      })
    }
    const schedule = () => {
      frame ??= requestAnimationFrame(update)
    }
    const reload = () => {
      lastLayout = undefined
      schedule()
    }
    const events = ['idle', 'moveend', 'resize'] as const
    for (const event of events) map.on(event, schedule)
    map.on('style.load', reload)
    map.on('projectiontransition', reload)
    const unsubscribe = display.subscribe(schedule)
    schedule()
    return () => {
      for (const event of events) map.off(event, schedule)
      map.off('style.load', reload)
      map.off('projectiontransition', reload)
      unsubscribe()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [data, isolatedIds, map, roots, selection, selectionKey])

  const labels = placed?.selection === selection ? placed.labels : undefined
  if (!roots.size || !labels?.features.length) return null
  return (
    <Source id="language-labels" type="geojson" data={labels}>
      <MapLabelLayer id="language-labels" singleLine />
    </Source>
  )
}
