// Note: CPA process, encrypted management key and component updates — see .agents/notes/workbench/service-integrations.md
import { desktop } from './desktop'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { SerialQueue, writeFileAtomic } from '@janusx/plugin-sdk/native'
import type { CpaSettings, CpaStatus } from '../shared/cpa'
import { validateCpaManagementKey } from '../shared/cpa'
import { CpaInstaller, type CpaInstallation } from './installer'
import { CpaProxy, cpaProxyEnvironment } from './desktop'
import { cpaLocalRequest } from './local-request'
export { cpaProxyEnvironment } from './desktop'

export interface CpaRuntimeControl {
  status(): Promise<CpaStatus>
  start(settings: CpaSettings): Promise<void>
  stop(): Promise<void>
  stageUpdate(): Promise<void>
  copyKey(): Promise<void>
  setManagementKey(key: string): Promise<void>
  openLogs(): Promise<void>
  dispose(): Promise<void>
  oauthStatus?(state: string, signal: AbortSignal): Promise<string | undefined>
}

export async function assertCpaPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error('cpa-port-in-use')))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()))
  })
}

export function managedCpaConfig(existing: string, settings: CpaSettings, accounts: string, proxy = ''): string {
  const parsed: unknown = existing ? parse(existing) : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('cpa-invalid-config')
  const value = parsed as Record<string, any>
  value['config-version'] = 8
  value.server = { ...value.server, host: '127.0.0.1', port: settings.port ?? 8317,
    tls: { enable: false }, discovery: { enabled: false }, 'github-token': '' }
  value.management = { ...value.management, 'allow-remote': false, 'secret-key': '',
    'disable-control-panel': false, 'disable-auto-update-panel': true }
  value.oauth = { ...value.oauth, 'auth-dir': accounts }
  // Management api-call ignores environment proxies; the explicit relay also covers executors.
  value.requests = { ...value.requests, 'proxy-url': proxy }
  delete value['proxy-url']
  value.access = { ...value.access, 'api-keys': value.access?.['api-keys']?.length ? value.access['api-keys'] : [randomBytes(32).toString('hex')] }
  // Host-owned keys override legacy spellings too: never accidentally expose a listener.
  delete value.host; delete value.port; delete value['remote-management']; delete value['auth-dir']
  value.observability = { ...value.observability,
    logs: { ...value.observability?.logs, 'logging-to-file': false, 'logs-max-total-size-mb': 10, 'error-logs-max-files': 2, 'request-log': false } }
  return stringify(value)
}

export class CpaRuntime implements CpaRuntimeControl {
  private queue = new SerialQueue()
  private child: ChildProcess | null = null
  private abort = new AbortController()
  private updateFlight: Promise<void> | null = null
  private state: CpaStatus = { phase: 'not-installed' }
  private initialized = false
  private initialization?: Promise<void>
  private disposed = false
  private generation = 0
  private managementKey: string | null = null
  private keyFlight?: Promise<string>
  private lastUpdateCheck = 0
  private updateTimer?: ReturnType<typeof setInterval>
  private logQueue = new SerialQueue()
  private logTail = ''
  private proxy?: CpaProxy
  private origin?: string

  constructor(readonly root: string,
    private readonly installer = new CpaInstaller(root)) {}

  async status(): Promise<CpaStatus> {
    if (!this.initialized) {
      this.initialization ??= (async () => {
        const [current, pending] = await Promise.all([this.installer.read('current'), this.installer.read('pending')])
        this.state = { ...this.state, phase: current ? 'stopped' : 'not-installed',
          version: current ? `${current.backend} / ${current.frontend}` : undefined,
          pendingVersion: pending ? `${pending.backend} / ${pending.frontend}` : undefined }
        this.initialized = true
      })()
      await this.initialization
    }
    return { ...this.state }
  }

