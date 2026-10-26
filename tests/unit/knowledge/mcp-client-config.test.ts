import { parse } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { clientEntry, updateClientConfig, type McpLaunch } from '../../../plugins/blueprint/src/main/blueprint/mcp/client-config'
const launch: McpLaunch = { command: 'C:\\Program Files\\JanusX\\JanusX.exe', args: ['C:\\app.asar\\out\\main\\note-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1', JANUSX_NOTE_STATE_ROOT: 'C:\\User Data\\config.json' } }
describe('client configuration interoperability', () => {
  it('preserves JSONC comments and unrelated client settings', () => {
    const source = '{\n // keep this comment\n "inputs": [], "mcpServers": {"other":{"command":"other"}},\n}'
    const updated = updateClientConfig(source, 'mcpServers', launch)
    expect(updated).toContain('// keep this comment')
    expect(updated).toContain('"inputs": []')
    expect(parse(updated).mcpServers.other).toEqual({ command: 'other' })
    expect(clientEntry(updated, 'mcpServers')).toEqual(launch)
    expect(updateClientConfig(updated, 'mcpServers', launch)).toBe(updated)
  })
  it('updates only the Codex server tables and preserves other settings', () => {
    const source = '# user preference\nmodel = "chosen"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.janusx-note]\ncommand = "old"\n[mcp_servers.janusx-note.env]\nOLD = "old"\n[features]\n# retain\nfoo = true\n'
    const updated = updateClientConfig(source, 'codex', launch)
    expect(updated).toContain('# user preference\nmodel = "chosen"')
    expect(updated).toContain('[features]\n# retain\nfoo = true')
    expect(updated).toContain('[mcp_servers.other]\ncommand = "other"')
    expect(clientEntry(updated, 'codex')).toEqual(launch)
    expect(updateClientConfig(updated, 'codex', launch)).toBe(updated)
  })
  it('emits OpenCode local array commands and environment', () => {
    expect(clientEntry(updateClientConfig('', 'opencode', launch), 'opencode')).toEqual({ type: 'local', command: [launch.command, ...launch.args], enabled: true, environment: launch.env })
  })
  it('rejects malformed collections and unsupported inline TOML without rewriting', () => {
    expect(() => updateClientConfig('{"mcpServers":42}', 'mcpServers', launch)).toThrow()
    expect(() => updateClientConfig('mcp_servers = {janusx-note = {command="old"}}', 'codex', launch)).toThrow('inline')
  })
})
