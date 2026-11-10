import { atom } from 'jotai'
import { selectAtom, unwrap } from 'jotai/utils'
import { loadAtlasData } from '../data/atlasRepository'
import {
  type AreaMode,
  buildGeographyAvailability,
  type GeographyAvailability,
} from '../domain/aggregation'
import type {
  GeographyDatasetSelection,
  GeometryVariantId,
  LanguageId,
  TemporalViewSelection,
} from '../domain/atlas'
import { buildBranchMapEntries } from '../domain/branches'
import type { OptimizedColors } from '../domain/colorOptimization'
import {
  buildColorTopology,
  buildSemanticPalette,
  type ColorConfiguration,
  DEFAULT_COLOR_CONFIGURATION,
  normalizeColor,
  resolveLanguageColors,
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
import { type GroupColoring, groupMapEntries, type MapGroup, mapGroupId } from '../domain/mapGroups'
import { selectGlobalColorProfile } from '../domain/preparedColors'

export const atlasDataAtom = atom(async () => loadAtlasData())

export const languageQueryAtom = atom('')
export const geographyDatasetFilterAtom = atom<GeographyDatasetSelection>(['asher2007world'])
export const finderScopeAtom = atom<'world' | 'viewport'>('world')
export const temporalViewAtom = atom<TemporalViewSelection>('contemporary')
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
/** Frozen, explicit dataset or view optimization. Camera/filter/selection changes never write it. */
export const optimizedColorsAtom = atom<OptimizedColors | null>(null)
const previousOptimizedColorsAtom = atom<{ readonly value: OptimizedColors | null } | null>(null)
export const canUndoColorsAtom = atom((get) => get(previousOptimizedColorsAtom) !== null)
export const applyOptimizedColorsAtom = atom(null, (get, set, result: OptimizedColors) => {
  const previous = get(optimizedColorsAtom)
  set(previousOptimizedColorsAtom, { value: previous })
  set(
    optimizedColorsAtom,
    result.datasetProfile
      ? result
      : {
          ...result,
          colors: new Map([...(previous?.colors ?? []), ...result.colors]),
          regions: new Map([...(previous?.regions ?? []), ...result.regions]),
        },
  )
})
export const undoColorsAtom = atom(null, (get, set) => {
  const previous = get(previousOptimizedColorsAtom)
  if (!previous) return
  set(optimizedColorsAtom, previous.value)
  set(previousOptimizedColorsAtom, null)
})
export const restoreDefaultColorsAtom = atom(null, (get, set) => {
  if (!get(optimizedColorsAtom)) return
  set(previousOptimizedColorsAtom, { value: get(optimizedColorsAtom) })
  set(optimizedColorsAtom, null)
})
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
    if (
      validated.strategy !== previous.strategy ||
      validated.rootIds.join(',') !== previous.rootIds.join(',') ||
      !sameRecord(validated.anchors, previous.anchors)
    ) {
      set(optimizedColorsAtom, null)
      set(previousOptimizedColorsAtom, null)
    }
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
export const branchColorRootsAtom = selectAtom(
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
export const semanticPaletteAtom = atom((get) =>
  buildSemanticPalette(
    get(languageHierarchyAtom),
    get(colorTopologyAtom),
    get(semanticRootsAtom),
    get(semanticAnchorsAtom),
  ),
)
export const globalColorProfileAtom = selectAtom(
  atom((get) => {
    const data = get(resolvedAtlasDataAtom)
    return data
      ? selectGlobalColorProfile(data, get(mapEntriesAtom), get(colorConfigurationAtom))
      : null
  }),
  (profile) => profile,
  (a, b) => a?.id === b?.id,
)
/** Dataset metadata is validated before AtlasData is published; selection is synchronous. */
export const preparedPaletteAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  const profile = get(globalColorProfileAtom)
  return data && profile ? (data.palettes.get(profile.id) ?? null) : null
})

