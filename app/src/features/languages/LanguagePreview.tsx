import { useSetAtom } from 'jotai'
import { type ComponentPropsWithRef, useEffect, useId } from 'react'
import type { LanguageMapTarget } from '../../domain/languageFocus'
import { setLanguagePreviewAtom } from '../../state/languageControls'

export const useLanguagePreview = (target: LanguageMapTarget, active = true) => {
  const instance = useId()
  const owner = `${instance}:${target.languageId}:${target.entryId ?? ''}:${target.groupId ?? ''}:${active}`
  const setPreview = useSetAtom(setLanguagePreviewAtom)
  useEffect(
    () => () => {
      setPreview({ kind: 'pointer', owner, target: null })
      setPreview({ kind: 'keyboard', owner, target: null })
    },
    [owner, setPreview],
  )
  return {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      if (active && event.pointerType !== 'touch') setPreview({ kind: 'pointer', owner, target })
    },
    onPointerLeave: () => setPreview({ kind: 'pointer', owner, target: null }),
    onFocusCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (
        active &&
        (event.target.matches(':focus-visible') || event.currentTarget.matches(':focus-visible'))
      ) {
        setPreview({ kind: 'keyboard', owner, target })
      }
    },
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        setPreview({ kind: 'keyboard', owner, target: null })
    },
  }
}

export const LanguagePreviewItem = ({
  target,
  active,
  ...props
}: ComponentPropsWithRef<'li'> & {
  readonly target: LanguageMapTarget
  readonly active: boolean
}) => <li {...props} {...useLanguagePreview(target, active)} />

export const LanguagePreviewArticle = ({
  target,
  ...props
}: ComponentPropsWithRef<'article'> & {
  readonly target: LanguageMapTarget
}) => <article {...props} {...useLanguagePreview(target)} />
