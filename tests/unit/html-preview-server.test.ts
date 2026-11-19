import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HtmlPreviewServer } from '../../src/main/preview/html-preview-server'
import { MAX_EDITOR_TEXT_BYTES, MAX_HTML_PREVIEW_BYTES } from '../../src/shared/editor'

describe('workspace HTML preview server', () => {
  let server: HtmlPreviewServer
  let root: string
  let workspace: string
  let document: string
  beforeEach(async () => {
    server = new HtmlPreviewServer()
    root = await mkdtemp(join(tmpdir(), 'janusx-html-server-'))
    workspace = join(root, 'workspace')
    await mkdir(join(workspace, 'docs'), { recursive: true })
    document = join(workspace, 'docs', 'page space.html')
    await writeFile(document, '<h1>disk version</h1>')
    await writeFile(join(workspace, 'docs', 'theme.css'), 'body{color:red}')
    await writeFile(join(workspace, 'root.js'), 'export const value=42')
  })
  afterEach(async () => {
    await server.dispose()
    // Exact temporary root returned by mkdtemp above.
    await rm(root, { recursive: true, force: true })
  })

  it('serves drafts without writing disk and preserves sibling and root-relative resources', async () => {
    const lease = await server.open(1, { workspacePath: workspace, documentPath: document, content: '<h1>draft version</h1>' })
    expect(await (await fetch(lease.url)).text()).toContain('draft version')
    const css = await fetch(new URL('theme.css?v=2', lease.url))
    expect(css.headers.get('content-type')).toContain('text/css')
    expect(await css.text()).toContain('color:red')
    const rootJs = await fetch(new URL('/root.js', lease.url), { headers: { Referer: lease.url } })
    expect(rootJs.url).toContain(`/${lease.id}/root.js`)
    expect(rootJs.headers.get('content-type')).toContain('javascript')
    expect(await rootJs.text()).toContain('42')
    server.update(1, lease.id, '<h1>second draft</h1>')
    expect(await (await fetch(lease.url)).text()).toContain('second draft')
  })

  it('expires leases by owner and refuses mutations and hostnames outside the lease', async () => {
    const lease = await server.open(1, { workspacePath: workspace, documentPath: document, content: 'draft' })
    expect(() => server.update(2, lease.id, 'wrong owner')).toThrow()
    server.release(2, lease.id)
    expect((await fetch(lease.url)).status).toBe(200)
    expect((await fetch(lease.url, { method: 'POST' })).status).toBe(405)
    expect((await fetch(new URL('/root.js', lease.url))).status).toBe(404)
    server.releaseOwner(1)
    expect((await fetch(lease.url)).status).toBe(404)
  })

  it('serves HTML above 32 MiB completely and rejects content above 64 MiB', async () => {
    const content = '<!--' + 'x'.repeat(MAX_EDITOR_TEXT_BYTES) + '--><h1>Complete HTML</h1>'
    const lease = await server.open(1, { workspacePath: workspace, documentPath: document, content })
    const response = await fetch(lease.url), reader = response.body!.getReader()
    expect(response.status).toBe(200)
    let bytes = 0, tail = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      tail = Buffer.from(value).toString('utf8').slice(-80)
    }
    expect(bytes).toBe(Buffer.byteLength(content))
    expect(tail).toContain('<h1>Complete HTML</h1>')
    const oversized = 'x'.repeat(MAX_HTML_PREVIEW_BYTES + 1)
    await expect(server.open(1, { workspacePath: workspace, documentPath: document, content: oversized })).rejects.toThrow('64 MiB')
    expect(() => server.update(1, lease.id, oversized)).toThrow('Invalid HTML preview content')
  })

  it('rejects outside documents, hidden paths, traversal and symlink escapes', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.html'), 'private')
    await writeFile(join(workspace, '.secret.txt'), 'private')
    await symlink(outside, join(workspace, 'escape'), 'junction')
    await expect(server.open(1, { workspacePath: workspace, documentPath: join(outside, 'secret.html'), content: '' })).rejects.toThrow('outside')
    const lease = await server.open(1, { workspacePath: workspace, documentPath: document, content: '' })
    const base = `${new URL(lease.url).origin}/${lease.id}/`
    expect((await fetch(`${base}.secret.txt`)).status).toBe(403)
    expect((await fetch(`${base}escape/secret.html`)).status).toBe(403)
    expect((await fetch(`${base}%2e%2e%2foutside%2fsecret.html`)).status).not.toBe(200)
    expect((await fetch(lease.url, { method: 'HEAD' })).status).toBe(200)
  })
})
