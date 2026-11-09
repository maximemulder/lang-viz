import { useAtomValue } from 'jotai'
import { useLayoutEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { inspectedSourceVariantIds } from '../../domain/aggregation'
import { atlasDataAtom, selectedMapAreasAtom } from '../../state/atlasState'
import { createInspectionHighlight } from './inspectionHighlight'

/** Hover updates stay outside the large, memoized language/coverage layer tree. */
export const InspectionHighlight = ({ variantIds }: { readonly variantIds: readonly string[] }) => {
  const { current } = useMap()
  const map = current?.getMap()
  const sourceLayer = useAtomValue(atlasDataAtom).manifest.vectorLayer
  const areas = useAtomValue(selectedMapAreasAtom)
  const highlightRef = useRef<ReturnType<typeof createInspectionHighlight> | null>(null)

  useLayoutEffect(() => {
    if (!map) return
    const highlight = createInspectionHighlight(map, 'language-areas', sourceLayer)
    highlightRef.current = highlight
    return () => {
      highlight.dispose()
      highlightRef.current = null
    }
  }, [map, sourceLayer])

  useLayoutEffect(() => {
    if (!map || !sourceLayer) return
    highlightRef.current?.set(inspectedSourceVariantIds(variantIds, areas))
  }, [map, sourceLayer, variantIds, areas])

  return null
}
