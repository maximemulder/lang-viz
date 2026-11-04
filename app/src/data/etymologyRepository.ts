import { type EtymologyData, type EtymologyRepository, indexEtymology } from '../domain/etymology'

let repository: Promise<EtymologyRepository> | undefined

export const loadEtymology = (): Promise<EtymologyRepository> => {
  repository ??= fetch(`${import.meta.env.BASE_URL}etymology/word-trails.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load Word Trails (${response.status}).`)
      const data = (await response.json()) as EtymologyData
      if (data.schemaVersion !== 1) throw new Error('Unsupported Word Trails data version.')
      return { data, index: indexEtymology(data) }
    })
    .catch((error: unknown) => {
      repository = undefined
      throw error
    })
  return repository
}
