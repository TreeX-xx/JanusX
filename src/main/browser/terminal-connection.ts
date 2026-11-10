// Note: .agents/notes/desktop/browser-control.md
import { readFile } from 'node:fs/promises'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export async function connectBrowserTerminal(file: string, client: string, root = process.cwd()) {
  const descriptor = JSON.parse(await readFile(file, 'utf8')) as { endpoint: string; token: string }
  const url = new URL(descriptor.endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Invalid JanusX browser endpoint')
  const request = async (path: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetch(new URL(path, url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-janusx-token': descriptor.token },
      body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(65000), ...(signal ? [signal] : [])]) })
    const result = await response.json() as { error?: string; session: string; tools: Tool[]; result: unknown }
    if (!response.ok) throw new Error(result.error ?? 'JanusX browser unavailable; open JanusX and reconnect the MCP')
    return result
  }
  const { session, tools } = await request('/connect', { client, root })
  const heartbeat = setInterval(() => { void request('/heartbeat', { session }).catch(() => {}) }, 15000)
  heartbeat.unref()
  return { tools,
    call: async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => (await request('/call', { session, name, args }, signal)).result,
    close: async () => { clearInterval(heartbeat); await request('/disconnect', { session }).catch(() => {}) },
  }
}
