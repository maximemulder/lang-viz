import { patternSize } from './patterns.ts'

export const stripeDensity = (zoom: number) => (zoom < 2 ? 8 : zoom < 3 ? 6 : zoom < 5 ? 4 : 2)

/** Density changes retain whole cycles in a seamless texture. */
export const stripeRepeats = (contributors: number, zoom: number, thickness: number) => {
  const size = patternSize(contributors) * 2
  // Keep bands readable before fractional-zoom/projection scaling.
  const maxRepeats = Math.max(1, Math.floor(size / contributors / 1.5))
  const defaultRepeats = Math.min(maxRepeats, stripeDensity(zoom))
  return Math.max(1, Math.min(maxRepeats, Math.round(defaultRepeats / thickness)))
}
