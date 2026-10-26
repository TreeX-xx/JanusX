// Note: manual local Blueprint use — .agents/notes/planning/blueprint-official-plugin.md
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { cp, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { packagePlugin } from './package-plugin.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export async function prepareBlueprintDevelopment(root = repository, directory = join(root, '.cache/blueprint-local')) {
  await mkdir(join(directory, 'profile'), { recursive: true })
  const keyPath = join(directory, 'signing-key.json')
  let signing
  try { signing = JSON.parse(await readFile(keyPath, 'utf8')) }
  catch (cause) {
    if (cause.code !== 'ENOENT') throw cause
    const pair = generateKeyPairSync('ed25519')
    signing = { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
    await writeFile(keyPath, JSON.stringify(signing), { flag: 'wx', mode: 0o600 })
  }
  const keys = { 'blueprint-local': signing.publicKey }
  const trust = { catalogUrl: '', keys, nativePlugins: { 'official.blueprint': ['blueprint-local'] } }
  const counterPath = join(directory, 'revision.json')
  let revision = 0
  try { revision = JSON.parse(await readFile(counterPath, 'utf8')) } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid local Blueprint revision.')
  revision++
  const source = join(directory, 'builds', randomUUID())
  await mkdir(source, { recursive: true })
  await cp(join(root, 'plugins/blueprint/dist'), join(source, 'dist'), { recursive: true })
  const manifest = JSON.parse(await readFile(join(root, 'plugins/blueprint/manifest.json'), 'utf8'))
  manifest.version = manifest.version.split('-')[0] + `-local.${revision}`
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const result = await packagePlugin({ directory: source, output: source, url: 'https://local.invalid/blueprint.jxp',
    publisher: 'Local development build', host: '>=0.9.4 <1.0.0', platforms: [`${process.platform}-${process.arch}`],
    keyId: 'blueprint-local', privateKey: signing.privateKey, keys })
  const build = { profile: join(directory, 'profile'), appDirectory: join(directory, 'app'), id: manifest.id, version: manifest.version,
    archive: join(source, result.basename + '.jxp'), release: join(source, result.basename + '.release.json') }
  await writeFile(counterPath, JSON.stringify(revision) + '\n')
  await writeFile(join(directory, 'trust.json'), JSON.stringify(trust, null, 2) + '\n')
  await writeFile(join(directory, 'build.json'), JSON.stringify(build, null, 2) + '\n')
  return build
}

async function run(command, args, env = process.env) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: repository, env, stdio: 'inherit', windowsHide: true })
    const stop = () => child.kill()
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop) }
    child.once('error', cause => { cleanup(); reject(cause) })
    child.once('exit', code => { cleanup(); code === 0 ? done() : reject(new Error(`Command exited with ${code}: ${args.join(' ')}`)) })
  })
}

async function main() {
  const directory = join(repository, '.cache/blueprint-local')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'launch.lock')
  try {
    const pid = Number(await readFile(lockPath, 'utf8'))
    try { process.kill(pid, 0); throw new Error('Close the running local Blueprint session before rebuilding.') }
    catch (cause) { if (cause.code !== 'ESRCH') throw cause }
    await unlink(lockPath)
  } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
  const lock = await open(lockPath, 'wx')
  try {
    await lock.writeFile(String(process.pid))
    const npm = process.env.npm_execpath
    if (!npm) throw new Error('Run this entry with npm run dev:blueprint.')
    await run(process.execPath, [npm, 'run', 'build:plugin-sdk'])
    await run(process.execPath, [npm, 'run', 'build:llm-core'])
    await run(process.execPath, [npm, 'run', 'build', '--prefix', 'plugins/blueprint'])
    const build = await prepareBlueprintDevelopment()
    console.log(`\nLocal Blueprint ${build.version}\nProfile: ${build.profile}\nAdd your project, then enable Blueprint in Settings > Plugins. Configure models in this test profile.\nStop and rerun this command after changing plugin code. No Release upload is needed.\n`)
    if (!process.argv.includes('--prepare-only')) {
      const { ELECTRON_RUN_AS_NODE: _node, NODE_OPTIONS: _options, ...env } = process.env
      await run(process.execPath, [join(repository, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev',
        '--config', 'scripts/plugins/blueprint-dev.config.ts', '--outDir', '.cache/blueprint-local/app',
        '--entry', 'scripts/plugins/blueprint-dev-entry.mjs', '--', `--user-data-dir=${build.profile}`], env)
    }
  } finally { await lock.close(); await unlink(lockPath) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(cause => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
}
