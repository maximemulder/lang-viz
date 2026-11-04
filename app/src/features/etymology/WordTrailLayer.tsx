import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { Layer, Marker, Source, useMap } from 'react-map-gl/maplibre'
import {
  type AtlasWordTrail,
  atlasWordTrailAtom,
  wordFocusAtom,
  wordViewAtom,
  workspaceAtom,
} from '../../state/explorerState'
import { trailLineFeatures, trailLocations } from './trailGeography'

export const WordTrailLayer = () => {
  const trail = useAtomValue(atlasWordTrailAtom)
  return trail ? <TrailLayer trail={trail} /> : null
}

const TrailLayer = ({ trail: { data, trail, root } }: { readonly trail: AtlasWordTrail }) => {
  const { current: map } = useMap()
  const setFocus = useSetAtom(wordFocusAtom)
  const setView = useSetAtom(wordViewAtom)
  const setWorkspace = useSetAtom(workspaceAtom)
  const points = useMemo(() => trailLocations(data, trail), [data, trail])
  const lines = useMemo(() => trailLineFeatures(data, trail), [data, trail])
  useEffect(() => {
    if (!map || !points.length) return
    const fit = () => {
      const lngs = points.map(({ language }) => language?.lon ?? 0),
        lats = points.map(({ language }) => language?.lat ?? 0)
      const west = Math.min(...lngs),
        east = Math.max(...lngs),
        south = Math.min(...lats),
        north = Math.max(...lats)
      map.resize()
      if (east - west > 180) map.flyTo({ center: [lngs[0] ?? 0, 15], zoom: 1.3, duration: 700 })
      else
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 75, maxZoom: 3.2, duration: 700 },
        )
    }
    // A new map installs its projection during style.load. On an existing map,
    // getStyle() is available even while individual tiles are still loading.
    if (map.getStyle()) fit()
    else map.once('style.load', fit)
    return () => {
      map.off('style.load', fit)
    }
  }, [map, points])
  return (
    <>
      <Source
        id="word-trail-links"
        type="geojson"
        data={lines}
        attribution="Word histories and language focal points: DiACL (Carling, ed.)"
      >
        <Layer
          id="word-trail-casing"
          type="line"
          paint={{ 'line-color': '#fffdf5', 'line-width': 6, 'line-opacity': 0.85 }}
        />
        <Layer
          id="word-trail-lines"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 1,
          }}
        />
      </Source>
      {points.map(
        ({ languageId, ids, language }) =>
          language &&
          language.lon !== null &&
          language.lat !== null && (
            <Marker
              key={languageId}
              longitude={language.lon}
              latitude={language.lat}
              anchor="center"
            >
              <button
                type="button"
                className={`word-map-marker${ids.includes(root) ? ' is-root' : ''}`}
                title={`${language.name}: ${ids.map((id) => data.lexemes[id]?.f).join(', ')}. Open word history.`}
                aria-label={`Explore ${language.name}: ${ids.map((id) => data.lexemes[id]?.f).join(', ')}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setFocus(ids[0] ?? root)
                  setView('history')
                  setWorkspace('etymology')
                }}
              >
                <span />
                {language.name}
              </button>
            </Marker>
          ),
      )}
    </>
  )
}
