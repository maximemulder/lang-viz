import { addProtocol } from 'maplibre-gl'
import { requestSourceTile } from '../features/map/overlap/fallbackProtocol.ts'

/** Source reads and multi-profile MVT assembly run off the UI thread. */
addProtocol('language-areas', async ({ url }, controller) => {
  const [path = '', query] = url.split('?')
  const [z, x, y] = path.slice('language-areas://'.length).split('/').map(Number)
  const archiveUrl = new URLSearchParams(query).get('archive')
  if (
    z === undefined ||
    x === undefined ||
    y === undefined ||
    ![z, x, y].every(Number.isInteger) ||
    !archiveUrl
  )
    throw new Error('Invalid language tile URL')
  const data = await requestSourceTile(archiveUrl, { z, x, y }, controller.signal)
  return { data }
})

export const geometryTileUrl = (archiveUrl: string) =>
  `language-areas://{z}/{x}/{y}?archive=${encodeURIComponent(archiveUrl)}`
