import { app } from 'electron'
import { access, open, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { managedCliEnv } from '../external-cli/managed-paths'
import { providerPathContext, resolveProviderPaths } from '../external-cli/provider-paths'
import { OpenCodeUsageSource } from '../runtime-telemetry/opencode-source'
import { isDshLog, readDshUsage } from '../runtime-telemetry/dsh-usage'
import { sameRuntimePath } from '../../shared/runtime/path-identity'
import { normalizeHistorySourceSettings, type HistorySource, type HistorySourceSettings, type HistorySourcesView, type HistorySourceStatus } from '../../shared/history-sources'
import { resolveHistorySources } from './history-sources'

const queue = new SerialQueue()
const settingsPath = () => join(app.getPath('userData'), 'janusx', 'history-sources.json')
export async function readHistorySourceSettings(): Promise<HistorySourceSettings> {
  try { return normalizeHistorySourceSettings(JSON.parse(await readFile(settingsPath(), 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return normalizeHistorySourceSettings(undefined)
  }
}

export async function localHistorySources(settings?: HistorySourceSettings): Promise<HistorySource[]> {
  const [{ agentSessionRegistry }, { registeredWorkspaces }] = await Promise.all([import('./session-registry'), import('../workspace/runtime')])
  const { isExternalWorkspaceRuntime, parseRuntimeResource } = await import('../../shared/workspace-runtime')
  await agentSessionRegistry.load()
  const records = agentSessionRegistry.listSessions({ includeArchived: true }).map(item => agentSessionRegistry.getSession(item.id))
    .filter(item => item && !parseRuntimeResource(item.cwd))
  const roots = (await registeredWorkspaces()).filter(item => !isExternalWorkspaceRuntime(item.runtime)).map(item => item.path)
  const retained: Record<string, string[]> = {}
  for (const item of records) if (item?.providerStorePath) (retained[item.engine] ??= []).push(item.providerStorePath)
  return resolveHistorySources(settings ?? await readHistorySourceSettings(), providerPathContext({ env: managedCliEnv() }),
    [...new Set([...roots, ...records.map(item => item!.cwd)])], retained)
}

/** Bounded, read-only validation. Never copy a live SQLite file away from its WAL. */
export async function inspectHistorySource(source: HistorySource): Promise<HistorySourceStatus> {
  const result: HistorySourceStatus = { ...source, status: 'empty', resume: 'read-only' }
  try {
    const info = await stat(source.path)
    await access(source.path, constants.R_OK)
    if (source.engine === 'opencode') {
      if (!info.isFile()) return { ...result, status: 'invalid' }
      const db = new OpenCodeUsageSource(source.path)
      try { result.status = db.sessions().length ? 'ready' : 'empty' } finally { db.close() }
      const active = resolveProviderPaths('opencode', providerPathContext({ env: managedCliEnv() })).store
      if (active && sameRuntimePath(active, source.path)) result.resume = 'active-store'
      return result
    }
    if (!info.isDirectory()) return { ...result, status: 'invalid' }
    const pending = [source.path]
    let visited = 0
    let examined = 0
    while (pending.length && visited < 2000 && examined < 20) {
      const dir = pending.pop()!
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (++visited > 2000 || examined >= 20) break
        const path = join(dir, entry.name)
        if (entry.isDirectory()) pending.push(path)
        else if (entry.isFile() && source.engine === 'dsh' && isDshLog(entry.name)) {
          examined++
          const header = await readDshUsage(path, source.namespace, Date.now(), true).catch(() => undefined)
          if (header) return { ...result, status: 'ready' }
        } else if (entry.isFile() && source.engine !== 'dsh' && entry.name.endsWith('.jsonl')) {
          examined++
          const file = await open(path, 'r')
          let text: string
          try { const buffer = Buffer.alloc(64 * 1024); const read = await file.read(buffer); text = buffer.subarray(0, read.bytesRead).toString('utf8') }
          finally { await file.close() }
          const valid = text.split('\n').some(line => {
            try {
              const row = JSON.parse(line)
              return source.engine === 'claude' ? typeof row.sessionId === 'string' && !!row.message
                : source.engine === 'codex' ? row.type === 'session_meta' && typeof row.payload?.id === 'string'
                  : row.type === 'session' && typeof row.id === 'string'
            } catch { return false }
          })
          if (valid) {
            result.status = 'ready'
            if (source.engine === 'pi' || source.engine === 'claude' && basename(source.path) === 'projects'
              || source.engine === 'codex' && ['sessions', 'archived_sessions'].includes(basename(source.path))) result.resume = 'native-layout'
            return result
          }
        }
      }
    }
    if (examined) result.status = 'invalid'
    return result
  } catch (error) {
    return { ...result, status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
}
export async function getHistorySourcesView(): Promise<HistorySourcesView> {
  const settings = await readHistorySourceSettings()
  const sources = await localHistorySources(settings)
  return { settings, sources: await Promise.all(sources.map(inspectHistorySource)) }
}
export async function saveHistorySources(value: unknown): Promise<HistorySourcesView> {
  return queue.run(async () => {
    const settings = normalizeHistorySourceSettings(value)
    const previous = await readHistorySourceSettings()
    for (const entry of settings.locations) {
      if (!isAbsolute(entry.path)) throw new Error('History location must be an absolute path')
      const unchanged = previous.locations.some(old => old.engine === entry.engine && sameRuntimePath(old.path, entry.path) && old.enabled)
      if (entry.enabled && !unchanged) {
        const inspected = await inspectHistorySource({ ...entry, namespace: entry.path, automatic: false })
        if (inspected.status !== 'ready') throw new Error(`No readable ${entry.engine} history found at ${entry.path} (${inspected.status})`)
      }
    }
    await writeFileAtomic(settingsPath(), JSON.stringify(settings, null, 2))
    return getHistorySourcesView()
  })
}
