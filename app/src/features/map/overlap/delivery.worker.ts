import { type DeliveryRequest, type DeliveryResponse, DeliveryStore } from './deliveryStore.ts'

const store = new DeliveryStore()
self.onmessage = ({ data }: MessageEvent<DeliveryRequest>) => {
  if ('register' in data) store.register(data.register, data.ids, data.additions)
  else if ('release' in data) store.release(data.release)
  else {
    let response: DeliveryResponse
    try {
      // Transfer a copy: ancestor cache entries remain reusable and immutable.
      response = {
        request: data.request,
        data: store.get(data.snapshot, data.tile).slice(),
        metrics: store.stats(),
      }
    } catch (error) {
      response = { request: data.request, error: String(error), metrics: store.stats() }
    }
    self.postMessage(response, { transfer: response.data ? [response.data.buffer] : [] })
  }
  if ('register' in data || 'release' in data)
    self.postMessage({ request: 0, metrics: store.stats() } satisfies DeliveryResponse)
}
