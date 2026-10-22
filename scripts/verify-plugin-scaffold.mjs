// Note: .agents/notes/planning/plugin-platform-roadmap.md — reproducible external P1 build.
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createPlugin, checkPlugin } from '../packages/plugin-sdk/tools/cli.mjs'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run through npm run plugins:verify-scaffold.')
const repository = process.cwd()
const directory = await mkdtemp(join(await realpath(tmpdir()), 'janusx-plugin-p1-'))
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180_000,
})
const packed = JSON.parse(npm(['pack', '--workspace=@janusx/plugin-sdk', '--ignore-scripts', '--json', '--pack-destination', directory], repository))[0]
const project = await createPlugin(join(directory, 'reference'), resolve(directory, packed.filename))
const logs = []
for (const args of [
  ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'],
  ['run', 'build'], ['run', 'check'],
]) logs.push({ command: `npm ${args.join(' ')}`, output: npm(args, project) })
const manifest = await checkPlugin(project)
const generatedPackage = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
if (Object.keys(generatedPackage.dependencies).some((name) => name !== '@janusx/plugin-sdk')) throw new Error('Scaffold depends on private packages.')
await mkdir(resolve(repository, 'artifacts/plugin-p1'), { recursive: true })
await writeFile(resolve(repository, 'artifacts/plugin-p1/scaffold.json'), JSON.stringify({
  project, sdk: packed.filename, sdkIntegrity: packed.integrity, pluginId: manifest.id, logs,
}, null, 2) + '\n')
console.log(`Independent packed-SDK install, typecheck, build and package check passed: ${project}`)
