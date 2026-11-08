import { atom } from 'jotai'
import { selectAtom, unwrap } from 'jotai/utils'
import { loadAtlasData } from '../data/atlasRepository'
import {
  type AreaMode,
  areaMode,
  buildGeographyAvailability,
  type GeographyAvailability,
  mappedLeavesForLanguages,
  resolveMapAreas,
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
  resolveLanguageColors,
  topmostColorRoots,
  validateColorConfiguration,
} from '../domain/colors'
import { buildLanguageHierarchy } from '../domain/hierarchy'

export const atlasDataAtom = atom(async () => loadAtlasData())

export const languageQueryAtom = atom('')
export const geographyDatasetFilterAtom = atom<GeographyDatasetSelection>('all')
export const finderScopeAtom = atom<'world' | 'viewport'>('world')
export const temporalViewAtom = atom<TemporalViewSelection>('all')
export const viewportLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const visibleLanguageIdsAtom = atom<readonly LanguageId[]>([])
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
export const mappedLeafColorRootsAtom = atom<readonly LanguageId[]>([])
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
export const selectedMapAreasAtom = atom((get) =>
  resolveMapAreas(
    get(visibleLanguageIdsAtom),
    get(geographyAvailabilityAtom),
    get(areaModesAtom),
    get(languageColorsAtom),
  ),
)
export const overlapModeAtom = atom<'hatching' | 'blending'>('hatching')
export const languageOpacityAtom = atom(0.82)
export const overlapStatusAtom = atom<{
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}>({ status: 'idle', message: '' })

export const clearMapSelectionAtom = atom(null, (_get, set) => {
  set(visibleLanguageIdsAtom, [])
  set(mappedLeafColorRootsAtom, [])
})

export const toggleVisibleLanguageAtom = atom(null, (get, set, languageId: LanguageId) => {
  const current = get(visibleLanguageIdsAtom)
  const available = get(geographyAvailabilityAtom).get(languageId)
  if (!current.includes(languageId) && available) {
    const modes = get(areaModesAtom)
    set(areaModesAtom, { ...modes, [languageId]: areaMode(available, modes[languageId]) })
  }
  set(
    visibleLanguageIdsAtom,
    current.includes(languageId)
      ? current.filter((id) => id !== languageId)
      : [...current, languageId],
  )
})

export const showLanguagesAtom = atom(null, (get, set, languageIds: readonly LanguageId[]) => {
  const modes = { ...get(areaModesAtom) }
  const availability = get(geographyAvailabilityAtom)
  for (const id of languageIds) {
    const available = availability.get(id)
    if (available) modes[id] = areaMode(available, modes[id])
  }
  set(areaModesAtom, modes)
  set(visibleLanguageIdsAtom, [...new Set([...get(visibleLanguageIdsAtom), ...languageIds])])
})

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
    const nextRoots = [
      ...new Set([
        ...get(mappedLeafColorRootsAtom).filter((id) => !leaves.subtreeIds.has(id)),
        ...coloringRoots,
      ]),
    ].sort()
    const previousRoots = get(mappedLeafColorRootsAtom)
    if (
      nextRoots.length !== previousRoots.length ||
      nextRoots.some((id, i) => previousRoots[i] !== id)
    ) {
      set(mappedLeafColorRootsAtom, nextRoots)
    }
    const modes = { ...get(areaModesAtom) }
    for (const id of leaves.languageIds) modes[id] = 'own'
    set(areaModesAtom, modes)
    set(visibleLanguageIdsAtom, [
      ...get(visibleLanguageIdsAtom).filter((id) => !leaves.subtreeIds.has(id)),
      ...leaves.languageIds,
    ])
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
