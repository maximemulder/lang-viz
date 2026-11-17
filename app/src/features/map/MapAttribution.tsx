import { useEffect } from 'react'
import { AttributionControl, useMap } from 'react-map-gl/maplibre'

/** Keep fixed map information available independently of source visibility. */
export function MapAttribution({ attribution }: { readonly attribution: string }) {
  const { current } = useMap()

  useEffect(() => {
    const map = current?.getMap()
    if (!map) return

    const collapse = () => {
      const control = map
        .getContainer()
        .querySelector<HTMLElement>('.maplibregl-ctrl-attrib.maplibregl-compact-show')
      const button = control?.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button')
      if (!button) return
      button.click()
      map.off('styledata', collapse)
      map.off('sourcedata', collapse)
    }

    // MapLibre initially expands compact attribution and offers no initial-open
    // option. Close it once the control has source credits; later clicks belong
    // to the user.
    map.on('styledata', collapse)
    map.on('sourcedata', collapse)
    collapse()
    return () => {
      map.off('styledata', collapse)
      map.off('sourcedata', collapse)
    }
  }, [current])

  return <AttributionControl position="bottom-right" compact customAttribution={attribution} />
}
