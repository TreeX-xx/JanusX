import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument } from 'yaml'

export type McpConfigFormat = 'mcpServers' | 'opencode' | 'codex' | 'dsh'
export interface McpLaunch { command: string; args: string[]; env?: Record<string, string> }
export const MCP_KEY = 'janusx-note'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const key = (format: McpConfigFormat) => format === 'opencode' ? 'mcp' : format === 'codex' ? 'mcp_servers' : format

function read(raw: string, format: McpConfigFormat): Record<string, unknown> {
  if (format === 'codex') return raw.trim() ? parseToml(raw) : {}
  const errors: ParseError[] = []
  const value = parse(raw || '{}', errors, { allowTrailingComma: true })
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid client configuration; repair the original file before registering')
  return value
}

const beginDsh = '# janusx-note managed begin'
const endDsh = '# janusx-note managed end'
function dshRows(raw: string): unknown[] {
  const doc = parseDocument(raw || '[]', { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (doc.errors.length || !Array.isArray(doc.toJS())) throw new Error('Invalid DSH patch list')
  return doc.toJS()
}
function dshConfig(raw: string) {
  const rows = dshRows(raw)
  const matches = rows.flatMap(row => object(row).id === MCP_KEY ? [object(row)] : Array.isArray(object(row).insert) ? (object(row).insert as unknown[]).map(object).filter(row => row.id === MCP_KEY) : [])
  if (matches.length > 1) throw new Error('Duplicate DSH Note entries')
  const starts = [...raw.matchAll(/^# janusx-note managed begin\r?$/gm)]
  const ends = [...raw.matchAll(/^# janusx-note managed end\r?$/gm)]
  if (!starts.length && !ends.length) return { entry: matches[0], owned: false, start: -1, end: -1 }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index! >= ends[0].index!) throw new Error('Invalid managed DSH boundaries')
  const start = starts[0].index!, end = ends[0].index! + ends[0][0].length
  const block = dshRows(raw.slice(start + starts[0][0].length, ends[0].index))
  const insert = object(block[0]).insert
  const entry = Array.isArray(insert) && insert.length === 1 ? object(insert[0]) : undefined
  if (block.length !== 1 || Object.keys(object(block[0])).join() !== 'insert' || !entry
    || Object.keys(entry).sort().join() !== 'config,id,name' || entry.id !== MCP_KEY
    || entry.name !== '@deepseek-ai/dsh-mcp-client' || matches.length !== 1
    || !isDeepStrictEqual(entry, matches[0])) throw new Error('Managed DSH block contains unrelated configuration')
  return { entry, owned: true, start, end }
}
export function clientEntry(raw: string, format: McpConfigFormat): unknown {
  if (format === 'dsh') {
    const { entry, owned } = dshConfig(raw)
    return entry ? owned ? object(entry.config) : { foreign: true } : undefined
  }
  return object(read(raw, format)[key(format)])[MCP_KEY]
}
export function desiredEntry(format: McpConfigFormat, launch: McpLaunch): Record<string, unknown> {
  if (format === 'dsh') return { serverName: MCP_KEY, transport: 'stdio', ...launch }
  if (format === 'opencode') return { type: 'local', command: [launch.command, ...launch.args], enabled: true, ...(launch.env ? { environment: launch.env } : {}) }
  return { ...launch }
}

export function updateClientConfig(raw: string, format: McpConfigFormat, launch: McpLaunch | null): string {
  if (format === 'dsh') {
    const { entry, owned, start, end } = dshConfig(raw)
    if (entry && !owned) throw new Error('DSH Note entry is not owned by Janus')
    const clean = (start < 0 ? raw : raw.slice(0, start) + raw.slice(end).replace(/^\r?\n/, '')).replace(/^[ \t]*\[\][ \t]*(?=#|\r?$)/m, '')
    if (!launch) return clean
    const result = clean + (clean && !clean.endsWith('\n') ? '\n' : '') + beginDsh + '\n- insert: ' + JSON.stringify([{ id: MCP_KEY, name: '@deepseek-ai/dsh-mcp-client', config: desiredEntry(format, launch) }]) + '\n' + endDsh + '\n'
    dshConfig(result)
    return result
  }
  const data = read(raw, format)
  const parent = data[key(format)]
  if (parent !== undefined && (parent === null || typeof parent !== 'object' || Array.isArray(parent))) throw new Error('Invalid MCP server collection')
  if (format !== 'codex') {
    const source = raw || '{}'
    return applyEdits(source, modify(source, [key(format), MCP_KEY], (launch ? desiredEntry(format, launch) : undefined), { formattingOptions: { insertSpaces: true, tabSize: 2, eol: raw.includes('\r\n') ? '\r\n' : '\n' } }))
  }
  // Replace only this server's explicit tables; retain other tables and comments verbatim.
  const table = /^\s*\[mcp_servers\.(?:janusx-note|"janusx-note"|'janusx-note')(?:\.[^\]]+)?\]\s*(?:#.*)?$/
  let owned = false
  let found = false
  const lines = raw.split(/\r?\n/)
  const kept = lines.filter(line => {
    if (/^\s*\[/.test(line)) { owned = table.test(line); if (owned) found = true }
    return !owned
  }).join('\n')
  if (object(parent)[MCP_KEY] !== undefined && !found) throw new Error('Existing inline MCP configuration needs manual conversion to a TOML table')
  const fields = launch ? [`[mcp_servers.${MCP_KEY}]`, `command = ${JSON.stringify(launch.command)}`, `args = ${JSON.stringify(launch.args)}`] : []
  if (launch?.env) fields.push(`[mcp_servers.${MCP_KEY}.env]`, ...Object.entries(launch.env).map(([name, value]) => `${JSON.stringify(name)} = ${JSON.stringify(value)}`))
  const result = `${kept.trimEnd()}${fields.length ? '\n\n' + fields.join('\n') : ''}\n`
  const parsed = parseToml(result)
  const withoutEntry = (value: Record<string, unknown>) => ({ ...value, mcp_servers: Object.fromEntries(Object.entries(object(value.mcp_servers)).filter(([name]) => name !== MCP_KEY)) })
  if (!isDeepStrictEqual(withoutEntry(data), withoutEntry(parsed))) throw new Error('Cannot safely update this TOML layout; unrelated values would change')
  return raw.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result
}
