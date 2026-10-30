import type { JsonValue } from '@janusx/plugin-sdk'
import type { NativePeer } from '@janusx/plugin-sdk/native'

let peer: NativePeer
export function connectDesktop(host: NativePeer): void { peer = host }
export const desktop = {
  call(method: string, input: JsonValue): Promise<JsonValue> { return peer.call(method, input) },
  async encrypt(text: string): Promise<Buffer> {
    return Buffer.from(await peer.call('desktop.encrypt', { text }) as string, 'base64')
  },
  async decrypt(value: Buffer): Promise<string> {
    return await peer.call('desktop.decrypt', { value: value.toString('base64') }) as string
  },
}
export async function cpaProxyEnvironment(): Promise<NodeJS.ProcessEnv> {
  return await desktop.call('desktop.environment', {}) as NodeJS.ProcessEnv
}
/** The relay belongs to this plugin activation; page closure does not close it. */
export class CpaProxy {
  async start(): Promise<string> { return await desktop.call('desktop.proxy', {}) as string }
  async close(): Promise<void> { /* Host closes the shared relay when this activation stops. */ }
}
