import { spawn } from 'node:child_process'
import { dockerEnvironment } from './cli'

export interface ProcessOptions { signal?: AbortSignal; timeout?: number; input?: string }
export type Execute = (file: string, args: string[], options?: ProcessOptions) => Promise<string>
export function decodeOutput(data: Buffer): string {
  return (data.includes(0) ? data.toString('utf16le') : data.toString('utf8')).replace(/^\uFEFF/, '').trim()
}
/** WSL emits UTF-16 for management commands and UTF-8 for Linux commands. */
export const execute: Execute = (file, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { windowsHide: true, shell: false, env: dockerEnvironment(), stdio: 'pipe' })
  const output: Buffer[] = [], error: Buffer[] = []
  let size = 0, settled = false
  const finish = (cause?: Error) => {
    if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
    cause ? reject(cause) : resolve(decodeOutput(Buffer.concat(output)))
  }
  const abort = () => { child.kill(); finish(new Error('docker-runtime-cancelled')) }
  const timer = setTimeout(() => { child.kill(); finish(new Error('docker-runtime-timeout')) }, options.timeout ?? 18_000)
  const append = (target: Buffer[], chunk: Buffer) => {
    size += chunk.length
    if (size > 1024 * 1024) { child.kill(); finish(new Error('docker-output-limit')) } else target.push(chunk)
  }
  child.stdout.on('data', chunk => append(output, chunk)); child.stderr.on('data', chunk => append(error, chunk))
  child.on('error', cause => finish(cause))
  child.on('close', code => finish(code ? new Error(decodeOutput(Buffer.concat(error.length ? error : output)).slice(-2000) || `docker-runtime-exit-${code}`) : undefined))
  child.stdin.on('error', () => {}); child.stdin.end(options.input)
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort()
})

/** The engine is a user runtime, not a page collector; plugin revocation must not stop it. */
export async function launchEngine(wsl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(wsl, ['--distribution', 'JanusX-Docker', '--user', 'root', '--exec', '/usr/bin/flock', '-n', '/run/janusx-dockerd.lock',
      '/usr/bin/dockerd', '--host=unix:///var/run/docker.sock', '--log-level=error'],
    { windowsHide: true, detached: true, stdio: 'ignore', shell: false, env: dockerEnvironment() })
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve() })
  })
}
