import { build } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const backend = await build({ absWorkingDir: root, entryPoints: ['src/main/service-entry.ts'], outfile: 'dist/service.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, mainFields: ['module', 'main'], metafile: true, logLevel: 'info' })
const ui = await build({ absWorkingDir: root, entryPoints: ['src/ui/main.tsx'], outdir: 'dist/ui', platform: 'browser', target: 'chrome134', format: 'esm', bundle: true, jsx: 'automatic', metafile: true, minify: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' })
await copyFile(resolve(root, 'src/ui/index.html'), resolve(root, 'dist/ui/index.html'))
await mkdir(resolve(root, 'artifacts'), { recursive: true })
await writeFile(resolve(root, 'artifacts/build-inputs.json'), JSON.stringify({ inputs: [...Object.keys(backend.metafile.inputs), ...Object.keys(ui.metafile.inputs)], outputs: { ...backend.metafile.outputs, ...ui.metafile.outputs } }, null, 2))
