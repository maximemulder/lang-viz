import { useAtomValue, useSetAtom, useStore } from 'jotai'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { type RefObject, useEffect } from 'react'
import {
  atlasDataAtom,
  colorConfigurationAtom,
  geographyDatasetFilterAtom,
  languageColorsAtom,
  mappedLeafColorRootsAtom,
  overlapModeAtom,
  overlapStatusAtom,
  semanticPaletteAtom,
  temporalViewAtom,
  visibleLanguageIdsAtom,
} from '../../../../state/atlasState'
import { installOverlapTestApi } from './testBridge'

/** Browser fixtures and observers load only with the explicit overlap-test flag. */
export default function OverlapTestControls({
  map,
  configRef,
  refreshRef,
}: {
  readonly map: MapLibreMap
  readonly configRef: RefObject<{ selectionKey: string }>
  readonly refreshRef: RefObject<(() => void) | null>
}) {
  const data = useAtomValue(atlasDataAtom)
  const store = useStore()
  const setMode = useSetAtom(overlapModeAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const setPeriod = useSetAtom(temporalViewAtom)
  const setDatasetFilter = useSetAtom(geographyDatasetFilterAtom)

  useEffect(
    () =>
      installOverlapTestApi(
        map,
        (options) => {
          store.set(mappedLeafColorRootsAtom, [])
          setPeriod('contemporary')
          setDatasetFilter(['asher2007world'])
          setMode('hatching')
          setVisibleIds(
            options.languageIds === 'all'
              ? [
                  ...new Set(
                    data.variants
                      .filter((v) => v.datasetId === 'asher2007world')
                      .map((v) => v.languageId),
                  ),
                ]
              : options.languageIds,
          )
          map.jumpTo({ center: options.center, zoom: options.zoom })
        },
        () => refreshRef.current?.(),
        () => configRef.current.selectionKey,
        {
          configureColors: (config) => store.set(colorConfigurationAtom, config),
          colorState: (ids) => ({
            configuration: store.get(colorConfigurationAtom),
            colors: Object.fromEntries(
              ids.map((id) => [id, store.get(languageColorsAtom).get(id)]),
            ),
            roots: Object.fromEntries(
              ids.map((id) => [id, store.get(semanticPaletteAtom).rootById.get(id)]),
            ),
            mappedLeafRoots: store.get(mappedLeafColorRootsAtom),
          }),
        },
        () => store.get(overlapStatusAtom),
      ),
    [map, data, store, configRef, refreshRef, setPeriod, setDatasetFilter, setMode, setVisibleIds],
  )

  return null
}
