import { type EtymologyRepository, indexEtymology } from '../domain/etymology.ts'
import { validateEtymologyData } from '../domain/etymologyValidation.ts'

/** One in-flight or successful request per loader; failures are retryable. No navigation writes. */
export const createEtymologyLoader = (request: () => Promise<Response>) => {
  let pending: Promise<EtymologyRepository> | undefined
  return () => {
    pending ??= request()
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Could not load word histories (HTTP ${response.status}).`)
        const value: unknown = await response.json()
        validateEtymologyData(value)
        return { data: value, index: indexEtymology(value) }
      })
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }
}

export const loadEtymology = createEtymologyLoader(() =>
  fetch(`${import.meta.env.BASE_URL}etymology/word-trails.json`),
)
