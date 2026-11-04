import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// Note: .agents/notes/workbench/file-editor-experience.md — offline PDF resources.
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const files = new Map<string, string>()
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(resolve(root, folder))) files.set(`/pdfjs/${folder}/${name}`, resolve(root, folder, name))
  }
  return {
    name: 'pdf-offline-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = files.get((req.url ?? '').split('?')[0])
        if (!path) return next()
        res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(readFileSync(path))
      })
    },
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: name.slice(1), source: readFileSync(path) })
    },
  }
}
