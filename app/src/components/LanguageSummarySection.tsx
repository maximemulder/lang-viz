import { useAtomValue, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
import {
  languageSummarySectionsAtom,
  type LanguageSummarySection as Section,
  setLanguageSummarySectionAtom,
} from '../state/languageSummary'
import { SidebarSection } from './SidebarPane'

const titles: Record<Section, string> = {
  genealogy: 'Genealogy',
  areas: 'Areas',
  map: 'Map',
  features: 'Features',
  etymology: 'Etymology',
}

/** Shared disclosures for atlas and CLDR language records. */
export const LanguageSummarySection = ({
  section,
  children,
}: {
  readonly section: Section
  readonly children: ReactNode
}) => {
  const expanded = useAtomValue(languageSummarySectionsAtom)[section]
  const setExpanded = useSetAtom(setLanguageSummarySectionAtom)
  return (
    <SidebarSection
      className="language-summary-section"
      title={titles[section]}
      expanded={expanded}
      onExpandedChange={(next) => setExpanded(section, next)}
    >
      {expanded ? children : null}
    </SidebarSection>
  )
}
