import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { loadGeometryBounds } from '../../data/atlasRepository'
import type { GeographicBounds } from '../../domain/languageFocus'
import { atlasDataAtom, selectedMapAreasAtom } from '../../state/atlasState'
import { mapIsolationAtom } from '../../state/mapInteraction.ts'
import { familyLabels, type LanguageLabel, visibleLanguageLabels } from './languageLabels.ts'

/** Labels progressively reveal the catalog; no language geometry is hidden or replaced. */
export function LanguageZoom() {
  const data = useAtomValue(atlasDataAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const { current } = useMap()
  const map = current?.getMap()
  const [bounds, setBounds] = useState<Readonly<Record<string, GeographicBounds>>>({})
  const [view, setView] = useState({ zoom: 0, width: 0, height: 0, revision: 0 })
  useEffect(() => {
    let cancelled = false
    void loadGeometryBounds(data.manifest)
      .then((index) => {
        if (!cancelled) setBounds(index)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [data.manifest])
  useEffect(() => {
    if (!map) return
    const sync = () =>
      setView((previous) => ({
        zoom: map.getZoom(),
        width: map.getCanvas().clientWidth,
        height: map.getCanvas().clientHeight,
        revision: previous.revision + 1,
      }))
    sync()
    map.on('moveend', sync)
    map.on('resize', sync)
    return () => {
      map.off('moveend', sync)
      map.off('resize', sync)
    }
  }, [map])
  const labels = useMemo(() => {
    const extents = new Map<string, number>()
    for (const area of areas) {
      for (const variant of area.variants) {
        const box = bounds[variant.id]
        if (!box) continue
        const extent = Math.max(
          0.001,
          (box[2] - box[0]) *
            (box[3] - box[1]) *
            Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180),
        )
        extents.set(variant.languageId, Math.max(extents.get(variant.languageId) ?? 0, extent))
      }
    }
    const candidates: LanguageLabel[] = []
    for (const [id, area] of extents) {
      if (isolation?.kind === 'language' && isolation.id !== id) continue
      const language = data.languageById.get(id)
      if (
        !language ||
        language.level === 'family' ||
        language.longitude === null ||
        language.latitude === null
      )
        continue
      candidates.push({
        id,
        name: language.name,
        longitude: language.longitude,
        latitude: language.latitude,
        area,
        familyId: language.familyId,
        familyName: language.familyName,
        kind: 'language',
      })
    }
    return candidates
  }, [data, areas, bounds, isolation])
  const families = useMemo(
    () =>
      familyLabels(
        map
          ? labels.filter((label) => {
              const point = map.project([label.longitude, label.latitude])
              return (
                point.x >= 35 &&
                point.x <= view.width - 35 &&
                point.y >= 30 &&
                point.y <= view.height - 30
              )
            })
          : [],
      ),
    [map, labels, view],
  )
  const overview = view.zoom < 2.6 && !isolation
  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: map
        ? visibleLanguageLabels(
            overview ? families : labels,
            view.zoom,
            view.width,
            view.height,
            (label) => map.project([label.longitude, label.latitude]),
          ).map((label) => ({
            type: 'Feature' as const,
            properties: { name: label.name, kind: label.kind ?? 'language', priority: -label.area },
            geometry: { type: 'Point' as const, coordinates: [label.longitude, label.latitude] },
          }))
        : [],
    }),
    [map, labels, families, overview, view],
  )
  return (
    <Source id="language-zoom-labels" type="geojson" data={geojson}>
      <Layer
        id="language-names"
        type="symbol"
        layout={{
          'text-field': ['get', 'name'],
          'text-font': ['Arial', 'sans-serif'],
          'text-size': overview ? 13 : 12,
          'text-padding': overview ? 12 : 8,
          'text-max-width': overview ? 16 : 10,
          'symbol-sort-key': ['get', 'priority'],
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.5,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        }}
        paint={{ 'text-color': '#233d34', 'text-halo-color': '#fffdf5', 'text-halo-width': 1.8 }}
      />
    </Source>
  )
}
