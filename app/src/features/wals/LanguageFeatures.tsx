import { useAtomValue, useSetAtom } from 'jotai'
import type { WalsReference, WalsRepository } from '../../domain/wals.ts'
import type { WalsAssociation } from '../../integrations/wals/languageMatching.ts'
import { resolveWalsProfile } from '../../integrations/wals/profile.ts'
import {
  inspectWalsObservationAtom,
  selectWalsVarietyAtom,
  walsAssociationsAtom,
  walsInspectionAtom,
} from '../../integrations/wals/state.ts'
import {
  WALS_DEFINITIONS,
  WALS_SHORTLIST,
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
      <h5>
        {feature.name} <small>({featureId})</small>
      </h5>
      {inspected && <p className="wals-context">Inspected observation</p>}
      <strong>{category?.name ?? 'Not recorded in this WALS snapshot'}</strong>
      {illustration && (
        <p className="wals-illustration">
          “{illustration}” — reordered English words; Sam = subject, eats = verb, rice = object.
          This is an illustration, not a translation or a sentence in the recorded variety.
        </p>
      )}
      {orokErratum && (
        <p className="wals-caveat">
          Source erratum: Orok’s adjective order is disputed in the supplied errata, which report
          adjective–noun order. This card retains the published snapshot value. See source notes.
        </p>
      )}
      <details>
        <summary>Definition and evidence: {featureId}</summary>
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
      <summary>WALS version, variety bibliography and source notes</summary>
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
  const inspect = useSetAtom(inspectWalsObservationAtom)
  if (!record) return <p>The recorded WALS variety is unavailable.</p>
  const cards = walsCardFeatures(repository, sourceId, featureId)
  const observed = repository.index.bySource.get(sourceId)
  return (
    <div className="wals-record" data-source-id={sourceId}>
      <p className="wals-identity">
        Recorded variety:{' '}
        <a href={record.url} target="_blank" rel="noreferrer">
          {record.name}
        </a>{' '}
        ({sourceId}){' · '}Source region: {record.macroarea || 'Unspecified'}
      </p>
      {association?.status === 'associated' && (
        <p className={association.scope === 'broader' ? 'wals-caveat' : 'wals-context'}>
          {association.scope === 'broader' && (
            <strong>Broader catalog association ({association.level}). </strong>
          )}
          {association.explanation}
        </p>
      )}
      <p className="wals-context">
        An editorial summary of this variety’s recorded structures, not a uniqueness ranking.
      </p>
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
      <details>
        <summary>How are these cards selected?</summary>
        <p>
          Word order (81A) and the best-covered other shortlisted feature in this source region keep
          their slots, including unknown values. Coverage counts every WALS source variety once,
          including varieties without an atlas match. Ties follow 13A, 12A, 30A, 87A, 37A, 92A. A
          third card uses the first observed extra in priority order 13A, 30A, 12A, 37A, 92A, 87A.
          An inspected feature is also revealed. No uniqueness or representativeness is implied by
          these editorial choices.
        </p>
      </details>
      {!!observed?.size && (
        <label className="wals-select">
          Inspect a recorded feature
          <select
            aria-label="Inspect a recorded WALS feature"
            value={featureId ?? ''}
            onChange={(event) => {
              if (event.currentTarget.value)
                inspect({ sourceId, featureId: event.currentTarget.value })
            }}
          >
            <option value="" disabled>
              Choose an observation
            </option>
            {WALS_SHORTLIST.filter((id) => observed.has(id)).map((id) => (
              <option key={id} value={id}>
                {repository.data.features[id]?.name} ({id})
              </option>
            ))}
          </select>
        </label>
      )}
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
          <p>
            Explore recorded language structures from WALS. Coverage varies by variety and feature.
          </p>
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
              {profile.message} Missing records do not mean the entry lacks these features. No
              values are inherited from relatives.
            </p>
          )}
          {!profile.record && profile.sourceId && (
            <p>Saved WALS variety: {profile.sourceId} (unavailable for this profile).</p>
          )}
          {profile.sourceIds.length > 1 || (profile.sourceIds.length && !profile.record) ? (
            <label className="wals-select">
              Recorded WALS variety
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
