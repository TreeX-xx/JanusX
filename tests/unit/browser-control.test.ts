import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControlBroker } from '../../src/main/browser/control-broker'
import { normalizeControlSettings } from '../../src/shared/ipc/control'
import type { DevtoolsClient } from '../../src/main/browser/devtools-runtime'

function fixture() {
  const settings = normalizeControlSettings(undefined)
  let nextId = 10
  const tabs: Array<{ surfaceId: string; tabId: string; contents: { id: number; getURL(): string; getTitle(): string }; visible: boolean }> = []
  const calls: Array<{ id?: number; name: string; input: Record<string, unknown> }> = []
  const surfaces = {
    automationTabs: () => tabs,
    automationNewTab: (url: string) => { const id = nextId++; tabs.push({ surfaceId: 'browser', tabId: String(id), contents: { id, getURL: () => url, getTitle: () => 'Fixture' }, visible: true }); return id },
    automationShow: vi.fn((_surface: string, id: string) => { for (const tab of tabs) tab.visible = tab.tabId === id }),
    closeTab: (_surface: string, id: string) => { const index = tabs.findIndex(tab => tab.tabId === id); tabs.splice(index, 1) },
    setAgentControlled: vi.fn(),
  }
  const connect = vi.fn(async (id?: number): Promise<DevtoolsClient> => ({ tools: [], close: vi.fn(async () => {}),
    call: async (name, input) => { calls.push({ id, name, input }); return { content: [{ type: 'text', text: name === 'list_pages' ? '1: Fixture (https://example.test/)' : 'done' }] } },
  }))
  const broker = new BrowserControlBroker({ surfaces: surfaces as never, directory: '/artifacts', settings: async () => settings, connect })
  const signal = new AbortController().signal
  broker.beginTurn('turn')
  const call = (name: string, input: Record<string, unknown>, owner = 'one', run = 'turn') => broker.call(owner, run, name, input, signal)
  return { broker, call, settings, surfaces, tabs, calls, connect }
}
describe('browser host adapter', () => {
  it('creates through the host, activates the selected native tab and translates IDs for upstream', async () => {
    const f = fixture()
    const first = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    const second = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    await f.call('take_snapshot', { pageId: first.pageId })
    expect(f.surfaces.automationShow).toHaveBeenLastCalledWith('browser', String(first.pageId))
    expect(f.calls.at(-1)).toEqual({ id: first.pageId, name: 'take_snapshot', input: { pageId: 1 } })
    expect(second.pageId).not.toBe(first.pageId)
    expect(f.calls.some(call => call.name === 'new_page')).toBe(false)
    await f.call('close_page', { pageId: second.pageId })
    expect(f.tabs).toHaveLength(1)
  })
  it('does not leak or control another conversation, even with identical URLs', async () => {
    const f = fixture()
    const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    expect(await f.call('list_pages', {}, 'two')).toMatchObject({ pages: [] })
    await expect(f.call('select_page', { pageId: page.pageId }, 'two')).rejects.toThrow('another conversation')
    expect(f.connect).not.toHaveBeenCalled()
  })
  it('requires explicit selection before reading an existing user page', async () => {
    const f = fixture()
    const id = f.surfaces.automationNewTab('https://example.test/')
    await expect(f.call('take_snapshot', { pageId: id })).rejects.toThrow('grant control')
    await f.call('select_page', { pageId: id })
    await f.call('take_snapshot', { pageId: id })
    expect(f.connect).toHaveBeenCalledWith(id, undefined)
  })
  it('refuses privileged schemes and file uploads without a workspace', async () => {
    const f = fixture()
    await expect(f.call('new_page', { url: 'file:///secret' })).rejects.toThrow('HTTP')
    const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    await expect(f.call('navigate_page', { pageId: page.pageId, url: 'javascript:alert(1)' })).rejects.toThrow('HTTP')
    await expect(f.call('upload_file', { pageId: page.pageId, filePaths: ['/secret'] })).rejects.toThrow('workspace')
    expect(f.connect).not.toHaveBeenCalled()
  })
  it('refuses a destroyed target without reconnecting it to another page', async () => {
    const f = fixture()
    const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    await f.call('close_page', { pageId: page.pageId })
    await expect(f.call('click', { pageId: page.pageId, uid: '1_2' })).rejects.toThrow('closed')
  })
  it('blocks subsequent operations in a stopped turn and permits a fresh turn', async () => {
    const f = fixture()
    const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    await f.broker.stop()
    await expect(f.call('click', { pageId: page.pageId, uid: '1_2' })).rejects.toThrow('stopped')
    await f.broker.endTurn('turn')
    await expect(f.call('take_snapshot', { pageId: page.pageId })).rejects.toThrow('stopped')
    f.broker.beginTurn('next')
    await f.call('take_snapshot', { pageId: page.pageId }, 'one', 'next')
    expect(f.connect).toHaveBeenCalledTimes(1)
  })
  it('restricts file uploads to regular files inside the attached workspace', async () => {
    const f = fixture()
    const directory = await mkdtemp(join(tmpdir(), 'janusx-control-unit-'))
    const workspace = join(directory, 'workspace')
    try {
      await mkdir(workspace)
      await writeFile(join(workspace, 'allowed.txt'), 'allowed')
      await writeFile(join(directory, 'outside.txt'), 'outside')
      const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
      const upload = (path: string) => f.broker.call('one', 'turn', 'upload_file', { pageId: page.pageId, uid: '1_1', filePaths: [path] }, new AbortController().signal, workspace)
      await expect(upload(join(directory, 'outside.txt'))).rejects.toThrow()
      expect(f.connect).not.toHaveBeenCalled()
      await upload(join(workspace, 'allowed.txt'))
      expect(f.calls.at(-1)?.input.filePaths).toEqual([join(workspace, 'allowed.txt')])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('honors disable and abort before any host page is created', async () => {
    const f = fixture()
    f.settings.browser.enabled = false
    await expect(f.call('new_page', { url: 'https://example.test/' })).rejects.toThrow('disabled')
    f.settings.browser.enabled = true
    const controller = new AbortController(); controller.abort()
    await expect(f.broker.call('one', 'turn', 'new_page', { url: 'https://example.test/' }, controller.signal)).rejects.toThrow()
    expect(f.tabs).toHaveLength(0)
  })
  it('cancels an in-flight request and rejects a queued action after user stop', async () => {
    const f = fixture()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const forwarded: string[] = []
    f.connect.mockImplementationOnce(async () => ({ tools: [], close: vi.fn(async () => {}), call: async (name, _input, signal) => {
      forwarded.push(name)
      if (name === 'click') {
        started()
        await new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      }
      return { content: [{ type: 'text', text: '1: Fixture (https://example.test/)' }] }
    } }))
    const page = await f.call('new_page', { url: 'https://example.test/' }) as { pageId: number }
    const running = f.call('click', { pageId: page.pageId, uid: '1_1' })
    const runningRejected = expect(running).rejects.toThrow('cancelled')
    await ready
    const queued = f.call('fill', { pageId: page.pageId, uid: '1_2', value: 'queued' })
    const queuedRejected = expect(queued).rejects.toThrow('stopped')
    await f.broker.stop()
    await Promise.all([runningRejected, queuedRejected])
    expect(forwarded).not.toContain('fill')
  })
})
