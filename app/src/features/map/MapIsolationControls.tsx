import { useAtomValue, useSetAtom } from 'jotai'
import {
  clearMapIsolationAtom,
  mapIsolationAtom,
  setIsolationColorAtom,
} from '../../state/mapInteraction.ts'

export function MapIsolationControls() {
  const isolation = useAtomValue(mapIsolationAtom)
  const clear = useSetAtom(clearMapIsolationAtom)
  const setColor = useSetAtom(setIsolationColorAtom)
  if (!isolation) return null
  return (
    <section className="map-isolation" aria-label="Map isolation">
      <strong>Only {isolation.label}</strong>
      {isolation.kind === 'language' && (
        <label>
          Colour
          <input
            type="color"
            aria-label="Isolation colour"
            value={isolation.color}
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        </label>
      )}
      <button type="button" onClick={() => clear()}>
        End isolation
      </button>
    </section>
  )
}
