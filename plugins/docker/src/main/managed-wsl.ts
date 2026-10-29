// Note: .agents/notes/workbench/docker-management-entry.md — opt-in managed runtime, data survives uninstall.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import type { RuntimeStatus, RuntimePhase } from '../shared/docker'
import { execute, launchEngine, type Execute } from './runtime-process'
import { rootfsDownloader, type DownloadRootfs } from './runtime-download'

export const distribution = 'JanusX-Docker' as const
export const endpoint = 'unix:///var/run/docker.sock'
export const installScript = `set -eu
export DEBIAN_FRONTEND=noninteractive
# This file is inside the dedicated JanusX distro only. Do not auto-start services during apt.
printf '#!/bin/sh\nexit 101\n' >/usr/sbin/policy-rc.d
chmod 755 /usr/sbin/policy-rc.d
dpkg --configure -a </dev/null
apt-get -o DPkg::Lock::Timeout=600 update -qq </dev/null
apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends ca-certificates docker.io util-linux </dev/null
test -x /usr/bin/docker && test -x /usr/bin/dockerd && test -x /usr/bin/flock
mkdir -p /var/lib/janusx-docker
touch /var/lib/janusx-docker/installed
`
interface Dependencies { run: Execute; download: DownloadRootfs; launch(wsl: string): Promise<void>; platform: string; architecture: string; wsl: string; elevate(): Promise<string> }
export class ManagedWsl {
  state: RuntimeStatus = { phase: 'checking', busy: false }
  private flight?: Promise<void>
  private abort = new AbortController()
  private checked = false
  private id?: string
  private deps: Dependencies
  constructor(readonly root: string, host: NativePeer, dependencies: Partial<Dependencies> = {}) {
    const wsl = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/wsl.exe')
    this.deps = { run: execute, download: rootfsDownloader(host, process.arch), launch: launchEngine, platform: process.platform, architecture: process.arch, wsl,
      elevate: () => {
        // Fixed Microsoft command; no plugin/page text is interpolated into an elevated shell.
        const script = "$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath \"$env:SystemRoot\\System32\\wsl.exe\" -ArgumentList '--install','--no-distribution','--no-launch' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -notin 0,3010) { exit 1 }; Write-Output 'restart-required' } catch { exit 2 }"
        return execute(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { signal: this.abort.signal, timeout: 900_000 })
      }, ...dependencies }
  }
  get executable(): string { return this.deps.wsl }
  private set(phase: RuntimePhase, extra: Partial<RuntimeStatus> = {}): void { this.state = { phase, busy: Boolean(this.flight), ...extra } }
  private linux(args: string[], timeout = 18_000, input?: string): Promise<string> {
    return this.deps.run(this.deps.wsl, ['--distribution', distribution, '--user', 'root', '--exec', ...args], { signal: this.abort.signal, timeout, input })
  }
  private async identity(create = false): Promise<string | undefined> {
    if (this.id) return this.id
    try {
      const data = JSON.parse(await readFile(join(this.root, 'owner.json'), 'utf8'))
      if (!/^[a-f0-9-]{36}$/.test(data.id)) throw new Error('docker-runtime-ownership')
      return this.id = data.id
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || !create) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw cause
      }
      await mkdir(this.root, { recursive: true })
      const id = randomUUID()
      // Exclusive creation makes concurrent profiles agree on ownership.
      try { const file = await open(join(this.root, 'owner.json'), 'wx'); try { await file.writeFile(JSON.stringify({ id })) } finally { await file.close() } }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; return this.identity() }
      return this.id = id
    }
  }
  private async owns(recover = false): Promise<void> {
    const id = await this.identity()
    let marker = await this.linux(['/bin/cat', '/etc/janusx-docker-owner'], 5000).catch(() => '')
    if (recover && id && !marker) {
      // Recover an interrupted import only when Windows registers this exact managed data path.
      const script = "$ErrorActionPreference='Stop'; Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' | Get-ItemProperty | Where-Object DistributionName -eq 'JanusX-Docker' | Select-Object -ExpandProperty BasePath"
      const base = await this.deps.run(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { signal: this.abort.signal }).catch(() => '')
      if (base && resolve(base.replace(/^\\\\\?\\/, '')).toLowerCase() === resolve(this.root, 'distribution').toLowerCase()) {
        await this.linux(['/bin/sh', '-s'], 18_000, `set -eu\nprintf '%s' '${id}' > /etc/janusx-docker-owner\n`); marker = id
      }
    }
    if (!id || marker.trim() !== id) throw new Error('docker-runtime-ownership')
    const kernel = await this.linux(['/bin/cat', '/proc/sys/kernel/osrelease'], 5000)
    if (!/microsoft.*wsl2/i.test(kernel)) throw new Error('docker-runtime-wsl2-required')
  }
  async inspect(force = false): Promise<RuntimeStatus> {
    if (this.flight || this.checked && !force) return this.state
    if (this.deps.platform !== 'win32' || !['x64', 'arm64'].includes(this.deps.architecture)) { this.set('unsupported'); this.checked = true; return this.state }
    this.set('checking')
    try {
      let distros: string
      try { distros = await this.deps.run(this.deps.wsl, ['--list', '--quiet'], { signal: this.abort.signal, timeout: 5000 }) }
      catch { this.set('wsl-required'); this.checked = true; return this.state }
      if (!distros.split(/\r?\n/).some(name => name.trim() === distribution)) this.set('not-installed')
      else {
        await this.owns()
        const installed = await this.linux(['/usr/bin/test', '-f', '/var/lib/janusx-docker/installed'], 5000).then(() => true, () => false)
        if (!installed) this.set('not-installed')
        else {
          const ready = await this.linux(['/usr/bin/docker', '--host', endpoint, 'info', '--format', '{{.ServerVersion}}'], 5000).then(() => true, () => false)
          this.set(ready ? 'ready' : 'stopped')
        }
      }
    } catch (cause) { this.set('error', { error: failure(cause) }) }
    this.checked = true; return this.state
  }
  /** Accept quickly; lengthy installation belongs to activation, not the requesting page. */
  start(): RuntimeStatus {
    if (this.abort.signal.aborted) throw new Error('docker-runtime-cancelled')
    if (this.flight) return this.state
    if (this.deps.platform !== 'win32' || !['x64', 'arm64'].includes(this.deps.architecture)) throw new Error('docker-runtime-unsupported')
    this.set('checking', { busy: true })
    this.flight = this.prepare().catch(cause => { this.set('error', { error: failure(cause) }) }).finally(() => {
      this.flight = undefined; this.state = { ...this.state, busy: false }; this.checked = true
    })
    return this.state
  }
  private async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const lockPath = join(this.root, 'install.lock')
    try {
      const pid = Number(await readFile(lockPath, 'utf8'))
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('docker-runtime-busy')
      try { process.kill(pid, 0); throw new Error('docker-runtime-busy') }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause }
      await rm(lockPath)
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
    const lock = await open(lockPath, 'wx')
    try {
      await lock.writeFile(String(process.pid))
      let distros: string
      try { distros = await this.deps.run(this.deps.wsl, ['--list', '--quiet'], { signal: this.abort.signal }) }
      catch {
        this.abort.signal.throwIfAborted()
        this.set('preparing-wsl'); await this.deps.elevate(); this.set('restart-required'); return
      }
      const id = await this.identity(true)
      if (!distros.split(/\r?\n/).some(name => name.trim() === distribution)) {
        this.set('downloading', { progress: 0 })
        const archive = join(this.root, 'ubuntu-base.tar.gz')
        await this.deps.download(archive, this.abort.signal, progress => { this.set('downloading', { progress }) })
        this.set('importing')
        try { await this.deps.run(this.deps.wsl, ['--import', distribution, join(this.root, 'distribution'), archive, '--version', '2'], { signal: this.abort.signal, timeout: 300_000 }) }
        catch (cause) {
          this.abort.signal.throwIfAborted()
          if (!(cause instanceof Error) || !/0x80370102|0x8007019e|HCS_E_HYPERV_NOT_INSTALLED|WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED/i.test(cause.message)) throw cause
          this.set('preparing-wsl'); await this.deps.elevate(); this.set('restart-required'); return
        }
        await this.linux(['/bin/sh', '-s'], 18_000, `set -eu\nprintf '%s' '${id}' > /etc/janusx-docker-owner\n`)
      }
      await this.owns(true)
      const installed = await this.linux(['/usr/bin/test', '-f', '/var/lib/janusx-docker/installed']).then(() => true, () => false)
      if (!installed) { this.set('installing'); await this.linux(['/usr/bin/flock', '-w', '600', '/run/janusx-docker-install.lock', '/bin/sh', '-s'], 900_000, installScript) }
      this.set('starting')
      const healthy = () => this.linux(['/usr/bin/docker', '--host', endpoint, 'info', '--format', '{{.ServerVersion}}'], 5000)
      if (!await healthy().then(() => true, () => false)) {
        this.abort.signal.throwIfAborted(); await this.deps.launch(this.deps.wsl)
        let ready = false
        for (let attempt = 0; attempt < 30; attempt++) {
          this.abort.signal.throwIfAborted()
          if (await healthy().then(() => true, () => false)) { ready = true; break }
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error('docker-runtime-cancelled')) }
            const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort', abort); resolve() }, 1000)
            this.abort.signal.addEventListener('abort', abort, { once: true })
          })
        }
        if (!ready) throw new Error('docker-runtime-start-failed')
      }
      this.set('ready')
    } finally { await lock.close(); await rm(lockPath, { force: true }) }
  }
  stop(): void { this.abort.abort() }
}
function failure(cause: unknown): string { return (cause instanceof Error ? cause.message : String(cause)).slice(-2000) }
