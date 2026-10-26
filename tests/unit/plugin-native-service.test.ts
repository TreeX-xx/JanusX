import { afterEach, describe, expect, it } from 'vitest'
import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { NativePeer, nativeValueSchema } from '../../packages/plugin-sdk/src/native-protocol'
import { NativePluginService } from '../../src/main/plugins/native-service'
import type { JsonValue } from '../../packages/plugin-sdk/src/api'

const cleanups: Array<() => void | Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janus-native-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const entry = join(root, 'service.cjs')
  await build({ stdin: { contents: `
    import { startNativePlugin } from './packages/plugin-sdk/src/native'
    import { readFile, writeFile } from 'node:fs/promises'
    import { join } from 'node:path'
    startNativePlugin(async (context, host) => ({
      async call(method, value, signal) {
        if (method === 'echo') return { value, pid: process.pid, context }
        if (method === 'host') return host.call('approved.read', value)
        if (method === 'event') { host.emit('changed', value); return null }
        if (method === 'wait') { await new Promise(resolve => setTimeout(resolve, 150)); return 'late' }
        if (method === 'crash') process.exit(2)
        if (method === 'resource') return process.memoryUsage().heapUsed
        if (method === 'state') {
          const path = join(context.directory, 'state.json')
          await writeFile(path, JSON.stringify(value)); return JSON.parse(await readFile(path, 'utf8'))
        }
        return null
      },
      async stop() { await writeFile(join(context.directory, 'stopped'), 'graceful') }
    }))`, resolveDir: process.cwd(), loader: 'ts' }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
  const failures: string[] = []
  const children: ReturnType<typeof fork>[] = []
  const service = new NativePluginService({
    spawn(generation) {
      const child = fork(entry, [`--janusx-native-generation=${generation}`], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      children.push(child)
      return {
        send: packet => { child.send(packet) },
        listen: listener => { child.on('message', listener); return () => { child.off('message', listener) } },
        exited: listener => { child.on('exit', listener); return () => { child.off('exit', listener) } },
        terminate: () => { child.kill() },
      }
    },
    host: async (method, value) => ({ method, value }), stopped: code => failures.push(code),
  })
  cleanups.push(async () => { service.stop(); await Promise.all(children.map(child => child.exitCode !== null || child.signalCode ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve())))) })
  await service.start({ directory: root })
  return { service, failures, root }
}

describe('native plugin supervision', () => {
  it('records spawn failures once and rejects retrying a failed activation', async () => {
    const failures: string[] = []
    const service = new NativePluginService({ spawn: () => { throw new Error('spawn failed') }, host: async () => null, stopped: code => failures.push(code) })
    await expect(service.start(null)).rejects.toThrow('spawn failed')
    await expect(service.start(null)).rejects.toThrow('SERVICE_STOPPED')
    expect(failures).toEqual(['SERVICE_START_FAILED'])
  })
  it('runs in a separate real Node process, persists state and uses a bounded host callback', async () => {
    const f = await fixture()
    const result = await f.service.call('echo', { a: 1 }) as { pid: number; value: JsonValue }
    expect(result.pid).not.toBe(process.pid)
    expect(result.value).toEqual({ a: 1 })
    expect(await f.service.call('state', { revision: 1, text: 'preserved' })).toEqual({ revision: 1, text: 'preserved' })
    expect(await f.service.call('host', 'bounded')).toEqual({ method: 'approved.read', value: 'bounded' })
    await f.service.shutdown()
    expect(f.failures).toEqual(['SERVICE_STOPPED'])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(f.root, 'stopped'), 'utf8')).toBe('graceful')
    await expect(f.service.call('echo', null)).rejects.toThrow('SERVICE_STOPPED')
  })
  it('drops a cancelled late response and still handles a later request and unsubscribe', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const events: JsonValue[] = []
    const unsubscribe = f.service.onEvent((_name, value) => events.push(value))
    await f.service.call('event', 'first')
    unsubscribe()
    await f.service.call('event', 'second')
    expect(events).toEqual(['first'])
    const pending = f.service.call('wait', null, controller.signal)
    const rejected = expect(pending).rejects.toThrow('CANCELLED')
    controller.abort(); await rejected
    expect((await f.service.call('echo', 'next') as { value: string }).value).toBe('next')
    expect(f.failures).toEqual([])
  })
  it('settles pending work on a process crash and never silently restarts it', async () => {
    const f = await fixture()
    await expect(f.service.call('crash', null)).rejects.toThrow('SERVICE_STOPPED')
    expect(f.failures).toEqual(['SERVICE_EXITED'])
    await expect(f.service.start(null)).rejects.toThrow('SERVICE_STOPPED')
    f.service.stop()
    expect(f.failures).toHaveLength(1)
  })
  it('rejects oversized values, malformed packets and stale generations', async () => {
    expect(nativeValueSchema.safeParse('x'.repeat(4 * 1024 * 1024)).success).toBe(false)
    expect(nativeValueSchema.safeParse({ value: Infinity }).success).toBe(false)
    let listener!: (packet: unknown) => void
    const sent: unknown[] = [], faults: string[] = []
    const generation = crypto.randomUUID()
    const peer = new NativePeer({ send: packet => sent.push(packet), listen: callback => { listener = callback; return () => {} } }, generation, async () => 'unexpected', code => faults.push(code))
    cleanups.push(() => peer.close())
    listener({ protocol: 1, generation: crypto.randomUUID(), type: 'request', id: crypto.randomUUID(), method: 'read', value: null })
    expect(sent).toEqual([])
    listener({ protocol: 1, generation, type: 'request', id: 'invalid', method: 'read', value: null })
    expect(faults).toEqual(['INVALID_NATIVE_PACKET'])
    const controller = new AbortController()
    const pending = peer.call('read', null, controller.signal, 20)
    await expect(pending).rejects.toThrow('TIMEOUT')
    expect(faults).toContain('TIMEOUT')
  })
})
