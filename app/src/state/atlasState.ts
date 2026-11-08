import { atom } from 'jotai'
import { selectAtom, unwrap } from 'jotai/utils'
import { loadAtlasData } from '../data/atlasRepository'
import {
  type AreaMode,
  buildGeographyAvailability,
  type GeographyAvailability,
  mappedLeavesForLanguages,
} from '../domain/aggregation'
import type {
  GeographyDatasetSelection,
  GeometryVariantId,
  LanguageId,
  TemporalViewSelection,
} from '../domain/atlas'
import {
  buildColorTopology,
  buildSemanticPalette,
  type ColorConfiguration,
  DEFAULT_COLOR_CONFIGURATION,
  normalizeColor,
  resolveLanguageColors,
  topmostColorRoots,
  validateColorConfiguration,
} from '../domain/colors'
import { buildLanguageHierarchy } from '../domain/hierarchy'
import {
  addMapEntries,
  draftRepresentationKey,
  type GeographyContext,
  type MapEntry,
  mapEntryKey,
  pinMapEntry,
  replaceSubtreeMapEntries,
  resolveMapEntries,
} from '../domain/mapEntries'

export const atlasDataAtom = atom(async () => loadAtlasData())

export const languageQueryAtom = atom('')
export const geographyDatasetFilterAtom = atom<GeographyDatasetSelection>('all')
export const finderScopeAtom = atom<'world' | 'viewport'>('world')
export const temporalViewAtom = atom<TemporalViewSelection>('all')
export const viewportLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const mapEntriesAtom = atom<readonly MapEntry[]>([])
/** Languoid identities for genealogy/presentation, never map-entry identities. */
export const visibleLanguageIdsAtom = selectAtom(
  atom((get) => [...new Set(get(mapEntriesAtom).map(({ languageId }) => languageId))]),
  (ids) => ids,
  (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
)
export const geometryOverridesAtom = atom<Readonly<Record<LanguageId, GeometryVariantId>>>({})
export const areaModesAtom = atom<Readonly<Record<LanguageId, AreaMode>>>({})
const resolvedAtlasDataAtom = unwrap(atlasDataAtom)
export const languageHierarchyAtom = atom((get) =>
  buildLanguageHierarchy(get(resolvedAtlasDataAtom)?.languages ?? []),
)
const colorConfigurationStateAtom = atom<ColorConfiguration>(DEFAULT_COLOR_CONFIGURATION)
/** Public, validated configuration API; no dependency on the current controls. */
export const colorConfigurationAtom = atom(
  (get) => get(colorConfigurationStateAtom),
  (get, set, config: ColorConfiguration) => {
    const previous = get(colorConfigurationStateAtom)
    const validated = validateColorConfiguration(config)
    const sameRecord = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([id, color]) => b[id] === color)
    set(colorConfigurationStateAtom, {
      ...validated,
      rootIds:
        validated.rootIds.length === previous.rootIds.length &&
        validated.rootIds.every((id, i) => id === previous.rootIds[i])
          ? previous.rootIds
          : validated.rootIds,
      anchors: sameRecord(validated.anchors, previous.anchors)
        ? previous.anchors
        : validated.anchors,
      overrides: sameRecord(validated.overrides, previous.overrides)
        ? previous.overrides
        : validated.overrides,
    })
  },
)
/** Selection provenance, separate from explicit roots in the configuration. */
export const mappedLeafColorRootsAtom = selectAtom(
  atom((get) =>
    [
      ...new Set(
        get(mapEntriesAtom).flatMap(({ colorRootId }) => (colorRootId ? [colorRootId] : [])),
      ),
    ].sort(),
  ),
  (ids) => ids,
  (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
)
export const colorTopologyAtom = atom((get) => buildColorTopology(get(languageHierarchyAtom)))
const semanticRootsAtom = atom((get) => get(colorConfigurationAtom).rootIds)
const semanticAnchorsAtom = atom((get) => get(colorConfigurationAtom).anchors)
const selectedFamilyRootsAtom = selectAtom(
  atom((get) => {
    const hierarchy = get(languageHierarchyAtom)
    return get(visibleLanguageIdsAtom)
      .filter((id) => hierarchy.languageById.get(id)?.level === 'family')
      .sort()
  }),
  (roots) => roots,
  (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
)
export const semanticPaletteAtom = atom((get) =>
  buildSemanticPalette(
    get(languageHierarchyAtom),
    get(colorTopologyAtom),
    [...get(semanticRootsAtom), ...get(selectedFamilyRootsAtom), ...get(mappedLeafColorRootsAtom)],
    get(semanticAnchorsAtom),
  ),
)
export const languageColorsAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  return data
    ? resolveLanguageColors(data, get(colorConfigurationAtom), get(semanticPaletteAtom))
    : new Map<string, string>()
})
export const geographyAvailabilityAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  return data
    ? buildGeographyAvailability(
        data,
        get(languageHierarchyAtom),
        get(temporalViewAtom),
        get(geographyDatasetFilterAtom),
        get(geometryOverridesAtom),
      )
    : new Map<string, GeographyAvailability>()
})
export const selectedMapAreasAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  return data ? resolveMapEntries(get(mapEntriesAtom), data, get(languageColorsAtom)) : []
})

