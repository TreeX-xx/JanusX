// Session-only, bounded LRU. No private repository content is persisted.
type Entry = { value: unknown; expires: number; bytes: number }
export class HostedCache {
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Promise<unknown>>()
  private bytes = 0
  onAuthFailure?: () => void
  constructor(private maxEntries = 160, private maxBytes = 32 * 1024 * 1024) {}
  peek<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key); this.entries.set(key, entry)
    return entry.value as T
  }
  fresh(key: string): boolean { return (this.entries.get(key)?.expires ?? 0) > Date.now() }
  set<T>(key: string, value: T, ttl: number): void {
    this.remove(key)
    const bytes = JSON.stringify(value).length * 2
    if (bytes > this.maxBytes) return
    this.entries.set(key, { value, expires: Date.now() + ttl, bytes }); this.bytes += bytes
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!)
  }
  private remove(key: string) { this.bytes -= this.entries.get(key)?.bytes ?? 0; this.entries.delete(key) }
  invalidate(match: (key: string) => boolean, drop = false, cancelPending = true): void {
    for (const [key, entry] of this.entries) if (match(key)) { if (drop) this.remove(key); else entry.expires = 0 }
    if (cancelPending) for (const key of this.pending.keys()) if (match(key)) this.pending.delete(key)
  }
  clear(): void { this.entries.clear(); this.pending.clear(); this.bytes = 0 }
  handleError(error: unknown): void {
    if (/auth login|not logged|HTTP 401|401 Unauthorized|token.*invalid/i.test(String(error))) this.onAuthFailure?.()
  }
  load<T>(key: string, loader: () => Promise<T>, ttl: number, force = false): Promise<T> {
    const pending = this.pending.get(key)
    if (pending) return pending as Promise<T>
    if (!force && this.fresh(key)) return Promise.resolve(this.peek<T>(key)!)
    const request = Promise.resolve().then(loader).then(value => {
      if (this.pending.get(key) !== request) throw new Error('Repository request was superseded')
      this.set(key, value, ttl)
      return value
    }).catch(error => {
      if (this.pending.get(key) === request) this.handleError(error)
      throw error
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })
    this.pending.set(key, request)
    return request
  }
}
export const hostedCache = new HostedCache()
export const HOSTED_TTL = { content: 60_000, overview: 300_000, image: 300_000 }
export function hostedKey(target: { workspacePath: string; repositoryKey: string }, type: string, ...parts: unknown[]): string {
  return JSON.stringify([target.workspacePath, target.repositoryKey, type, ...parts])
}
export function invalidateHosted(target: { workspacePath: string; repositoryKey: string }, types?: string[], drop = false, cancelPending = true): void {
  hostedCache.invalidate(key => { const [path, repo, type] = JSON.parse(key); return path === target.workspacePath && repo === target.repositoryKey && (!types || types.includes(type)) }, drop, cancelPending)
}
