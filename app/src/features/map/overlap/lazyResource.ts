/** Share initialization, retaining successful resources but allowing failed attempts to retry. */
export const lazyResource = <T>(initialize: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= Promise.resolve()
      .then(initialize)
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }
}