  start(settings: CpaSettings): Promise<void> {
    const generation = this.generation
    return this.queue.run(async () => {
      if (this.disposed || generation !== this.generation) throw new Error('cpa-stopped')
      await this.status()
      if (this.disposed || generation !== this.generation) throw new Error('cpa-stopped')
      if (this.child && this.state.phase === 'running') { this.configureUpdates(settings); return }
      this.abort = new AbortController()
      try {
        await assertCpaPortFree(settings.port ?? 8317)
        await mkdir(join(this.root, 'accounts'), { recursive: true, mode: 0o700 })
        await this.key()
        if (this.updateFlight) await this.updateFlight.catch(() => {})
        let current = await this.installer.read('current')
        let target = await this.installer.read('pending') ?? current
        if (!target) {
          this.state.phase = 'downloading'
          target = await this.install()
          this.lastUpdateCheck = Date.now()
        }
        const configPath = join(this.root, 'config.yaml')
        let original = ''
        try { original = await readFile(configPath, 'utf8') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        try {
          await this.launch(target, settings, original)
        } catch (error) {
          await this.terminate()
          if (!current || current.id === target.id) throw error
          await this.launch(current, settings, original)
          target = current
          this.state.updateError = 'cpa-update-rolled-back'
        }
        this.abort.signal.throwIfAborted()
        if (!this.child || this.child.exitCode !== null) throw new Error('cpa-process-exited')
        await this.installer.activate(target)
        current = target
        this.state = { ...this.state, phase: 'running', version: `${current.backend} / ${current.frontend}`,
          pid: this.child?.pid, pendingVersion: undefined, error: undefined, progress: undefined }
        this.configureUpdates(settings)
      } catch (error) {
        await this.terminate()
        this.state = { ...this.state, phase: 'failed', pid: undefined, error: errorCode(error) }
        throw new Error(this.state.error)
      }
    })
  }

  async stop(): Promise<void> {
    this.generation++
    this.abort.abort()
    await this.queue.run(async () => {
      await this.terminate()
      this.state = { ...this.state, phase: this.state.version ? 'stopped' : 'not-installed', pid: undefined, error: undefined }
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.generation++
    this.abort.abort()
    // Do not wait on a queued download during application shutdown.
    await this.terminate()
    await this.logQueue.run(async () => {})
  }

  stageUpdate(): Promise<void> {
    if (this.updateFlight) return this.updateFlight
    if (this.disposed) return Promise.reject(new Error('cpa-stopped'))
    if (this.abort.signal.aborted) this.abort = new AbortController()
    this.lastUpdateCheck = Date.now()
    this.updateFlight = this.status().then(() => this.install()).then(async () => {
      const pending = await this.installer.read('pending')
      this.state.pendingVersion = pending ? `${pending.backend} / ${pending.frontend}` : undefined
      this.state.updateError = undefined
    }).catch((error) => {
      this.state.updateError = errorCode(error)
      throw new Error(this.state.updateError)
    }).finally(() => { this.updateFlight = null; this.state.progress = undefined })
    return this.updateFlight
  }

  private install(): Promise<CpaInstallation> {
    return this.installer.install(this.abort.signal, (value) => { this.state.progress = value })
  }

  private configureUpdates(settings: CpaSettings): void {
    if (this.updateTimer) clearInterval(this.updateTimer)
    this.updateTimer = undefined
    if (settings.autoUpdate === false) return
    const check = () => { void this.stageUpdate().catch(() => {}) }
    if (Date.now() - this.lastUpdateCheck > 24 * 60 * 60 * 1000) check()
    this.updateTimer = setInterval(check, 24 * 60 * 60 * 1000)
    this.updateTimer.unref()
  }

  copyKey(): Promise<void> { return this.queue.run(async () => { await desktop.call('desktop.clipboard', { text: await this.key() }) }) }

  setManagementKey(input: string): Promise<void> {
    const key = validateCpaManagementKey(input)
    return this.queue.run(async () => {
      if (this.disposed) throw new Error('cpa-stopped')
      if (this.child) throw new Error('cpa-key-change-requires-stop')
      await this.keyFlight?.catch(() => {})
      await this.saveKey(key)
      this.keyFlight = Promise.resolve(key)
    })
  }
  async openLogs(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await appendFile(join(this.root, 'cpa.log'), '')
    await desktop.call('desktop.openPath', { path: join(this.root, 'cpa.log') })
  }

  private key(): Promise<string> {
    if (this.managementKey) return Promise.resolve(this.managementKey)
    this.keyFlight ??= this.loadKey().catch((error) => { this.keyFlight = undefined; throw error })
    return this.keyFlight
  }

  private async loadKey(): Promise<string> {
    if (this.managementKey) return this.managementKey
    await this.assertEncryption()
    const path = join(this.root, 'management-key.enc')
    try { this.managementKey = await desktop.decrypt(await readFile(path)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('cpa-key-unavailable')
      await this.saveKey(randomBytes(32).toString('hex'))
    }
    return this.managementKey!
  }

  private async assertEncryption(): Promise<void> {
    try { await desktop.call('desktop.encryption', {}) } catch { throw new Error('cpa-encryption-unavailable') }
  }

  private async saveKey(key: string): Promise<void> {
    await this.assertEncryption()
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      await writeFileAtomic(join(this.root, 'management-key.enc'), await desktop.encrypt(key))
    } catch { throw new Error('cpa-key-save-failed') }
    this.managementKey = key
  }

  async oauthStatus(state: string, signal: AbortSignal): Promise<string | undefined> {
    if (!this.origin || !this.child || !/^[a-zA-Z0-9_.-]{1,128}$/.test(state)) return undefined
    const response = await cpaLocalRequest(`${this.origin}/v8/management/oauth/status?state=${encodeURIComponent(state)}`,
      AbortSignal.any([signal, AbortSignal.timeout(3000)]), await this.key(), true)
    return response.ok ? response.status : undefined
  }

  private async launch(value: CpaInstallation, settings: CpaSettings, original: string): Promise<void> {
    if (this.abort.signal.aborted || this.disposed) throw new Error('cpa-stopped')
    this.state.phase = 'starting'
    const env: NodeJS.ProcessEnv = await cpaProxyEnvironment()
    this.proxy = new CpaProxy()
    const proxy = await this.proxy.start()
    await writeFileAtomic(join(this.root, 'config.yaml'), managedCpaConfig(original, settings, join(this.root, 'accounts'), proxy))
    // Even code paths that only understand environment variables use the same relay.
    Object.assign(env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy })
    this.origin = `http://127.0.0.1:${settings.port ?? 8317}`
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
      if (process.env[name]) env[name] = process.env[name]
    }
    env.MANAGEMENT_PASSWORD = await this.key()
    env.MANAGEMENT_STATIC_PATH = join(this.installer.directory(value), 'management.html')
    this.abort.signal.throwIfAborted()
    const child = spawn(join(this.installer.directory(value), this.installer.binaryName), ['-config', join(this.root, 'config.yaml'), '-local-model'], {
      cwd: this.root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
    })
    this.child = child
    let launchError = false
    child.once('error', () => { launchError = true })
    child.once('exit', () => {
      if (this.child !== child) return
      this.child = null
      void this.proxy?.close(); this.proxy = undefined; this.origin = undefined
      this.state = { ...this.state, phase: 'failed', pid: undefined, error: 'cpa-process-exited' }
    })
    const output = (data: Buffer) => this.log(data.toString())
    child.stdout?.on('data', output)
    child.stderr?.on('data', output)
    if (process.platform === 'win32' && child.pid) {
      // A separate watcher survives a parent crash and releases only this captured child.
      // GetProcessById/StartTime capture process identity before waiting, rather than
      // killing whatever happens to occupy the PID later.
      const script = '$ErrorActionPreference="Stop";try {$p=[Diagnostics.Process]::GetProcessById([int]$env:JANUSX_CPA_PARENT);$c=[Diagnostics.Process]::GetProcessById([int]$env:JANUSX_CPA_CHILD);$created=$c.StartTime;while(-not $c.HasExited){if($p.WaitForExit(1000)){if(-not $c.HasExited -and $c.StartTime -eq $created){$c.Kill()};break}}}catch{}'
      const watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true, shell: false, detached: true, stdio: 'ignore',
        env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
          JANUSX_CPA_PARENT: String(process.pid), JANUSX_CPA_CHILD: String(child.pid) },
      })
      watcher.on('error', () => { /* Normal app shutdown still terminates the owned process. */ })
      watcher.unref()
      child.once('exit', () => watcher.kill())
    }
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      this.abort.signal.throwIfAborted()
      if (launchError || child.exitCode !== null || this.child !== child) throw new Error('cpa-process-exited')
      try {
        const response = await cpaLocalRequest(`${this.origin}/v8/management/config`,
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(1000)]), await this.key())
        if (response.ok && this.child === child && child.exitCode === null) {
          const page = await cpaLocalRequest(`${this.origin}/management.html`,
            AbortSignal.any([this.abort.signal, AbortSignal.timeout(1500)]))
          if (page.ok) return
        }
      } catch { /* Retry only while this owned child is starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('cpa-start-timeout')
  }

  private async terminate(): Promise<void> {
    if (this.updateTimer) clearInterval(this.updateTimer)
    this.updateTimer = undefined
    const child = this.child
    this.child = null
    this.origin = undefined
    const proxy = this.proxy
    this.proxy = undefined
    await proxy?.close()
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1500)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill()
    })
  }

  private log(chunk: string): void {
    this.logTail += chunk
    const lines = this.logTail.split(/\r?\n/)
    this.logTail = lines.pop()?.slice(-8192) ?? ''
    const content = lines.map((line) => /authorization|bearer|token|password|secret|api.?key|credential/i.test(line)
      ? '[credential-related output omitted]' : line.replace(/\x1b\[[0-9;]*m/g, '')
        .replaceAll(this.managementKey ?? '\0', '[redacted]').slice(0, 4096)).join('\n')
    if (!content) return
    void this.logQueue.run(async () => {
      const path = join(this.root, 'cpa.log')
      try { if ((await stat(path)).size > 2 * 1024 * 1024) await rename(path, join(this.root, 'cpa.previous.log')) } catch { /* New log. */ }
      await appendFile(path, content + '\n')
    }).catch(() => {})
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^cpa-[a-z-]+$/.test(error.message) ? error.message : 'cpa-operation-failed'
}
