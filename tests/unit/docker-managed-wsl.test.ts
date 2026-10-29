import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { ManagedWsl, distribution, endpoint, installScript } from '../../plugins/docker/src/main/managed-wsl'
import { decodeOutput, type Execute } from '../../plugins/docker/src/main/runtime-process'
import { DockerCli } from '../../plugins/docker/src/main/cli'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(options: { exists?: boolean; installed?: boolean; running?: boolean; owner?: string; available?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'docker-wsl-')); directories.push(root)
  let exists = options.exists ?? false, installed = options.installed ?? false, running = options.running ?? false
  let owner = options.owner ?? '9e3993e4-770f-4fdb-a03f-cfe3160ac572'
  if (exists && !options.owner) await writeFile(join(root, 'owner.json'), JSON.stringify({ id: owner }))
  const run = vi.fn<Execute>(async (_file, args, settings) => {
    if (args[0] === '--list') {
      if (options.available === false) throw new Error('WSL unavailable')
      return exists ? `${distribution}\r\nUbuntu` : 'Ubuntu'
    }
    if (args[0] === '--import') { exists = true; expect(args).toEqual(['--import', distribution, join(root, 'distribution'), join(root, 'ubuntu-base.tar.gz'), '--version', '2']); return '' }
    expect(args.slice(0, 5)).toEqual(['--distribution', distribution, '--user', 'root', '--exec'])
    const command = args.slice(5)
    if (command[1] === '/etc/janusx-docker-owner') return owner
    if (command[1] === '/proc/sys/kernel/osrelease') return '6.6.87.2-microsoft-standard-WSL2'
    if (command[0] === '/usr/bin/test') { if (!installed) throw new Error('not installed'); return '' }
    if (command[0] === '/usr/bin/docker') { expect(command.slice(1, 3)).toEqual(['--host', endpoint]); if (!running) throw new Error('not running'); return '28.0' }
    if (settings?.input?.includes('/etc/janusx-docker-owner')) { owner = JSON.parse(await readFile(join(root, 'owner.json'), 'utf8')).id; return '' }
    if (settings?.input === installScript) { installed = true; return '' }
    throw new Error('unexpected command: ' + command.join(' '))
  })
  const download = vi.fn(async (_file: string, _signal: AbortSignal, progress: (value: number) => void) => { progress(80) })
  const launch = vi.fn(async () => { running = true }), elevate = vi.fn(async () => 'restart-required')
  const proxy = vi.fn(async (): Promise<string | undefined> => undefined)
  const manager = new ManagedWsl(root, {} as NativePeer, { run, download, launch, elevate, proxy, platform: 'win32', architecture: 'x64', wsl: 'C:/Windows/System32/wsl.exe' })
  const settle = () => vi.waitFor(() => expect(manager.state.busy).toBe(false))
  return { manager, run, download, launch, elevate, proxy, settle, root }
}
describe('managed local Docker preparation', () => {
  it('detects absence without downloading or installing anything', async () => {
    const f = await fixture()
    expect(await f.manager.inspect()).toMatchObject({ phase: 'not-installed', busy: false })
    expect(f.download).not.toHaveBeenCalled(); expect(f.elevate).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled()
    expect(f.run.mock.calls).toHaveLength(1)
  })
  it('imports only a dedicated WSL2 distro, installs signed apt packages and starts a pinned socket', async () => {
    const f = await fixture()
    expect(f.manager.start()).toMatchObject({ busy: true }); f.manager.start()
    await f.settle()
    expect(f.manager.state).toMatchObject({ phase: 'ready', busy: false })
    expect(f.download).toHaveBeenCalledOnce(); expect(f.launch).toHaveBeenCalledOnce()
    expect(f.run.mock.calls.filter(([, args]) => args[0] === '--import')).toHaveLength(1)
    expect(installScript).toContain('apt-get'); expect(installScript).not.toContain('curl'); expect(installScript).not.toContain('--allow-unauthenticated')
    expect(await f.manager.inspect(true)).toMatchObject({ phase: 'ready' })
    f.manager.stop(); expect(f.launch).toHaveBeenCalledOnce()
    expect(f.run.mock.calls.some(([, args]) => args.some(arg => ['--unregister', '--terminate', '--shutdown'].includes(arg)))).toBe(false)
  })
  it('passes the managed relay to apt and daemon startup without changing user proxy files', async () => {
    const f = await fixture()
    f.proxy.mockResolvedValue('http://janusx:fixture@172.20.0.1:31415')
    f.manager.start(); await f.settle()
    expect(f.manager.state.phase).toBe('ready')
    const installation = f.run.mock.calls.find(([, , settings]) => settings?.input === installScript)!
    expect(installation[1]).toContain('HTTPS_PROXY=http://janusx:fixture@172.20.0.1:31415')
    expect(installation[1]).toContain('-u')
    expect(f.launch).toHaveBeenCalledWith('C:/Windows/System32/wsl.exe', 'http://janusx:fixture@172.20.0.1:31415')
    expect(installScript).not.toContain('apt.conf'); expect(installScript).not.toContain('daemon.json')
  })
  it('requests Windows preparation only after a click and stops for a possible reboot', async () => {
    const f = await fixture({ available: false })
    expect(await f.manager.inspect()).toMatchObject({ phase: 'wsl-required' }); expect(f.elevate).not.toHaveBeenCalled()
    f.manager.start(); await f.settle()
    expect(f.manager.state).toMatchObject({ phase: 'restart-required' }); expect(f.elevate).toHaveBeenCalledOnce(); expect(f.download).not.toHaveBeenCalled()
  })
  it('does not modify or adopt an unowned same-name distribution', async () => {
    const f = await fixture({ exists: true, owner: 'not-ours' })
    expect(await f.manager.inspect()).toMatchObject({ phase: 'error', error: 'docker-runtime-ownership' })
    f.manager.start(); await f.settle()
    expect(f.manager.state).toMatchObject({ phase: 'error', error: 'docker-runtime-ownership' })
    expect(f.download).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled()
    expect(f.run.mock.calls.some(([, args, settings]) => args[0] === '--import' || Boolean(settings?.input))).toBe(false)
  })
  it('reuses an owned installed runtime without importing, downloading or reinstalling', async () => {
    const f = await fixture({ exists: true, installed: true })
    expect(await f.manager.inspect()).toMatchObject({ phase: 'stopped' })
    f.manager.start(); await f.settle()
    expect(f.manager.state.phase).toBe('ready'); expect(f.download).not.toHaveBeenCalled(); expect(f.launch).toHaveBeenCalledOnce()
    expect(f.run.mock.calls.some(([, , settings]) => settings?.input === installScript)).toBe(false)
  })
  it('retains a partial owned installation for retry and rejects a live cross-profile install lock', async () => {
    const f = await fixture({ exists: true })
    await writeFile(join(f.root, 'install.lock'), String(process.pid))
    f.manager.start(); await f.settle()
    expect(f.manager.state).toMatchObject({ phase: 'error', error: 'docker-runtime-busy' })
    await rm(join(f.root, 'install.lock')); f.manager.start(); await f.settle()
    expect(f.manager.state.phase).toBe('ready'); expect(f.download).not.toHaveBeenCalled()
  })
  it('stops a preparation request and does not start a daemon after revocation', async () => {
    const f = await fixture()
    f.download.mockImplementation(async (_file, signal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }))
    f.manager.start(); await vi.waitFor(() => expect(f.manager.state.phase).toBe('downloading'))
    f.manager.stop(); await f.settle(); expect(f.launch).not.toHaveBeenCalled()
    expect(() => f.manager.start()).toThrow('docker-runtime-cancelled')
  })
  it('refuses WSL1 instead of installing into it', async () => {
    const f = await fixture({ exists: true })
    const original = f.run.getMockImplementation()!
    f.run.mockImplementation((file, args, settings) => args.includes('/proc/sys/kernel/osrelease') ? Promise.resolve('4.4.0-Microsoft') : original(file, args, settings))
    f.manager.start(); await f.settle()
    expect(f.manager.state).toMatchObject({ phase: 'error', error: 'docker-runtime-wsl2-required' }); expect(f.launch).not.toHaveBeenCalled()
  })
  it('pins every managed query, action and terminal transport to one distro and socket', async () => {
    const run = vi.fn(async () => '{"Name":"managed","ServerVersion":"28"}')
    const cli = new DockerCli(run); cli.useManaged('C:/Windows/System32/wsl.exe'); await cli.connect(); await cli.operate('a'.repeat(64), 'stop')
    expect(run.mock.calls[1]).toEqual(['C:/Windows/System32/wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', '/usr/bin/docker', '--host', endpoint, 'stop', '--time', '5', 'a'.repeat(64)], undefined])
  })
  it('decodes UTF-16 WSL inventory without corrupting ordinary UTF-8 Linux output', () => {
    expect(decodeOutput(Buffer.from('\uFEFFJanusX-Docker\r\n', 'utf16le'))).toBe(distribution)
    expect(decodeOutput(Buffer.from('运行中\n'))).toBe('运行中')
  })
})
