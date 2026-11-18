import { writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
await build({
  absWorkingDir: root, entryPoints: ['src/entry.ts'], platform: 'node', format: 'cjs', target: 'node22',
  outfile: resolve(process.env.JANUSX_PLUGIN_BUILD_ROOT ?? root, 'dist/service.cjs'), bundle: true, mainFields: ['module', 'main'],
})

const ui = resolve(process.env.JANUSX_PLUGIN_BUILD_ROOT ?? root, 'dist/ui')
await build({ absWorkingDir: root, entryPoints: ['src/view.ts', 'src/view.css'], outdir: ui, bundle: true,
  format: 'esm', platform: 'browser', target: 'chrome134', mainFields: ['module', 'main'] })
for (const view of ['settings', 'workers']) {
  await writeFile(resolve(ui, view + '.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SuperAgent</title><link rel="stylesheet" href="./view.css"></head><body data-view="${view}"><main></main><p role="status"></p><script type="module" src="./view.js"></script></body></html>`)
}
