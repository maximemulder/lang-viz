import type { OverlapRequest, OverlapResponse } from '../overlap/types.ts'
import { GeometryService } from './serviceClient.ts'

export const geometryService = new GeometryService(
  () => new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' }),
)

/** A selection is one cancellable consumer of the shared geometry store. */
export class GeometryCoverageClient {
  private readonly service: GeometryService
  constructor(service = geometryService) {
    this.service = service
  }
  onmessage: ((event: MessageEvent<OverlapResponse>) => void) | null = null
  onerror: (() => void) | null = null
  private controller: AbortController | undefined
  get restarts() {
    return this.service.restarts
  }
  postMessage(request: OverlapRequest) {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    const started = performance.now()
    this.service.submit(
      { kind: 'coverage', request },
      controller.signal,
      (result) => {
        if (this.controller !== controller || result.kind !== 'coverage') return
        this.onmessage?.({ data: result.response } as MessageEvent<OverlapResponse>)
      },
      (error) => {
        if (controller.signal.aborted || this.controller !== controller) return
        this.onmessage?.({
          data: {
            requestId: request.requestId,
            failure: 'request-deadline',
            error: error.message,
            durationMs: performance.now() - started,
          },
        } as MessageEvent<OverlapResponse>)
      },
    )
  }
  cancel() {
    this.controller?.abort()
    this.controller = undefined
  }
  terminate() {
    this.cancel()
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => geometryService.dispose())
