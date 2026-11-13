import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import type { WalsReference, WalsRepository } from '../../domain/wals.ts'
import type { WalsAssociation } from '../../integrations/wals/languageMatching.ts'
import { resolveWalsProfile } from '../../integrations/wals/profile.ts'
import {
  clearWalsOverlayAtom,
  selectWalsVarietyAtom,
  showWalsExamplesAtom,
  walsAssociationsAtom,
  walsInspectionAtom,
} from '../../integrations/wals/state.ts'
import {
  readableWalsValue,
  WALS_DEFINITIONS,
  WALS_TITLES,
  walsCardFeatures,
  walsWordOrderIllustration,
} from './cards.ts'
import {
  loadWalsAtom,
  walsActionAtom,
  walsLoadStateAtom,
  walsRepositoryAtom,
  walsSessionAtom,
} from './state.ts'
import './wals.css'

const References = ({
  repository,
  references,
}: {
  readonly repository: WalsRepository
  readonly references: readonly WalsReference[]
}) => (
  <ul className="wals-references">
    {references.map(({ sourceId, pages }) => {
      const reference = repository.data.references[sourceId]
      return (
        <li key={`${sourceId}/${pages}`}>
          {reference ? (
            <>
              <a href={reference.url} target="_blank" rel="noreferrer">
                {reference.fields.author || sourceId}
                {reference.fields.year ? ` (${reference.fields.year})` : ''}
                {' · '}
                {reference.fields.title || 'Title unavailable in this snapshot'}
              </a>
              {reference.fields.journal ? ` · ${reference.fields.journal}` : ''}
              {reference.fields.publisher ? ` · ${reference.fields.publisher}` : ''}
            </>
          ) : (
            <span>Reference unavailable: {sourceId}</span>
          )}
          {pages ? ` · pp. ${pages}` : ''}
        </li>
      )
    })}
  </ul>
)

export const WalsFeatureCard = ({
  repository,
  sourceId,
  featureId,
  inspected = false,
}: {
  readonly repository: WalsRepository
  readonly sourceId: string
  readonly featureId: string
  readonly inspected?: boolean
}) => {
  const showExamples = useSetAtom(showWalsExamplesAtom)
  const clearOverlay = useSetAtom(clearWalsOverlayAtom)
  const overlay = useAtomValue(walsSessionAtom).overlay
  const active =
    overlay?.visible && overlay.sourceId === sourceId && overlay.featureId === featureId
  const { data, index } = repository
  const feature = data.features[featureId]
  if (!feature) return null
  const observationId = index.bySource.get(sourceId)?.get(featureId)
  const observation = observationId ? data.observations[observationId] : undefined
  const category = observation ? data.categories[observation.categoryId] : undefined
  const illustration =
    featureId === '81A' && category ? walsWordOrderIllustration(category.name) : null
  const orokErratum = data.records[sourceId]?.name === 'Orok' && featureId === '87A'
  return (
    <article className="wals-card" data-feature-id={featureId} data-observed={!!observation}>
      <h5>{WALS_TITLES[featureId] ?? feature.name}</h5>
      <strong>{category ? readableWalsValue(featureId, category.name) : 'Not recorded'}</strong>
      {illustration && (
        <p className="wals-illustration">
          “{illustration}” ·{' '}
          {category?.name
            .split('')
            .map((role) => ({ S: 'who', V: 'action', O: 'what' })[role])
            .join(' → ')}
        </p>
      )}
      {orokErratum && (
        <p className="wals-caveat">This recorded value is disputed. See the source notes below.</p>
      )}
      {observation && (
        <button
          type="button"
          className="wals-highlight-action"
          aria-pressed={Boolean(active)}
          aria-label={`${active ? 'Clear' : 'Highlight'} matching languages for ${WALS_TITLES[featureId] ?? feature.name}`}
          onClick={() => (active ? clearOverlay() : showExamples({ sourceId, featureId }))}
        >
          {active ? 'Clear highlights' : 'Find languages like this'}
        </button>
      )}
      <details>
        <summary>What this means &amp; sources</summary>
        <p>
          Recorded WALS value: {category?.name ?? 'Unknown'}.{' '}
          {inspected ? 'Selected observation.' : ''}
        </p>
        {illustration && (
          <p>The example rearranges English words to explain the order; it is not a translation.</p>
        )}
        <p>{WALS_DEFINITIONS[featureId] ?? feature.description}</p>
        {category?.description && <p>{category.description}</p>}
        <p>
          <a href={feature.url} target="_blank" rel="noreferrer">
            Feature definition
          </a>
          {' · '}
          <a href={feature.chapterUrl} target="_blank" rel="noreferrer">
            Read the WALS chapter
          </a>
        </p>
        <p>{feature.chapterCitation}</p>
        {observation ? (
          <>
            <p>
              <a href={observation.url} target="_blank" rel="noreferrer">
                Recorded observation
              </a>
              {' for '}
              {data.records[sourceId]?.name} ({sourceId})
            </p>
            {observation.comment && <p>{observation.comment}</p>}
            {observation.references.length ? (
              <References repository={repository} references={observation.references} />
            ) : (
              <p>
                This value is recorded, but an observation reference is unavailable in this
                snapshot.
              </p>
            )}
            {observation.exampleIds.map((id) => {
              const example = data.examples[id]
              return example ? (
                <blockquote key={id}>
                  <a href={example.url} target="_blank" rel="noreferrer">
                    Source example {id}
                  </a>
                  <p className="wals-source-text">{example.text}</p>
                  {example.analyzed && <p className="wals-source-text">{example.analyzed}</p>}
                  {example.gloss && <p className="wals-source-text">{example.gloss}</p>}
                  {example.translation && <p>{example.translation}</p>}
                  {example.comment && <p>{example.comment}</p>}
                </blockquote>
              ) : null
            })}
          </>
        ) : (
          <p>
            No observation is recorded here for this variety. This does not mean the variety lacks
            this feature; no value is inferred from relatives.
          </p>
        )}
      </details>
    </article>
  )
}

