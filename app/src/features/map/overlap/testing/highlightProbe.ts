import type { Map as MapLibreMap } from 'maplibre-gl'
import { inspectionLineOpacity } from '../../geometry/boundaryInspection.ts'
import { geometryDisplay } from '../../geometry/display.ts'
import { boundaryFilter } from '../../geometryBoundaries.ts'

/** Require loaded line geometry through the actual outline filters. Registered
 * props identify the requested groups, but cannot establish that they loaded.
 */
export const highlightBoundaryEvidence = (map: MapLibreMap, id: string) => {
  const highlight = geometryDisplay(map).highlights.get(id)
  if (!highlight?.visible) return { variantIds: [], boundaryFeatures: 0 }
  const groups = highlight.groups.filter((group) => group.length)
  const found = new Set<number>()
  let boundaryFeatures = 0
  for (const layerId of [`${highlight.layerId}-outline`, `${highlight.layerId}-fallback-outline`]) {
    const layer = map.getLayer(layerId)
    const filter = layer && map.getFilter(layerId)
    if (
      layer?.type !== 'line' ||
      layer.source !== highlight.source ||
      !layer.sourceLayer ||
      (highlight.featureState
        ? filter != null ||
          JSON.stringify(map.getPaintProperty(layerId, 'line-opacity')) !==
            JSON.stringify(inspectionLineOpacity)
        : !filter || JSON.stringify(filter) !== JSON.stringify(boundaryFilter(highlight.groups))) ||
      map.getLayoutProperty(layerId, 'visibility') === 'none' ||
      (!highlight.featureState && Number(map.getPaintProperty(layerId, 'line-opacity')) <= 0) ||
      Number(map.getPaintProperty(layerId, 'line-width')) <= 0
    )
      return { variantIds: [], boundaryFeatures: 0 }
    for (const feature of map.querySourceFeatures(highlight.source, {
      sourceLayer: layer.sourceLayer,
      filter: highlight.featureState || !filter ? boundaryFilter(highlight.groups) : filter,
    })) {
      if (
        highlight.featureState &&
        (feature.id === undefined ||
          map.getFeatureState({
            source: highlight.source,
            sourceLayer: layer.sourceLayer,
            id: feature.id,
          }).inspected !== true)
      )
        continue
      const geometry = feature.geometry
      const lines =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : []
      if (!lines.some((line) => line.some((p) => p[0] !== line[0]?.[0] || p[1] !== line[0]?.[1])))
        continue
      let matches = false
      groups.forEach((group, index) => {
        if (
          group.some((member) => feature.properties[`l:${member}`]) !==
          group.some((member) => feature.properties[`r:${member}`])
        ) {
          found.add(index)
          matches = true
        }
      })
      if (matches) boundaryFeatures++
    }
  }
  return {
    variantIds: groups.length && found.size === groups.length ? [...highlight.variants] : [],
    boundaryFeatures,
  }
}