export const languageColorsAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  if (!data) return new Map<string, string>()
  const config = get(colorConfigurationAtom)
  const colors = new Map(
    get(preparedPaletteAtom)?.colors ??
      resolveLanguageColors(data, config, get(semanticPaletteAtom)),
  )
  if (config.strategy === 'semantic') {
    for (const [id, color] of get(optimizedColorsAtom)?.colors ?? []) {
      if (!config.anchors[id]) colors.set(id, color)
    }
  }
  for (const [id, color] of Object.entries(config.overrides)) {
    if (data.languageById.has(id)) colors.set(id, color)
  }
  return colors
})

export const resetColorSettingsAtom = atom(null, (_get, set) => {
  set(colorConfigurationAtom, DEFAULT_COLOR_CONFIGURATION)
  set(optimizedColorsAtom, null)
  set(previousOptimizedColorsAtom, null)
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
export const mapGroupsAtom = atom((get) => groupMapEntries(get(mapEntriesAtom)))
const mapGroupStylesAtom = selectAtom(
  atom((get) => get(mapGroupsAtom).map(({ group }) => group)),
  (groups) => groups,
  (a, b) =>
    a.length === b.length &&
    a.every((group, i) => {
      const other = b[i]
      return (
        other &&
        group.id === other.id &&
        group.coloring === other.coloring &&
        group.color === other.color
      )
    }),
)
const mapGroupPalettesAtom = atom((get) => {
  const groups = get(mapGroupStylesAtom)
  const config = get(colorConfigurationAtom)
  const overrides = Object.entries(config.overrides)
  const automatic = get(languageColorsAtom)
  const result = new Map<string, ReadonlyMap<string, string>>()
  for (const group of groups) {
    const palette =
      group.color && group.coloring === 'hierarchy'
        ? buildSemanticPalette(get(languageHierarchyAtom), get(colorTopologyAtom), [group.rootId], {
            [group.rootId]: group.color,
          }).colors
        : automatic
    result.set(
      group.id,
      palette === automatic || !overrides.length ? palette : new Map([...palette, ...overrides]),
    )
  }
  return result
})
export const selectedMapAreasAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  return data
    ? resolveMapEntries(
        get(mapEntriesAtom),
        data,
        get(languageColorsAtom),
        get(mapGroupPalettesAtom),
      )
    : []
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
export const stripeThicknessAtom = atom(1)
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

export const removeMapGroupAtom = atom(null, (get, set, groupId: string) => {
  set(
    mapEntriesAtom,
    get(mapEntriesAtom).filter((entry) => mapGroupId(entry) !== groupId),
  )
})

export const setMapGroupStyleAtom = atom(
  null,
  (get, set, update: { groupId: string; coloring?: GroupColoring; color?: string | null }) => {
    const current = get(mapGroupsAtom).find(({ group }) => group.id === update.groupId)
    if (!current) return
    const group: MapGroup = {
      ...current.group,
      ...(update.coloring ? { coloring: update.coloring } : {}),
      ...(update.color !== undefined
        ? { color: update.color === null ? null : normalizeColor(update.color) }
        : {}),
    }
    set(
      mapEntriesAtom,
      get(mapEntriesAtom).map((entry) =>
        mapGroupId(entry) === group.id ? { ...entry, group } : entry,
      ),
    )
  },
)

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

export const showBranchAtom = atom(null, (get, set, roots: LanguageId | readonly LanguageId[]) => {
  const context = get(geographyContextAtom)
  const branch = buildBranchMapEntries(
    typeof roots === 'string' ? [roots] : roots,
    get(languageHierarchyAtom),
    get(geographyAvailabilityAtom),
    context,
    get(colorTopologyAtom),
  )
  if (!branch.languageIds.length) return
  set(areaModesAtom, {
    ...get(areaModesAtom),
    ...Object.fromEntries(branch.languageIds.map((id) => [id, 'own' as const])),
  })
  set(
    mapEntriesAtom,
    replaceSubtreeMapEntries(get(mapEntriesAtom), branch.entries, branch.subtreeIds, context),
  )
})

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
