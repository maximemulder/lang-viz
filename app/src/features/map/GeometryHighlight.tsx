import { Fragment, useLayoutEffect } from 'react'
import { Layer } from 'react-map-gl/maplibre'
import { useGeometryDisplay } from './geometry/display'
import { BOUNDARY_LAYER, boundaryFilter, FALLBACK_BOUNDARY_LAYER } from './geometryBoundaries'
import { COVERAGE_LAYER } from './overlap/delivery'

/** Outline and fill share a source, tile retention, coordinates and revision. */
export const GeometryHighlight = ({
  id,
  source,
  groups,
  variants = [],
  halo = false,
  fillOpacity = 0,
  visible = true,
}: {
  readonly id: string
  readonly source: string
  readonly groups: readonly (readonly string[])[]
  readonly variants?: readonly string[]
  readonly halo?: boolean
  readonly fillOpacity?: number
  readonly visible?: boolean
}) => {
  const { display } = useGeometryDisplay()
  // Source changes remount this component. Unique layer IDs prevent the outgoing
  // Layer effects from removing the incoming source's outlines after it renders.
  const layerId = `${id}-${source}`
  useLayoutEffect(() => {
    display.highlights.set(id, { layerId, source, groups, variants, visible })
    return () => {
      display.highlights.delete(id)
    }
  }, [display, id, layerId, source, groups, variants, visible])
  const filter = boundaryFilter(groups)
  return (
    <>
      {halo && fillOpacity > 0 && (
        <Layer
          id={`${layerId}-fill`}
          source={source}
          source-layer={COVERAGE_LAYER}
          type="fill"
          paint={{
            'fill-color': '#cb5d3e',
            'fill-opacity': visible ? fillOpacity : 0,
            'fill-opacity-transition': { duration: 0 },
          }}
        />
      )}
      {[BOUNDARY_LAYER, FALLBACK_BOUNDARY_LAYER].map((layer, index) => (
        <Fragment key={layer}>
          {halo && (
            <Layer
              id={`${layerId}${index ? '-fallback' : ''}-halo`}
              source={source}
              source-layer={layer}
              type="line"
              filter={filter}
              paint={{
                'line-color': '#fffdf7',
                'line-width': 5,
                'line-opacity': visible ? 0.95 : 0,
                'line-opacity-transition': { duration: 0 },
              }}
            />
          )}
          <Layer
            id={`${layerId}${index ? '-fallback' : ''}-outline`}
            source={source}
            source-layer={layer}
            type="line"
            filter={filter}
            paint={{
              'line-color': halo ? '#392a20' : '#111111',
              'line-width': halo ? 2.5 : 3,
              'line-opacity': visible ? 0.95 : 0,
              'line-opacity-transition': { duration: 0 },
            }}
          />
        </Fragment>
      ))}
    </>
  )
}
