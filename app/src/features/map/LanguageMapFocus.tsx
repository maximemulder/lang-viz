import { useAtomValue } from 'jotai'
import { type LanguageMapTarget, targetGeometry } from '../../domain/languageFocus'
import {
  atlasDataAtom,
  geographyAvailabilityAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
  selectedMapAreasAtom,
} from '../../state/atlasState'
import {
  languageKeyboardPreviewAtom,
  languagePanelAtom,
  languagePointerPreviewAtom,
} from '../../state/languageControls'
import { searchCoverageAtom } from '../../state/searchSelection'
import { GeometryHighlight } from './GeometryHighlight'
import { useGeometryDisplay } from './geometry/display'
import { GeometryPreview } from './geometry/GeometryPreview'

/** Selection and transient sidebar preview resolve through the same geometry path. */
const LanguageTargetOutline = ({
  target,
  id,
  highlightStyle,
  coordinateDisplay,
}: {
  readonly target: LanguageMapTarget
  readonly id: string
  readonly highlightStyle: 'selected' | 'hover'
  readonly coordinateDisplay: boolean
}) => {
  const data = useAtomValue(atlasDataAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const selected = useAtomValue(selectedMapAreasAtom)
  const { state } = useGeometryDisplay()
  const variants = targetGeometry(target, data, availability, coverage, hierarchy, entries)
  const ids = [...new Set(variants.map(({ id }) => id))].sort()
  if (!ids.length) return null
  const groupEntries = target?.groupId
    ? new Set(
        entries.filter((entry) => entry.group?.id === target.groupId).map((entry) => entry.id),
      )
    : null
  const candidates = selected.filter((area) =>
    target?.entryId
      ? area.id === target.entryId
      : groupEntries
        ? groupEntries.has(area.id)
        : area.variants.every((variant) => ids.includes(variant.id)),
  )
  const represented = [
    ...new Set(candidates.flatMap((area) => area.variants.map((variant) => variant.id))),
  ].sort()
  if (
    state.source &&
    (state.snapshot?.composed || candidates.length === 1) &&
    JSON.stringify(represented) === JSON.stringify(ids)
  )
    return (
      <GeometryHighlight
        key={state.source}
        id={id}
        source={state.source}
        groups={[candidates.map((area) => area.id)]}
        variants={ids}
      />
    )
  return (
    <GeometryPreview
      key={JSON.stringify(ids)}
      id={id}
      ids={ids}
      fillOpacity={highlightStyle === 'selected' ? 0 : selected.length ? 0 : 0.12}
      coordinateDisplay={coordinateDisplay}
    />
  )
}

export const LanguageMapPreview = ({
  active,
  mapInspectionActive,
}: {
  readonly active: boolean
  readonly mapInspectionActive: boolean
}) => {
  const pointer = useAtomValue(languagePointerPreviewAtom)
  const keyboard = useAtomValue(languageKeyboardPreviewAtom)
  const panel = useAtomValue(languagePanelAtom)
  if (!active) return null
  const selectedTarget = panel.detailId
    ? {
        languageId: panel.detailId,
        ...(panel.detailEntryId ? { entryId: panel.detailEntryId } : {}),
        ...(panel.detailGroupId ? { groupId: panel.detailGroupId } : {}),
      }
    : null
  const transientTarget = pointer?.target ?? (mapInspectionActive ? null : keyboard?.target)
  const sameTarget =
    transientTarget &&
    selectedTarget &&
    transientTarget.languageId === selectedTarget.languageId &&
    transientTarget.entryId === selectedTarget.entryId &&
    transientTarget.groupId === selectedTarget.groupId
  return (
    <>
      {transientTarget && !sameTarget && (
        <LanguageTargetOutline
          target={transientTarget}
          id="language-sidebar-preview"
          highlightStyle="hover"
          coordinateDisplay={!selectedTarget}
        />
      )}
      {selectedTarget && (
        <LanguageTargetOutline
          target={selectedTarget}
          id="language-selection"
          highlightStyle="selected"
          coordinateDisplay
        />
      )}
    </>
  )
}
