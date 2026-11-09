import { useAtomValue } from 'jotai'
import { Layer, Source } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../data/atlasRepository'
import { selectGeometryArchives } from '../../data/geometryArchives'
import { outlineTileUrl } from '../../data/outlineProtocol'
import { atlasDataAtom } from '../../state/atlasState'
import { OUTLINE_LAYER, outlineGroupsKey } from './outlineSelection'

export const UnionOutline = ({
  id,
  groups,
  halo = false,
  fillOpacity = 0,
}: {
  readonly id: string
  readonly groups: readonly (readonly string[])[]
  readonly halo?: boolean
  readonly fillOpacity?: number
}) => {
  const data = useAtomValue(atlasDataAtom)
  const key = outlineGroupsKey(groups)
  const ids = [...new Set(groups.flat())]
  if (!ids.length) return null
  const archiveUrl = languageArchiveUrl(
    selectGeometryArchives(data.manifest, data.variants, [], 'all', ids),
  ).replace(/^pmtiles:\/\//, '')
  const sourceId = `${id}-boundary`
  return (
    <Source
      key={key}
      id={sourceId}
      type="vector"
      tiles={[outlineTileUrl(archiveUrl, data.manifest.vectorLayer, groups)]}
      minzoom={0}
      maxzoom={data.manifest.geometryMaxZoom ?? 8}
    >
      {halo && (
        <Layer
          id={`${id}-fill`}
          type="fill"
          source-layer={OUTLINE_LAYER}
          paint={{
            'fill-color': '#cb5d3e',
            'fill-opacity': fillOpacity,
            'fill-opacity-transition': { duration: 0 },
          }}
        />
      )}
      {halo && (
        <Layer
          id={`${id}-halo`}
          type="line"
          source-layer={OUTLINE_LAYER}
          paint={{ 'line-color': '#fffdf7', 'line-width': 5, 'line-opacity': 0.95 }}
        />
      )}
      <Layer
        id={`${id}-outline`}
        type="line"
        source-layer={OUTLINE_LAYER}
        paint={{
          'line-color': halo ? '#392a20' : '#111111',
          'line-width': halo ? 2.5 : 3,
          'line-opacity': halo ? 1 : 0.95,
        }}
      />
    </Source>
  )
}
