import { atom } from 'jotai'
import { loadWals } from '../../data/walsRepository.ts'
import type { WalsRepository } from '../../domain/wals.ts'
import { createWalsSession, reduceWalsSession, type WalsAction } from './session.ts'

export const walsRepositoryAtom = atom<WalsRepository | null>(null)
export const walsLoadStateAtom = atom<{
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}>({ status: 'idle', message: '' })
const pendingAtom = atom<Promise<void> | null>(null)
/** Data completion changes only data/loading atoms; navigation is never initialized here. */
export const loadWalsAtom = atom(
  null,
  (get, set, load: () => Promise<WalsRepository> = loadWals): Promise<void> => {
    if (get(walsRepositoryAtom)) return Promise.resolve()
    const pending = get(pendingAtom)
    if (pending) return pending
    set(walsLoadStateAtom, { status: 'loading', message: '' })
    const work = Promise.resolve()
      .then(load)
      .then((repository) => {
        set(walsRepositoryAtom, repository)
        set(walsLoadStateAtom, { status: 'ready', message: '' })
      })
      .catch((error: unknown) => {
        set(walsLoadStateAtom, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load WALS.',
        })
      })
      .finally(() => set(pendingAtom, null))
    set(pendingAtom, work)
    return work
  },
)
const sessionAtom = atom(createWalsSession())
export const walsSessionAtom = atom((get) => get(sessionAtom))
/** Integration validates user actions against ready data and associations before dispatch. */
export const walsActionAtom = atom(null, (get, set, action: WalsAction) =>
  set(sessionAtom, reduceWalsSession(get(sessionAtom), action)),
)
