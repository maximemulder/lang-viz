/** Explicit offline review, not deployed code. Requires restored WALS/atlas browser data. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import type { Language } from '../src/domain/atlas.ts'
import { indexWals } from '../src/domain/wals.ts'
import {
  selectWalsExamples,
  type WalsPoint,
  walsExampleGeometry,
} from '../src/domain/walsExamples.ts'
import { validateWalsData } from '../src/domain/walsValidation.ts'
import { associateWals } from '../src/integrations/wals/languageMatching.ts'

const sourceCommit = '3b7078614efcfebc1c471fea2c4ab7fb336745a6'
const source = execFileSync(
  'git',
  ['show', `${sourceCommit}:app/src/domain/featureConnections.ts`],
  {
    encoding: 'utf8',
  },
)
// Execute only the reviewed historical pure module for side-by-side comparison.
// It has no runtime imports. No legacy geometry is copied into the application.
const legacy = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`
)
const bytes = readFileSync(new URL('../public/wals/features.json', import.meta.url))
const data: unknown = JSON.parse(bytes.toString())
validateWalsData(data)
const repository = indexWals(data)
const catalogBytes = readFileSync(new URL('../public/data/languages.json', import.meta.url))
const catalog: Language[] = JSON.parse(catalogBytes.toString())
const associations = associateWals(repository, catalog)
const oldRecords = Object.entries(data.records).map(([id, record]) => {
  const association = associations.bySource.get(id)
  return {
    id,
    name: record.name,
    atlasId: association?.status === 'associated' ? association.atlasId : null,
    longitude: record.coordinates?.[0] ?? null,
    latitude: record.coordinates?.[1] ?? null,
    values: Object.fromEntries(
      [...(repository.index.bySource.get(id) ?? [])].map(([featureId, observationId]) => [
        featureId,
        { code: data.observations[observationId]?.categoryId },
      ]),
    ),
  }
})
const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
const project = ([longitude, latitude]: WalsPoint) => [
  20 + (longitude + 180) * 1.5,
  20 + (90 - latitude) * 1.5,
]
const review = []
const sections = []
for (const [sourceId, featureId] of [
  ['eng', '81A'],
  ['ird', '12A'],
  ['kyq', '37A'],
  ['aea', '12A'],
  ['mla', '81A'],
] as const) {
  const selection = selectWalsExamples(repository, sourceId, featureId)
  assert.ok(selection)
  const origin = oldRecords.find((record) => record.id === sourceId)
  assert.ok(origin)
  const targets = selection.examples.map((example) =>
    oldRecords.find((record) => record.id === example.sourceId),
  )
  assert.ok(targets.every(Boolean))
  const arcs = legacy.connectionGeometry({ origin, targets, featureId, total: targets.length })
  const oldSelection = legacy.sharedFeatureConnections({ languages: oldRecords }, origin, featureId)
  const paths = arcs.features.flatMap((feature: { geometry: { coordinates: number[][][] } }) =>
    feature.geometry.coordinates.map((line) =>
      line
        .map((point) => {
          assert.ok(point.every(Number.isFinite))
          const [x, y] = project(point as [number, number])
          return `${x},${y}`
        })
        .join(' '),
    ),
  )
  const markers = [selection.origin, ...selection.examples]
    .map((example, index) => {
      if (!example.coordinates) return ''
      const [x, y] = project(example.coordinates)
      return `${
        index === 0
          ? `<path d="M ${x} ${y - 7} l 7 7 l -7 7 l -7 -7 Z" fill="#ac491a" stroke="white"/>`
          : `<circle cx="${x}" cy="${y}" r="5" fill="#23688b" stroke="white"/>`
      }
      <text x="${x + 6}" y="${y - 5}" font-size="12">${index === 0 ? 'Origin' : index}</text>`
    })
    .join('')
  const grid = [
    ...[-180, -120, -60, 0, 60, 120, 180].map((longitude) => {
      const [x] = project([longitude, 0])
      return `<path d="M${x},20 V290"/><text x="${x}" y="309">${longitude}°</text>`
    }),
    ...[-90, -45, 0, 45, 90].map((latitude) => {
      const [, y] = project([0, latitude])
      return `<path d="M20,${y} H560"/>`
    }),
  ].join('')
  const panel = (
    title: string,
    lines: boolean,
  ) => `<svg viewBox="0 0 580 325" role="img" aria-label="${title}: ${escapeHtml(origin.name)}">
    <title>${title}; same observations and equirectangular graticule</title>
    <rect x="20" y="20" width="540" height="270" fill="#f3f7f9"/>
    <g stroke="#d1dade" stroke-width="0.6" fill="#52616b" font-size="9">${grid}</g>
    ${lines ? paths.map((path: string) => `<polyline points="${path}" fill="none" stroke="#23688b" opacity="0.65" stroke-width="1.5"/>`).join('') : ''}
    ${markers}</svg>`
  const rows = selection.examples
    .map((example, index) => {
      const association = associations.bySource.get(example.sourceId)
      return `<tr><td>${index + 1}</td><td>${escapeHtml(data.records[example.sourceId]?.name)} (${escapeHtml(example.sourceId)})</td><td>${escapeHtml(example.observationId)}</td><td>${escapeHtml(example.coordinates.join(', '))}</td><td>${escapeHtml(association?.status === 'associated' ? `${association.atlasId} (${association.scope})` : association?.status)}</td></tr>`
    })
    .join('')
  sections.push(`<section><h2>${escapeHtml(origin.name)} (${sourceId}), ${featureId}: ${escapeHtml(data.categories[selection.categoryId]?.name)}</h2>
    <p>Counts: ${escapeHtml(JSON.stringify(selection.counts))}. Orange diamond: origin. Blue numbered points: exact source observations.</p>
    <div class="panels"><figure><figcaption>Chosen: static points, no relationship edges</figcaption>${panel('Static points', false)}</figure><figure><figcaption>Prototype arcs, identical selected records</figcaption>${panel('Historical arcs', true)}</figure></div>
    <p>Illustrative geographic selection, not a representative sample or a similarity ranking. These arcs carry no recorded ancestry, borrowing or contact evidence. Graticule only; this is a design comparison, not the production map.</p>
    <table><thead><tr><th>#</th><th>Recorded variety</th><th>Observation</th><th>WALS lon, lat</th><th>Catalog association</th></tr></thead><tbody>${rows}</tbody></table></section>`)
  review.push({
    sourceId,
    featureId,
    categoryId: selection.categoryId,
    counts: selection.counts,
    originAssociation: associations.bySource.get(sourceId),
    selected: selection.examples.map((example) => ({
      ...example,
      association: associations.bySource.get(example.sourceId),
    })),
    pointGeometry: walsExampleGeometry(selection),
    historicalSelection: {
      total: oldSelection.total,
      sourceIds: oldSelection.targets.map((record: { id: string }) => record.id),
    },
    historicalArcsOnSameSelection: arcs,
  })
}
const dateline = legacy.splitAtDateLine([
  [-180, 10],
  [180, 20],
])
assert.ok(dateline.flat(2).some((coordinate: number) => !Number.isFinite(coordinate)))
const output = new URL('../test-results/wals-05/', import.meta.url)
mkdirSync(output, { recursive: true })
writeFileSync(
  new URL('review.json', output),
  `${JSON.stringify(
    {
      sourceCommit,
      snapshot: data.provenance.snapshot,
      bundleSha256: createHash('sha256').update(bytes).digest('hex'),
      catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
      legacyExactDatelineProducesNonfinite: true,
      review,
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  new URL('review.html', output),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WALS-05 representation review</title>
<style>body{font:16px system-ui;margin:24px;color:#23313b;background:#fff}section{margin:32px 0 64px}h1,h2{line-height:1.3}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0}svg{width:100%}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #cbd4d8;padding:6px;text-align:left}p{overflow-wrap:anywhere}@media(max-width:700px){.panels{grid-template-columns:1fr}table{font-size:11px}}</style>
<h1>WALS-05: points versus historical arcs</h1><p>Snapshot ${escapeHtml(data.provenance.snapshot)}. Each pair uses the same origin, category, 12 selected source records and projection. No animation. Points are chosen for WALS-06; no map controls are mounted in this step. Actual word-history edges encode recorded DiACL relationships and have typed line colors. Shared WALS categories do not establish such relationships.</p>${sections.join('')}<p>Historical geometry comes directly from ${sourceCommit}. Its exact −180/+180 input produces nonfinite coordinates; this code is not ported.</p></html>\n`,
)
console.log(`Wrote ${output.pathname}review.html and review.json (five real comparisons).`)
