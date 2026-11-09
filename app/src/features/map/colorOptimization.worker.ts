import { type ColorOptimizationInput, optimizeColors } from '../../domain/colorOptimization'

self.onmessage = ({ data }: MessageEvent<ColorOptimizationInput>) => {
  try {
    self.postMessage({ result: optimizeColors(data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
