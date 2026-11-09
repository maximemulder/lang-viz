import type { AtlasData } from '../domain/atlas'
import {
  decodePreparedPalette,
  type PreparedColorProfile,
  type PreparedPalette,
} from '../domain/preparedColors'

const cache = new WeakMap<AtlasData, Map<string, Promise<PreparedPalette | null>>>()
/** Optional assets fail closed to ordinary defaults. Successful loads are reused. */
export const loadPreparedPalette = (data: AtlasData, profile: PreparedColorProfile) => {
  let profiles = cache.get(data)
  if (!profiles) {
    profiles = new Map()
    cache.set(data, profiles)
  }
  const cached = profiles.get(profile.id)
  if (cached) return cached
  const pending = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${profile.file}`)
      return response.ok ? await decodePreparedPalette(await response.text(), data, profile) : null
    } catch {
      return null
    }
  })().then((result) => {
    if (!result) profiles.delete(profile.id)
    return result
  })
  profiles.set(profile.id, pending)
  return pending
}
