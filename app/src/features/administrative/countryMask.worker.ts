import type { Geometry } from 'geojson'
import { countryOutsideMask } from './countryMask.ts'

self.onmessage = async ({ data }: MessageEvent<readonly Geometry[]>) => {
  try {
    self.postMessage({ mask: await countryOutsideMask(data) })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Country view unavailable.',
    })
  }
}
