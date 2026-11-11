import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo } from 'react'
import { Layer, Marker, Source, useMap } from 'react-map-gl/maplibre'
import type { EtymologyRepository, WordTrail } from '../../domain/etymology.ts'
import { isCurrentTrailFocus } from '../../domain/explorerSession.ts'
import { combinedBounds } from '../../domain/languageFocus.ts'
import { trailLineFeatures, trailLocations } from '../../domain/wordTrailGeography.ts'
import { etymologyRepositoryAtom } from '../../state/etymologyData.ts'
import {
  atlasWordTrailAtom,
  explorerActionAtom,
  explorerSessionAtom,
} from '../../state/explorerState.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { startTrailCamera } from './trailCamera.ts'
import './wordTrailMap.css'

export const WordTrailLayer = () => {
  const repository = useAtomValue(etymologyRepositoryAtom)
  const trail = useAtomValue(atlasWordTrailAtom)
  return repository && trail ? <TrailLayer repository={repository} trail={trail} /> : null
}

const TrailLayer = ({
  repository: { data },
  trail,
}: {
  readonly repository: EtymologyRepository
  readonly trail: WordTrail
}) => {
  const session = useAtomValue(explorerSessionAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const store = useStore()
  const dispatch = useSetAtom(explorerActionAtom)
  const { current } = useMap()
  const map = current?.getMap()
  const points = useMemo(() => trailLocations(data, trail), [data, trail])
  const lines = useMemo(() => trailLineFeatures(data, trail), [data, trail])
  const bounds = useMemo(
    () =>
      combinedBounds(
        points.flatMap(({ language }) =>
          language?.lon !== null && language?.lon !== undefined && language.lat !== null
            ? [[language.lon, language.lat, language.lon, language.lat] as const]
            : [],
        ),
      ),
    [points],
  )
  const request = session.overlay.focusRequest
  useEffect(() => {
    if (!map || !request || intent !== request) return
    return startTrailCamera({
      map,
      bounds,
      isCurrent: () =>
        isCurrentTrailFocus(store.get(explorerSessionAtom), request) &&
        store.get(mapCameraIntentAtom) === request,
      canStop: () => !store.get(mapCameraIntentAtom) || store.get(mapCameraIntentAtom) === request,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      frames: {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (id) => window.cancelAnimationFrame(id),
      },
    })
  }, [map, request, intent, store, bounds])
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
          paint={{ 'line-color': ['get', 'color'], 'line-width': 3 }}
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
                className={`word-map-marker${ids.includes(session.trail.root ?? '') ? ' is-root' : ''}`}
                data-lexical-language={languageId}
                title={`${language.name}: ${ids.map((id) => data.lexemes[id]?.f).join(', ')}. Inspect a form; all stages are listed in the trail panel.`}
                aria-label={`Inspect ${language.name}: ${ids.map((id) => data.lexemes[id]?.f).join(', ')}`}
                onMouseMove={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  const id = ids[0]
                  if (id) dispatch({ type: 'inspect-trail-word', id })
                }}
              >
                <span aria-hidden="true" />
                {language.name}
              </button>
            </Marker>
          ),
      )}
    </>
  )
}
