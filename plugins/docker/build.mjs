import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const outputRoot = resolve(process.env.JANUSX_PLUGIN_BUILD_ROOT ?? root)
const dist = resolve(outputRoot, 'dist')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions must match')
const backend = await build({ absWorkingDir: root, entryPoints: ['src/main/service-entry.ts'], outfile: resolve(dist, 'service.cjs'), platform: 'node', target: 'node22', format: 'cjs', bundle: true, mainFields: ['module', 'main'], metafile: true, logLevel: 'info' })
const ui = await build({ absWorkingDir: root, entryPoints: ['src/ui/main.tsx'], outdir: resolve(dist, 'ui'), platform: 'browser', target: 'chrome134', format: 'esm', bundle: true, jsx: 'automatic', metafile: true, minify: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' })
await copyFile(resolve(root, 'src/ui/index.html'), resolve(dist, 'ui/index.html'))
await mkdir(resolve(outputRoot, 'artifacts'), { recursive: true })
await writeFile(resolve(outputRoot, 'artifacts/build-inputs.json'), JSON.stringify({ inputs: [...Object.keys(backend.metafile.inputs), ...Object.keys(ui.metafile.inputs)], outputs: { ...backend.metafile.outputs, ...ui.metafile.outputs } }, null, 2))
