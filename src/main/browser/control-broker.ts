// Note: host ownership/lifecycle around upstream tools — .agents/notes/desktop/browser-computer-use.md
import { randomUUID } from 'node:crypto'
import { join, isAbsolute, relative } from 'node:path'
import { resolveWorkspaceTarget } from '@janus-agent/agent-core'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ControlSettings } from '../../shared/ipc/control'
import type { BrowserSurfaceManager } from './surface-manager'
import type { DevtoolsClient } from './devtools-runtime'

export const BROWSER_TOOLS = new Set(['list_pages', 'new_page', 'select_page', 'close_page', 'navigate_page',
  'take_snapshot', 'take_screenshot', 'click', 'fill', 'fill_form', 'press_key', 'type_text', 'hover', 'drag',
  'wait_for', 'handle_dialog', 'upload_file', 'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request'])
export const READ_BROWSER_TOOLS = new Set(['list_pages', 'take_snapshot', 'take_screenshot', 'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request', 'wait_for'])
type Surfaces = Pick<BrowserSurfaceManager, 'automationTabs' | 'automationNewTab' | 'automationShow' | 'closeTab' | 'setAgentControlled'>
const resultText = (result: CallToolResult) => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
export function browserUrl(value: unknown): string {
  const url = new URL(String(value))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) browser pages are supported')
  return url.href
}

export class BrowserControlBroker {
  private owners = new Map<number, string>()
  private revoked = new Set<string>()
  private pending = new Set<string>()
  private leases = new Map<string, Set<string>>()
  private turns = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private active?: AbortController
  private connection?: { contentsId: number; root?: string; client: DevtoolsClient; nativeId: number }
  constructor(private deps: { surfaces: Surfaces; settings(): Promise<ControlSettings>; directory: string;
    connect(contentsId: number | undefined, root?: string): Promise<DevtoolsClient> }) {}

