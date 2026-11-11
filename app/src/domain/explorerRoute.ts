import type { ExplorerRoute } from './explorerSession.ts'

/** Syntactic parsing is independent of dataset readiness. Unknown valid IDs survive. */
export const parseExplorerRoute = (
  fragment: string,
): { route: ExplorerRoute; issues: readonly string[] } => {
  const value = fragment.replace(/^#/, '')
  const issues: string[] = []
  try {
    decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    issues.push('Malformed URL encoding')
  }
  const params = new URLSearchParams(value)
  const single = (key: string) => {
    const values = params.getAll(key)
    if (values.length > 1) {
      issues.push(`Repeated URL parameter: ${key}`)
      return null
    }
    return values[0] ?? null
  }
  const id = (key: string) => {
    const candidate = single(key)
    if (candidate === null) return null
    if (!/^(0|[1-9][0-9]*)$/.test(candidate)) {
      issues.push(`Invalid URL identifier: ${key}`)
      return null
    }
    return candidate
  }
  const workspace = single('workspace')
  const view = single('view')
  if (workspace !== null && workspace !== 'geography' && workspace !== 'etymology')
    issues.push('Unknown workspace')
  if (view !== null && view !== 'history' && view !== 'family') issues.push('Unknown word view')
  const word = id('word'),
    concept = id('concept'),
    collection = id('collection')
  return {
    route: {
      workspace:
        workspace === 'etymology' ||
        (!params.has('workspace') &&
          (word !== null || concept !== null || collection !== null || view === 'family'))
          ? 'etymology'
          : 'geography',
      word,
      view: view === 'family' ? 'family' : 'history',
      concept,
      collection,
    },
    issues,
  }
}

export const serializeExplorerRoute = (route: ExplorerRoute): string => {
  const params = new URLSearchParams({ workspace: route.workspace })
  if (route.word !== null) params.set('word', route.word)
  if (
    route.workspace === 'etymology' ||
    route.word !== null ||
    route.concept !== null ||
    route.collection !== null ||
    route.view !== 'history'
  )
    params.set('view', route.view)
  if (route.concept !== null) params.set('concept', route.concept)
  if (route.collection !== null) params.set('collection', route.collection)
  return `#${params}`
}
