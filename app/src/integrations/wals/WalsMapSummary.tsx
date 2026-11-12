import { useAtomValue, useSetAtom } from 'jotai'
import { walsRepositoryAtom, walsSessionAtom } from '../../features/wals/state.ts'
import {
  clearWalsOverlayAtom,
  focusWalsExamplesAtom,
  inspectWalsObservationAtom,
  setWalsOverlayVisibilityAtom,
  walsAssociationsAtom,
  walsExampleGeometryAtom,
  walsExampleSelectionAtom,
} from './state.ts'
import './walsMap.css'

export default function WalsMapSummary() {
  const repository = useAtomValue(walsRepositoryAtom)
  const overlay = useAtomValue(walsSessionAtom).overlay
  const selection = useAtomValue(walsExampleSelectionAtom)
  const geometry = useAtomValue(walsExampleGeometryAtom)
  const associations = useAtomValue(walsAssociationsAtom)
  const inspect = useSetAtom(inspectWalsObservationAtom)
  const focus = useSetAtom(focusWalsExamplesAtom)
  const setVisible = useSetAtom(setWalsOverlayVisibilityAtom)
  const clear = useSetAtom(clearWalsOverlayAtom)
  if (!overlay) return null
  const data = repository?.data
  const origin = data?.records[overlay.sourceId]
  const located = geometry?.features.length ?? 0
  return (
    <aside
      className="wals-map-summary"
      aria-label="WALS recorded examples"
      data-wals-origin={overlay.sourceId}
      data-wals-feature={overlay.featureId}
    >
      <p className="eyebrow">WALS recorded examples{!overlay.visible && ' · Hidden'}</p>
      <h2>
        Recorded examples sharing {data?.features[overlay.featureId]?.name ?? overlay.featureId}:{' '}
        {data?.categories[selection?.categoryId ?? '']?.name ?? 'Unavailable'}
      </h2>
      <p>
        Origin: {origin?.name ?? overlay.sourceId} ({overlay.sourceId}). Values describe exact
        recorded varieties.
      </p>
      <div className="wals-map-actions">
        <button type="button" onClick={() => focus()} disabled={!overlay.visible || !located}>
          Focus WALS examples
        </button>
        <button
          type="button"
          aria-pressed={overlay.visible}
          onClick={() => setVisible(!overlay.visible)}
        >
          {overlay.visible ? 'Hide WALS overlay' : 'Show WALS overlay'}
        </button>
        <button type="button" onClick={() => clear()}>
          Clear WALS overlay
        </button>
      </div>
      {!selection || !data ? (
        <p role="status">
          The selected source observation is unavailable. Clear this overlay or choose another
          recorded value explicitly.
        </p>
      ) : (
        <>
          <p className="wals-map-counts">
            {selection.counts.displayedExamples} examples selected from{' '}
            {selection.counts.candidateRecords} located candidates at{' '}
            {selection.counts.groupedCandidates} distinct candidate locations.{' '}
            {selection.counts.matchingRecords} matching WALS records;{' '}
            {selection.counts.locatedRecords} located, including the origin when located.
          </p>
          {!selection.origin.coordinates && (
            <p role="status">
              The origin has no usable WALS location. Its evidence remains available; points show
              located examples only.
            </p>
          )}
          {!selection.examples.length && (
            <p role="status">
              No other located records share this exact category. The origin evidence remains
              available below.
            </p>
          )}
          <p>
            Illustrative geographic selection; not a representative sample, similarity ranking, or
            evidence of ancestry, borrowing or contact.
          </p>
          <p>
            Dateline-spanning selections use a world-width view in single-world Mercator; points may
            appear on opposite map edges.
          </p>
          <p className="wals-map-legend">
            <span className="wals-map-symbol is-diamond" aria-hidden="true" /> Origin (viewing
            reference) · <span className="wals-map-symbol" aria-hidden="true" /> Recorded example.
            No relationship lines.
          </p>
          <details key={`${overlay.sourceId}:${overlay.featureId}`}>
            <summary>Inspect origin and all {selection.examples.length} selected examples</summary>
            <ol className="wals-map-list">
              {[selection.origin, ...selection.examples].map((example, index) => {
                const association = associations?.bySource.get(example.sourceId)
                const shared =
                  geometry?.features.find((feature) =>
                    feature.properties.sourceIds.includes(example.sourceId),
                  )?.properties.sourceIds.length ?? 0
                return (
                  <li key={example.sourceId}>
                    <button
                      type="button"
                      data-wals-source={example.sourceId}
                      onClick={() =>
                        inspect({ sourceId: example.sourceId, featureId: overlay.featureId })
                      }
                    >
                      Inspect {data.records[example.sourceId]?.name} ({example.sourceId})
                      {index === 0 && ' · Origin'}
                    </button>
                    <small>
                      {overlay.featureId}: {data.categories[selection.categoryId]?.name}.{' '}
                      {shared > 1 && `${shared} displayed observations share this point. `}
                      {!example.coordinates && 'No usable source location. '}
                      {association?.status === 'associated'
                        ? association.scope === 'broader'
                          ? `Broader catalog association (${association.level}); value applies only to this WALS variety.`
                          : 'Catalog association available.'
                        : `${association?.status ?? 'Catalog pending'}; inspection opens WALS source evidence.`}
                    </small>
                  </li>
                )
              })}
            </ol>
          </details>
          <p>
            <a href={data.features[overlay.featureId]?.chapterUrl} target="_blank" rel="noreferrer">
              WALS feature definition and chapter
            </a>{' '}
            · {data.provenance.snapshot ?? 'Unspecified snapshot'}. Source locations are
            representative points.
          </p>
        </>
      )}
    </aside>
  )
}
