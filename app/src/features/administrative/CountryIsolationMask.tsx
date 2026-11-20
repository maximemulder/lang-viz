import type { FeatureCollection } from 'geojson'
import { useStore } from 'jotai'
import { useEffect, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { readyRegionMaskAtom } from '../../state/mapInteraction.ts'

const SOURCE_ID = 'country-outside-mask'

export function CountryIsolationMask({
  featureIds,
  geometry,
}: {
  readonly featureIds: readonly string[]
  readonly geometry: FeatureCollection
}) {
  const { current } = useMap()
  const store = useStore()
  const [mask, setMask] = useState<FeatureCollection | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (retry) setError('')
    let active = true
    const worker = new Worker(new URL('./countryMask.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }) => {
      if (!active) return
      if (data.error) setError(data.error)
      else setMask(data.mask)
    }
    worker.onerror = () => {
      if (active) setError('The region mask could not be prepared.')
    }
    const selected = new Set(featureIds)
    worker.postMessage(
      geometry.features
        .filter((feature) => selected.has(String(feature.properties?.featureId)))
        .map((feature) => feature.geometry),
    )
    return () => {
      active = false
      worker.terminate()
    }
  }, [geometry, featureIds, retry])

  useEffect(() => {
    const map = current?.getMap()
    if (!map || !mask) return
    const ready = () => {
      if (map.getSource(SOURCE_ID) && map.isSourceLoaded(SOURCE_ID))
        store.set(readyRegionMaskAtom, featureIds)
    }
    map.on('sourcedata', ready)
    ready()
    return () => {
      map.off('sourcedata', ready)
      if (store.get(readyRegionMaskAtom) === featureIds) store.set(readyRegionMaskAtom, null)
    }
  }, [current, featureIds, mask, store])

  if (error)
    return (
      <div className="administrative-map-status" role="alert">
        {error}{' '}
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry
        </button>
      </div>
    )
  if (!mask) return null
  return (
    <Source id={SOURCE_ID} type="geojson" data={mask}>
      <Layer
        id="country-outside-mask-fill"
        type="fill"
        beforeId="administrative-boundary-halo"
        paint={{ 'fill-color': '#f3f2ec', 'fill-antialias': false }}
      />
    </Source>
  )
}
