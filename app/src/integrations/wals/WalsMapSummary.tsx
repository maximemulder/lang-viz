import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { LanguagePreviewItem } from '../../features/languages/LanguagePreview'
import { readableWalsValue, WALS_TITLES } from '../../features/wals/cards'
import { walsRepositoryAtom, walsSessionAtom } from '../../features/wals/state'
import { atlasDataAtom } from '../../state/atlasState'
import { walsAreaMatchesAtom } from './areaState'
import { clearWalsOverlayAtom, inspectWalsObservationAtom } from './state'
import './walsMap.css'
export default function WalsMapSummary() {
  const overlay = useAtomValue(walsSessionAtom).overlay
  const repository = useAtomValue(walsRepositoryAtom)
  const matches = useAtomValue(walsAreaMatchesAtom)
  const atlas = useAtomValue(atlasDataAtom)
  const clear = useSetAtom(clearWalsOverlayAtom),
    inspect = useSetAtom(inspectWalsObservationAtom)
  const [expanded, setExpanded] = useState(false),
    [limit, setLimit] = useState(12)
  if (!overlay?.visible || !repository || !matches) return null
  const category = repository.data.categories[matches.categoryId ?? '']
  const languages = [...matches.mappedIds]
    .flatMap((id) => atlas.languageById.get(id) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <aside
      className="wals-map-summary"
      aria-label="Matching language areas"
      data-wals-feature={overlay.featureId}
    >
      <button
        type="button"
        className="wals-summary-close"
        aria-label="Clear matching language areas"
        onClick={() => clear()}
      >
        ×
      </button>
      <p className="eyebrow">Shared language feature</p>
      <h2>
        {WALS_TITLES[overlay.featureId] ?? 'Language feature'} ·{' '}
        {category ? readableWalsValue(overlay.featureId, category.name) : 'Unknown'}
      </h2>
      <p>
        {languages.length} language areas highlighted. Hover to preview, click for information,
        double-click to isolate.
      </p>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>Languages and data</summary>
        <p>
          Areas come from the current map sources and period. Recorded WALS varieties supply the
          feature values. Shared features do not establish ancestry.
        </p>
        <p>
          {matches.withoutAreas.length} matched entries have no area in these sources;{' '}
          {matches.conflicts.size} have conflicting variety records; {matches.unresolved} source
          records have no suitable language match. None receive invented boundaries.
        </p>
        {expanded && (
          <>
            <ul className="wals-map-list">
              {languages.slice(0, limit).map((language) => (
                <LanguagePreviewItem active key={language.id} target={{ languageId: language.id }}>
                  <button
                    type="button"
                    onClick={() => {
                      const id = matches.byLanguage.get(language.id)?.[0]
                      if (id) inspect({ sourceId: id, featureId: overlay.featureId })
                    }}
                  >
                    {language.name}
                  </button>
                </LanguagePreviewItem>
              ))}
            </ul>
            {languages.length > limit && (
              <button type="button" onClick={() => setLimit(limit + 12)}>
                Show 12 more
              </button>
            )}
          </>
        )}
      </details>
    </aside>
  )
}
