import { buildWordTrail, type EtymologyRepository } from '../../domain/etymology.ts'
import type { ExplorerSession, TrailSpecification } from '../../domain/explorerSession.ts'

export const deriveWordTrail = (repository: EtymologyRepository, spec: TrailSpecification) =>
  spec.root === null ? null : buildWordTrail(repository, spec.root, spec)

/** Resolve against the latest session after data arrives; never write navigation from a load callback. */
export const resolveExplorerSession = (
  session: ExplorerSession,
  repository: EtymologyRepository,
) => {
  const { data, index } = repository
  const issues: string[] = []
  if (session.trail.root !== null && !data.lexemes[session.trail.root])
    issues.push(`Unknown word: ${session.trail.root}`)
  const requestedConcept = session.comparison.conceptId
  const requestedCollection = session.comparison.collectionId
  if (requestedConcept !== null && !data.concepts[requestedConcept])
    issues.push(`Unknown concept: ${requestedConcept}`)
  if (requestedCollection !== null && !data.lists.some((list) => list.id === requestedCollection))
    issues.push(`Unknown collection: ${requestedCollection}`)
  const rootConcepts = index.wordConcepts.get(session.trail.root ?? '') ?? []
  const conceptId =
    requestedConcept ??
    rootConcepts.find(
      (id) =>
        requestedCollection === null ||
        data.concepts[id]?.groups.some((group) => group.list === requestedCollection),
    ) ??
    (requestedCollection === null
      ? null
      : (Object.values(data.concepts).find((concept) =>
          concept.groups.some((group) => group.list === requestedCollection),
        )?.id ?? null))
  const concept = conceptId === null ? null : (data.concepts[conceptId] ?? null)
  const collectionId = requestedCollection ?? concept?.groups[0]?.list ?? null
  if (
    concept &&
    collectionId !== null &&
    !concept.groups.some((group) => group.list === collectionId)
  )
    issues.push(`Concept ${concept.id} is not in collection ${collectionId}`)
  let languageId = session.search.languageId
  let languageMatch: 'exact' | 'ambiguous' | 'unmatched' | null = null
  const target = session.search.atlasTarget
  if (target) {
    const classification = target.classification
    const matches =
      classification.kind === 'glottolog' && classification.glottocode
        ? Object.entries(data.languages).filter(
            ([, language]) => language.glottocode === classification.glottocode,
          )
        : []
    languageId = matches.length === 1 ? (matches[0]?.[0] ?? null) : null
    languageMatch = matches.length === 1 ? 'exact' : matches.length > 1 ? 'ambiguous' : 'unmatched'
  }
  if (languageId !== null && !data.languages[languageId])
    issues.push(`Unknown lexical language: ${languageId}`)
  const selection = session.selection
  if (
    selection &&
    !(selection.kind === 'word'
      ? data.lexemes[selection.id]
      : data.edges.some((edge) => edge.id === selection.id))
  )
    issues.push(`Unknown ${selection.kind}: ${selection.id}`)
  return { concept, conceptId, collectionId, languageId, languageMatch, issues }
}
