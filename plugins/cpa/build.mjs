import { build } from 'esbuild'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions must match')
await mkdir(resolve(root, 'dist'), { recursive: true })
// Remove the former local dependency audit from the distributable directory.
await rm(resolve(root, 'dist/build-inputs.json'), { force: true })
const backend = await build({ absWorkingDir: root, entryPoints: { service: 'src/main/service-entry.ts' },
  outdir: 'dist', outExtension: { '.js': '.cjs' }, platform: 'node', target: 'node22', format: 'cjs', bundle: true,
  mainFields: ['module', 'main'], metafile: true, sourcemap: false, minify: false, logLevel: 'info' })
const ui = await build({ absWorkingDir: root, entryPoints: ['src/ui/main.tsx'], outdir: 'dist/ui', platform: 'browser', target: 'chrome134',
  format: 'esm', bundle: true, splitting: true, jsx: 'automatic', metafile: true, sourcemap: false, minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' })
await copyFile(resolve(root, 'src/ui/index.html'), resolve(root, 'dist/ui/index.html'))
await copyFile(resolve(root, 'src/ui/index.html'), resolve(root, 'dist/ui/settings.html'))
const inputs = { ...backend.metafile.inputs, ...ui.metafile.inputs }, outputs = { ...backend.metafile.outputs, ...ui.metafile.outputs }
// Public dependency packages are allowed; application source is never a build dependency.
for (const input of Object.keys(inputs)) {
  const path = relative(resolve(root, '../..', 'src'), resolve(root, input))
  if (!path.startsWith('..')) throw new Error(`CPA imports private host source: ${input}`)
}
for (const [file, output] of Object.entries(outputs)) if (output.bytes > 5 * 1024 * 1024) throw new Error(`Plugin asset exceeds the host limit: ${file}`)
await mkdir(resolve(root, 'artifacts'), { recursive: true })
await writeFile(resolve(root, 'artifacts/build-inputs.json'), JSON.stringify({ inputs: Object.keys(inputs), outputs }, null, 2) + '\n')
