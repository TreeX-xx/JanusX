import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validDockerWsl } from '@janusx/plugin-sdk'
import { writeFileAtomic } from '@janusx/plugin-sdk/native'
import type { DockerTarget, RuntimeStatus, EnvironmentState, WslDistribution } from '../shared/docker'
import { ManagedWsl, distribution, endpoint } from './managed-wsl'
import { execute, type Execute } from './runtime-process'

const existingInstall = `set -eu
export DEBIAN_FRONTEND=noninteractive
. /etc/os-release
test "$ID" = ubuntu
# Never replace an existing Docker client, daemon, configuration or repository.
if test -e /usr/bin/docker || test -e /usr/bin/dockerd || command -v docker >/dev/null 2>&1 || command -v dockerd >/dev/null 2>&1; then exit 42; fi
apt-get -o DPkg::Lock::Timeout=600 update -qq </dev/null
apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends docker.io util-linux </dev/null
`
export function parseTarget(value: unknown): DockerTarget {
  if (!value || typeof value !== 'object') throw new Error('docker-invalid-target')
  const target = value as DockerTarget
  if (target.kind === 'local' || target.kind === 'managed') return { kind: target.kind }
  if (target.kind === 'wsl' && validDockerWsl(target.distribution) && target.distribution !== distribution) return { kind: 'wsl', distribution: target.distribution }
  throw new Error('docker-invalid-target')
}
interface Dependencies { run: Execute; platform: string }
export class Environments {
  target: DockerTarget = { kind: 'local' }
  revision = 0
  private status: RuntimeStatus = { phase: 'checking', busy: false }
  private distributions: WslDistribution[] = []
  private discovery?: Promise<void>
  private discoveryError?: string
  private flight?: Promise<void>
  private probe?: Promise<RuntimeStatus>
  private abort = new AbortController()
  private deps: Dependencies
  constructor(private directory: string | undefined, readonly managed: ManagedWsl, dependencies: Partial<Dependencies> = {}) {
    this.deps = { run: execute, platform: process.platform, ...dependencies }
  }
  async load(): Promise<void> {
    if (!this.directory) return
    try { this.target = parseTarget(JSON.parse(await readFile(join(this.directory, 'environment.json'), 'utf8'))) }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') this.status = { phase: 'error', busy: false, error: 'docker-invalid-target' } }
  }
  get state(): RuntimeStatus { return this.target.kind === 'managed' ? this.managed.state : { ...this.status, busy: Boolean(this.flight) } }
  snapshot(): EnvironmentState {
    return { target: this.target, status: this.state, distributions: this.distributions, discovering: Boolean(this.discovery), revision: this.revision, windows: this.deps.platform === 'win32', ...(this.discoveryError ? { discoveryError: this.discoveryError } : {}) }
  }
  get executable(): string { return this.managed.executable }
  private async inventory(): Promise<string[]> {
    this.abort.signal.throwIfAborted()
    if (this.deps.platform !== 'win32') throw new Error('docker-runtime-unsupported')
    const text = await this.deps.run(this.executable, ['--list', '--quiet'], { signal: this.abort.signal, timeout: 5000 })
    return text.split(/\r?\n/).map(name => name.trim()).filter(validDockerWsl)
  }
  discover(): void {
    if (this.discovery) return
    this.discoveryError = undefined
    this.discovery = this.inventory().then(names => { this.distributions = names.filter(name => name !== distribution).map(name => ({ name })) })
      .catch(cause => { this.discoveryError = message(cause); this.distributions = [] }).finally(() => { this.discovery = undefined })
  }
  async select(value: unknown): Promise<void> {
    if (this.state.busy || this.probe) throw new Error('docker-busy')
    const next = parseTarget(value)
    if (next.kind !== 'local' && this.deps.platform !== 'win32') throw new Error('docker-runtime-unsupported')
    if (next.kind === 'wsl' && !(await this.inventory()).includes(next.distribution)) throw new Error('docker-distribution-gone')
    this.abort.signal.throwIfAborted()
    if (this.directory) await writeFileAtomic(join(this.directory, 'environment.json'), JSON.stringify(next))
    this.target = next; this.revision++; this.status = { phase: 'checking', busy: false }
  }
  inspect(refresh = false): Promise<RuntimeStatus> {
    if (this.state.busy) return Promise.resolve(this.state)
    return this.probe ??= this.check(refresh).finally(() => { this.probe = undefined })
  }
  private async linux(args: string[], timeout = 5000, input?: string): Promise<string> {
    this.abort.signal.throwIfAborted()
    if (this.target.kind !== 'wsl') throw new Error('docker-invalid-target')
    return this.deps.run(this.executable, ['--distribution', this.target.distribution, '--user', 'root', '--exec', ...args], { signal: this.abort.signal, timeout, input })
  }
  private async check(refresh: boolean): Promise<RuntimeStatus> {
    if (this.target.kind === 'managed') return this.managed.inspect(refresh)
    if (this.target.kind === 'local') return this.status = { phase: 'ready', busy: false }
    this.status = { phase: 'checking', busy: false }
    try {
      if (!(await this.inventory()).includes(this.target.distribution)) throw new Error('docker-distribution-gone')
      const kernel = await this.linux(['/bin/cat', '/proc/sys/kernel/osrelease'])
      if (!/microsoft.*wsl2/i.test(kernel)) throw new Error('docker-runtime-wsl2-required')
      const os = await this.linux(['/bin/cat', '/etc/os-release'])
      if (!/^ID=["']?ubuntu["']?\s*$/m.test(os)) { this.status = { phase: 'unsupported', busy: false }; return this.status }
      const present = await this.linux(['/usr/bin/test', '-x', '/usr/bin/docker']).then(() => true, () => false)
      if (!present) this.status = { phase: 'not-installed', busy: false }
      else {
        const ready = await this.linux(['/usr/bin/docker', '--host', endpoint, 'info', '--format', '{{.ServerVersion}}']).then(() => true, () => false)
        this.status = { phase: ready ? 'ready' : 'stopped', busy: false }
      }
    } catch (cause) { this.status = { phase: 'error', busy: false, error: message(cause) } }
    return this.status
  }
  start(allowInstall = false): RuntimeStatus {
    if (this.target.kind === 'managed') return this.managed.start()
    if (this.target.kind !== 'wsl') throw new Error('docker-invalid-target')
    if (this.flight) return this.state
    this.abort.signal.throwIfAborted()
    const previous = this.status
    this.status = { phase: 'checking', busy: true }
    this.flight = (async () => {
      const checked = await this.check(false)
      if (checked.phase === 'error' || checked.phase === 'unsupported') throw new Error(checked.error ?? 'docker-runtime-unsupported')
      if (checked.phase === 'not-installed') {
        if (!allowInstall) throw new Error('docker-install-confirmation-required')
        this.status = { phase: 'installing', busy: true }
        await this.linux(['/usr/bin/flock', '-w', '600', '/run/janusx-docker-install.lock', '/bin/sh', '-s'], 900_000, existingInstall)
      }
      this.status = { phase: 'starting', busy: true }
      if (await this.linux(['/usr/bin/docker', '--host', endpoint, 'info', '--format', '{{.ServerVersion}}']).then(() => true, () => false)) return
      // Existing daemons retain their user's service configuration. No replacement dockerd is launched.
      const systemd = await this.linux(['/usr/bin/test', '-d', '/run/systemd/system']).then(() => true, () => false)
      await this.linux(systemd ? ['/usr/bin/systemctl', 'start', 'docker'] : ['/usr/sbin/service', 'docker', 'start'], 30_000)
      await this.linux(['/usr/bin/docker', '--host', endpoint, 'info', '--format', '{{.ServerVersion}}'])
    })().then(() => { this.status = { phase: 'ready', busy: false } }).catch(cause => {
      this.status = { phase: 'error', busy: false, error: message(cause) }
    }).finally(() => { this.flight = undefined })
    if (previous.phase === 'not-installed' && allowInstall) this.status = { phase: 'installing', busy: true }
    return this.status
  }
  stop(): void { this.abort.abort(); this.managed.stop() }
}
function message(cause: unknown): string { return (cause instanceof Error ? cause.message : String(cause)).slice(-2000) }
