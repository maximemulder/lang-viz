import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { SidebarPane } from '../../components/SidebarPane'
import type { AtlasData, TemporalViewId } from '../../domain/atlas'
import {
  atlasDataAtom,
  browseGeographyViewAtom,
  geographyContextAtom,
  showOnlyGeographyViewAtom,
} from '../../state/atlasState'

const datasetViews = ({ datasets, variants }: AtlasData) => {
  const periodsByDataset = new Map<string, Map<TemporalViewId, string>>()
  for (const { datasetId, temporalCoverage } of variants) {
    let periods = periodsByDataset.get(datasetId)
    if (!periods) {
      periods = new Map()
      periodsByDataset.set(datasetId, periods)
    }
    if (!periods.has(temporalCoverage.viewId))
      periods.set(temporalCoverage.viewId, temporalCoverage.label)
  }
  return datasets.flatMap((dataset) =>
    [...(periodsByDataset.get(dataset.id) ?? [])].map(([viewId, periodLabel]) => ({
      datasetId: dataset.id,
      viewId,
      name: dataset.shortName,
      periodLabel,
      citation: dataset.citation,
      label: `${dataset.shortName} · ${periodLabel}`,
    })),
  )
}

export const GeographyFilters = () => {
  const data = useAtomValue(atlasDataAtom)
  const { sources, period } = useAtomValue(geographyContextAtom)
  const views = useMemo(() => datasetViews(data), [data])
  const browse = useSetAtom(browseGeographyViewAtom)
  const showOnly = useSetAtom(showOnlyGeographyViewAtom)
  const activeView =
    sources !== 'all' && sources.length === 1
      ? views.find((view) => view.datasetId === sources[0] && view.viewId === period)
      : undefined

  return (
    <SidebarPane
      className="finder-options"
      title="Data sources"
      summary={`Browsing ${activeView?.label ?? 'any dataset'}`}
    >
      <ul className="geography-sources" aria-label="Geographic dataset views">
        {views.map((view) => {
          const active = view === activeView
          return (
            <li
              className="geography-sources__row"
              key={`${view.datasetId}/${view.viewId}`}
              data-dataset-id={view.datasetId}
              data-view-id={view.viewId}
            >
              <div>
                <strong title={view.citation}>{view.name}</strong>
                <small>{view.periodLabel}</small>
              </div>
              <div className="geography-sources__actions">
                <button
                  type="button"
                  className="geography-sources__show"
                  aria-label={`Show only ${view.label}`}
                  onClick={() => showOnly(view)}
                >
                  Show
                </button>
                <input
                  type="checkbox"
                  className="geography-sources__browse"
                  aria-label={`Browse ${view.label}`}
                  title={`Browse ${view.label}`}
                  checked={active}
                  onChange={(event) => browse(event.currentTarget.checked ? view : null)}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </SidebarPane>
  )
}
