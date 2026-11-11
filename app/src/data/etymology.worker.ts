import { prepareEtymology } from './prepareEtymology.ts'

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ result: prepareEtymology(event.data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
