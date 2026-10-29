import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join, isAbsolute } from 'node:path'
import { localDockerEndpoint, validDockerWsl } from '@janusx/plugin-sdk'
import type { Container, Engine } from '../shared/docker'

export type Run = (executable: string, args: string[], signal?: AbortSignal) => Promise<string>
export const run: Run = (executable, args, signal) => new Promise((done, reject) => {
  const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: 'pipe', env: dockerEnvironment() })
  let output = '', error = '', settled = false
  const finish = (cause?: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); cause ? reject(cause) : done(output) }
  const abort = () => { child.kill(); finish(new Error('docker-cancelled')) }
  const timer = setTimeout(() => { child.kill(); finish(new Error('docker-timeout')) }, 18_000)
  child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 4 * 1024 * 1024) { child.kill(); finish(new Error('docker-output-limit')) } })
  child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-8192) })
  child.on('error', cause => finish(new Error((cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'docker-cli-missing' : cause.message)))
  child.on('close', code => finish(code === 0 ? undefined : new Error(error.trim() || 'docker-command-failed')))
  child.stdin.end()
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
})
export function dockerEnvironment(): NodeJS.ProcessEnv {
  // Never allow caller launch flags to override the pinned target or CLI templates/configuration.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DOCKER_(?:HOST|CONTEXT|TLS_VERIFY|CERT_PATH|CONFIG|API_VERSION)$/i.test(key)))
}
export async function findDocker(): Promise<string> {
  const filename = process.platform === 'win32' ? 'docker.exe' : 'docker'
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...(process.platform === 'win32' ? ['C:/Program Files/Docker/Docker/resources/bin'] : ['/usr/local/bin', '/opt/homebrew/bin', '/Applications/Docker.app/Contents/Resources/bin'])]
  for (const dir of dirs) {
    if (!isAbsolute(dir)) continue
    const file = join(dir, filename)
    try { await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return await realpath(file) } catch { /* Next installed location. */ }
  }
  throw new Error('docker-cli-missing')
}
export function parseContainers(text: string): Container[] {
  return text.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const item = JSON.parse(line), labels = Object.fromEntries(String(item.Labels ?? '').split(',').filter(Boolean).map(label => { const index = label.indexOf('='); return [label.slice(0, index), label.slice(index + 1)] }))
    if (!/^[a-f0-9]{64}$/.test(item.ID)) throw new Error('docker-invalid-response')
    const ports: Container['ports'] = []
    const pattern = /(\[[^\]]+\]|[\d.]+):(\d+)->(\d+)\/(tcp|udp)/g
    for (const match of String(item.Ports ?? '').matchAll(pattern)) ports.push({ host: match[1], port: Number(match[2]), container: Number(match[3]), protocol: match[4] })
    return { id: item.ID, name: String(item.Names), image: String(item.Image), state: String(item.State), status: String(item.Status), project: labels['com.docker.compose.project'] ?? '', service: labels['com.docker.compose.service'] ?? '', ports }
  })
}
export class DockerCli {
  executable = ''; engine?: Engine; wsl?: string
  constructor(private execute: Run = run, private locate = findDocker) {}
  async connect(signal?: AbortSignal): Promise<Engine> {
    if (this.wsl) {
      const info = JSON.parse(await this.execute(this.executable, this.args('info', '--format', '{{json .}}'), signal))
      return this.engine = { endpoint: 'unix:///var/run/docker.sock', name: String(info.Name ?? this.wsl), version: String(info.ServerVersion ?? ''), os: 'linux' }
    }
    const executable = await this.locate()
    const context = (await this.execute(executable, ['context', 'show'], signal)).trim()
    if (!context || context.startsWith('-')) throw new Error('docker-invalid-context')
    const contexts = JSON.parse(await this.execute(executable, ['context', 'inspect', context], signal))
    const endpoint = localDockerEndpoint(String(contexts[0]?.Endpoints?.docker?.Host ?? ''))
    if (this.engine && this.engine.endpoint !== endpoint) throw new Error('docker-engine-changed')
    const info = JSON.parse(await this.execute(executable, ['--host', endpoint, 'info', '--format', '{{json .}}'], signal))
    this.executable = executable
    return this.engine = { endpoint, name: String(info.Name ?? context), version: String(info.ServerVersion ?? ''), os: String(info.OSType ?? '') }
  }
  useManaged(executable: string): void {
    if (this.engine && !this.wsl) throw new Error('docker-engine-changed')
    this.executable = executable; this.wsl = 'JanusX-Docker'
    this.engine = { endpoint: 'unix:///var/run/docker.sock', name: this.wsl, version: '', os: 'linux' }
  }
  selectWsl(executable: string, distribution: string): void {
    if (!validDockerWsl(distribution)) throw new Error('docker-invalid-distribution')
    this.executable = executable; this.wsl = distribution
    this.engine = { endpoint: 'unix:///var/run/docker.sock', name: distribution, version: '', os: 'linux' }
  }
  reset(): void { this.executable = ''; this.wsl = undefined; this.engine = undefined }
  args(...args: string[]): string[] {
    if (!this.engine) throw new Error('docker-not-connected')
    return [...(this.wsl ? ['--distribution', this.wsl, '--user', 'root', '--exec', '/usr/bin/docker'] : []), '--host', this.engine.endpoint, ...args]
  }
  async list(signal?: AbortSignal): Promise<Container[]> { return parseContainers(await this.execute(this.executable, this.args('ps', '-a', '--no-trunc', '--format', '{{json .}}'), signal)) }
  async operate(id: string, action: 'start' | 'stop' | 'restart', signal?: AbortSignal): Promise<void> {
    // Short stop timeout keeps this ordinary request within the host's 30-second deadline.
    await this.execute(this.executable, this.args(action, ...(action === 'start' ? [] : ['--time', '5']), id), signal)
  }
  follow(id: string): ChildProcessWithoutNullStreams {
    return spawn(this.executable, this.args('logs', '--follow', '--timestamps', '--tail', '500', id), { shell: false, windowsHide: true, env: dockerEnvironment(), stdio: 'pipe' })
  }
}