const SourceNotes = ({
  repository,
  sourceId,
}: {
  readonly repository: WalsRepository
  readonly sourceId: string
}) => {
  const { data } = repository
  const record = data.records[sourceId]
  return (
    <details className="wals-source-notes">
      <summary>Sources and data</summary>
      <p>{data.provenance.citation}</p>
      <p>
        Snapshot: {data.provenance.snapshot ?? 'Unspecified'} · Source commit:{' '}
        {data.provenance.commit ?? 'Unspecified'}
      </p>
      <p>
        {data.provenance.sourceUrl && (
          <a href={data.provenance.sourceUrl} target="_blank" rel="noreferrer">
            Source dataset
          </a>
        )}
        {' · '}
        <a href={data.provenance.license} target="_blank" rel="noreferrer">
          License
        </a>
      </p>
      <h5>Variety bibliography</h5>
      <p>
        These references describe the variety; each card lists its observation references
        separately.
      </p>
      {record?.references.length ? (
        <References repository={repository} references={record.references} />
      ) : (
        <p>No variety bibliography supplied.</p>
      )}
      <p>{data.sourceNotices.errataPolicy}</p>
      <details>
        <summary>Supplied errata</summary>
        <pre className="wals-source-text">{data.sourceNotices.errata}</pre>
      </details>
      <details>
        <summary>Attribution and adapter notice</summary>
        <pre className="wals-source-text">{data.sourceNotices.notice}</pre>
      </details>
    </details>
  )
}

const RecordedFeatures = ({
  repository,
  sourceId,
  featureId,
  association,
}: {
  readonly repository: WalsRepository
  readonly sourceId: string
  readonly featureId: string | null
  readonly association: WalsAssociation | null
}) => {
  const record = repository.data.records[sourceId]
  if (!record) return <p>The recorded WALS variety is unavailable.</p>
  const cards = walsCardFeatures(repository, sourceId, featureId)
  const observed = repository.index.bySource.get(sourceId)
  return (
    <div className="wals-record" data-source-id={sourceId}>
      <p className="wals-identity">Recorded for {record.name} · WALS</p>
      {association?.status === 'associated' && association.scope === 'broader' && (
        <p className="wals-caveat">
          These values describe the recorded variety, not the whole language group.
        </p>
      )}
      {!observed?.size && (
        <p>WALS includes this variety, but none of these selected features is recorded.</p>
      )}
      <div className="wals-cards">
        {cards.map((id) => (
          <WalsFeatureCard
            key={id}
            repository={repository}
            sourceId={sourceId}
            featureId={id}
            inspected={id === featureId}
          />
        ))}
      </div>
      <SourceNotes repository={repository} sourceId={sourceId} />
    </div>
  )
}

