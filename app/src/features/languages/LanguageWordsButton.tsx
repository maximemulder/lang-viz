import { useSetAtom } from 'jotai'
import type { Language } from '../../domain/atlas.ts'
import { explorerActionAtom } from '../../state/explorerState.ts'

/** Pass the represented catalog entry, including aggregate and source-defined identities. */
export const LanguageWordsButton = ({
  language,
  onNavigate,
}: {
  readonly language: Language
  readonly onNavigate?: () => void
}) => {
  const dispatch = useSetAtom(explorerActionAtom)
  return (
    <button
      type="button"
      className="language-word-entries"
      aria-label={`Browse word entries for ${language.name}`}
      onClick={() => {
        dispatch({
          type: 'language-words',
          target: { name: language.name, classification: language.classification },
        })
        onNavigate?.()
      }}
    >
      Browse word entries
    </button>
  )
}
