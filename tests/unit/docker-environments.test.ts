import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Environments, parseTarget } from '../../plugins/docker/src/main/environments'
import type { Execute } from '../../plugins/docker/src/main/runtime-process'
import type { ManagedWsl } from '../../plugins/docker/src/main/managed-wsl'
import { validDockerWsl } from '@janusx/plugin-sdk'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(settings: { installed?: boolean; running?: boolean; ubuntu?: boolean; wsl2?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'docker-env-')); directories.push(directory)
  let installed = settings.installed ?? false, running = settings.running ?? false
  const managed = { state: { phase: 'not-installed', busy: false }, executable: 'C:/Windows/System32/wsl.exe', start: vi.fn(), inspect: vi.fn(), stop: vi.fn() }
  const run = vi.fn<Execute>(async (_file, args, options) => {
    if (args[0] === '--list') return 'Ubuntu-24.04\nUbuntu Tools\nJanusX-Docker\ndocker-desktop\ndocker-desktop-data'
    expect(args.slice(0, 5)).toEqual(['--distribution', 'Ubuntu-24.04', '--user', 'root', '--exec'])
    if (args.includes('/proc/sys/kernel/osrelease')) return settings.wsl2 === false ? '4.4-Microsoft' : '6.6-microsoft-standard-WSL2'
    if (args.includes('/etc/os-release')) return settings.ubuntu === false ? 'ID=debian\n' : 'ID=ubuntu\nVERSION_ID="24.04"\n'
    if (args.includes('/usr/bin/test')) {
      if (args.includes('/run/systemd/system') || installed) return ''
      throw new Error('missing')
    }
    if (args.includes('/usr/bin/docker')) { if (!running) throw new Error('stopped'); return '28.0' }
    if (options?.input) {
      expect(options.input).toContain('test "$ID" = ubuntu')
      expect(options.input).toContain('exit 42')
      expect(options.input).not.toContain('policy-rc.d')
      expect(options.input).not.toContain('dpkg --configure')
      installed = true; return ''
    }
    if (args.includes('/usr/bin/systemctl')) { expect(args.slice(-2)).toEqual(['start', 'docker']); running = true; return '' }
    throw new Error('Unexpected invocation')
  })
  const env = new Environments(directory, managed as unknown as ManagedWsl, { run, platform: 'win32' })
  const select = () => env.select({ kind: 'wsl', distribution: 'Ubuntu-24.04' })
  const settle = () => vi.waitFor(() => expect(env.state.busy).toBe(false))
  return { env, run, managed, select, settle, directory }
}
describe('Docker environment selection', () => {
  it('discovers existing names without probing Linux, installing or changing default WSL', async () => {
    const f = await fixture(); f.env.discover()
    await vi.waitFor(() => expect(f.env.snapshot().discovering).toBe(false))
    expect(f.env.snapshot().distributions).toEqual([{ name: 'Ubuntu-24.04' }, { name: 'Ubuntu Tools' }])
    expect(f.run.mock.calls.map(([, args]) => args)).toEqual([['--list', '--quiet']])
    expect(f.managed.start).not.toHaveBeenCalled()
  })
  it('requires explicit installation after read-only checks and retains target across activation', async () => {
    const f = await fixture(); await f.select()
    expect(await f.env.inspect()).toMatchObject({ phase: 'not-installed' })
    expect(f.run.mock.calls.some(([, , options]) => Boolean(options?.input))).toBe(false)
    f.env.start(); await f.settle()
    expect(f.env.state).toMatchObject({ phase: 'error', error: 'docker-install-confirmation-required' })
    expect(f.run.mock.calls.some(([, , options]) => Boolean(options?.input))).toBe(false)
    f.env.start(true); await f.settle()
    expect(f.env.state.phase).toBe('ready')
    const restored = new Environments(f.directory, f.managed as unknown as ManagedWsl); await restored.load()
    expect(restored.target).toEqual({ kind: 'wsl', distribution: 'Ubuntu-24.04' })
    expect(JSON.parse(await readFile(join(f.directory, 'environment.json'), 'utf8'))).toEqual(restored.target)
    f.env.stop(); expect(f.managed.stop).toHaveBeenCalledOnce()
    expect(f.run.mock.calls.some(([, args]) => args.includes('--shutdown') || args.includes('--unregister'))).toBe(false)
  })
  it('starts existing Docker through its service without package changes, a replacement daemon or implicit startup during inspect', async () => {
    const f = await fixture({ installed: true }); await f.select()
    expect(await f.env.inspect()).toMatchObject({ phase: 'stopped' })
    expect(f.run.mock.calls.some(([, args]) => args.includes('/usr/bin/systemctl'))).toBe(false)
    f.env.start(); await f.settle(); expect(f.env.state.phase).toBe('ready')
    expect(f.run.mock.calls.some(([, , options]) => Boolean(options?.input))).toBe(false)
    expect(f.run.mock.calls.some(([, args]) => args.includes('/usr/bin/dockerd'))).toBe(false)
  })
  it.each([{ ubuntu: false }, { wsl2: false }])('does not install or convert unsupported distributions %j', async settings => {
    const f = await fixture(settings); await f.select(); await f.env.inspect()
    f.env.start(true); await f.settle()
    expect(f.env.state.phase).toBe('error')
    expect(f.run.mock.calls.some(([, , options]) => Boolean(options?.input))).toBe(false)
  })
  it('rejects unregistered distributions and excludes managed/system names from the existing path', async () => {
    const f = await fixture()
    await expect(f.env.select({ kind: 'wsl', distribution: 'Gone' })).rejects.toThrow('docker-distribution-gone')
    expect(f.env.target.kind).toBe('local')
    expect(() => parseTarget({ kind: 'wsl', distribution: 'JanusX-Docker' })).toThrow()
    for (const name of ['--exec', 'Ubuntu\nroot', 'Ubuntu;rm', 'docker-desktop', 'docker-desktop-data', '../Ubuntu']) expect(validDockerWsl(name)).toBe(false)
    expect(validDockerWsl('Ubuntu Tools')).toBe(true)
  })
  it('rejects switching while a preparation is active and prevents Linux commands after stop', async () => {
    const f = await fixture({ installed: true }); await f.select()
    let release!: () => void
    const implementation = f.run.getMockImplementation()!
    f.run.mockImplementation(async (file, args, options) => {
      if (args.includes('/usr/bin/systemctl')) await new Promise<void>(resolve => { release = resolve })
      return implementation(file, args, options)
    })
    f.env.start(); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(f.env.select({ kind: 'local' })).rejects.toThrow('docker-busy')
    release(); await f.settle(); f.env.stop()
    expect(() => f.env.start()).toThrow()
  })
})
