import { createStripeTextureJobs, type StripeTextureInput } from './stripeTextureJobs.ts'

const receive = createStripeTextureJobs((output) => {
  const transfer = output.type === 'complete' ? output.images.map((image) => image.data.buffer) : []
  self.postMessage(output, { transfer })
})
self.onmessage = ({ data }: MessageEvent<StripeTextureInput>) => receive(data)
