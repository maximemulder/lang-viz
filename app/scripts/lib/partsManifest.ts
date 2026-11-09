import type { AtlasManifest } from '../../src/domain/atlas.ts'

type Config = NonNullable<AtlasManifest['coverageParts']>
type Profile = Config['profiles'][number]

/** A filtered or lower-detail run must never discard another completed profile. */
export const mergePartsManifest = (
  previous: AtlasManifest['coverageParts'],
  directory: string,
  additions: readonly Profile[],
): Config => {
  const profiles = new Map(
    (previous?.directory === directory ? previous.profiles : []).map((p) => [p.id, p]),
  )
  for (const profile of additions) {
    const old = profiles.get(profile.id)
    if (!old || (profile.maxZoom ?? 0) >= (old.maxZoom ?? previous?.maxZoom ?? 0))
      profiles.set(profile.id, profile)
  }
  const completed = [...profiles.values()].sort((a, b) => a.id.localeCompare(b.id))
  return {
    directory,
    maxZoom: Math.max(0, ...completed.map((p) => p.maxZoom ?? previous?.maxZoom ?? 0)),
    profiles: completed,
  }
}
