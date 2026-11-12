import type { Language } from '../../domain/atlas.ts'
import type { LexicalLanguage } from '../../domain/etymology.ts'

// An explicit Glottocode takes precedence. An ISO fallback must be unique on both
// sides; historical stages sharing an ISO code must never be merged by accident.
export const matchAtlasLanguage = (
  lexicalId: string,
  lexicalLanguages: Readonly<Record<string, LexicalLanguage>>,
  atlasLanguages: readonly Language[],
): Language | undefined => {
  const language = lexicalLanguages[lexicalId]
  if (!language) return undefined
  if (language.glottocode) {
    const matches = atlasLanguages.filter(
      (entry) =>
        entry.classification.kind === 'glottolog' &&
        entry.classification.glottocode === language.glottocode,
    )
    return matches.length === 1 ? matches[0] : undefined
  }
  if (!language.iso) return undefined
  const lexicalMatches = Object.values(lexicalLanguages).filter(
    (entry) => entry.iso === language.iso,
  )
  const atlasMatches = atlasLanguages.filter((entry) => entry.iso6393 === language.iso)
  return lexicalMatches.length === 1 && atlasMatches.length === 1 ? atlasMatches[0] : undefined
}

/** Reverse navigation requires a unique exact Glottocode; ISO cannot identify a stage. */
export const matchLexicalLanguage = (
  atlasLanguage: Language,
  lexicalLanguages: Readonly<Record<string, LexicalLanguage>>,
): string | undefined => {
  const classification = atlasLanguage.classification
  if (classification.kind !== 'glottolog' || !classification.glottocode) return undefined
  const matches = Object.entries(lexicalLanguages).filter(
    ([, language]) => language.glottocode === classification.glottocode,
  )
  return matches.length === 1 ? matches[0]?.[0] : undefined
}
