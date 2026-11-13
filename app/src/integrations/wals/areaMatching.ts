import type { GeometryVariant } from '../../domain/atlas.ts'
import type { WalsRepository } from '../../domain/wals.ts'
import type { WalsAssociations } from './languageMatching.ts'

/** Original atlas polygons only. Never expand families into descendants or infer
 * grammar from an ancestor, a country, or the shape of a neighbouring language.
 */
export const matchWalsAreas = (
  repository: WalsRepository,
  associations: WalsAssociations,
  sourceId: string,
  featureId: string,
  variants: readonly GeometryVariant[],
) => {
  const observationId = repository.index.bySource.get(sourceId)?.get(featureId)
  const categoryId = observationId ? repository.data.observations[observationId]?.categoryId : null
  const sources = categoryId
    ? (repository.index.byCategory.get(categoryId) ?? []).flatMap((id) => {
        const observation = repository.data.observations[id]
        return observation ? [observation.sourceId] : []
      })
    : []
  const byLanguage = new Map<string, string[]>()
  let unresolved = 0
  for (const id of sources) {
    const association = associations.bySource.get(id)
    if (
      association?.status !== 'associated' ||
      association.scope === 'broader' ||
      !['language', 'dialect'].includes(association.level)
    ) {
      unresolved++
      continue
    }
    const records = byLanguage.get(association.atlasId) ?? []
    records.push(id)
    byLanguage.set(association.atlasId, records)
  }
  const conflicts = new Set<string>()
  for (const [id] of byLanguage) {
    const values = new Set(
      (associations.byAtlas.get(id) ?? []).flatMap((recordId) => {
        const observation = repository.index.bySource.get(recordId)?.get(featureId)
        const value = observation ? repository.data.observations[observation] : null
        return value ? [value.categoryId] : []
      }),
    )
    if (values.size > 1) conflicts.add(id)
  }
  const matchedVariants = variants.filter(
    (variant) => byLanguage.has(variant.languageId) && !conflicts.has(variant.languageId),
  )
  const mappedIds = new Set(matchedVariants.map((variant) => variant.languageId))
  return {
    sourceId,
    featureId,
    categoryId: categoryId ?? null,
    sourceIds: sources,
    byLanguage,
    conflicts,
    unresolved,
    variants: matchedVariants,
    mappedIds,
    withoutAreas: [...byLanguage.keys()].filter((id) => !conflicts.has(id) && !mappedIds.has(id)),
  }
}
