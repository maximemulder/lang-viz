/** Let worker messages run between chunks of synchronous geometry. */
export const geometryCheckpoint = (signal?: AbortSignal) => {
  let sliceStart = performance.now()
  return () => {
    signal?.throwIfAborted()
    if (performance.now() - sliceStart < 8) return
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      signal?.throwIfAborted()
      sliceStart = performance.now()
    })
  }
}
