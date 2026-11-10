import { useAtomValue } from 'jotai'
import { SidebarSection } from '../../components/SidebarPane'
import { mapEntriesAtom, mapGroupsAtom } from '../../state/atlasState'
import { ColorControls } from '../map/ColorControls'
import { OnMapLanguages } from './OnMapLanguages'

export const OnMapView = () => {
  const groups = useAtomValue(mapGroupsAtom)
  const entries = useAtomValue(mapEntriesAtom)
  return (
    <div className="on-map-workspace">
      <SidebarSection
        id="on-map-colors"
        className="on-map-colors"
        title="Colors"
        defaultExpanded={false}
      >
        <ColorControls />
      </SidebarSection>
      <SidebarSection
        id="on-map-entries"
        className="on-map-entries"
        title="Entries"
        summary={`${groups.length.toLocaleString()} groups · ${entries.length.toLocaleString()} areas`}
      >
        <OnMapLanguages />
      </SidebarSection>
    </div>
  )
}
