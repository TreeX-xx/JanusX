import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startBrowserTerminalHost } from '../../src/main/browser/terminal-host'
import { connectBrowserTerminal } from '../../src/main/browser/terminal-connection'
import type { BrowserControlBroker } from '../../src/main/browser/control-broker'

describe('authenticated browser terminal bridge', () => {
  it('requires host authentication, preserves client identity, enforces approval and releases sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-host-')), file = join(root, 'connection.json')
    const approve = vi.fn(async () => false)
    const broker = { catalog: async () => [{ name: 'click', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } } }, { name: 'list_pages', inputSchema: { type: 'object' } }],
      beginTurn: vi.fn(), releaseOwner: vi.fn(async () => {}), call: vi.fn(async () => ({ pages: [] })) }
    const host = await startBrowserTerminalHost({ file, broker: broker as unknown as BrowserControlBroker, approve })
    let connection: Awaited<ReturnType<typeof connectBrowserTerminal>> | undefined
    try {
      const descriptor = JSON.parse(await readFile(file, 'utf8'))
      expect((await fetch(descriptor.endpoint + '/connect', { method: 'POST', body: '{}' })).status).toBe(403)
      connection = await connectBrowserTerminal(file, 'codex', root)
      expect(connection.tools[0].inputSchema.properties).not.toHaveProperty('filePath')
      await connection.call('list_pages', {})
      expect(broker.call).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'list_pages', {}, expect.any(AbortSignal), expect.any(String))
      await expect(connection.call('click', { pageId: 1 })).rejects.toThrow('not approved')
      expect(broker.call).toHaveBeenCalledTimes(1)
      await host.disconnectClient('codex')
      await expect(connection.call('list_pages', {})).rejects.toThrow('expired')
      expect(broker.releaseOwner).toHaveBeenCalledTimes(1)
    } finally { await connection?.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
  })
})
