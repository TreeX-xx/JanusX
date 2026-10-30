// Note: .agents/notes/terminal/terminal-hook-launch-isolation.md
import { createHash, randomUUID } from 'node:crypto'
import { lstat, realpath, unlink, open, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { applyEdits, modify, parse, parseTree, type ParseError, type Node } from 'jsonc-parser'
import { workspaceIo, writeIoFile, readIoFile } from '@janus-agent/agent-core'
import type { LegacyHookCleanupResult } from '../../shared/ipc/workspace-storage'

export interface LegacyHookLocations {
  homeDir: string
  userDataDir: string
  claudeConfigDir?: string
  codexHome?: string
}

let cleaning: Promise<LegacyHookCleanupResult> | undefined
export function assertHookCleanupIdle(): void {
  if (cleaning) throw new Error('旧 Hook 正在清理，请完成后再打开终端。 Legacy Hook cleanup is in progress.')
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const textFile = async (path: string) => (await readIoFile(path)).toString('utf8')

/** No links, including redirected parents. Missing files are a successful no-op. */
async function plainFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || key(await realpath(path)) !== key(path)) throw new Error('Linked or non-file entry retained')
    return true
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

function ownedCommand(value: unknown): boolean {
  if (!object(value) || value.type !== 'command' || typeof value.command !== 'string') return false
  const raw = value.command
  // Flatten the two quoting forms emitted by the old shell adapters for
  // matching; check shell operators against the original command below.
  const command = raw.replace(/'\\''/g, "'").replace(/''/g, "'")
  if (!/^(?:&\s*)?(?:powershell(?:\.exe)?\s|['"].*?(?:janusx(?:-hook-runner)?|electron)(?:\.exe)?['"]\s)/i.test(command)) return false
  if (!/(?:janusx-agent-hook-v2|janusx-hook-v1)['"]*(?:\s+(?:['"]*(?:-Matcher|--matcher)['"]*\s+)?['"]*(?:permission_prompt|idle_prompt)['"]*)?['"]*\s*$/.test(command)) return false
  if (/-Command\s/i.test(command)) {
    // The historical fallback contains one fixed Test-Path guard. Customized
    // command bodies are retained rather than deleting additional user actions.
    if (!/-Command\s+['"]if \(-not \(Test-Path -LiteralPath /.test(command)
      || !/\)\) \{ exit 0 \}; & /.test(command) || (command.match(/;/g)?.length ?? 0) !== 1 || /[|<>`]/.test(command)) return false
  }
  let quote = ''
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === '\\' && quote !== "'") { index++; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === "'" || char === '"') quote = char
    else if (/[;|<>\r\n`]/.test(char) || char === '&' && index !== 0) return false
  }
  if (quote) return false
  // A name mentioned in user text is not an ownership declaration. Only the
  // historical sender plus its exact marker argument authorizes removal.
  const marked = /(?:-Marker|--janusx-hook-marker)['"]*\s+['"]*(?:janusx-agent-hook-v2|janusx-hook-v1)(?:['"\s]|$)/.test(command)
  const runner = /janusx-hook-runner\.exe['"]\s/.test(command) && /['"](?:janusx-agent-hook-v2|janusx-hook-v1)['"]/.test(command)
  return (marked || runner) && /(?:janusx-agent-hook\.ps1|janusx-hook\.ps1|--janusx-hook(?:['"\s]|$))/.test(command)
}

function rejectDuplicateKeys(node: Node | undefined): void {
  if (!node) return
  if (node.type === 'object') {
    const names = node.children?.map(property => property.children?.[0].value) ?? []
    if (new Set(names).size !== names.length) throw new Error('Duplicate configuration keys retained')
  }
  for (const child of node.children ?? []) rejectDuplicateKeys(child)
}

function cleanedSettings(raw: string): { text: string; removed: number; ambiguous: boolean } {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  let text = raw.slice(bom.length)
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !object(data)) throw new Error('Invalid native Hook configuration retained')
  rejectDuplicateKeys(parseTree(text))
  let removed = 0, ambiguous = false
  if (!object(data.hooks)) return { text: raw, removed, ambiguous: /janusx.*hook|TerminalAgentNotificationCoordinator|terminal-agent-notification|aiCliCompletion/i.test(raw) }
  let removedEvents = 0
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) continue
    let removedGroups = 0
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
      const group: unknown = groups[groupIndex]
      if (!object(group) || !Array.isArray(group.hooks)) continue
      let removedInner = 0
      for (let index = group.hooks.length - 1; index >= 0; index--) {
        const hook: unknown = group.hooks[index]
        if (ownedCommand(hook)) {
          text = applyEdits(text, modify(text, ['hooks', event, groupIndex, 'hooks', index], undefined, {}))
          removed++
          removedInner++
        } else if (object(hook) && typeof hook.command === 'string' && /janusx.*hook|TerminalAgentNotificationCoordinator|terminal-agent-notification|aiCliCompletion/i.test(hook.command)) ambiguous = true
      }
      if (removedInner === group.hooks.length && removedInner > 0 && Object.keys(group).every(name => name === 'hooks' || name === 'matcher')) {
        text = applyEdits(text, modify(text, ['hooks', event, groupIndex], undefined, {}))
        removedGroups++
      }
    }
    if (removedGroups === groups.length && removedGroups > 0) {
      text = applyEdits(text, modify(text, ['hooks', event], undefined, {}))
      removedEvents++
    }
  }
  if (removedEvents === Object.keys(data.hooks).length && removedEvents > 0) text = applyEdits(text, modify(text, ['hooks'], undefined, {}))
  ambiguous ||= /janusx.*hook|TerminalAgentNotificationCoordinator|terminal-agent-notification|aiCliCompletion/i.test(text)
  return { text: bom + text, removed, ambiguous }
}

// Audited generated senders from pre-P3 releases. Unknown/edited files stay.
const LEGACY_SCRIPT_HASHES = new Set<string>([
  '5c0aeb5aa7eec7bad08fc7edd83236f0099eba5e87f7b245e652e22d3d676de5', // e06a5009
  '61c31c2c6b0d0b7427147a513da04f9c1ec8d27710c88d77eddfbf8048b65386', // f8da937a
])
const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')

async function replaceSettings(path: string, before: string, after: string, assertUnused: () => void): Promise<void> {
  const info = await lstat(path), temporary = `${path}.${randomUUID()}.tmp`
  // Preserve native file permissions; never expose a 0600 config in a 0666 temp.
  const handle = await open(temporary, 'wx', info.mode & 0o777)
  try {
    await handle.chmod(info.mode & 0o777)
    await writeIoFile(dirname(path), temporary, [after])
    await handle.sync()
    assertUnused(); await plainFile(path); await plainFile(temporary)
    if (await textFile(path) !== before || (await lstat(path)).ino !== info.ino) throw new Error('Configuration changed during cleanup; retry')
    await handle.close()
    await rename(temporary, path)
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export function retireLegacyHooks(locations: LegacyHookLocations, assertUnused: () => void): Promise<LegacyHookCleanupResult> {
  if (cleaning) return cleaning
  const flight = workspaceIo.run(join(locations.userDataDir, 'janusx', 'hooks'), async () => {
    assertUnused()
    const result: LegacyHookCleanupResult = { commands: 0, files: [], retained: [] }
    const retain = (path: string, reason: string) => result.retained.push({ path, reason })
    const configs = [...new Set([
      join(locations.homeDir, '.claude', 'settings.json'),
      join(locations.homeDir, '.codex', 'hooks.json'),
      ...(locations.claudeConfigDir ? [join(locations.claudeConfigDir, 'settings.json')] : []),
      ...(locations.codexHome ? [join(locations.codexHome, 'hooks.json')] : []),
    ].map(resolvePath => resolve(resolvePath)))]
    let nativeClear = true
    for (const path of configs) {
      try {
        if (!await plainFile(path)) continue
        const before = await textFile(path), cleaned = cleanedSettings(before)
        if (cleaned.removed) {
          assertUnused()
          await plainFile(path)
          await replaceSettings(path, before, cleaned.text, assertUnused)
          result.commands += cleaned.removed
        }
        if (cleaned.ambiguous) { nativeClear = false; retain(path, 'Unrecognized Hook command retained') }
      } catch (error) { nativeClear = false; retain(path, String(error)) }
      await workspaceIo.step()
    }
    const removeKnown = async (path: string, expected: (text: string) => boolean): Promise<void> => {
      try {
        if (!await plainFile(path)) return
        if (!nativeClear) { retain(path, 'Native Hook cleanup is incomplete; sender retained'); return }
        const before = await textFile(path)
        if (!expected(before)) { retain(path, 'Unknown or edited asset retained'); return }
        assertUnused(); await plainFile(path)
        if (await textFile(path) !== before) throw new Error('Asset changed during cleanup; retry')
        await unlink(path); result.files.push(path)
      } catch (error) { retain(path, String(error)) }
      await workspaceIo.step()
    }
    const oldHooks = join(locations.homeDir, '.janusx', 'hooks')
    await removeKnown(join(oldHooks, 'janusx-agent-hook.ps1'), text => LEGACY_SCRIPT_HASHES.has(hash(text)))
    await removeKnown(join(oldHooks, 'janusx-hook-runner.cs'), text => hash(text) === '8d96d100c428ef5ecee7b5e16df8db6a9e89e42c05b90c250ba63f2876b96f63')
    // Opaque executables cannot be attributed by filename alone. Keep them for
    // explicit inspection; never delete a user's replacement binary or logs.
    for (const file of ['janusx-hook-runner.exe']) {
      const path = join(oldHooks, file)
      try { if (await plainFile(path)) retain(path, 'Legacy runner retained for explicit inspection') }
      catch (error) { retain(path, String(error)) }
      await workspaceIo.step()
    }
    const opencode = join(locations.userDataDir, 'janusx', 'hooks', 'opencode')
    const marker = join(opencode, 'janusx-agent-hook-marker.json')
    const ownedMarker = (text: string) => {
      try { const data = JSON.parse(text); return Object.keys(data).length === 2 && data.owner === 'JanusX' && data.marker === 'janusx-agent-hook-v2' }
      catch { return false }
    }
    let opencodeOwned = false
    try { if (await plainFile(marker)) opencodeOwned = ownedMarker(await textFile(marker)) }
    catch { /* removeKnown reports the retained marker below. */ }
    await removeKnown(join(opencode, 'opencode.json'), text => {
      try { const data = JSON.parse(text); return opencodeOwned && Object.keys(data).length === 1 && data.$schema === 'https://opencode.ai/config.json' }
      catch { return false }
    })
    await removeKnown(marker, ownedMarker)
    return result
  }, { background: true })
  cleaning = flight
  void flight.finally(() => { if (cleaning === flight) cleaning = undefined }).catch(() => {})
  return flight
}
