// Note: .agents/notes/workbench/plugin-contract-v1.md — bounded window geometry, never content or grants.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'

export interface PluginWindowBounds { x: number; y: number; width: number; height: number }
const boundsSchema = z.object({ x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(320).max(2400), height: z.number().int().min(240).max(1800) }).strict()
export function fitPluginWindow(bounds: PluginWindowBounds | undefined, area: PluginWindowBounds): PluginWindowBounds {
  const width = Math.min(bounds?.width ?? 720, area.width); const height = Math.min(bounds?.height ?? 520, area.height)
  return { width, height,
    x: Math.max(area.x, Math.min(bounds?.x ?? area.x + Math.round((area.width - width) / 2), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds?.y ?? area.y + Math.round((area.height - height) / 2), area.y + area.height - height)) }
}
export class PluginWindowLayout {
  private entries = new Map<string, PluginWindowBounds>()
  private queue = new SerialQueue()
  private ready?: Promise<void>
  constructor(private path: string, private failed: () => void) {}
  initialize(): Promise<void> {
    return this.ready ??= (async () => {
      try {
        const text = await readFile(this.path, 'utf8')
        if (Buffer.byteLength(text) > 64 * 1024) throw new Error('Layout exceeds budget')
        const data: unknown = JSON.parse(text)
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid layout')
        for (const [key, value] of Object.entries(data).slice(-128)) {
          const bounds = boundsSchema.safeParse(value)
          if (/^[a-f0-9]{64}$/.test(key) && bounds.success) this.entries.set(key, bounds.data)
        }
      } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') this.failed() }
    })()
  }
  get(key: string): PluginWindowBounds | undefined { const value = this.entries.get(key); return value ? { ...value } : undefined }
  save(key: string, value: PluginWindowBounds): Promise<void> {
    const checked = boundsSchema.safeParse(value)
    if (!/^[a-f0-9]{64}$/.test(key) || !checked.success) return Promise.resolve()
    this.entries.delete(key); this.entries.set(key, checked.data)
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!)
    return this.queue.run(async () => {
      try { await writeFileAtomic(this.path, JSON.stringify(Object.fromEntries(this.entries))) } catch { this.failed() }
    })
  }
}
