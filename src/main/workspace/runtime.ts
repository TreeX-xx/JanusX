// Note: .agents/notes/sessions/workspace-runtime-import.md
import { spawn, execFile } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, posix } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { app } from 'electron'
import { fetch as fetchRuntime, EnvHttpProxyAgent } from 'undici'
import type { Workspace } from '../../shared/ipc/workspace'
import { parseRuntimeResource, runtimeResource, type WorkspaceRuntime } from '../../shared/workspace-runtime'

const execute = promisify(execFile)
type ExternalRuntime = Exclude<WorkspaceRuntime, { kind: 'windows' }>
export const workspaceRecordsDirectory = () => join(app.getPath('userData'), 'janusx', 'workspaces')
const connections = new Map<string, RuntimeClient>()
const preparing = new Map<string, Promise<void>>()

export function quotePosix(value: string): string {
  if (value.includes('\0')) throw new Error('Invalid command argument')
  return `'${value.replace(/'/g, `'"'"'`)}'`
}
export function validateRuntime(value: unknown): ExternalRuntime {
  if (!value || typeof value !== 'object') throw new Error('Select a workspace environment')
  const runtime = value as ExternalRuntime
  if (typeof runtime.root !== 'string' || (runtime.root !== '' && !runtime.root.startsWith('/')) || /[\0\r\n]/.test(runtime.root)) throw new Error('Use an absolute Linux directory')
  if (runtime.kind === 'wsl') {
    if (typeof runtime.distro !== 'string' || !runtime.distro || /[\0\r\n]/.test(runtime.distro)) throw new Error('Select a WSL distribution')
    return { kind: 'wsl', distro: runtime.distro, root: runtime.root }
  }
  if (runtime.kind !== 'ssh' || typeof runtime.host !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]*$/.test(runtime.host)) throw new Error('Enter an SSH host or user@host')
  if (runtime.user !== undefined && !/^[a-zA-Z0-9_.-]+$/.test(runtime.user)) throw new Error('Invalid SSH user')
  if (runtime.port !== undefined && (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535)) throw new Error('Invalid SSH port')
  if (runtime.identityFile !== undefined && (typeof runtime.identityFile !== 'string' || /[\0\r\n]/.test(runtime.identityFile))) throw new Error('Invalid identity file')
  return { kind: 'ssh', host: runtime.host, user: runtime.user, port: runtime.port, identityFile: runtime.identityFile, root: runtime.root }
}
function runtimeKey(runtime: ExternalRuntime): string {
  return createHash('sha256').update(JSON.stringify({ ...runtime, root: '' })).digest('hex')
}
function transport(runtime: ExternalRuntime, argv: string[]): { file: string; args: string[] } {
  // Opt-in desktop integration isolation changes only HOME/config, never the
  // transport binary or protocol. Packaged applications ignore these values.
  const liveTest = !app.isPackaged && process.env.JANUSX_RUNTIME_LIVE === '1'
  if (runtime.kind === 'wsl') return { file: 'wsl.exe', args: ['--distribution', runtime.distro, '--exec',
    ...(liveTest && process.env.JANUSX_WORKSPACE_TEST_HOME ? ['env', `HOME=${process.env.JANUSX_WORKSPACE_TEST_HOME}`] : []), ...argv] }
  const args = ['-T', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
  if (liveTest && process.env.JANUSX_WORKSPACE_TEST_SSH_CONFIG) args.push('-F', process.env.JANUSX_WORKSPACE_TEST_SSH_CONFIG)
  // Respect OpenSSH config, agent, and known_hosts. Unknown/changed hosts are
  // never silently accepted by this noninteractive transport.
  args.push('-o', 'BatchMode=yes')
  if (runtime.port) args.push('-p', String(runtime.port))
  if (runtime.user) args.push('-l', runtime.user)
  if (runtime.identityFile) args.push('-i', runtime.identityFile)
  args.push(runtime.host, argv.map(quotePosix).join(' '))
  return { file: 'ssh', args }
}
function runTransport(runtime: ExternalRuntime, argv: string[], input?: Buffer): Promise<string> {
  const { file, args } = transport(runtime, argv)
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Workspace connection timed out')) }, 120_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-64 * 1024) })
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000) })
    child.once('error', reason => { clearTimeout(timer); reject(reason) })
    // exit can precede the last stdout/stderr chunks, especially with wsl.exe.
    // close guarantees both pipes have drained before callers parse JSON.
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(error.trim() || `Workspace connection exited (${code})`)) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
async function prepare(runtime: ExternalRuntime): Promise<void> {
  const key = runtimeKey(runtime)
  const existing = preparing.get(key)
  if (existing) return existing
  const task = (async () => {
    const source = await readRuntimeAsset('workspace-host.py')
    const bootstrap = "import pathlib,sys,os,tempfile; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1'; p.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(p,0o700); f=tempfile.NamedTemporaryFile(dir=p,delete=False); f.write(sys.stdin.buffer.read()); f.close(); os.replace(f.name,p/'host.py')"
    await runTransport(runtime, ['python3', '-c', bootstrap], source)
  })()
  preparing.set(key, task)
  try { await task } catch (error) { preparing.delete(key); throw error }
}

