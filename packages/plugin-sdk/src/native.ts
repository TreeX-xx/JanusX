/** Node-only entry for explicitly trusted native services. Never import this entry in a view. */
import process from 'node:process'
import type { JsonValue } from './api.js'
import { NativePeer, NativeServiceError, type NativeHandler, type NativePacket } from './native-protocol.js'
export * from './native-protocol.js'

export interface NativePluginImplementation {
  call: NativeHandler
  /** Host-owned page identity; invoked on close, crash, or project invalidation. */
  releaseContext?(instanceId: string): Promise<void>
  stop(): Promise<void>
}
export function startNativePlugin(start: (context: JsonValue, host: NativePeer) => Promise<NativePluginImplementation>): NativePeer {
  const generation = process.argv.find(arg => arg.startsWith('--janusx-native-generation='))?.split('=')[1]
  if (!generation || !/^[a-f0-9-]{36}$/.test(generation)) throw new Error('Native plugins must be launched by a verified host')
  const parentPort = (process as unknown as { parentPort?: { postMessage(value: unknown): void; on(type: 'message', callback: (event: { data: unknown }) => void): void; removeListener(type: 'message', callback: (event: { data: unknown }) => void): void } }).parentPort
  if (!parentPort && !process.send) throw new Error('Native plugin transport is unavailable')
  let implementation: NativePluginImplementation | undefined
  let starting = false, stopping = false
  const peer = new NativePeer({
    send(packet: NativePacket) { if (parentPort) parentPort.postMessage(packet); else process.send!(packet) },
    listen(listener) {
      if (parentPort) {
        const callback = (event: { data: unknown }) => listener(event.data)
        parentPort.on('message', callback)
        return () => parentPort.removeListener('message', callback)
      }
      process.on('message', listener)
      return () => { process.removeListener('message', listener) }
    },
  }, generation, async (method, value, signal) => {
    if (method === 'lifecycle.start') {
      if (starting || stopping) throw new NativeServiceError('INVALID_STATE')
      starting = true
      implementation = await start(value, peer)
      if (stopping) { await implementation.stop(); throw new NativeServiceError('SERVICE_STOPPED') }
      return null
    }
    if (method === 'lifecycle.stop') {
      stopping = true
      await implementation?.stop()
      return null
    }
    if (!implementation || stopping) throw new NativeServiceError('SERVICE_STOPPED')
    if (method === 'lifecycle.release') {
      const instanceId = value && typeof value === 'object' && !Array.isArray(value) ? value.instanceId : undefined
      if (typeof instanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(instanceId)) throw new NativeServiceError('INVALID_REQUEST')
      await implementation.releaseContext?.(instanceId)
      return null
    }
    return implementation.call(method, value, signal)
  }, () => { peer.close(); process.exitCode = 1; void implementation?.stop().finally(() => process.exit(1)) })
  process.once('disconnect', () => { stopping = true; peer.close(); void implementation?.stop().finally(() => process.exit(0)) })
  return peer
}

export * from './node-storage.js'
export * from './native-agent.js'
