import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }))
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), readFile: vi.fn(async () => Buffer.from('# helper')) }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }))

type Child = EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: Writable; kill: ReturnType<typeof vi.fn> }
function fakeProcess(action: (child: Child, input: string) => void): Child {
  const child = new EventEmitter() as Child
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  let input = ''
  child.stdin = new Writable({
    write(chunk, _encoding, callback) { input += chunk.toString(); callback() },
    final(callback) { callback(); setImmediate(() => action(child, input)) },
  })
  return child
}
function finish(child: Child, output: string, code = 0): void {
  child.stdout.end(output)
  child.emit('exit', code)
  child.emit('close', code)
}
const runtime = { kind: 'wsl' as const, distro: 'test', root: '/project' }
beforeEach(() => { vi.resetModules(); mocks.spawn.mockReset() })

it('waits for stdout after exit and decodes UTF-8 split across chunks', async () => {
  mocks.spawn.mockImplementationOnce(() => fakeProcess(child => finish(child, '')))
    .mockImplementationOnce(() => fakeProcess(child => {
      child.emit('exit', 0)
      setImmediate(() => {
        const bytes = Buffer.from('{"state":"running","log":"安装中"}')
        const split = bytes.indexOf(Buffer.from('安')) + 1
        child.stdout.write(bytes.subarray(0, split))
        child.stdout.end(bytes.subarray(split))
        child.emit('close', 0)
      })
    }))
  const { runtimeCliRequest } = await import('../../src/main/workspace/runtime')
  expect(await runtimeCliRequest(runtime, { method: 'status', tool: 'opencode' })).toEqual({ state: 'running', log: '安装中' })
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
})

it('recovers from empty and truncated status replies without submitting an install', async () => {
  const requests: string[] = []
  mocks.spawn.mockImplementationOnce(() => fakeProcess(child => finish(child, '')))
  for (const output of ['', '{"state":', '{"state":"complete"}']) {
    mocks.spawn.mockImplementationOnce(() => fakeProcess((child, input) => { requests.push(JSON.parse(input).method); finish(child, output) }))
  }
  const { runtimeCliRequest } = await import('../../src/main/workspace/runtime')
  expect(await runtimeCliRequest(runtime, { method: 'status', tool: 'opencode' })).toEqual({ state: 'complete' })
  expect(requests).toEqual(['status', 'status', 'status'])
})

it('bounds malformed status retries and reports an actionable error', async () => {
  mocks.spawn.mockImplementation(() => fakeProcess(child => finish(child, '')))
  const { runtimeCliRequest } = await import('../../src/main/workspace/runtime')
  await expect(runtimeCliRequest(runtime, { method: 'status', tool: 'opencode' })).rejects.toThrow('status returned an empty response')
  expect(mocks.spawn).toHaveBeenCalledTimes(4) // deployment + three reads
})

it('never automatically repeats an install with an invalid acknowledgement', async () => {
  mocks.spawn.mockImplementation(() => fakeProcess(child => finish(child, '')))
  const { runtimeCliRequest } = await import('../../src/main/workspace/runtime')
  await expect(runtimeCliRequest(runtime, { method: 'install', tool: 'opencode', packages: ['@opencode/cli'] })).rejects.toThrow('operation may still be running')
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
})

it('retains stderr delivered after a failed exit', async () => {
  mocks.spawn.mockImplementationOnce(() => fakeProcess(child => finish(child, '')))
    .mockImplementationOnce(() => fakeProcess(child => {
      child.emit('exit', 1)
      setImmediate(() => { child.stderr.end('target unavailable'); child.emit('close', 1) })
    }))
  const { runtimeCliRequest } = await import('../../src/main/workspace/runtime')
  await expect(runtimeCliRequest(runtime, { method: 'status', tool: 'opencode' })).rejects.toThrow('target unavailable')
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
})
