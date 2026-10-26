import { app } from 'electron'
import { homedir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { NoteMcpClients } from '../../../../plugins/blueprint/src/main/blueprint/mcp/clients'
import type { NoteMcpProbe } from '../../../../plugins/blueprint/src/shared/note-mcp'

export function noteMcpClients(): NoteMcpClients {
  return new NoteMcpClients({ home: homedir(), codexHome: process.env.CODEX_HOME, configHome: process.env.XDG_CONFIG_HOME, dshHome: process.env.DSH_HOME,
    launch: { command: app.isPackaged ? process.execPath : 'node',
      args: [join(app.isPackaged ? app.getAppPath() : process.env.JANUSX_DEV_BUILD_ROOT ?? join(app.getAppPath(), 'out'), ...(app.isPackaged ? ['out', 'main'] : ['main']), 'note-mcp.js')],
      env: { ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}), JANUSX_PLUGIN_HOME: join(app.getPath('userData'), 'janusx', 'plugins') } },
  })
}

/** Handshake and a harmless read in a disposable workspace; never run commands from client configuration. */
export async function probeNoteMcp(): Promise<NoteMcpProbe> {
  const result: NoteMcpProbe = { ok: false, tools: [] }
  const root = await mkdtemp(join(tmpdir(), 'janusx-note-probe-'))
  const client = new Client({ name: 'janusx-note-probe', version: '1.0.0' })
  const launch = noteMcpClients().dirs.launch
  const transport = new StdioClientTransport({ ...launch, env: { ...getDefaultEnvironment(), ...launch.env }, stderr: 'pipe', cwd: root })
  transport.stderr?.on('data', () => {})
  try {
    await client.connect(transport, { timeout: 10000 })
    result.tools = (await client.listTools({}, { timeout: 10000 })).tools.map(tool => tool.name)
    if (!['note.list', 'note.read', 'note.write', 'note.init', 'note.context', 'note.suggestions', 'note.suggestions.close'].every(name => result.tools.includes(name))) throw new Error('Required Note tools are unavailable')
    const response = await client.callTool({ name: 'note.list', arguments: { workspacePath: root } }, undefined, { timeout: 10000 })
    if (response.isError) throw new Error('Note read probe failed')
    result.ok = true
  } catch { result.error = 'Note MCP could not start; install and enable the compatible official Blueprint plugin, then register Note MCP again' }
  finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
  return result
}
