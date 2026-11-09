import { addProtocol } from 'maplibre-gl'
import { outlineGroupsKey } from '../features/map/outlineSelection.ts'
import { FallbackWorkerClient } from '../features/map/overlap/fallbackWorkerClient.ts'

const client = new FallbackWorkerClient(
  () =>
    new Worker(new URL('../features/map/outline.worker.ts', import.meta.url), { type: 'module' }),
)
addProtocol('language-outline', async ({ url }, controller) => {
  const [path = '', query] = url.split('?')
  const [z, x, y] = path.slice('language-outline://'.length).split('/').map(Number)
  const params = new URLSearchParams(query)
  const archiveUrl = params.get('archive')
  const sourceLayer = params.get('layer')
  const groups: unknown = JSON.parse(params.get('groups') ?? 'null')
  if (
    z === undefined ||
    x === undefined ||
    y === undefined ||
    ![z, x, y].every(Number.isInteger) ||
    !archiveUrl ||
    !sourceLayer ||
    !Array.isArray(groups) ||
    !groups.every((group) => Array.isArray(group) && group.every((id) => typeof id === 'string'))
  )
    throw new Error('Invalid language outline URL')
  const data = await client.request(
    { archiveUrl, tile: { z, x, y }, coverage: [], outline: { sourceLayer, groups } },
    controller.signal,
  )
  return { data }
})

export const outlineTileUrl = (
  archiveUrl: string,
  sourceLayer: string,
  groups: readonly (readonly string[])[],
) =>
  `language-outline://{z}/{x}/{y}?archive=${encodeURIComponent(archiveUrl)}&layer=${encodeURIComponent(sourceLayer)}&groups=${encodeURIComponent(outlineGroupsKey(groups))}`

if (import.meta.hot)
  import.meta.hot.dispose(() => client.terminate(new Error('Outline worker reloaded')))
