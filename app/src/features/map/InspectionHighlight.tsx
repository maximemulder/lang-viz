import { useAtomValue } from 'jotai'
import { useLayoutEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { atlasDataAtom, selectedMapAreasAtom } from '../../state/atlasState'
import { createInspectionHighlight } from './inspectionHighlight'
import { UnionOutline } from './UnionOutline'

/** Hover updates stay outside the large, memoized language/coverage layer tree. */
export const InspectionHighlight = ({ variantIds }: { readonly variantIds: readonly string[] }) => {
  const { current } = useMap()
  const map = current?.getMap()
  const sourceLayer = useAtomValue(atlasDataAtom).manifest.vectorLayer
  const areas = useAtomValue(selectedMapAreasAtom)
  const contributors = variantIds.map(
    (id) => areas.find((area) => area.id === id)?.variants.map((variant) => variant.id) ?? [id],
  )
  const directIds = contributors.flatMap((ids) => (ids.length === 1 ? ids : []))
  const aggregates = contributors.filter((ids) => ids.length > 1)
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
    highlightRef.current?.set(directIds)
  }, [map, sourceLayer, directIds])

  return <UnionOutline id="language-inspection" groups={aggregates} />
}
