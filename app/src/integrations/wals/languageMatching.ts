import type { Language, LanguoidLevel } from '../../domain/atlas.ts'
import { appendWalsIndex, type WalsRepository } from '../../domain/wals.ts'

export type WalsAssociation = {
  readonly sourceId: string
  readonly explanation: string
} & (
  | {
      readonly status: 'associated'
      readonly atlasId: string
      readonly method: 'glottocode' | 'unique-iso' | 'reviewed-override'
      readonly level: LanguoidLevel
      readonly scope: 'exact' | 'broader' | 'source-defined'
    }
  | {
      readonly status: 'unmatched' | 'ambiguous'
      readonly reason:
        | 'unresolved-glottocode'
        | 'duplicate-glottocode'
        | 'missing-identifiers'
        | 'unresolved-iso'
        | 'duplicate-source-iso'
        | 'duplicate-target-iso'
      readonly candidateAtlasIds: readonly string[]
    }
)
export interface WalsAssociationOverride {
  readonly sourceId: string
  readonly expectedGlottocode: string | null
  readonly expectedIso: string | null
  readonly atlasId: string
  readonly reason: string
}
export interface WalsAssociations {
  readonly bySource: ReadonlyMap<string, WalsAssociation>
  readonly byAtlas: ReadonlyMap<string, readonly string[]>
  readonly diagnostics: Readonly<
    Record<'status' | 'method' | 'level' | 'scope' | 'reason', Readonly<Record<string, number>>>
  >
}

/** Use the complete loaded catalogs. Never filter by geometry, observations, or catalog level. */
export const associateWals = (
  repository: WalsRepository,
  languages: readonly Language[],
  overrides: readonly WalsAssociationOverride[] = [],
): WalsAssociations => {
  const byGlottocode = new Map<string, Language[]>()
  const byIso = new Map<string, Language[]>()
  const atlas = new Map<string, Language>()
  const add = (index: Map<string, Language[]>, key: string, language: Language) => {
    const values = index.get(key)
    if (values) values.push(language)
    else index.set(key, [language])
  }
  for (const language of languages) {
    if (atlas.has(language.id)) throw new Error(`Duplicate atlas ID: ${language.id}`)
    atlas.set(language.id, language)
    if (language.classification.kind === 'glottolog')
      add(byGlottocode, language.classification.glottocode, language)
    if (language.iso6393) add(byIso, language.iso6393, language)
  }
  const reviewed = new Map<string, WalsAssociationOverride>()
  for (const override of overrides) {
    const record = Object.hasOwn(repository.data.records, override.sourceId)
      ? repository.data.records[override.sourceId]
      : undefined
    if (
      !record ||
      reviewed.has(override.sourceId) ||
      !atlas.has(override.atlasId) ||
      !override.reason.trim() ||
      record.glottocode !== override.expectedGlottocode ||
      record.iso6393 !== override.expectedIso
    )
      throw new Error(`Invalid or stale WALS association override: ${override.sourceId}`)
    reviewed.set(override.sourceId, override)
  }
  const bySource = new Map<string, WalsAssociation>()
  const byAtlas = new Map<string, string[]>()
  const diagnostics: Record<
    'status' | 'method' | 'level' | 'scope' | 'reason',
    Record<string, number>
  > = {
    status: {},
    method: {},
    level: {},
    scope: {},
    reason: {},
  }
  const count = (field: keyof typeof diagnostics, key: string) => {
    const counts = diagnostics[field]
    counts[key] = (counts[key] ?? 0) + 1
  }
  for (const sourceId of repository.index.bySource.keys()) {
    const record = repository.data.records[sourceId]
    if (!record) throw new Error(`Missing WALS record: ${sourceId}`)
    const override = reviewed.get(sourceId)
    let association: WalsAssociation | undefined
    let target: Language | undefined
    let method: 'glottocode' | 'unique-iso' | 'reviewed-override' = 'glottocode'
    const unresolved = (
      reason: Extract<WalsAssociation, { status: 'unmatched' | 'ambiguous' }>['reason'],
      explanation: string,
      candidates: readonly Language[] = [],
    ): WalsAssociation => ({
      sourceId,
      status: reason.startsWith('duplicate-') ? 'ambiguous' : 'unmatched',
      reason,
      explanation,
      candidateAtlasIds: candidates.map((language) => language.id).sort(),
    })
    if (override) {
      target = atlas.get(override.atlasId)
      method = 'reviewed-override'
    } else if (record.glottocode) {
      const matches = byGlottocode.get(record.glottocode) ?? []
      if (matches.length === 1) target = matches[0]
      association =
        matches.length > 1
          ? unresolved(
              'duplicate-glottocode',
              `Multiple catalog entries declare Glottocode ${record.glottocode}; no ISO substitution.`,
              matches,
            )
          : unresolved(
              'unresolved-glottocode',
              `Glottocode ${record.glottocode} is absent from catalog classification metadata; no ISO substitution.`,
            )
    } else if (record.iso6393) {
      method = 'unique-iso'
      const matches = byIso.get(record.iso6393) ?? []
      if (repository.index.byIso.get(record.iso6393)?.length !== 1)
        association = unresolved(
          'duplicate-source-iso',
          `ISO ${record.iso6393} identifies multiple WALS records; the varieties remain separate.`,
          matches,
        )
      else if (matches.length > 1)
        association = unresolved(
          'duplicate-target-iso',
          `ISO ${record.iso6393} identifies multiple entries in the complete atlas catalog.`,
          matches,
        )
      else if (!matches.length)
        association = unresolved(
          'unresolved-iso',
          `ISO ${record.iso6393} is absent from the complete atlas catalog.`,
        )
      else target = matches[0]
    } else
      association = unresolved(
        'missing-identifiers',
        'No Glottocode or primary ISO code is recorded; name matching is not used.',
      )
    if (target) {
      const scope =
        target.level === 'family' || target.level === 'group'
          ? 'broader'
          : target.classification.kind === 'source'
            ? 'source-defined'
            : 'exact'
      association = {
        sourceId,
        status: 'associated',
        atlasId: target.id,
        method,
        level: target.level,
        scope,
        explanation: `${override ? `Reviewed override: ${override.reason}` : method === 'glottocode' ? `Declared Glottocode ${record.glottocode}.` : `Primary ISO ${record.iso6393} is unique in both complete catalogs; no Glottocode is recorded.`} ${scope === 'broader' ? `This ${target.level} catalog entry has broader scope. ` : scope === 'source-defined' ? 'The catalog classification is source-defined. ' : ''}Values describe only WALS ${record.name} (${sourceId}); they do not apply to other varieties or descendants.`,
      }
      appendWalsIndex(byAtlas, target.id, sourceId)
    }
    if (!association) throw new Error(`Could not associate WALS record: ${sourceId}`)
    bySource.set(sourceId, association)
    count('status', association.status)
    if (association.status === 'associated') {
      count('method', association.method)
      count('level', association.level)
      count('scope', association.scope)
    } else {
      count('reason', association.reason)
    }
  }
  return { bySource, byAtlas, diagnostics }
}
