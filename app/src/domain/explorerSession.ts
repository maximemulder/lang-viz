import type { LanguageClassification } from './atlas.ts'

export type Workspace = 'geography' | 'etymology'
export type WordView = 'history' | 'family'
export interface TrailSpecification {
  readonly root: string | null
  readonly depth: number
  readonly branches: boolean
  readonly placeholders: boolean
  readonly expanded: ReadonlySet<string>
}
export type EvidenceSelection = { readonly kind: 'word' | 'edge'; readonly id: string } | null
export interface LanguageWordTarget {
  readonly name: string
  readonly classification: LanguageClassification
}
export interface ExplorerSession {
  readonly workspace: Workspace
  readonly trail: TrailSpecification
  readonly view: WordView
  readonly selection: EvidenceSelection
  readonly comparison: {
    readonly conceptId: string | null
    readonly collectionId: string | null
    readonly family: string | null
    readonly includeMissing: boolean
  }
  readonly search: {
    readonly query: string
    readonly languageId: string | null
    readonly atlasTarget: LanguageWordTarget | null
  }
  readonly overlay: {
    readonly enabled: boolean
    readonly focusSequence: number
    readonly focusRequest: { readonly id: number } | null
  }
}

export const createExplorerSession = (): ExplorerSession => ({
  workspace: 'geography',
  trail: { root: null, depth: 4, branches: true, placeholders: false, expanded: new Set() },
  view: 'history',
  selection: null,
  comparison: { conceptId: null, collectionId: null, family: null, includeMissing: false },
  search: { query: '', languageId: null, atlasTarget: null },
  overlay: { enabled: false, focusSequence: 0, focusRequest: null },
})

export interface ExplorerRoute {
  readonly workspace: Workspace
  readonly word: string | null
  readonly view: WordView
  readonly concept: string | null
  readonly collection: string | null
}

export const sessionRoute = (session: ExplorerSession): ExplorerRoute => ({
  workspace: session.workspace,
  word: session.trail.root,
  view: session.view,
  concept: session.comparison.conceptId,
  collection: session.comparison.collectionId,
})

export type ExplorerAction =
  | { readonly type: 'workspace'; readonly workspace: Workspace }
  | { readonly type: 'trace'; readonly id: string }
  | { readonly type: 'inspect-trail-word'; readonly id: string }
  | { readonly type: 'view'; readonly view: WordView }
  | { readonly type: 'select'; readonly selection: EvidenceSelection }
  | { readonly type: 'expand'; readonly id: string }
  | {
      readonly type: 'trail-options'
      readonly depth?: number
      readonly branches?: boolean
      readonly placeholders?: boolean
    }
  | {
      readonly type: 'comparison'
      readonly conceptId?: string | null
      readonly collectionId?: string | null
    }
  | {
      readonly type: 'comparison-filter'
      readonly family?: string | null
      readonly includeMissing?: boolean
    }
  | { readonly type: 'search'; readonly query?: string; readonly languageId?: string | null }
  | { readonly type: 'language-words'; readonly target: LanguageWordTarget }
  | { readonly type: 'show-trail' }
  | { readonly type: 'clear-overlay' }
  | { readonly type: 'restore-route'; readonly route: ExplorerRoute }

