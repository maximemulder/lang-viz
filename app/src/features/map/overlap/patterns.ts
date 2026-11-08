/** Opaque stripe tiles. Single contributors use native solid fills. */
export class OverlapPatternError extends Error {
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.reason = reason
  }
}

// Keep two-color repeats at 16 px; tighter multi-color repeats bound atlas
// storage while retaining at least three native pixels per color band.
export const patternSize = (contributors: number) => {
  if (!Number.isInteger(contributors) || contributors < 2)
    throw new Error('A stripe pattern needs at least two colors')
  const size = 2 ** Math.ceil(Math.log2(Math.max(16, contributors * 3)))
  if (size > 128)
    throw new OverlapPatternError(
      'pattern-contributors',
      'Too many languages overlap here for this preview. Select fewer languages.',
    )
  return size
}

// Include MapLibre's one-pixel wrap padding on every edge. This bounds source
// image area, not all browser/GPU memory: MapLibre also makes per-tile atlases.
export const patternPixels = (contributors: number) => (patternSize(contributors) + 2) ** 2
export const MAX_PATTERN_PIXELS = 4 * 1024 * 1024

export const checkPatternBudget = (pixels: number, limit = MAX_PATTERN_PIXELS) => {
  if (pixels > limit)
    throw new OverlapPatternError(
      'pattern-memory',
      'Overlap textures exceed the preview memory budget. Zoom in or select fewer languages.',
    )
}

export const stripeImage = (colors: readonly string[]) => {
  const size = patternSize(colors.length)
  const channels = colors.map((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid language color: ${color}`)
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ] as const
  })
  const data = new Uint8Array(size * size * 4)
  const row = new Uint8Array(size * 4)
  for (let x = 0; x < size; x++) {
    const color = channels[Math.floor((x * channels.length) / size)]
    if (color) row.set([...color, 255], x * 4)
  }
  // Every diagonal row is a cyclic shift of the same color band. Copy bytes
  // rather than choosing a color and assigning four channels for every texel.
  for (let y = 0; y < size; y++) {
    data.set(row.subarray(y * 4), y * size * 4)
    data.set(row.subarray(0, y * 4), (y * size + size - y) * 4)
  }
  return { width: size, height: size, data }
}
