import type { EtymologyRepository } from '../domain/etymology.ts'
import { prepareInWorker } from './etymologyWorker.ts'
import { prepareEtymology } from './prepareEtymology.ts'

/** One in-flight or successful request per loader; failures are retryable. No navigation writes. */
export const createEtymologyLoader = (
  request: () => Promise<Response>,
  prepare: (bytes: ArrayBuffer) => EtymologyRepository | Promise<EtymologyRepository> = (bytes) =>
    prepareEtymology(bytes).repository,
) => {
  let pending: Promise<EtymologyRepository> | undefined
  return () => {
    pending ??= request()
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Could not load word histories (HTTP ${response.status}).`)
        performance.mark('lexical:headers')
        const body = await response.arrayBuffer()
        performance.mark('lexical:body')
        return prepare(body)
      })
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }
}

export const loadEtymology = createEtymologyLoader(
  () => fetch(`${import.meta.env.BASE_URL}etymology/word-trails.json`),
  prepareInWorker,
)
