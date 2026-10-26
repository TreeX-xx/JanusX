import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep, posix } from 'node:path'
import type { HtmlPreviewRequest, HtmlPreviewLease } from '../../shared/ipc/workspace'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import type { WorkspaceRuntime } from '../../shared/workspace-runtime'

const MAX_BYTES = 32 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.map': 'application/json',
}

interface Entry { owner: number; root: string; document: string; content: string; runtime?: Exclude<WorkspaceRuntime, { kind: 'windows' }> }

function isInside(root: string, file: string): boolean {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Capability URLs expose only one workspace, and expire with their renderer. */
export class HtmlPreviewServer {
  private entries = new Map<string, Entry>()
  private server: Server | null = null
  private starting: Promise<string> | null = null
  private origin = ''

  private start(): Promise<string> {
    if (this.starting) return this.starting
    const server = createServer((request, response) => { void this.serve(request, response) })
    this.server = server
    this.starting = new Promise<string>((done, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') { reject(new Error('Preview port unavailable')); return }
        this.origin = `http://127.0.0.1:${address.port}`
        server.unref()
        done(this.origin)
      })
    }).catch(error => { this.starting = null; throw error })
    return this.starting
  }

  async open(owner: number, request: HtmlPreviewRequest): Promise<HtmlPreviewLease> {
    if (typeof request?.workspacePath !== 'string' || typeof request.documentPath !== 'string' || typeof request.content !== 'string') throw new Error('Invalid HTML preview request')
    if (Buffer.byteLength(request.content) > MAX_BYTES) throw new Error('HTML preview exceeds 32 MB')
    const remote = await resolveRuntimeResource(request.workspacePath)
    let root: string, document: string
    if (remote) {
      const file = await resolveRuntimeResource(request.documentPath)
      if (!file || file.workspaceId !== remote.workspaceId) throw new Error('Preview document is outside the workspace')
      root = remote.path; document = file.path
      const path = posix.relative(root, document)
      if (!path || path === '..' || path.startsWith('../')) throw new Error('Preview document is outside the workspace')
      const info = await runtimeRequest<{ isFile: boolean }>(remote.runtime, 'fs.stat', { root, path })
      if (!info.isFile) throw new Error('Preview requires a file')
    } else {
      ;[root, document] = await Promise.all([realpath(resolve(request.workspacePath)), realpath(resolve(request.documentPath))])
      if (!isInside(root, document) || !(await stat(root)).isDirectory()) throw new Error('Preview document is outside the workspace')
    }
    if (![ '.html', '.htm' ].includes(extname(document).toLowerCase())) throw new Error('Preview requires an HTML document')
    if ([...this.entries.values()].filter(entry => entry.owner === owner).length >= 32) throw new Error('Too many HTML previews')
    const origin = await this.start()
    const id = randomBytes(24).toString('hex')
    this.entries.set(id, { owner, root, document, content: request.content, runtime: remote?.runtime })
    const path = (remote ? posix.relative(root, document).split('/') : relative(root, document).split(sep)).map(encodeURIComponent).join('/')
    return { id, url: `${origin}/${id}/${path}` }
  }

  update(owner: number, id: string, content: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.owner !== owner) throw new Error('HTML preview is unavailable')
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw new Error('Invalid HTML preview content')
    entry.content = content
  }

  release(owner: number, id: string): void {
    if (this.entries.get(id)?.owner === owner) this.entries.delete(id)
  }

  releaseOwner(owner: number): void {
    for (const [id, entry] of this.entries) if (entry.owner === owner) this.entries.delete(id)
  }

  async dispose(): Promise<void> {
    this.entries.clear()
    const server = this.server
    this.server = null
    this.starting = null
    if (server) {
      server.closeAllConnections()
      await new Promise<void>(done => server.close(() => done()))
    }
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers.host !== new URL(this.origin).host) { response.writeHead(403).end(); return }
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return }
      const url = new URL(request.url ?? '/', this.origin)
      const [id, ...segments] = url.pathname.slice(1).split('/')
      const entry = this.entries.get(id)
      if (!entry) {
        // Root-relative resources inherit the same document capability via Referer.
        const referrer = request.headers.referer ? new URL(request.headers.referer) : null
        const referrerId = referrer?.pathname.split('/')[1]
        if (referrer?.origin === this.origin && referrerId && this.entries.has(referrerId)) {
          response.writeHead(302, { Location: `/${referrerId}${url.pathname}${url.search}` }).end()
          return
        }
        response.writeHead(404).end(); return
      }
      const parts = segments.map(segment => decodeURIComponent(segment))
      if (parts.some(part => part.startsWith('.') || /[\\/\0:]/.test(part))) { response.writeHead(403).end(); return }
      const file = entry.runtime ? posix.join(entry.root, ...parts) : await realpath(resolve(entry.root, ...parts))
      if (!entry.runtime && !isInside(entry.root, file)) { response.writeHead(403).end(); return }
      const mime = MIME[extname(file).toLowerCase()]
      if (!mime) { response.writeHead(415).end(); return }
      let body: Buffer
      if (entry.runtime) {
        const path = posix.relative(entry.root, file)
        const info = await runtimeRequest<{ isFile: boolean; size: number }>(entry.runtime, 'fs.stat', { root: entry.root, path })
        if (!info.isFile || info.size > MAX_BYTES) { response.writeHead(413).end(); return }
        body = file === entry.document ? Buffer.from(entry.content) : Buffer.from((await runtimeRequest<{ base64: string }>(entry.runtime, 'fs.binary', { root: entry.root, path })).base64, 'base64')
      } else {
        const info = await stat(file)
        if (!info.isFile() || info.size > MAX_BYTES) { response.writeHead(413).end(); return }
        body = file === entry.document ? Buffer.from(entry.content) : await readFile(file)
      }
      if (body.length > MAX_BYTES) { response.writeHead(413).end(); return }
      response.writeHead(200, {
        'Content-Type': mime, 'Content-Length': body.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end()
    }
  }
}

export const htmlPreviewServer = new HtmlPreviewServer()
