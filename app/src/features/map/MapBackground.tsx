import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { applyBackground, type BackgroundMode } from './geographicBasemap'

export const MapBackground = ({ mode }: { readonly mode: BackgroundMode }) => {
  const { current } = useMap()

  useEffect(() => {
    if (!current) return
    const map = current.getMap()
    let applying = false
    const sync = () => {
      if (applying) return
      applying = true
      try {
        applyBackground(map, mode)
      } finally {
        applying = false
      }
    }
    sync()
    // Reapply after an initial load or a full style replacement, as well as a selection change.
    map.on('styledata', sync)
    return () => {
      map.off('styledata', sync)
    }
  }, [current, mode])

  return null
}
