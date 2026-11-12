import { indexWals, type WalsRepository } from '../domain/wals.ts'
import { validateWalsData } from '../domain/walsValidation.ts'

/** Shared data work only. No component cache, navigation callback, or eager request. */
export const createWalsLoader = (request: () => Promise<Response>) => {
  let pending: Promise<WalsRepository> | undefined
  return () => {
    pending ??= Promise.resolve()
      .then(request)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load WALS (HTTP ${response.status}).`)
        const data: unknown = await response.json()
        validateWalsData(data)
        return indexWals(data)
      })
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }
}

export const loadWals = createWalsLoader(() =>
  fetch(`${import.meta.env.BASE_URL}wals/features.json`),
)
