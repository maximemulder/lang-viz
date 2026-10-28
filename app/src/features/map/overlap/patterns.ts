/** Opaque solid/striped tiles. Transparency is applied once to the coverage layer. */
export const stripeImage = (colors: readonly string[]) => {
  if (colors.length === 0) throw new Error('A coverage pattern needs at least one color')
  const size = 2 ** Math.ceil(Math.log2(Math.max(32, colors.length * 12)))
  if (size > 512)
    throw new Error('Too many languages overlap here for this preview. Select fewer languages.')
  const channels = colors.map((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid language color: ${color}`)
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ] as const
  })
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = channels[Math.floor((((x + y) % size) * channels.length) / size)]
      if (!color) continue
      const offset = (y * size + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = 255
    }
  }
  return { width: size, height: size, data }
}
