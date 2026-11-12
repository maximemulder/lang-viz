import type { WalsRepository } from '../../domain/wals.ts'
import type { WalsSession } from '../../features/wals/session.ts'
import type { WalsAssociations } from './languageMatching.ts'

/** A deterministic default is derived, never written by a loading callback. */
export const resolveWalsProfile = (
  repository: WalsRepository,
  associations: WalsAssociations,
  session: WalsSession,
  profileId: string,
) => {
  const sourceIds = associations.byAtlas.get(profileId) ?? []
  const saved = session.profiles.get(profileId)
  const sourceId = saved?.sourceId ?? sourceIds[0] ?? null
  const available = sourceId !== null && sourceIds.includes(sourceId)
  return {
    sourceIds,
    sourceId,
    featureId: saved?.featureId ?? null,
    record: available ? (repository.data.records[sourceId] ?? null) : null,
    association: available ? (associations.bySource.get(sourceId) ?? null) : null,
    message:
      saved && !available
        ? 'The saved WALS variety is unavailable for this catalog profile; choose a variety explicitly.'
        : sourceIds.length
          ? ''
          : 'No WALS source record is associated with this catalog profile.',
  }
}
