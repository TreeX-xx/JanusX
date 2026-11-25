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
await build({ absWorkingDir: root, entryPoints: { view: 'src/view.ts', settings: 'src/settings-entry.tsx' }, outdir: ui, bundle: true,
  format: 'esm', platform: 'browser', target: 'chrome134', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, mainFields: ['module', 'main'] })
for (const view of ['settings', 'workers']) {
  const asset = view === 'settings' ? 'settings' : 'view'
  const content = view === 'settings' ? '<main class="worker-settings-host" data-jx-settings-scroll></main>' : '<main></main><p role="status"></p>'
  await writeFile(resolve(ui, view + '.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SuperAgent</title><link rel="stylesheet" href="./${asset}.css"></head><body data-view="${view}">${content}<script type="module" src="./${asset}.js"></script></body></html>`)
}
