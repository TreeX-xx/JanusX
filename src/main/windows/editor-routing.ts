import type { BrowserWindow, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { normalize } from 'node:path'
import type { EditorDelivery, EditorOpenRequest, EditorOpenResult } from '../../shared/editor'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system'
import type { EditorWindowManager } from './editor-window'

// Note: whole-session handoff and host-following opens ? .agents/notes/workbench/unified-file-window.md
export class EditorRouting {
  private embeddedHost: WebContents | null = null
  private readyWaiters = new Set<() => void>()
  embeddedReady(sender: WebContents): void {
    if (this.main()?.webContents !== sender) return
    this.embeddedHost = sender
    for (const ready of this.readyWaiters) ready()
  }
  private async waitForEmbedded(target: WebContents): Promise<boolean> {
    if (this.embeddedHost === target) return true
    return new Promise(resolve => {
      const ready = () => { clearTimeout(timer); this.readyWaiters.delete(ready); resolve(this.embeddedHost === target) }
      const timer = setTimeout(() => { this.readyWaiters.delete(ready); resolve(false) }, 30_000)
      this.readyWaiters.add(ready)
    })
  }
  private queues = new Map<string, Promise<EditorOpenResult>>()
  private receipts = new Map<string, { sender: WebContents; finish: (success: boolean) => void }>()
  constructor(private windows: EditorWindowManager, private main: () => BrowserWindow | null) {}

  received(sender: WebContents, requestId: string, success: boolean): void {
    const receipt = this.receipts.get(requestId)
    if (receipt?.sender === sender) receipt.finish(success)
  }

  private enqueue(payload: EditorOpenRequest, action: () => Promise<EditorOpenResult>): Promise<EditorOpenResult> {
    if (!payload.filePath || !payload.workspacePath) return Promise.resolve({ success: false, error: 'Missing file scope' })
    const remote = payload.workspacePath.startsWith('janusx-workspace://')
    const normalized = (remote ? payload.workspacePath : normalize(payload.workspacePath)).replace(/[\\/]+$/, '')
    const key = !remote && process.platform === 'win32' ? normalized.toLowerCase() : normalized
    const previous = this.queues.get(key) ?? Promise.resolve({ success: true })
    const next = previous.catch(() => ({ success: false })).then(action).catch(error => ({ success: false, error: String(error) }))
    this.queues.set(key, next)
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key) })
    return next
  }

  private async deliver(target: WebContents, payload: EditorOpenRequest, send: (delivery: EditorDelivery) => Promise<unknown> | void): Promise<boolean> {
    if (target.isDestroyed()) return false
    const requestId = randomUUID()
    let finish!: (success: boolean) => void
    const received = new Promise<boolean>(resolve => { finish = resolve })
    const cancel = () => finish(false)
    const timer = setTimeout(cancel, 15_000)
    target.once('destroyed', cancel)
    this.receipts.set(requestId, { sender: target, finish })
    try {
      await send({ ...payload, requestId })
      return await received
    } finally {
      clearTimeout(timer)
      target.removeListener('destroyed', cancel)
      this.receipts.delete(requestId)
    }
  }

  open(payload: EditorOpenRequest): Promise<EditorOpenResult> {
    return this.enqueue(payload, async () => {
      const scope = payload.workspacePath!
      const existing = this.windows.get(scope)
      if (payload.floating || existing) {
        // Create first, then queue the complete state until the renderer announces readiness.
        const created = !existing
        const result = await this.windows.open({ filePath: payload.filePath, workspacePath: scope })
        if (!result.success) return result
        const target = this.windows.get(scope)!
        const accepted = await this.deliver(target.webContents, payload, delivery => this.windows.open(delivery))
        if (!accepted && created && !target.isDestroyed()) target.destroy()
        return { success: accepted, error: accepted ? undefined : 'File window did not accept the session' }
      }
      const target = this.main()
      if (!target || target.isDestroyed()) return { success: false, error: 'Main window unavailable' }
      if (!await this.waitForEmbedded(target.webContents)) return { success: false, error: 'Embedded editor is not ready' }
      const accepted = await this.deliver(target.webContents, payload, delivery => target.webContents.send(SYSTEM_CHANNELS.editorEmbedded, delivery))
      return { success: accepted, error: accepted ? undefined : 'Embedded editor did not accept the file' }
    })
  }

  embed(sender: WebContents, payload: EditorOpenRequest): Promise<EditorOpenResult> {
    return this.enqueue(payload, async () => {
      const source = this.windows.get(payload.workspacePath!)
      const target = this.main()
      if (!source || source.webContents !== sender || !target || target.isDestroyed()) return { success: false, error: 'Editor host unavailable' }
      const accepted = await this.deliver(target.webContents, payload, delivery => target.webContents.send(SYSTEM_CHANNELS.editorEmbedded, delivery))
      if (!accepted) return { success: false, error: 'Main window did not accept the session' }
      this.windows.confirmClose(sender)
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
      return { success: true }
    })
  }
}
