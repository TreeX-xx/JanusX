import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Note: source tests cannot prove that external re-exports load after bundling — see .agents/notes/blueprint/agentx-harness-inheritance.md
const repo = resolve(import.meta.dirname, '../..')
const fixtures: string[] = []
afterEach(async () => {
  for (const directory of fixtures.splice(0)) await rm(directory, { recursive: true, force: true })
})

it.each(['serve', 'build'] as const)('loads the %s harness bundle and preserves shared export identities', async (command) => {
  await mkdir(join(repo, '.cache'), { recursive: true })
  const root = await mkdtemp(join(repo, '.cache/harness-bundle-'))
  fixtures.push(root)
  const input = join(root, 'probe.ts')
  const service = join(repo, 'src/main/harness/service.ts').replaceAll('\\', '/')
  await writeFile(input, `
    export { harnessNoteService } from ${JSON.stringify(service)}
    export async function loadService() { return await import(${JSON.stringify(service)}) }
  `)
  const script = `
    import { resolveConfig } from 'electron-vite'
    import { build } from 'vite'
    import { join } from 'node:path'
    import { pathToFileURL } from 'node:url'
    import assert from 'node:assert/strict'
    import * as shared from '@janus-agent/harness-node'
    const { root, input, command } = JSON.parse(process.argv[1])
    const resolved = await resolveConfig({}, command, command === 'serve' ? 'development' : 'production')
    const main = resolved.config.main
    const boundary = { name: 'shared-note-boundary', generateBundle() {
      const leaked = [...this.getModuleIds()].filter(id => id.replaceAll('\\\\', '/').includes('/plugins/blueprint/'))
      assert.deepEqual(leaked, [], 'shared Note bundle must not contain blueprint modules')
    } }
    await build({ ...main, configFile: false, logLevel: 'silent', plugins: [...(main.plugins ?? []), boundary], build: { ...main.build,
      outDir: join(root, 'out'), minify: false, rollupOptions: { ...main.build.rollupOptions,
        input, output: { format: 'es', entryFileNames: 'probe.mjs' } } } })
    const entry = await import(pathToFileURL(join(root, 'out/probe.mjs')).href)
    const service = await entry.loadService()
    for (const name of ['assertNoLocalLeak', 'claimsHarnessSchema', 'stripRemoteCreds']) {
      assert.equal(typeof service[name], 'function', name)
      assert.equal(service[name], shared[name], name + ' must reuse agentX')
    }
    assert.equal(service.harnessNoteService, entry.harnessNoteService)
    assert.ok(service.harnessNoteService instanceof shared.NoteService)
    assert.equal(service.harnessNoteService.projectView, undefined)
    console.log('Bundled harness namespace loaded')
  `
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '--eval', script, JSON.stringify({ root, input, command })],
    { cwd: repo, windowsHide: true, timeout: 30_000 })
  expect(stdout).toContain('Bundled harness namespace loaded')
}, 30_000)
