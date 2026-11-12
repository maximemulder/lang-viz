export interface WalsSelection {
  readonly sourceId: string
  readonly featureId: string | null
}
export interface WalsOverlaySpecification {
  readonly sourceId: string
  readonly featureId: string
  readonly visible: boolean
  readonly maxExamples: number
}
export interface WalsSession {
  readonly profiles: ReadonlyMap<string, WalsSelection>
  readonly inspection: WalsSelection | null
  readonly overlay: WalsOverlaySpecification | null
}
export const createWalsSession = (): WalsSession => ({
  profiles: new Map(),
  inspection: null,
  overlay: null,
})
export type WalsAction =
  | { readonly type: 'select-variety'; readonly profileId: string; readonly sourceId: string }
  | {
      readonly type: 'inspect'
      readonly sourceId: string
      readonly featureId: string
      readonly profileId?: string
    }
  | { readonly type: 'show-examples'; readonly sourceId: string; readonly featureId: string }
  | { readonly type: 'overlay-visibility'; readonly visible: boolean }
  | { readonly type: 'clear-overlay' }

/** Store source IDs, never copied records, atlas-deduplicated values, or sampled targets. */
export const reduceWalsSession = (session: WalsSession, action: WalsAction): WalsSession => {
  switch (action.type) {
    case 'select-variety': {
      const current = session.profiles.get(action.profileId)
      if (current?.sourceId === action.sourceId) return session
      const profiles = new Map(session.profiles)
      profiles.set(action.profileId, { sourceId: action.sourceId, featureId: null })
      return { ...session, profiles }
    }
    case 'inspect': {
      const selection = { sourceId: action.sourceId, featureId: action.featureId }
      const profiles = new Map(session.profiles)
      if (action.profileId) profiles.set(action.profileId, selection)
      return { ...session, profiles, inspection: selection }
    }
    case 'show-examples':
      return {
        ...session,
        overlay: {
          sourceId: action.sourceId,
          featureId: action.featureId,
          visible: true,
          maxExamples: 12,
        },
      }
    case 'overlay-visibility':
      return session.overlay
        ? { ...session, overlay: { ...session.overlay, visible: action.visible } }
        : session
    case 'clear-overlay':
      return { ...session, overlay: null }
  }
}
