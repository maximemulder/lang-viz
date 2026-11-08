/** Composite a disjoint face once, preserving the existing source-over color order. */
export const blendedFace = (colors: readonly string[], opacity: number) => {
  let alpha = 0
  const rgb = [0, 0, 0]
  for (const color of colors) {
    for (let channel = 0; channel < 3; channel++) {
      const value = Number.parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16)
      rgb[channel] = value * opacity + (rgb[channel] ?? 0) * (1 - opacity)
    }
    alpha = opacity + alpha * (1 - opacity)
  }
  return {
    color: `#${rgb
      .map((value) =>
        Math.round(alpha ? value / alpha : 0)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`,
    opacity: alpha,
  }
}
