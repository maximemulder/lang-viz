/** Byte payloads are bounded separately from the number of JS cache entries. */
export class ByteCache {
  private readonly entries = new Map<string, Uint8Array>()
  bytes = 0
  readonly maxEntries: number
  readonly maxBytes: number

  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
  }

  get size() {
    return this.entries.size
  }

  get(key: string) {
    const data = this.entries.get(key)
    if (data) {
      this.entries.delete(key)
      this.entries.set(key, data)
    }
    return data
  }

  set(key: string, data: Uint8Array) {
    const previous = this.entries.get(key)
    if (previous) this.bytes -= previous.byteLength
    this.entries.delete(key)
    if (data.byteLength > this.maxBytes) return
    this.entries.set(key, data)
    this.bytes += data.byteLength
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.bytes -= this.entries.get(oldest)?.byteLength ?? 0
      this.entries.delete(oldest)
    }
  }
}
