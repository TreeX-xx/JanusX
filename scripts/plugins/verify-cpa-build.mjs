// Build outside the repository against a packed public SDK, never private application sources.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'janusx-cpa-build-'))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run npm run plugins:cpa:check.')
const run = (cwd, args) => execFileSync(process.execPath, [npm, ...args], { cwd, stdio: 'pipe', windowsHide: true })
try {
  const source = join(temporary, 'plugin')
  await mkdir(source)
  for (const name of ['src', 'manifest.json', 'package.json', 'tsconfig.json', 'build.mjs']) await cp(join(repository, 'plugins/cpa', name), join(source, name), { recursive: true })
  const packed = JSON.parse(run(repository, ['pack', '--workspace=@janusx/plugin-sdk', '--pack-destination', temporary, '--json']).toString())[0]
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  pkg.dependencies['@janusx/plugin-sdk'] = `file:${join(temporary, packed.filename).replaceAll('\\', '/')}`
  await writeFile(join(source, 'package.json'), JSON.stringify(pkg))
  run(source, ['install', '--ignore-scripts', '--no-audit', '--no-fund'])
  run(source, ['run', 'typecheck'])
  run(source, ['run', 'build'])
  execFileSync(process.execPath, [join(source, 'node_modules/@janusx/plugin-sdk/tools/cli.mjs'), 'check', source], { cwd: source, stdio: 'pipe', windowsHide: true })
  const evidence = JSON.parse(await readFile(join(source, 'artifacts/build-inputs.json'), 'utf8'))
  await mkdir(resolve('artifacts/plugins/cpa'), { recursive: true })
  await writeFile(resolve('artifacts/plugins/cpa/external-build.json'), JSON.stringify({ plugin: 'official.cpa',
    checks: ['public SDK tarball', 'external npm install', 'strict typecheck', 'bundle', 'package check'], ...evidence }, null, 2) + '\n')
  console.log('CPA external build, typecheck and package check passed with the public SDK tarball.')
} catch (cause) {
  if (cause.stdout) process.stderr.write(cause.stdout)
  if (cause.stderr) process.stderr.write(cause.stderr)
  throw cause
} finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
