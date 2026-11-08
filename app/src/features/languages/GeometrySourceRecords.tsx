import { useState } from 'react'
import { type GeometryProvenance, loadGeometryProvenance } from '../../data/atlasRepository'
import type { AtlasManifest, GeometryVariant } from '../../domain/atlas'

/** Original source identifiers are downloaded only when explicitly expanded. */
export const GeometrySourceRecords = ({
  manifest,
  variant,
}: {
  readonly manifest: AtlasManifest
  readonly variant: GeometryVariant
}) => {
  const [record, setRecord] = useState<GeometryProvenance | null>(null)
  const [status, setStatus] = useState('')
  const load = () => {
    if (record || status === 'Loading source records…') return
    setStatus('Loading source records…')
    loadGeometryProvenance(manifest, variant)
      .then((result) => {
        setRecord(result)
        setStatus('')
      })
      .catch(() => setStatus('Could not load source records. Close and reopen to retry.'))
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) load()
      }}
    >
      <summary>Original source records</summary>
      {record ? (
        <>
          <p>{record.sourceFile}</p>
          <p>
            {record.sourceFeatureIds.length.toLocaleString()} source features:{' '}
            {record.sourceFeatureIds.join(', ')}
          </p>
        </>
      ) : (
        <p role="status">{status}</p>
      )}
    </details>
  )
}
