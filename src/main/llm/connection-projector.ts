import { homedir } from 'node:os'
import { providerPathContext, resolveProviderPaths } from '../external-cli/provider-paths'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parse as parseToml } from 'smol-toml'
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type { ProviderSettings } from '@janusx/llm-core'
import { channelModels, channelProtocol, type LlmConsumer } from '../../shared/llm-configuration'
import { SerialQueue } from '../lib/atomic-file'

// Note: managed connection fields and native restoration — .agents/notes/terminal/terminal-provider-collections.md
type ExternalAgent = Exclude<LlmConsumer, 'janus'>
type Field = { path: string[]; value?: unknown }
interface ManagedFile { path: string; format: 'json' | 'toml'; original: Field[]; applied: Field[] }
interface Journal { files: ManagedFile[] }
const PROVIDER_KEY = 'janusx_managed'
const BEGIN = '# JanusX managed provider begin'
const END = '# JanusX managed provider end'

async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function secureWrite(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, text, { mode: 0o600 })
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}
function parse(text: string, format: ManagedFile['format']): Record<string, unknown> {
  if (!text.trim()) return {}
  if (format === 'toml') return parseToml(text) as Record<string, unknown>
  const errors: ParseError[] = []
  const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent config must be a valid JSON object')
  return value as Record<string, unknown>
}
function getAt(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value
  for (const key of path) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  return current
}
function equal(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b))
}

