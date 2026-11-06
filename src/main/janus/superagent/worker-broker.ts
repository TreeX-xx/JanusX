import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

type Handler = (tool: string, args: unknown) => Promise<unknown>

/** Capability is issued to one execution; caller-supplied work/execution identifiers are never trusted. */
export class SuperAgentWorkerBroker {
  private server?: Server
  private endpoint = ''
  private handlers = new Map<string, Handler>()
  private opening?: Promise<void>
  private open(): Promise<void> {
    return this.opening ??= new Promise((resolve, reject) => {
      this.server = createServer(async (request, response) => {
        const respond = (code: number, body: unknown) => { if (!response.destroyed) { response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) } }
        const token = request.headers.authorization?.replace(/^Bearer /, '')
        const handler = token && this.handlers.get(token)
        if (request.method !== 'POST' || request.url !== '/worker' || request.headers.origin || !handler) { respond(403, { error: 'Worker capability is unavailable' }); return }
        try {
          let size = 0
          const chunks: Buffer[] = []
          for await (const chunk of request) {
            size += chunk.length
            if (size > 4 * 1024 * 1024) { respond(413, { error: 'Worker request is too large' }); return }
            chunks.push(chunk)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (typeof body.tool !== 'string' || Object.keys(body).some(key => !['tool', 'arguments'].includes(key))) throw new Error('Invalid worker request')
          if (this.handlers.get(token as string) !== handler) throw new Error('Worker capability expired')
          respond(200, await handler(body.tool, body.arguments))
        } catch (error) { respond(400, { error: error instanceof Error ? error.message : String(error) }) }
      })
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address()
        if (!address || typeof address === 'string') { reject(new Error('Worker broker did not bind')); return }
        this.endpoint = `http://127.0.0.1:${address.port}/worker`; resolve()
      })
    })
  }
  async issue(handler: Handler): Promise<{ endpoint: string; token: string; revoke(): void }> {
    await this.open()
    const token = randomBytes(32).toString('hex')
    this.handlers.set(token, handler)
    return { endpoint: this.endpoint, token, revoke: () => { this.handlers.delete(token) } }
  }
  async close(): Promise<void> {
    this.handlers.clear()
    if (!this.server) return
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server!.close(() => resolve()))
  }
}