export const reduceExplorerSession = (
  session: ExplorerSession,
  action: ExplorerAction,
): ExplorerSession => {
  const cancelledFocus = { ...session.overlay, focusRequest: null }
  switch (action.type) {
    case 'workspace':
      return session.workspace === action.workspace
        ? session
        : { ...session, workspace: action.workspace, overlay: cancelledFocus }
    case 'trace':
      return {
        ...session,
        workspace: 'etymology',
        view: 'history',
        trail: { ...session.trail, root: action.id, expanded: new Set() },
        selection: { kind: 'word', id: action.id },
        comparison: { ...session.comparison, conceptId: null, collectionId: null },
        search: { query: '', languageId: null, atlasTarget: null },
        overlay: cancelledFocus,
      }
    case 'inspect-trail-word':
      return {
        ...session,
        workspace: 'etymology',
        view: 'history',
        selection: { kind: 'word', id: action.id },
        overlay: cancelledFocus,
      }
    case 'view':
      return { ...session, view: action.view, overlay: cancelledFocus }
    case 'select':
      return { ...session, selection: action.selection, overlay: cancelledFocus }
    case 'expand':
      return {
        ...session,
        view: 'history',
        trail: { ...session.trail, expanded: new Set([...session.trail.expanded, action.id]) },
        overlay: cancelledFocus,
      }
    case 'trail-options': {
      if (action.depth !== undefined && (!Number.isSafeInteger(action.depth) || action.depth < 0))
        throw new RangeError('Trail depth must be a nonnegative safe integer')
      return {
        ...session,
        trail: {
          ...session.trail,
          depth: action.depth ?? session.trail.depth,
          branches: action.branches ?? session.trail.branches,
          placeholders: action.placeholders ?? session.trail.placeholders,
        },
        overlay: cancelledFocus,
      }
    }
    case 'comparison':
      return {
        ...session,
        view: 'family',
        overlay: cancelledFocus,
        comparison: {
          ...session.comparison,
          collectionId:
            action.collectionId === undefined
              ? session.comparison.collectionId
              : action.collectionId,
          conceptId:
            action.conceptId === undefined
              ? action.collectionId === undefined ||
                action.collectionId === session.comparison.collectionId
                ? session.comparison.conceptId
                : null
              : action.conceptId,
        },
      }
    case 'comparison-filter':
      return {
        ...session,
        comparison: {
          ...session.comparison,
          family: action.family === undefined ? session.comparison.family : action.family,
          includeMissing: action.includeMissing ?? session.comparison.includeMissing,
        },
      }
    case 'search':
      return {
        ...session,
        search: {
          query: action.query ?? session.search.query,
          languageId:
            action.languageId === undefined ? session.search.languageId : action.languageId,
          // Editing query text preserves an atlas scope; choosing a scope replaces it.
          atlasTarget: action.languageId === undefined ? session.search.atlasTarget : null,
        },
      }
    case 'language-words':
      return {
        ...session,
        workspace: 'etymology',
        search: { query: '', languageId: null, atlasTarget: action.target },
        overlay: cancelledFocus,
      }
    case 'show-trail': {
      if (session.trail.root === null) return session
      const id = session.overlay.focusSequence + 1
      return {
        ...session,
        workspace: 'geography',
        overlay: { enabled: true, focusSequence: id, focusRequest: { id } },
      }
    }
    case 'clear-overlay':
      return { ...session, overlay: { ...cancelledFocus, enabled: false } }
    case 'restore-route': {
      const route = action.route
      const current = sessionRoute(session)
      if (
        current.workspace === route.workspace &&
        current.word === route.word &&
        current.view === route.view &&
        current.concept === route.concept &&
        current.collection === route.collection
      )
        return session
      const changedWord = route.word !== session.trail.root
      return {
        ...session,
        workspace: route.workspace,
        view: route.view,
        trail: changedWord
          ? { ...session.trail, root: route.word, expanded: new Set() }
          : session.trail,
        selection: changedWord
          ? route.word === null
            ? null
            : { kind: 'word', id: route.word }
          : session.selection,
        comparison: {
          ...session.comparison,
          conceptId: route.concept,
          collectionId: route.collection,
        },
        search: changedWord ? { query: '', languageId: null, atlasTarget: null } : session.search,
        overlay: cancelledFocus,
      }
    }
  }
}

/** Check again after awaiting bounds, map readiness, or animation preparation. */
export const isCurrentTrailFocus = (
  session: ExplorerSession,
  request: NonNullable<ExplorerSession['overlay']['focusRequest']>,
) =>
  session.workspace === 'geography' &&
  session.overlay.enabled &&
  session.overlay.focusRequest === request
