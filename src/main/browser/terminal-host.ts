// Note: .agents/notes/desktop/browser-control.md
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { realpath, stat, mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { BrowserControlBroker } from './control-broker'
import { BROWSER_TOOLS, READ_BROWSER_TOOLS } from './control-broker'
import { browserToolCatalog } from './tool-catalog'

const connectSchema = z.object({ client: z.string().max(32), root: z.string().max(4096) }).strict()
const callSchema = z.object({ session: z.string().uuid(), name: z.string().max(100), args: z.record(z.unknown()) }).strict()
export async function startBrowserTerminalHost(deps: { file: string; broker: BrowserControlBroker; approve(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<boolean> }) {
  const token = randomBytes(32).toString('hex')
  const sessions = new Map<string, { client: string; root: string; seen: number; controller: AbortController }>()
  const release = async (id: string) => {
    const session = sessions.get(id)
    sessions.delete(id); session?.controller.abort()
    if (session) await deps.broker.releaseOwner(id, id)
  }
  const server = createServer(async (request, response) => {
    const reply = (status: number, data: unknown) => { if (!response.destroyed && !response.writableEnded) response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)) }
    const provided = request.headers['x-janusx-token']
    if (request.method !== 'POST' || request.headers.origin || typeof provided !== 'string' || Buffer.byteLength(provided) !== token.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) { reply(403, { error: 'Browser connection unauthorized' }); return }
    try {
      let raw = ''
      for await (const chunk of request) { raw += chunk; if (raw.length > 256 * 1024) { reply(413, {}); return } }
      const body = JSON.parse(raw)
      if (request.url === '/connect') {
        if (sessions.size >= 32) throw new Error('Too many browser connections')
        const input = connectSchema.parse(body)
        if (!isAbsolute(input.root)) throw new Error('A local workspace directory is required')
        const root = await realpath(input.root)
        if (!(await stat(root)).isDirectory()) throw new Error('Workspace is not a directory')
        const tools = browserToolCatalog(await deps.broker.catalog())
        const id = randomUUID()
        sessions.set(id, { client: input.client, root, seen: Date.now(), controller: new AbortController() })
        deps.broker.beginTurn(id)
        reply(200, { session: id, tools }); return
      }
      const id = z.string().uuid().parse(body.session)
      const session = sessions.get(id)
      if (!session) throw new Error('Browser connection expired; reconnect MCP')
      session.seen = Date.now()
      if (request.url === '/disconnect') { await release(id); reply(200, {}); return }
      if (request.url === '/heartbeat') { reply(200, {}); return }
      if (request.url !== '/call') { reply(404, {}); return }
      const input = callSchema.parse(body)
      if (!BROWSER_TOOLS.has(input.name)) throw new Error('Unsupported browser tool')
      const controller = new AbortController()
      const abort = () => controller.abort()
      response.once('close', abort)
      const signal = AbortSignal.any([controller.signal, session.controller.signal, AbortSignal.timeout(60000)])
      try {
        if (!READ_BROWSER_TOOLS.has(input.name) && !await deps.approve(input.name, input.args, signal)) throw new Error('Browser action was not approved')
        signal.throwIfAborted()
        const result = await deps.broker.call(id, id, input.name, input.args, signal, session.root)
        reply(200, { result })
      } finally { response.removeListener('close', abort) }
    } catch (error) { reply(400, { error: error instanceof z.ZodError ? 'Invalid browser request' : error instanceof Error ? error.message : 'Browser request failed' }) }
  })
  server.requestTimeout = 5000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Browser bridge unavailable')
  const sweep = setInterval(() => { for (const [id, session] of sessions) if (Date.now() - session.seen > 60000) void release(id) }, 15000)
  sweep.unref()
  try {
    await mkdir(dirname(deps.file), { recursive: true })
    await writeFile(deps.file, JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, token }), { mode: 0o600 })
  } catch (error) { clearInterval(sweep); server.close(); throw error }
  return {
    disconnectClient: async (client: string) => { await Promise.all([...sessions].filter(([, session]) => session.client === client).map(([id]) => release(id))) },
    close: async () => {
      clearInterval(sweep)
      await Promise.all([...sessions.keys()].map(release))
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
      await unlink(deps.file).catch(() => {})
    },
  }
}
