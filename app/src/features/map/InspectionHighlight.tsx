import { useAtomValue } from 'jotai'
import { useLayoutEffect, useRef } from 'react'
import { selectedMapAreasAtom } from '../../state/atlasState'
import { createBoundaryInspection, inspectionLayerId } from './geometry/boundaryInspection'
import { useGeometryDisplay } from './geometry/display'

/** Picking and outlines reference the same committed source, including fallback. */
export const InspectionHighlight = ({ variantIds }: { readonly variantIds: readonly string[] }) => {
  const areas = useAtomValue(selectedMapAreasAtom)
  const { map, display, state } = useGeometryDisplay()
  const inspection = useRef<ReturnType<typeof createBoundaryInspection> | null>(null)
  const variants = variantIds.flatMap(
    (id) => areas.find((area) => area.id === id)?.variants.map((variant) => variant.id) ?? [id],
  )
  useLayoutEffect(() => {
    if (!map || !state.source) return
    const controller = createBoundaryInspection(map, state.source)
    inspection.current = controller
    return () => {
      controller.dispose()
      inspection.current = null
    }
  }, [map, state.source])
  useLayoutEffect(() => {
    const groups = variantIds.map((id) => [id])
    inspection.current?.set(groups)
    if (!state.source) return
    display.highlights.set('language-inspection', {
      layerId: inspectionLayerId(state.source),
      source: state.source,
      groups,
      variants,
      visible: true,
      featureState: true,
    })
    return () => {
      display.highlights.delete('language-inspection')
    }
  }, [display, state.source, variantIds, variants])
  return null
}
