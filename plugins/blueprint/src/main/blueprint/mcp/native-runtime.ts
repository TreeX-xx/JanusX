import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { NoteMcpClients } from './clients'
import { NOTE_MCP_CLIENTS, type NoteMcpProbe } from '../../../shared/note-mcp'
import { NOTE_MAINTENANCE_GUIDE } from './guide'

const descriptor = z.object({ launch: z.object({ command: z.string().min(1), args: z.array(z.string()).min(1), env: z.record(z.string()) }),
  directories: z.object({ home: z.string().min(1), codexHome: z.string().optional(), configHome: z.string().optional(), dshHome: z.string().optional() }) })
const clientsByHost = new WeakMap<object, Promise<NoteMcpClients>>()

export async function callNoteMcp(host: Pick<NativePeer, 'call'>, method: string, input: unknown, signal: AbortSignal) {
  if (method === 'mcp.guide') return NOTE_MAINTENANCE_GUIDE
  let pending = clientsByHost.get(host)
  if (!pending) {
    pending = host.call('mcp.launch', null, signal).then(raw => {
      const { launch, directories } = descriptor.parse(raw)
      return new NoteMcpClients({ ...directories, launch })
    }).catch(cause => { clientsByHost.delete(host); throw cause })
    clientsByHost.set(host, pending)
  }
  const clients = await pending, launch = clients.dirs.launch
  signal.throwIfAborted()
  if (method === 'mcp.status') return clients.status()
  if (method === 'mcp.change') {
    const args = z.object({ client: z.enum(NOTE_MCP_CLIENTS), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['import', 'remove']) }).strict().parse(input)
    await clients.change(args); return clients.status()
  }
  const result: NoteMcpProbe = { ok: false, tools: [] }, root = await mkdtemp(join(tmpdir(), 'janusx-note-probe-'))
  const client = new Client({ name: 'janusx-note-probe', version: '1.0.0' })
  const transport = new StdioClientTransport({ ...launch, env: { ...getDefaultEnvironment(), ...launch.env }, stderr: 'pipe', cwd: root })
  transport.stderr?.on('data', () => {})
  const abort = () => { void transport.close() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await client.connect(transport, { timeout: 10_000 })
    result.tools = (await client.listTools({}, { timeout: 10_000 })).tools.map(tool => tool.name)
    if (!['note.list', 'note.read', 'note.write', 'note.init', 'note.context', 'note.suggestions', 'note.suggestions.close'].every(name => result.tools.includes(name))) throw new Error('Required Note tools are unavailable')
    const response = await client.callTool({ name: 'note.list', arguments: { workspacePath: root } }, undefined, { timeout: 10_000 })
    if (response.isError) throw new Error('Note read probe failed')
    result.ok = true
  } catch { result.error = 'Install and enable the compatible Blueprint plugin, then register Note MCP again.' }
  finally {
    signal.removeEventListener('abort', abort)
    await client.close().catch(() => {}); await transport.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  signal.throwIfAborted()
  return result
}
