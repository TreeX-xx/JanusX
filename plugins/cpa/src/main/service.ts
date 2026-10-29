import type { JsonValue } from '@janusx/plugin-sdk'
import { cp, mkdir, readFile, rename, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SerialQueue, writeFileAtomic, type NativePeer, type NativePluginImplementation } from '@janusx/plugin-sdk/native'
import { normalizeCpaSettings, validateCpaManagementKey, type CpaSettings } from '../shared/cpa'
import { connectDesktop, desktop } from './desktop'
import { CpaRuntime } from './runtime'

const oauth = {
  prefix: '/v8/management/oauth/', auth: '/v8/management/oauth/auth-url', status: '/v8/management/oauth/status', session: '/v8/management/oauth/session',
  providers: {
    codex: { port: 1455, urls: ['https://auth.openai.com/oauth/authorize'] },
    claude: { port: 54545, urls: ['https://claude.ai/oauth/authorize'] },
    antigravity: { port: 51121, urls: ['https://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com/o/oauth2/v2/auth'] },
  },
}

/** Copy legacy data once without changing or deleting the original. No download or process start here. */
export async function importCpaData(directory: string, legacy: { directory: string; settings: unknown } | null): Promise<void> {
  const target = join(directory, 'components')
  try { await lstat(target); return } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
  const staging = join(directory, `import-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  try {
    if (legacy) {
      const info = await lstat(legacy.directory).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
      })
      if (info) {
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('cpa-invalid-legacy-directory')
        await cp(legacy.directory, staging, { recursive: true, errorOnExist: true, force: false, filter: async source => {
          if ((await lstat(source)).isSymbolicLink()) throw new Error('cpa-invalid-legacy-directory')
          return true
        } })
      }
    }
    await mkdir(staging, { recursive: true })
    // Settings and data are prepared before the final directory rename. A partial copy is never active.
    let settings: CpaSettings
    try { settings = normalizeCpaSettings(legacy?.settings ?? null) } catch { settings = normalizeCpaSettings(null) }
    await writeFileAtomic(join(staging, 'plugin-settings.json'), JSON.stringify(settings))
    await rename(staging, target)
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function createCpaService(context: JsonValue, host: NativePeer): Promise<NativePluginImplementation> {
  connectDesktop(host)
  const initial = context as { directory: string; allowLegacyImport: boolean }
  const legacy = initial.allowLegacyImport ? await desktop.call('desktop.legacy', {}) as {directory: string; settings: unknown} | null : null
  await importCpaData(initial.directory, legacy)
  const root = join(initial.directory, 'components'), settingsPath = join(root, 'plugin-settings.json')
  let settings = normalizeCpaSettings(JSON.parse(await readFile(settingsPath, 'utf8')))
  const runtime = new CpaRuntime(root)
  const queue = new SerialQueue()
  let stopped = false, generation = 0, configurationRevision = 0, flight: Promise<void> | undefined, operationError: string | undefined
  const check = (revision: number) => { if (stopped || revision !== generation) throw new Error('cpa-stopped') }
  function run(operation: (revision: number) => Promise<void>): void {
    if (stopped) throw new Error('cpa-stopped')
    if (flight) throw new Error('cpa-operation-in-progress')
    operationError = undefined
    const revision = generation
    flight = queue.run(async () => { check(revision); await operation(revision) }).catch(cause => {
      operationError = cause instanceof Error && /^cpa-[a-z-]+$/.test(cause.message) ? cause.message : 'cpa-operation-failed'
    }).finally(() => { flight = undefined })
  }
  const browser = (owner: string, method: string, input: Record<string, JsonValue> = {}) => desktop.call(`desktop.browser.${method}`, { ...input, owner })
  return {
    async call(method, value, signal) {
      const request = value as { input: Record<string, JsonValue>; instanceId?: string }
      const input = request.input ?? {}, owner = request.instanceId
      try {
        if (stopped) throw new Error('cpa-stopped')
        if (method === 'browser.oauth-status') return await runtime.oauthStatus(String(input.state), signal) ?? null
        let result: unknown = null
        switch (method) {
          case 'settings.read': result = settings; break
          case 'settings.save': {
            if (flight) throw new Error('cpa-operation-in-progress')
            const next = normalizeCpaSettings(input.settings)
            const key = input.key === undefined ? undefined : validateCpaManagementKey(input.key)
            if (key && next.mode !== 'managed') throw new Error('cpa-not-managed')
            run(async revision => {
              await runtime.stop()
              check(revision)
              if (key) await runtime.setManagementKey(key)
              check(revision)
              await writeFileAtomic(settingsPath, JSON.stringify(next))
              settings = next
              configurationRevision++
              check(revision)
              if (settings.mode === 'managed' && settings.enabled) await runtime.start(settings)
            })
            break
          }
          case 'runtime.status': result = { ...await runtime.status(), busy: Boolean(flight), operationError, revision: configurationRevision }; break
          case 'runtime.start':
            if (settings.mode === 'managed') { if (!settings.enabled) throw new Error('cpa-not-enabled'); run(() => runtime.start(settings)) }
            break
          case 'runtime.stop':
            generation++
            await runtime.stop()
            await flight
            operationError = undefined
            break
          case 'runtime.restart':
          case 'runtime.update':
            if (settings.mode !== 'managed' || !settings.enabled) throw new Error('cpa-not-enabled')
            run(async revision => {
              if (method === 'runtime.update') await runtime.stageUpdate()
              check(revision)
              await runtime.stop()
              check(revision)
              await runtime.start(settings)
            }); break
          case 'runtime.copy-key': await runtime.copyKey(); break
          case 'runtime.logs': await runtime.openLogs(); break
          case 'browser.open': {
            if (!owner) throw new Error('cpa-page-unavailable')
            if (settings.mode === 'managed' && (await runtime.status()).phase !== 'running') throw new Error('cpa-not-running')
            await browser(owner, 'open', { url: settings.managementUrl, direct: settings.mode === 'managed', ...(settings.mode === 'managed' ? { oauth } : {}) })
            break
          }
          case 'browser.close': case 'browser.bounds': case 'browser.status':
            if (!owner) throw new Error('cpa-page-unavailable')
            result = await browser(owner, method.slice(8), input); break
          case 'browser.external': await desktop.call('desktop.external', { url: settings.managementUrl }); break
          default: throw new Error('cpa-unknown-method')
        }
        return JSON.parse(JSON.stringify({ ok: true, data: result })) as JsonValue
      } catch (cause) {
        return { ok: false, error: cause instanceof Error && /^cpa-[a-z-]+$/.test(cause.message) ? cause.message : 'cpa-operation-failed' }
      }
    },
    async stop() { stopped = true; generation++; await runtime.dispose(); await flight },
    // UI leases are revoked by the host. The application-level backend belongs to the activation.
    async releaseContext() {},
  }
}
