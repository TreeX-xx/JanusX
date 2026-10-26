import { randomUUID } from 'node:crypto'
import { NativeServiceError } from '@janusx/plugin-sdk/native'

// A snapshot is serialized once. Each part stays below both native and broker
// byte/value limits, including worst-case UTF-8 and JSON escaping.
const PART_LENGTH = 128 * 1024
export class GraphTransfers {
  private snapshots = new Map<string, { root: string; owner: number; text: string; expires: number }>()

  open(root: string, owner: number, value: unknown) {
    for (const [id, row] of this.snapshots) {
      if (row.expires < Date.now() || row.owner === owner) this.snapshots.delete(id)
    }
    if (this.snapshots.size >= 16) throw new NativeServiceError('RATE_LIMITED')
    const text = JSON.stringify(value)
    if (text.length > 64 * 1024 * 1024) throw new NativeServiceError('FILE_TOO_LARGE')
    const id = randomUUID()
    this.snapshots.set(id, { root, owner, text, expires: Date.now() + 120_000 })
    return { id, parts: Math.ceil(text.length / PART_LENGTH) }
  }

  part(root: string, owner: number, id: string, index: number) {
    const row = this.snapshots.get(id)
    if (!row || row.root !== root || row.owner !== owner || row.expires < Date.now()) throw new NativeServiceError('RESOURCE_CHANGED')
    if (!Number.isInteger(index) || index < 0 || index * PART_LENGTH >= row.text.length) throw new NativeServiceError('INVALID_REQUEST')
    return { text: row.text.slice(index * PART_LENGTH, (index + 1) * PART_LENGTH) }
  }

  close(root: string, owner: number, id: string) {
    const row = this.snapshots.get(id)
    if (row?.root === root && row.owner === owner) this.snapshots.delete(id)
  }

  release(owner: number) { for (const [id, row] of this.snapshots) if (row.owner === owner) this.snapshots.delete(id) }
  clear() { this.snapshots.clear() }
}