export const geographyContextAtom = atom<GeographyContext>((get) => ({
  sources: get(geographyDatasetFilterAtom),
  period: get(temporalViewAtom),
}))

/** Checkboxes refer to the draft being browsed, not every representation of this languoid. */
export const selectedDraftLanguageIdsAtom = atom((get) => {
  const availability = get(geographyAvailabilityAtom)
  const modes = get(areaModesAtom)
  return get(mapEntriesAtom)
    .filter(
      (entry) =>
        mapEntryKey(entry) ===
        draftRepresentationKey(
          entry.languageId,
          availability.get(entry.languageId),
          modes[entry.languageId],
        ),
    )
    .map(({ languageId }) => languageId)
})
export const overlapModeAtom = atom<'hatching' | 'blending'>('hatching')
export const languageOpacityAtom = atom(0.82)
export const overlapStatusAtom = atom<{
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}>({ status: 'idle', message: '' })

export const clearMapSelectionAtom = atom(null, (_get, set) => {
  set(mapEntriesAtom, [])
})

export const toggleVisibleLanguageAtom = atom(null, (get, set, languageId: LanguageId) => {
  const current = get(mapEntriesAtom)
  const available = get(geographyAvailabilityAtom).get(languageId)
  const preferred = get(areaModesAtom)[languageId]
  const key = draftRepresentationKey(languageId, available, preferred)
  if (!key) return
  const existing = current.find((entry) => mapEntryKey(entry) === key)
  if (existing)
    set(
      mapEntriesAtom,
      current.filter(({ id }) => id !== existing.id),
    )
  else {
    const entry = pinMapEntry(languageId, available, preferred, get(geographyContextAtom))
    if (entry) set(mapEntriesAtom, addMapEntries(current, [entry]))
  }
})

export const showLanguagesAtom = atom(null, (get, set, languageIds: readonly LanguageId[]) => {
  const modes = get(areaModesAtom)
  const availability = get(geographyAvailabilityAtom)
  const context = get(geographyContextAtom)
  const candidates = languageIds.flatMap((id) => {
    const entry = pinMapEntry(id, availability.get(id), modes[id], context)
    return entry ? [entry] : []
  })
  set(mapEntriesAtom, addMapEntries(get(mapEntriesAtom), candidates))
})

export const hideLanguagesAtom = atom(null, (get, set, ids: readonly LanguageId[]) => {
  const availability = get(geographyAvailabilityAtom)
  const modes = get(areaModesAtom)
  const keys = new Set(ids.map((id) => draftRepresentationKey(id, availability.get(id), modes[id])))
  set(
    mapEntriesAtom,
    get(mapEntriesAtom).filter((entry) => !keys.has(mapEntryKey(entry))),
  )
})

export const removeMapEntryAtom = atom(null, (get, set, entryId: string) => {
  set(
    mapEntriesAtom,
    get(mapEntriesAtom).filter(({ id }) => id !== entryId),
  )
})

export const setMapEntryColorAtom = atom(
  null,
  (get, set, update: { entryId: string; color: string | null }) => {
    const color = update.color === null ? null : normalizeColor(update.color)
    set(
      mapEntriesAtom,
      get(mapEntriesAtom).map((entry) =>
        entry.id === update.entryId ? { ...entry, colorOverride: color } : entry,
      ),
    )
  },
)

export const showMappedLeavesAtom = atom(
  null,
  (get, set, roots: LanguageId | readonly LanguageId[]) => {
    const leaves = mappedLeavesForLanguages(
      typeof roots === 'string' ? [roots] : roots,
      get(languageHierarchyAtom),
      get(geographyAvailabilityAtom),
    )
    if (!leaves.languageIds.length) return
    const coloringRoots = topmostColorRoots(
      typeof roots === 'string' ? [roots] : roots,
      get(colorTopologyAtom),
    )
    const rootSet = new Set(coloringRoots)
    const hierarchy = get(languageHierarchyAtom)
    const context = get(geographyContextAtom)
    const availability = get(geographyAvailabilityAtom)
    const candidates = leaves.languageIds.flatMap((id) => {
      let ancestor: string | null = id
      const visited = new Set<string>()
      while (ancestor && !rootSet.has(ancestor) && !visited.has(ancestor)) {
        visited.add(ancestor)
        ancestor = hierarchy.languageById.get(ancestor)?.parentId ?? null
      }
      const colorRootId = ancestor && rootSet.has(ancestor) ? ancestor : null
      const entry = pinMapEntry(id, availability.get(id), 'own', context, colorRootId)
      return entry ? [entry] : []
    })
    set(areaModesAtom, {
      ...get(areaModesAtom),
      ...Object.fromEntries(leaves.languageIds.map((id) => [id, 'own' as const])),
    })
    set(
      mapEntriesAtom,
      replaceSubtreeMapEntries(get(mapEntriesAtom), candidates, leaves.subtreeIds, context),
    )
  },
)

export const setGeometryOverrideAtom = atom(
  null,
  (
    get,
    set,
    update: { readonly languageId: LanguageId; readonly variantId: GeometryVariantId },
  ) => {
    set(geometryOverridesAtom, {
      ...get(geometryOverridesAtom),
      [update.languageId]: update.variantId,
    })
  },
)