export const LanguageFeatures = ({ profileId }: { readonly profileId: string }) => {
  const repository = useAtomValue(walsRepositoryAtom)
  const loading = useAtomValue(walsLoadStateAtom)
  const associations = useAtomValue(walsAssociationsAtom)
  const session = useAtomValue(walsSessionAtom)
  const load = useSetAtom(loadWalsAtom)
  const selectVariety = useSetAtom(selectWalsVarietyAtom)
  useEffect(() => {
    if (!repository && loading.status === 'idle') void load()
  }, [repository, loading.status, load])
  const profile =
    repository && associations
      ? resolveWalsProfile(repository, associations, session, profileId)
      : null
  return (
    <section
      className="wals-panel"
      aria-label="Language features from WALS"
      aria-busy={loading.status === 'loading'}
    >
      <h4>How this language works</h4>
      {!repository ? (
        <>
          {loading.status === 'loading' ? (
            <p role="status">Loading language features…</p>
          ) : (
            <>
              {loading.status === 'error' && (
                <p role="alert">Feature data could not be loaded. {loading.message}</p>
              )}
              <button type="button" onClick={() => load()}>
                {loading.status === 'error' ? 'Retry WALS features' : 'Load WALS features'}
              </button>
            </>
          )}
        </>
      ) : !profile ? (
        <p role="status">Associating WALS with the complete atlas catalog…</p>
      ) : (
        <>
          {profile.message && (
            <p role="status">
              {profile.sourceIds.length
                ? 'The saved variety is unavailable. Choose another recorded variety below.'
                : 'No WALS record is linked to this entry. This means information is unavailable, not that the language lacks these features.'}
            </p>
          )}
          {!profile.record && profile.sourceId && (
            <p>Saved WALS variety: {profile.sourceId} (unavailable for this profile).</p>
          )}
          {profile.sourceIds.length > 1 || (profile.sourceIds.length && !profile.record) ? (
            <details className="wals-varieties">
              <summary>Recorded variety</summary>
              <label className="wals-select">
                WALS variety
                <select
                  aria-label="Recorded WALS variety"
                  value={profile.record ? (profile.sourceId ?? '') : ''}
                  onChange={(event) =>
                    selectVariety({ profileId, sourceId: event.currentTarget.value })
                  }
                >
                  {!profile.record && (
                    <option value="" disabled>
                      Choose a variety
                    </option>
                  )}
                  {profile.sourceIds.map((id) => (
                    <option key={id} value={id}>
                      {repository.data.records[id]?.name} ({id})
                    </option>
                  ))}
                </select>
              </label>
            </details>
          ) : null}
          {profile.record && profile.sourceId && (
            <RecordedFeatures
              repository={repository}
              sourceId={profile.sourceId}
              featureId={profile.featureId}
              association={profile.association}
            />
          )}
        </>
      )}
    </section>
  )
}

/** Unresolved evidence never appears under the previous atlas profile's identity. */
export const WalsStandaloneInspection = () => {
  const repository = useAtomValue(walsRepositoryAtom)
  const inspection = useAtomValue(walsInspectionAtom)
  const dispatch = useSetAtom(walsActionAtom)
  if (!repository || !inspection) return null
  if (inspection.profileId) return null
  return (
    <section className="wals-panel wals-standalone" aria-label="Standalone WALS source inspection">
      <h4>WALS source inspection</h4>
      <button type="button" onClick={() => dispatch({ type: 'clear-inspection' })}>
        Close source inspection
      </button>
      <p>{inspection.message}</p>
      <RecordedFeatures
        repository={repository}
        sourceId={inspection.sourceId}
        featureId={inspection.featureId}
        association={inspection.association}
      />
    </section>
  )
}