async function readRuntimeAsset(name: 'workspace-host.py' | 'workspace-backend.cjs' | 'workspace-cli.py'): Promise<Buffer> {
  // electron <entry.js> uses the entry directory as appPath; packaged/dev
  // launches use the project root. Both assets are emitted beside the entry.
  const candidates = [join(app.getAppPath(), name), join(app.getAppPath(), 'out/main', name),
    join(app.getAppPath(), '.cache/main', name), join(process.resourcesPath ?? '', 'workspace-runtime', name)]
  if (name === 'workspace-host.py') candidates.push(join(app.getAppPath(), 'resources/workspace-runtime/host.py'))
  if (name === 'workspace-cli.py') candidates.push(join(app.getAppPath(), 'resources/workspace-runtime/cli.py'))
  for (const path of candidates) {
    try { return await readFile(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  throw new Error(`Workspace service asset is missing: ${name}. Rebuild or reinstall JanusX.`)
}

const preparingBackends = new Map<string, Promise<void>>()
const preparingCli = new Map<string, Promise<void>>()
export async function runtimeCliRequest<T>(runtime: ExternalRuntime, request: Record<string, unknown>): Promise<T> {
  const key = runtimeKey(runtime)
  let prepared = preparingCli.get(key)
  if (!prepared) {
    prepared = (async () => {
      const source = await readRuntimeAsset('workspace-cli.py')
      await runTransport(runtime, ['python3', '-c', "import pathlib,sys,os,tempfile; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1'; p.mkdir(parents=True,exist_ok=True,mode=0o700); f=tempfile.NamedTemporaryFile(dir=p,delete=False); f.write(sys.stdin.buffer.read()); f.close(); os.replace(f.name,p/'cli.py')"], source)
    })()
    preparingCli.set(key, prepared)
  }
  try { await prepared } catch (error) { preparingCli.delete(key); throw error }
  const attempts = request.method === 'status' ? 3 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    const output = await runTransport(runtime, ['python3', '-c', "import pathlib,runpy; runpy.run_path(str(pathlib.Path.home()/'.local/share/janusx/runtime-v1/cli.py'),run_name='__main__')", 'request'], Buffer.from(JSON.stringify(request)))
    try {
      const result = JSON.parse(output)
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response shape')
      return result as T
    } catch {
      if (attempt + 1 === attempts) {
        throw new Error(`Remote CLI ${String(request.method)} returned ${output.trim() ? 'invalid JSON' : 'an empty response'} after the connection closed (${output.length} characters). The remote operation may still be running; check its status before retrying installation.`)
      }
      // Only the read-only status request is safe to repeat automatically.
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  throw new Error('Remote CLI response is unavailable')
}
const NODE_VERSION = '22.20.0'
// Official nodejs.org v22.20.0 SHASUMS256.txt; pin with the version so cached
// installations remain verifiable offline and a manifest fetch is unnecessary.
const NODE_SHA256 = {
  x64: '00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc',
  arm64: '06907b9c088ce62305bc1530e5c1ae1510245114645768f7750c349c5b6fe667',
}
/** Private, checksum-verified Linux runtime; never changes the user's Node installation. */
export async function prepareRuntimeBackend(runtime: ExternalRuntime): Promise<void> {
  const key = runtimeKey(runtime)
  const existing = preparingBackends.get(key)
  if (existing) return existing
  const pending = (async () => {
    await prepare(runtime)
    const probe = JSON.parse(await runTransport(runtime, ['python3', '-c', "import pathlib,platform,json; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1/node/bin/node'; print(json.dumps(dict(arch=platform.machine(),installed=p.exists())))"]))
    if (!probe.installed) {
      const arch = probe.arch === 'x86_64' ? 'x64' : probe.arch === 'aarch64' ? 'arm64' : null
      if (!arch) throw new Error(`Unsupported Linux architecture: ${probe.arch}`)
      const name = `node-v${NODE_VERSION}-linux-${arch}.tar.xz`
      const url = `https://nodejs.org/dist/v${NODE_VERSION}/`
      const cache = join(app.getPath('userData'), 'janusx', 'runtime-downloads')
      await mkdir(cache, { recursive: true })
      const expected = NODE_SHA256[arch]
      let archive = await readFile(join(cache, name)).catch(() => null)
      if (!archive || createHash('sha256').update(archive).digest('hex') !== expected) {
        const dispatcher = new EnvHttpProxyAgent()
        try {
          const response = await fetchRuntime(url + name, { dispatcher, signal: AbortSignal.timeout(300_000) })
          if (!response.ok) throw new Error('Cannot download the Linux workspace runtime')
          archive = Buffer.from(await response.arrayBuffer())
        } finally { await dispatcher.destroy() }
        if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Linux workspace runtime checksum mismatch')
        await writeFile(join(cache, name), archive)
      }
      const install = "import pathlib,sys,tempfile,os,subprocess,shutil; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1'; d=pathlib.Path(tempfile.mkdtemp(dir=p)); subprocess.run(['tar','-xJ','-C',str(d)],input=sys.stdin.buffer.read(),check=True); os.rename(next(d.iterdir()),p/'node') if not (p/'node').exists() else None; shutil.rmtree(d)"
      await runTransport(runtime, ['python3', '-c', install], archive)
    }
    const bundle = await readRuntimeAsset('workspace-backend.cjs')
    await runTransport(runtime, ['python3', '-c', "import pathlib,sys,os,tempfile; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1'; f=tempfile.NamedTemporaryFile(dir=p,delete=False); f.write(sys.stdin.buffer.read()); f.close(); os.replace(f.name,p/'backend.cjs')"], bundle)
  })()
  preparingBackends.set(key, pending)
  try { await pending } catch (error) { preparingBackends.delete(key); throw error }
}

class RuntimeClient {
  private sequence = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private child: ReturnType<typeof spawn>
  private ready: Promise<void>
  closed = false
  constructor(runtime: ExternalRuntime, private readonly onClose: () => void) {
    const { file, args } = transport(runtime, ['python3', '-u', '-c', "import os,pathlib; p=pathlib.Path.home()/'.local/share/janusx/runtime-v1/host.py'; os.execvp('python3',['python3','-u',str(p),'connect'])"])
    this.child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let errorText = ''
    this.child.stderr?.on('data', value => { errorText = (errorText + value.toString()).slice(-4000) })
    const lines = createInterface({ input: this.child.stdout! })
    lines.on('line', line => {
      try {
        const reply = JSON.parse(line)
        const pending = this.pending.get(reply.id)
        if (!pending) return
        this.pending.delete(reply.id)
        clearTimeout(pending.timer)
        reply.error ? pending.reject(new Error(reply.error)) : pending.resolve(reply.result)
      } catch { this.close(new Error('Invalid response from workspace service')) }
    })
    this.child.once('error', error => this.close(error))
    this.child.once('exit', () => this.close(new Error(errorText.trim() || 'Workspace disconnected. Reconnect to check the result of any pending write.')))
    this.child.stdin?.on('error', error => this.close(error))
    this.ready = this.requestWire<{ protocol: number }>('hello', {}).then(reply => {
      if (reply.protocol !== 3) {
        const error = new Error('The running workspace service uses an incompatible protocol. Existing remote tasks were left running; finish them before upgrading the service.')
        this.close(error)
        throw error
      }
    })
  }
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ready
    return this.requestWire<T>(method, params)
  }
  private requestWire<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Workspace disconnected'))
    if (this.pending.size >= 128) return Promise.reject(new Error('Too many workspace requests'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Workspace request timed out; reconnect before repeating a write')) }, method === 'process.run' || method.startsWith('worktree.') || method === 'backend.request' ? 125_000 : 30_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.child.stdin!.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }
  close(error = new Error('Workspace transport closed')): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.child.stdin?.end()
    this.child.kill()
    this.onClose()
  }
}
export async function runtimeRequest<T>(runtime: ExternalRuntime, method: string, params: unknown = {}): Promise<T> {
  await prepare(runtime)
  const lane = method.startsWith('terminal.') ? 'terminal' : method === 'process.run' || method.startsWith('worktree.') ? 'process' : method === 'process.cancel' ? 'control' : method === 'backend.request' ? 'backend' : 'files'
  const key = runtimeKey(runtime) + ':' + lane
  let client = connections.get(key)
  if (!client || client.closed) {
    client = new RuntimeClient(runtime, () => connections.delete(key))
    connections.set(key, client)
  }
  return client.request<T>(method, params)
}
export function disconnectRuntimeTransports(): void {
  for (const client of [...connections.values()]) client.close()
  connections.clear()
  // The daemon and PTYs intentionally remain alive on Linux.
}
export async function readWorkspaceRecord(id: string): Promise<Workspace> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid workspace id')
  return JSON.parse(await readFile(join(workspaceRecordsDirectory(), `${id}.json`), 'utf8'))
}
export function projectWorkspace(workspace: Workspace): Workspace {
  return workspace.runtime && workspace.runtime.kind !== 'windows'
    ? { ...workspace, path: runtimeResource(workspace.id, workspace.runtime.root) }
    : workspace
}
export async function resolveRuntimeResource(value: unknown): Promise<{ runtime: ExternalRuntime; root: string; path: string; relative: string; workspaceId: string } | null> {
  const resource = parseRuntimeResource(value)
  if (!resource) return null
  const workspace = await readWorkspaceRecord(resource.workspaceId)
  if (!workspace.runtime || workspace.runtime.kind === 'windows') throw new Error('Workspace environment is unavailable')
  const runtime = validateRuntime(workspace.runtime)
  let root = posix.normalize(runtime.root)
  let path = posix.normalize(resource.path)
  let relative = posix.relative(root, path)
  if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) {
    const scope = await runtimeRequest<{ root: string; path: string }>(runtime, 'scope.resolve', { root, path })
    root = scope.root; path = scope.path; relative = posix.relative(root, path)
  }
  return { runtime, root, path, relative, workspaceId: workspace.id }
}
export async function listWslDistributions(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const { stdout } = await execute('wsl.exe', ['--list', '--quiet'], { encoding: 'buffer', timeout: 15_000, windowsHide: true })
  return stdout.toString('utf16le').replace(/\0/g, '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
}
export async function listSshHosts(): Promise<string[]> {
  const home = app.getPath('home')
  const visited = new Set<string>(), hosts = new Set<string>()
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 8 || visited.has(path) || visited.size >= 64) return
    visited.add(path)
    const source = await readFile(path, 'utf8').catch(() => '')
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*Host\s+([^#]+)/i.exec(line)
      if (match) for (const host of match[1].trim().split(/\s+/)) if (/^[\w][\w.:-]*$/.test(host)) hosts.add(host)
      const include = /^\s*Include\s+([^#]+)/i.exec(line)
      if (include) for (const name of include[1].trim().split(/\s+/)) {
        const expanded = name.startsWith('~/') ? join(home, name.slice(2)) : name
        if (!/[?*]/.test(expanded)) await visit(expanded.startsWith('/') || /^[a-z]:/i.test(expanded) ? expanded : join(home, '.ssh', expanded), depth + 1)
      }
    }
  }
  await visit(join(home, '.ssh', 'config'), 0)
  return [...hosts].sort()
}
export async function registeredExternalWorkspaces(): Promise<Workspace[]> {
  const files = await readdir(workspaceRecordsDirectory()).catch(() => [])
  const records = await Promise.all(files.filter(name => name.endsWith('.json')).map(name => readWorkspaceRecord(name.slice(0, -5)).catch(() => null)))
  return records.filter((record): record is Workspace => Boolean(record?.runtime && record.runtime.kind !== 'windows'))
}
