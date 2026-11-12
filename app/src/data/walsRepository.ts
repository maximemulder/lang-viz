import { indexWals, type WalsRepository } from '../domain/wals.ts'
import { validateWalsData } from '../domain/walsValidation.ts'

/** Shared data work only. No component cache, navigation callback, or eager request. */
export const createWalsLoader = (request: () => Promise<Response>) => {
  let pending: Promise<WalsRepository> | undefined
  return () => {
    pending ??= Promise.resolve()
      .then(() => {
        const start = performance.now()
        return request().then((response) => ({ response, start }))
      })
      .then(async ({ response, start }) => {
        if (!response.ok) throw new Error(`Could not load WALS (HTTP ${response.status}).`)
        const body = await response.text()
        const received = performance.now()
        const data: unknown = JSON.parse(body)
        const parsed = performance.now()
        validateWalsData(data)
        const validated = performance.now()
        const repository = indexWals(data)
        const indexed = performance.now()
        // Local browser timings only; emitted once per successful load, never on cache hits.
        performance.measure('wals:receive', { start, end: received })
        performance.measure('wals:parse', { start: received, end: parsed })
        performance.measure('wals:validate', { start: parsed, end: validated })
        performance.measure('wals:index', { start: validated, end: indexed })
        performance.mark('wals:prepared')
        return repository
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
