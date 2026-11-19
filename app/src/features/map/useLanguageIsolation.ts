import { useAtomValue, useSetAtom } from 'jotai'
import { atlasDataAtom, languageColorsAtom } from '../../state/atlasState'
import { explorerActionAtom } from '../../state/explorerState.ts'
import { inspectLanguageFromMapAtom } from '../../state/languageControls'
import { isolateMapAtom } from '../../state/mapInteraction.ts'

/** Explicit language-panel action. Map gestures never isolate. */
export function useLanguageIsolation() {
  const atlas = useAtomValue(atlasDataAtom)
  const colors = useAtomValue(languageColorsAtom)
  const open = useSetAtom(inspectLanguageFromMapAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const isolate = useSetAtom(isolateMapAtom)
  return (id: string) => {
    const language = atlas.languageById.get(id)
    if (!language) return
    dispatch({ type: 'map-mode', mode: 'language' })
    open({ languageId: id })
    isolate({ kind: 'language', id, label: language.name, color: colors.get(id) ?? '#d4774c' })
  }
}