/** Locate simple root assignments without interpreting table contents or multiline strings. */
function setTomlRoot(text: string, key: string, value: unknown): string {
  const lines = text.split(/\r?\n/)
  let multiline: string | null = null
  let table = lines.length
  let found = -1
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (multiline) {
      if (line.includes(multiline)) multiline = null
      continue
    }
    const triple = line.match(/"""|'''/)
    if (triple && line.split(triple[0]).length % 2 === 0) { multiline = triple[0]; continue }
    if (/^\s*\[/.test(line)) { table = index; break }
    if (new RegExp('^\\s*(?:' + key + '|"' + key + '"|\x27' + key + '\x27)\\s*=').test(line)) found = index
  }
  const assignment = key + ' = ' + JSON.stringify(value)
  if (found >= 0) {
    if (value === undefined) lines.splice(found, 1)
    else lines[found] = assignment
  } else if (value !== undefined) lines.splice(table, 0, assignment)
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n')
}
function patchText(text: string, format: ManagedFile['format'], fields: Field[]): string {
  if (format === 'json') {
    let next = text.trim() ? text : '{}\n'
    for (const field of fields) next = applyEdits(next, modify(next, field.path, field.value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } }))
    return next
  }
  let next = text
  for (const field of fields) {
    if (field.path.length === 1) next = setTomlRoot(next, field.path[0]!, field.value)
    else {
      const start = next.indexOf(BEGIN)
      const end = next.indexOf(END)
      if (start >= 0 && end >= start) next = next.slice(0, start) + next.slice(end + END.length).replace(/^\r?\n/, '')
      if (field.value !== undefined) {
        const values = field.value as Record<string, unknown>
        next = next.trimEnd() + '\n\n' + BEGIN + '\n[model_providers.' + PROVIDER_KEY + ']\n'
          + Object.entries(values).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join('\n') + '\n' + END + '\n'
      }
    }
  }
  return next
}

export class ConnectionProjector {
  private queue = new SerialQueue()
  constructor(private readonly stateDir: string, private readonly home: string = homedir(), private readonly env: NodeJS.ProcessEnv = process.env) {}
  private journalPath(tool: ExternalAgent): string { return join(this.stateDir, 'llm-connections', tool + '.json') }
  private async plans(tool: ExternalAgent, provider: ProviderSettings, model: string): Promise<Array<{ path: string; format: ManagedFile['format']; fields: Field[] }>> {
    const protocol = channelProtocol(provider)
    const configHome = resolveProviderPaths(tool, providerPathContext({ home: this.home, env: this.env })).configHome
    if (!configHome) throw new Error('Provider configuration directory is unresolved')
    if (tool === 'claude') return [{
      path: join(configHome, 'settings.json'), format: 'json',
      fields: [
        { path: ['env', 'ANTHROPIC_BASE_URL'], value: provider.baseURL },
        { path: ['env', 'ANTHROPIC_AUTH_TOKEN'], value: undefined },
        { path: ['env', 'ANTHROPIC_API_KEY'], value: provider.apiKey },
        { path: ['env', 'ANTHROPIC_MODEL'], value: model }, { path: ['model'], value: model },
      ],
    }]
    if (tool === 'codex') return [{
      path: join(configHome, 'config.toml'), format: 'toml',
      fields: [{ path: ['model'], value: model }, { path: ['model_provider'], value: PROVIDER_KEY },
        { path: ['model_providers', PROVIDER_KEY], value: { name: provider.name, base_url: provider.baseURL,
          wire_api: 'responses', experimental_bearer_token: provider.apiKey || '', requires_openai_auth: false } }],
    }]
    const models = [...new Set([...channelModels(provider), model])]
    if (tool === 'pi') {
      // Pi interprets !-prefixed credentials as shell commands.
      if (provider.apiKey?.trimStart().startsWith('!')) throw new Error('Pi requires a literal API key')
      const dir = configHome
      return [
        { path: join(dir, 'models.json'), format: 'json', fields: [{ path: ['providers', PROVIDER_KEY], value: {
          baseUrl: provider.baseURL, apiKey: provider.apiKey || 'janusx-no-key',
          api: protocol === 'anthropic' ? 'anthropic-messages' : protocol === 'responses' ? 'openai-responses' : 'openai-completions',
          models: models.map(id => ({ id, name: id })),
        } }] },
        { path: join(dir, 'settings.json'), format: 'json', fields: [
          { path: ['defaultProvider'], value: PROVIDER_KEY }, { path: ['defaultModel'], value: model },
        ] },
      ]
    }
    const dir = join(this.env.XDG_CONFIG_HOME || join(this.home, '.config'), 'opencode')
    const json = join(dir, 'opencode.json')
    const jsonc = join(dir, 'opencode.jsonc')
    const path = await readOptional(json) !== null ? json : await readOptional(jsonc) !== null ? jsonc : json
    return [{ path, format: 'json', fields: [
      { path: ['model'], value: PROVIDER_KEY + '/' + model },
      { path: ['provider', PROVIDER_KEY], value: {
        name: provider.name, npm: protocol === 'anthropic' ? '@ai-sdk/anthropic' : protocol === 'responses' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible',
        options: { baseURL: provider.baseURL, apiKey: provider.apiKey || '' },
        models: Object.fromEntries(models.map(id => [id, { name: id }])),
      } },
    ] }]
  }
  async isCurrent(tool: ExternalAgent): Promise<boolean> {
    const raw = await readOptional(this.journalPath(tool))
    if (!raw) return false
    try {
      const journal = JSON.parse(raw) as Journal
      for (const file of journal.files) {
        const text = await readOptional(file.path)
        if (text === null) return false
        const value = parse(text, file.format)
        if (file.applied.some(field => !equal(getAt(value, field.path), field.value))) return false
      }
      return true
    } catch { return false }
  }
  /** Commit selection only after every file verifies. Restore pre-operation bytes on failure. */
  async apply(tool: ExternalAgent, provider: ProviderSettings | null, model: string, commit: () => Promise<void>): Promise<void> {
    return this.queue.run(async () => {
      const journalPath = this.journalPath(tool)
      const previousRaw = await readOptional(journalPath)
      const previous = previousRaw ? JSON.parse(previousRaw) as Journal : null
      const plans = provider ? await this.plans(tool, provider, model) : []
      const paths = [...new Set([...(previous?.files.map(file => file.path) || []), ...plans.map(plan => plan.path)])]
      if (!paths.length) { await commit(); return }
      const snapshots = new Map<string, string | null>()
      const journal: Journal = { files: [] }
      const writes: Array<{ path: string; next: string; format: ManagedFile['format']; fields: Field[] }> = []
      for (const path of paths) {
        const old = previous?.files.find(file => file.path === path)
        const plan = plans.find(file => file.path === path)
        const format = plan?.format || old!.format
        const current = await readOptional(path)
        snapshots.set(path, current)
        const parsed = parse(current || '', format)
        // Refuse to erase a connection changed outside JanusX.
        if (old && !provider && old.applied.some(field => !equal(getAt(parsed, field.path), field.value))) throw new Error('Agent connection changed outside JanusX; explicitly reapply a channel before restoring the original configuration')
        const fields = plan?.fields || old!.original
        const original = plan ? plan.fields.map(field => {
          const prior = old?.original.find(entry => equal(entry.path, field.path))
          return prior || { path: field.path, value: getAt(parsed, field.path) }
        }) : []
        if (plan && !old) {
          const reserved = plan.fields.filter(field => field.path.includes(PROVIDER_KEY))
          if (reserved.some(field => getAt(parsed, field.path) !== undefined)) throw new Error('Reserved JanusX provider name is already in use')
        }
        const next = patchText(current || '', format, fields)
        const checked = parse(next, format)
        if (fields.some(field => !equal(getAt(checked, field.path), field.value))) throw new Error('Unable to safely edit Agent config')
        writes.push({ path, next, format, fields })
        if (plan) journal.files.push({ path, format, original, applied: fields })
      }
      // One bounded recovery snapshot per Agent; it is replaced on the next apply.
      await secureWrite(journalPath + '.backup', JSON.stringify({ previous, snapshots: Object.fromEntries(snapshots) }, null, 2))
      try {
        // Preserve original managed values before any external write.
        await secureWrite(journalPath, JSON.stringify(journal, null, 2))
        for (const write of writes) {
          await secureWrite(write.path, write.next)
          const verified = parse(await readFile(write.path, 'utf8'), write.format)
          if (write.fields.some(field => !equal(getAt(verified, field.path), field.value))) throw new Error('Agent config verification failed')
        }
        if (!provider) await rm(journalPath, { force: true })
        await commit()
      } catch (error) {
        for (const [path, raw] of snapshots) {
          if (raw === null) await rm(path, { force: true })
          else await secureWrite(path, raw)
        }
        if (previousRaw === null) await rm(journalPath, { force: true })
        else await secureWrite(journalPath, previousRaw)
        throw error
      }
    })
  }
}
