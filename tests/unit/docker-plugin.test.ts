import { describe, expect, it, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { localDockerEndpoint } from '@janusx/plugin-sdk'
import { DockerCli, parseContainers } from '../../plugins/docker/src/main/cli'
import { createDockerService } from '../../plugins/docker/src/main/service'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import type { Container } from '../../plugins/docker/src/shared/docker'
import type { ManagedWsl } from '../../plugins/docker/src/main/managed-wsl'
import { Environments } from '../../plugins/docker/src/main/environments'
const id = 'a'.repeat(64), otherId = 'b'.repeat(64)
const endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
const containers: Container[] = [id, otherId].map((id, index) => ({ id, name: `app-${index}`, image: 'alpine:3', state: 'running', status: 'Up', project: 'atlas', service: `web-${index}`, ports: [{ host: '0.0.0.0', port: 8080, container: 80, protocol: 'tcp' }] }))
afterEach(() => vi.useRealTimers())
describe('local Docker target and CLI parsing', () => {
  it.each(['tcp://127.0.0.1:2375', 'ssh://remote', 'http://localhost', 'npipe://remote/pipe/docker', 'unix://relative', 'unix:///tmp/a\n'])('rejects nonlocal or malformed endpoint %s', value => {
    expect(() => localDockerEndpoint(value)).toThrow('docker-remote-endpoint')
  })
  it.each([endpoint, 'npipe:////./pipe/docker_engine', 'unix:///var/run/docker.sock'])('accepts a local Docker endpoint %s', value => expect(localDockerEndpoint(value)).toBe(value))
  it('parses full identities, Compose labels and published IPv4/IPv6 ports without guessing HTTP', () => {
    const [item] = parseContainers(JSON.stringify({ ID: id, Names: 'atlas-web', Image: 'nginx', State: 'running', Status: 'Up 1 hour', Labels: 'com.docker.compose.project=atlas,com.docker.compose.service=web', Ports: '0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 0.0.0.0:5353->53/udp' }))
    expect(item).toMatchObject({ id, project: 'atlas', service: 'web', name: 'atlas-web' })
    expect(item.ports).toHaveLength(3)
    expect(item.ports[2].protocol).toBe('udp')
    expect(() => parseContainers('{"ID":"short"}')).toThrow('docker-invalid-response')
  })
  it('pins every operation to the inspected local endpoint and never falls back from remote contexts', async () => {
    const execute = vi.fn(async (_exe, args: string[]) => args[0] === 'context' ? args[1] === 'show' ? 'desktop-linux' : JSON.stringify([{ Endpoints: { docker: { Host: endpoint } } }]) : args.includes('info') ? '{"Name":"local","ServerVersion":"28.0","OSType":"linux"}' : '')
    const cli = new DockerCli(execute, async () => 'C:/Docker/docker.exe')
    await cli.connect(); await cli.list(); await cli.operate(id, 'stop')
    expect(execute.mock.calls.at(-1)?.[1]).toEqual(['--host', endpoint, 'stop', '--time', '5', id])
    execute.mockImplementation(async () => '[{"Endpoints":{"docker":{"Host":"ssh://remote"}}}]')
    const remote = new DockerCli(async (_exe, args) => args[1] === 'show' ? 'remote' : execute('', args), async () => 'C:/Docker/docker.exe')
    await expect(remote.connect()).rejects.toThrow('docker-remote-endpoint')
    expect(cli.engine?.endpoint).toBe(endpoint)
  })
})
async function fixture() {
  const children: any[] = []
  const follow = vi.fn(() => { const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() }); children.push(child); return child })
  const cli = { engine: { endpoint, name: 'local', version: '28', os: 'linux' }, executable: 'C:/Docker/docker.exe', connect: vi.fn(async () => cli.engine), reset: vi.fn(), list: vi.fn(async () => containers), operate: vi.fn(async () => {}), follow }
  const host = { call: vi.fn(async (method: string) => method === 'desktop.terminal.open' ? { id: 'session-1', data: '', cursor: 0, truncated: false, exited: false, exitCode: null } : null), emit: vi.fn() }
  const service = await createDockerService(null, host as unknown as NativePeer, cli as unknown as DockerCli)
  const call = (method: string, input = {}, instanceId = 'page-one') => service.call(method, { input, instanceId }, new AbortController().signal) as Promise<any>
  await call('engine.connect')
  return { cli, host, service, call, children }
}
describe('Docker plugin activation and page leases', () => {
  it('clears old caches and shells on explicit target selection, rejects stale work and never stops engine containers', async () => {
    const f = await fixture(); await f.call('terminal.open', { id }); await f.call('ui.save', { state: { selected: id, search: 'old', runningOnly: false, containers: {} } })
    let complete!: (rows: Container[]) => void
    f.cli.list.mockImplementationOnce(() => new Promise<Container[]>(resolve => { complete = resolve }))
    const late = f.call('containers.list')
    let closeComplete!: () => void
    f.host.call.mockImplementationOnce(() => new Promise<null>(resolve => { closeComplete = () => resolve(null) }))
    const lateClose = f.call('terminal.close', { container: id, id: 'session-1' })
    expect(await f.call('environment.select', { target: { kind: 'managed' } })).toMatchObject({ ok: true, data: { target: { kind: 'managed' }, revision: 1 } })
    complete(containers); expect(await late).toMatchObject({ error: 'docker-target-changed' })
    expect(f.host.call).toHaveBeenCalledWith('desktop.terminal.reset', {})
    expect(await f.call('ui.read')).toMatchObject({ data: { selected: '', containers: {} } })
    expect(await f.call('terminal.write', { container: id, id: 'session-1', data: 'stale' })).toMatchObject({ error: 'docker-session-ended' })
    expect(await f.call('containers.operate', { id, action: 'stop', revision: 0 })).toMatchObject({ error: 'docker-target-changed' })
    expect(f.cli.operate).not.toHaveBeenCalled()
    await f.call('environment.select', { target: { kind: 'local' } }); await f.call('engine.connect'); await f.call('terminal.open', { id })
    closeComplete(); expect(await lateClose).toMatchObject({ error: 'docker-target-changed' })
    expect(await f.call('ui.read')).toMatchObject({ data: { containers: { [id]: { terminal: 'session-1' } } } })
    await f.service.stop()
  })
  it('returns environment checks immediately and does not start a stopped runtime after revocation', async () => {
    let resolve!: (value: { phase: string }) => void
    const runtime = { state: { phase: 'checking', busy: false }, inspect: vi.fn(() => new Promise<{ phase: string }>(done => { resolve = done })), start: vi.fn(), stop: vi.fn() }
    const f = await fixture()
    const environments = new Environments(undefined, runtime as unknown as ManagedWsl); environments.target = { kind: 'managed' }
    const service = await createDockerService(null, f.host as unknown as NativePeer, f.cli as unknown as DockerCli, runtime as unknown as ManagedWsl, environments)
    expect(await service.call('runtime.inspect', { input: {} }, new AbortController().signal)).toMatchObject({ data: { phase: 'checking' } })
    expect(runtime.start).not.toHaveBeenCalled()
    await service.stop(); resolve({ phase: 'stopped' }); await Promise.resolve()
    expect(runtime.start).not.toHaveBeenCalled(); await f.service.stop()
  })
  it('keeps installation activation-owned, forwards its status, and never silently replaces a selected remote context', async () => {
    const runtime = { state: { phase: 'installing', busy: true }, inspect: vi.fn(async () => ({ phase: 'ready' })), start: vi.fn(() => runtime.state), stop: vi.fn(), executable: 'C:/Windows/System32/wsl.exe' }
    const cli = { engine: undefined, wsl: undefined, connect: vi.fn(async () => { throw new Error('docker-remote-endpoint') }), useManaged: vi.fn() }
    const host = { call: vi.fn(), emit: vi.fn() }
    const environments = new Environments(undefined, runtime as unknown as ManagedWsl); environments.target = { kind: 'managed' }
    const service = await createDockerService(null, host as unknown as NativePeer, cli as unknown as DockerCli, runtime as unknown as ManagedWsl, environments)
    const call = (method: string) => service.call(method, { input: {}, instanceId: 'page-one' }, new AbortController().signal) as Promise<any>
    expect(await call('runtime.prepare')).toMatchObject({ data: { phase: 'installing', busy: true } })
    await service.releaseContext!('page-one'); expect(runtime.stop).not.toHaveBeenCalled()
    expect(await call('runtime.status')).toMatchObject({ data: { busy: true } })
    runtime.state.busy = false
    environments.target = { kind: 'local' }
    expect(await call('engine.connect')).toMatchObject({ error: 'docker-remote-endpoint' }); expect(cli.useManaged).not.toHaveBeenCalled(); expect(runtime.inspect).not.toHaveBeenCalled()
    await service.stop(); expect(runtime.stop).toHaveBeenCalledOnce()
  })
  it('owns shells across page release and exposes them to the next page without a project', async () => {
    const f = await fixture()
    expect(await f.call('terminal.open', { id })).toMatchObject({ ok: true, data: { id: 'session-1' } })
    await f.service.releaseContext!('page-one')
    expect(f.host.call).not.toHaveBeenCalledWith('desktop.terminal.end', expect.anything())
    expect(await f.call('ui.read', {}, 'page-two')).toMatchObject({ data: { containers: { [id]: { terminal: 'session-1' } } } })
    await f.call('terminal.write', { container: id, id: 'session-1', data: 'ls\r', owner: 'forged' }, 'page-two')
    expect(f.host.call).toHaveBeenLastCalledWith('desktop.terminal.write', expect.objectContaining({ owner: 'page-two' }))
    await f.service.stop()
    expect(f.host.call).toHaveBeenCalledWith('desktop.terminal.end', { id: 'session-1' })
    expect(await f.call('containers.list')).toMatchObject({ ok: false, error: 'docker-stopped' })
  })
  it('rejects removed containers, nonpublished services, unsupported operations and forged session identities', async () => {
    const f = await fixture()
    expect(await f.call('containers.operate', { id: 'missing', action: 'stop' })).toMatchObject({ ok: false })
    expect(await f.call('containers.operate', { id, action: 'rm' })).toMatchObject({ ok: false })
    expect(await f.call('service.open', { id, port: 9999 })).toMatchObject({ ok: false })
    await f.call('service.open', { id, port: 8080 })
    expect(f.host.call).toHaveBeenLastCalledWith('desktop.service.open', { url: 'http://127.0.0.1:8080/' })
    expect(await f.call('terminal.write', { container: id, id: 'forged', data: '' })).toMatchObject({ ok: false })
    await f.service.stop()
  })
  it('reports every Compose item, rejects overlapping jobs and keeps accepted actions running after page release', async () => {
    const f = await fixture(); let done!: () => void
    f.cli.operate.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve })).mockRejectedValueOnce(new Error('denied'))
    expect(await f.call('containers.operate', { project: 'atlas', action: 'stop' })).toMatchObject({ data: { busy: true } })
    expect(await f.call('containers.operate', { id, action: 'start' })).toMatchObject({ error: 'docker-busy' })
    await f.service.releaseContext!('page-one'); done()
    await vi.waitFor(async () => expect((await f.call('containers.list')).data.operation.busy).toBe(false))
    expect((await f.call('containers.list')).data.operation.results).toEqual([{ id, ok: true }, { id: otherId, ok: false, error: 'denied' }])
    await f.service.stop()
  })
  it('bounds batched logs and reclaims only the closing page subscriptions', async () => {
    vi.useFakeTimers(); const f = await fixture()
    const first = await f.call('logs.subscribe', { id })
    await f.call('logs.subscribe', { id: otherId }, 'page-two')
    f.children[0].stdout.write(Buffer.from('x'.repeat(400_000)))
    await vi.advanceTimersByTimeAsync(120)
    expect(f.host.emit).toHaveBeenCalledWith('docker.logs', expect.objectContaining({ scope: null, data: expect.objectContaining({ subscription: first.data.subscription, truncated: true }) }))
    expect((f.host.emit.mock.calls[0][1] as any).data.text.length).toBeLessThanOrEqual(256 * 1024)
    await f.service.releaseContext!('page-one')
    expect(f.children[0].kill).toHaveBeenCalledOnce(); expect(f.children[1].kill).not.toHaveBeenCalled()
    await f.service.stop(); expect(f.children[1].kill).toHaveBeenCalledOnce()
  })
})
