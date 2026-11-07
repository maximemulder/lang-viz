/** Shared identities for rendering, inspection, and resource ownership. */
export const BUFFERS = [0, 1] as const
export const coverageSourceId = (buffer: number) => `language-overlap-regions-${buffer}`
export const stripeLayerId = (buffer: number) => `language-overlap-hatching-${buffer}`
export const solidLayerId = (buffer: number) => `language-overlap-solids-${buffer}`
export const fallbackLayerId = (buffer: number) => `language-overlap-fallback-${buffer}`
export const blendLayerPrefix = (buffer: number) => `language-overlap-blend-${buffer}-`
export const blendLayerId = (buffer: number, index: number) => `${blendLayerPrefix(buffer)}${index}`
