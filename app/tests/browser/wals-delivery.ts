import { loadWals } from '../../src/data/walsRepository.ts'

const button = document.querySelector<HTMLButtonElement>('#load')
const status = document.querySelector<HTMLPreElement>('#status')
if (!button || !status) throw new Error('Missing WALS delivery fixture controls')
button.addEventListener('click', async () => {
  status.textContent = 'loading'
  try {
    const first = loadWals()
    const second = loadWals()
    const repository = await first
    if (first !== second || repository !== (await second))
      throw new Error('Repository work was not shared')
    status.textContent = JSON.stringify({
      status: 'ready',
      records: repository.index.bySource.size,
      features: repository.index.byFeature.size,
      snapshot: repository.data.provenance.snapshot,
    })
  } catch (error: unknown) {
    status.textContent = `error: ${error instanceof Error ? error.message : String(error)}`
  }
})
button.disabled = false
