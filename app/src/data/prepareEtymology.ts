import { indexEtymology } from '../domain/etymology.ts'
import { validateEtymologyData } from '../domain/etymologyValidation.ts'

export const prepareEtymology = (bytes: ArrayBuffer) => {
  const start = performance.now()
  const body = new TextDecoder().decode(bytes)
  const decoded = performance.now()
  const value: unknown = JSON.parse(body)
  const parsed = performance.now()
  validateEtymologyData(value)
  const validated = performance.now()
  const index = indexEtymology(value)
  const indexed = performance.now()
  return {
    repository: { data: value, index },
    timings: {
      decode: decoded - start,
      parse: parsed - decoded,
      validate: validated - parsed,
      index: indexed - validated,
    },
  }
}
