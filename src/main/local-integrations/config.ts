import { applyEdits, modify, parse as parseJson, type ParseError } from 'jsonc-parser'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { isDeepStrictEqual } from 'node:util'
import type { LocalIntegrationClient } from '../../shared/local-integrations'

export class IntegrationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'IntegrationError' }
}
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntegrationError('invalid-config')
  return value as Record<string, unknown>
}
export function parseConfig(raw: string, client: LocalIntegrationClient): Record<string, unknown> {
  try {
    const text = raw.replace(/^\uFEFF/, '')
    if (!text.trim()) return {}
    if (client === 'codex') return object(parseToml(text))
    const errors: ParseError[] = []
    const value = parseJson(text, errors, { allowTrailingComma: true, disallowComments: false })
    if (errors.length) throw new IntegrationError('invalid-config')
    return object(value)
  } catch { throw new IntegrationError('invalid-config') }
}
export function collection(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let value: unknown = data
  for (const key of keys) {
    if (value === undefined) return {}
    value = object(value)[key]
  }
  return value === undefined ? {} : object(value)
}
export function mcpTransport(config: Record<string, unknown>): 'stdio' | 'http' | 'sse' {
  if (typeof config.url === 'string') return config.type === 'sse' ? 'sse' : 'http'
  if (typeof config.command === 'string' || Array.isArray(config.command)) return 'stdio'
  throw new IntegrationError('invalid-server')
}
export function validateServer(value: unknown, client: LocalIntegrationClient): Record<string, unknown> {
  const config = object(value)
  const transport = mcpTransport(config)
  if (transport === 'stdio') {
    if (client === 'opencode') {
      if (config.type !== 'local' || !Array.isArray(config.command) || !config.command.length || config.command.some(item => typeof item !== 'string' || item.includes('\0')) || !config.command[0].trim()) throw new IntegrationError('invalid-server')
    } else if (typeof config.command !== 'string' || !config.command.trim() || config.command.includes('\0')) throw new IntegrationError('invalid-server')
    if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(item => typeof item !== 'string' || item.includes('\0')))) throw new IntegrationError('invalid-server')
  } else {
    const templated = /\$\{[A-Za-z_][\w]*(?::-[^}]*)?\}|\{env:[A-Za-z_][\w]*\}/.test(String(config.url))
    if (!templated) {
      try { if (!['http:', 'https:'].includes(new URL(String(config.url)).protocol)) throw new Error() } catch { throw new IntegrationError('invalid-server') }
    }
    if (client === 'opencode' && config.type !== 'remote') throw new IntegrationError('invalid-server')
  }
  for (const key of ['env', 'environment', 'headers', 'http_headers', 'env_http_headers']) {
    if (config[key] !== undefined && Object.values(object(config[key])).some(item => typeof item !== 'string')) throw new IntegrationError('invalid-server')
  }
  return config
}

/** JSONC edits retain comments. TOML edits replace only explicit tables and prove unrelated data stayed intact. */
export function updateServer(raw: string, client: LocalIntegrationClient, keys: string[], name: string, config: Record<string, unknown>): string {
  const before = parseConfig(raw, client)
  const existing = collection(before, keys)
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = raw.replace(/^\uFEFF/, '')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (client !== 'codex') {
    return bom + applyEdits(text || '{}', modify(text || '{}', [...keys, name], config, { formattingOptions: { insertSpaces: true, tabSize: 2, eol } }))
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const table = new RegExp('^\\s*\\[mcp_servers\\.(?:' + escaped + '|"' + escaped + '"|\'' + escaped + '\')(?:\\.[^\\]]+)?\\]\\s*(?:#.*)?$')
  let owned = false, found = false
  const kept = text.split(/\r?\n/).filter(line => {
    if (/^\s*\[/.test(line)) { owned = table.test(line); found ||= owned }
    return !owned
  }).join('\n')
  if (existing[name] !== undefined && !found) throw new IntegrationError('toml-layout')
  const serializedEntry = stringifyToml({ mcp_servers: { [name]: config } })
  const result = `${kept.trimEnd()}\n\n${serializedEntry}`.replace(/^\n+/, '')
  const after = parseConfig(result, client)
  const withoutEntry = (data: Record<string, unknown>) => ({ ...data, mcp_servers: Object.fromEntries(Object.entries(collection(data, keys)).filter(([key]) => key !== name)) })
  const expected = collection(parseConfig(serializedEntry, client), keys)[name]
  if (!isDeepStrictEqual(withoutEntry(before), withoutEntry(after)) || !isDeepStrictEqual(collection(after, keys)[name], expected)) throw new IntegrationError('toml-layout')
  return bom + (eol === '\r\n' ? result.replace(/\n/g, '\r\n') : result)
}
