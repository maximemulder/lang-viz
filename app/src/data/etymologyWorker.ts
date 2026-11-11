import type { EtymologyRepository } from '../domain/etymology.ts'
import type { prepareEtymology } from './prepareEtymology.ts'

type Reply = { result: ReturnType<typeof prepareEtymology>; error?: never } | { error: string }

/** One preparation worker per attempt, terminated on success or failure. */
export const prepareInWorker = (bytes: ArrayBuffer): Promise<EtymologyRepository> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./etymology.worker.ts', import.meta.url), {
      type: 'module',
      name: 'word-histories',
    })
    const fail = (message: string) => {
      worker.terminate()
      reject(new Error(message))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fail(event.message || 'Could not prepare word histories.')
    }
    worker.onmessageerror = () => fail('Could not receive prepared word histories.')
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      worker.terminate()
      if ('error' in data) {
        reject(new Error(data.error))
        return
      }
      for (const [phase, duration] of Object.entries(data.result.timings))
        performance.measure(`lexical:${phase}`, { start: 0, duration, detail: { worker: true } })
      performance.mark('lexical:prepared')
      resolve(data.result.repository)
    }
    try {
      worker.postMessage(bytes, [bytes])
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not send word-history data.')
    }
  })