  get activeControl(): boolean { return this.leases.size > 0 }
  beginTurn(runId: string): void { this.turns.add(runId) }
  async releaseOwner(owner: string, runId: string): Promise<void> {
    await this.endTurn(runId)
    for (const [id, value] of this.owners) if (value === owner) this.owners.delete(id)
  }
  async catalog(): Promise<Tool[]> {
    const client = await this.deps.connect(undefined)
    try { return client.tools.filter(tool => BROWSER_TOOLS.has(tool.name)) } finally { await client.close() }
  }
  private tabs(owner: string) {
    const tabs = this.deps.surfaces.automationTabs()
    for (const id of this.owners.keys()) if (!tabs.some(tab => tab.contents.id === id)) this.owners.delete(id)
    return tabs.filter(tab => (!this.owners.has(tab.contents.id) || this.owners.get(tab.contents.id) === owner)
      && (!tab.contents.getURL() || tab.contents.getURL() === 'about:blank' || /^https?:\/\//i.test(tab.contents.getURL())))
  }
  private list(owner: string) {
    return this.tabs(owner).map(tab => ({ pageId: tab.contents.id, url: tab.contents.getURL(), title: tab.contents.getTitle(),
      controlled: this.owners.get(tab.contents.id) === owner, active: tab.visible }))
  }
  async stop(): Promise<void> {
    for (const id of this.turns) this.revoked.add(id)
    for (const id of this.pending) this.revoked.add(id)
    for (const id of this.leases.keys()) this.revoked.add(id)
    this.active?.abort(new Error('Browser control stopped by user'))
    for (const surfaces of this.leases.values()) for (const id of surfaces) this.deps.surfaces.setAgentControlled(id, false)
    this.leases.clear()
    const connection = this.connection; this.connection = undefined
    await connection?.client.close()
  }
  async endTurn(runId: string): Promise<void> {
    this.turns.delete(runId)
    const surfaces = this.leases.get(runId)
    this.leases.delete(runId)
    for (const id of surfaces ?? []) {
      if (![...this.leases.values()].some(lease => lease.has(id))) this.deps.surfaces.setAgentControlled(id, false)
    }
    this.revoked.delete(runId)
    if (!this.leases.size) {
      const connection = this.connection; this.connection = undefined
      await connection?.client.close()
    }
  }
  async call(owner: string, runId: string, name: string, input: Record<string, unknown>, signal: AbortSignal, root?: string): Promise<unknown> {
    this.pending.add(runId)
    const action = this.queue.then(async () => {
      const settings = await this.deps.settings()
      const check = () => { signal.throwIfAborted(); if (!this.turns.has(runId) || this.revoked.has(runId)) throw new Error('Browser control stopped; start a new turn to resume') }
      check()
      if (!settings.browser.enabled) throw new Error('Browser control is disabled in Settings')
      if (!BROWSER_TOOLS.has(name)) throw new Error('Unsupported browser tool')
      if (name === 'list_pages') return { pages: this.list(owner), guidance: 'Select an uncontrolled page to grant this conversation access, or create a new page.' }
      if (name === 'new_page') {
        const id = this.deps.surfaces.automationNewTab(browserUrl(input.url))
        this.owners.set(id, owner)
        const tab = this.tabs(owner).find(tab => tab.contents.id === id)!
        this.deps.surfaces.automationShow(tab.surfaceId, tab.tabId)
        const lease = this.leases.get(runId) ?? new Set<string>()
        lease.add(tab.surfaceId); this.leases.set(runId, lease)
        this.deps.surfaces.setAgentControlled(tab.surfaceId, true)
        return { pageId: id, pages: this.list(owner) }
      }
      const id = input.pageId
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('A pageId from browser_list_pages is required')
      const tab = this.tabs(owner).find(tab => tab.contents.id === id)
      if (!tab) throw new Error('Browser target is closed, unavailable or belongs to another conversation')
      if (name === 'select_page') this.owners.set(id, owner)
      if (this.owners.get(id) !== owner) throw new Error('Select this page to grant control before reading or operating it')
      if (name === 'close_page') {
        this.deps.surfaces.closeTab(tab.surfaceId, tab.tabId); this.owners.delete(id)
        return { pages: this.list(owner) }
      }
      this.deps.surfaces.automationShow(tab.surfaceId, tab.tabId)
      const lease = this.leases.get(runId) ?? new Set<string>()
      lease.add(tab.surfaceId); this.leases.set(runId, lease)
      this.deps.surfaces.setAgentControlled(tab.surfaceId, true)
      if (name === 'select_page') return { pageId: id, pages: this.list(owner) }
      const controller = new AbortController()
      this.active = controller
      const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(settings.browser.timeoutMs)])
      const onAbort = () => { const connection = this.connection; this.connection = undefined; void connection?.client.close() }
      combined.addEventListener('abort', onAbort, { once: true })
      try {
        check(); combined.throwIfAborted()
        if (name === 'navigate_page' && input.url !== undefined) browserUrl(input.url)
        if (name === 'upload_file' && !root) throw new Error('File uploads require an attached project workspace')
        if (name === 'upload_file') {
          if (!Array.isArray(input.filePaths) || !input.filePaths.length || !input.filePaths.every(path => typeof path === 'string')) throw new Error('File upload paths are required')
          const validated: string[] = []
          for (const path of input.filePaths as string[]) {
            const target = await resolveWorkspaceTarget(root!, isAbsolute(path) ? relative(root!, path) : path)
            if (target.kind !== 'file') throw new Error('Uploads require regular workspace files')
            validated.push(join(root!, target.relativePath))
          }
          input = { ...input, filePaths: validated }
        }
        const started = Date.now()
        while (!this.deps.surfaces.automationTabs().find(tab => tab.contents.id === id)?.visible) {
          combined.throwIfAborted(); check()
          if (Date.now() - started > 5000) throw new Error('Open the browser page and dismiss covering dialogs before operating it')
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (this.connection?.contentsId !== id || this.connection.root !== root) {
          await this.connection?.client.close(); this.connection = undefined
          const client = await this.deps.connect(id, root)
          if (combined.aborted) { await client.close(); combined.throwIfAborted() }
          const listing = await client.call('list_pages', {}, combined)
          const ids = [...resultText(listing).matchAll(/^\s*(\d+):/gm)]
          if (listing.isError || ids.length !== 1) { await client.close(); throw new Error(`Browser target isolation failed: ${resultText(listing)}`) }
          this.connection = { contentsId: id, root, client, nativeId: Number(ids[0][1]) }
        }
        const connection = this.connection!
        const args = { ...input, pageId: connection.nativeId }
        // Schemas guide models; enforce output confinement for every caller as well.
        for (const key of ['filePath', 'requestFilePath', 'responseFilePath']) delete (args as Record<string, unknown>)[key]
        const artifact = name === 'take_screenshot' ? join(this.deps.directory, `screenshot-${randomUUID()}.png`) : undefined
        if (artifact) Object.assign(args, { filePath: artifact, format: 'png' })
        check(); combined.throwIfAborted()
        const result = await connection.client.call(name, args, combined)
        if (result.isError) throw new Error(resultText(result))
        return { pageId: id, text: resultText(result).slice(0, 64000), ...(artifact ? { screenshot: artifact } : {}) }
      } catch (error) {
        if (combined.aborted) throw new Error('Browser operation cancelled or timed out. It may already have taken effect; inspect the page before retrying.')
        throw error
      } finally { combined.removeEventListener('abort', onAbort); if (this.active === controller) this.active = undefined }
    })
    this.queue = action.catch(() => {})
    try { return await action } finally { this.pending.delete(runId) }
  }
}
