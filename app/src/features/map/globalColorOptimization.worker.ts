import type { AtlasData } from '../../domain/atlas'
import {
  buildGlobalColorInput,
  type GlobalColorProfile,
  optimizeGlobalColors,
} from '../../domain/globalColors'

export interface GlobalColorRequest {
  readonly data: AtlasData
  readonly profile: GlobalColorProfile
  readonly dataUrl: string
}

self.onmessage = async ({ data: { data, profile, dataUrl } }: MessageEvent<GlobalColorRequest>) => {
  try {
    const { input } = await buildGlobalColorInput(data, profile, async (path) => {
      const response = await fetch(new URL(path, dataUrl))
      if (!response.ok) throw new Error('Could not load full-dataset geometry. Try again.')
      return new Uint8Array(await response.arrayBuffer())
    })
    self.postMessage({ result: optimizeGlobalColors(input, profile) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
