import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { parsePublishArgs, publishWin, releaseFiles, stageWin } from '../../scripts/publish-win.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(version = '1.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'janusx-publish-test-')); roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, 'electron-builder.yml'), stringify({ productName: 'JanusX', publish: { provider: 'github', owner: 'owner', repo: 'repo' } }))
  const directory = join(root, 'release', version); mkdirSync(directory, { recursive: true })
  const setup = `JanusX-${version}-x64-setup.exe`, bytes = Buffer.from('setup')
  writeFileSync(join(directory, setup), bytes)
  writeFileSync(join(directory, `${setup}.blockmap`), 'blockmap')
  writeFileSync(join(directory, `JanusX-${version}-x64-portable.exe`), 'portable')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  writeFileSync(join(directory, version.includes('-') ? 'beta.yml' : 'latest.yml'), stringify({ version, path: setup, sha512, files: [{ url: setup, sha512, size: bytes.length }] }))
  const release = releaseFiles(root)
  const assets = release.files.map(file => ({ name: basename(file), size: readFileSync(file).length, digest: `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` }))
  const state = {
    remote: { tag_name: release.tag, draft: true, prerelease: version.includes('-'), assets: [...assets] } as { tag_name: string; draft: boolean; prerelease: boolean; assets: typeof assets } | null,
    dirty: '', tagSha: 'commit', runtimeFailure: false, uploadFailure: false, authFailure: false,
  }
  const calls: { command: string; args: string[] }[] = []
  const run = (command: string, args: string[]) => {
    calls.push({ command, args })
    if (command === 'git') return args[0] === 'status' ? state.dirty : 'commit'
    if (command === process.execPath) { if (state.runtimeFailure) throw new Error('smoke failed'); return '' }
    if (command !== 'gh') throw new Error(`Unexpected command: ${command}`)
    if (args[0] === 'api') {
      if (state.authFailure) throw new Error('HTTP 403 forbidden')
      if (args[1].includes('/commits/')) return JSON.stringify({ sha: state.tagSha })
      return JSON.stringify([state.remote ? [state.remote] : []])
    }
    if (args[1] === 'create') state.remote = { tag_name: release.tag, draft: true, prerelease: version.includes('-'), assets: [] }
    if (args[1] === 'upload') {
      for (const file of args.slice(3, args.indexOf('--repo'))) {
        state.remote!.assets.push(assets.find(asset => asset.name === basename(file))!)
        if (state.uploadFailure) throw new Error('upload failed')
      }
    }
    if (args[1] === 'download') {
      const name = args[args.indexOf('--pattern') + 1]
      writeFileSync(join(args[args.indexOf('--dir') + 1], name), readFileSync(join(directory, name)))
    }
    if (args[1] === 'edit') state.remote!.draft = false
    return ''
  }
  return { root, directory, setup, release, assets, run, calls, state,
    actions: () => calls.filter(call => call.command === 'gh' && call.args[0] === 'release').map(call => call.args[1]) }
}

describe('Windows draft staging and explicit publication', () => {
  it.each(['1.0.0', '1.0.0-beta.1'])('stages %s without publishing', version => {
    const f = fixture(version); f.state.remote = null
    stageWin(f.root, f.run)
    expect(f.actions()).toEqual(['create', 'upload'])
    expect(f.state.remote!.draft).toBe(true)
    expect(f.state.remote!.prerelease).toBe(version.includes('-'))
    expect(f.calls.find(call => call.command === process.execPath)!.args).toContain('--portable')
  })
  it('does not mutate GitHub if runtime verification fails', () => {
    const f = fixture(); f.state.remote = null; f.state.runtimeFailure = true
    expect(() => stageWin(f.root, f.run)).toThrow('smoke failed')
    expect(f.actions()).toEqual([])
  })
  it('rejects an altered setup before any external command', () => {
    const f = fixture(); writeFileSync(join(f.directory, f.setup), 'different')
    expect(() => stageWin(f.root, f.run)).toThrow('hash and size')
    expect(f.calls).toEqual([])
  })
  it('rejects artifacts modified during the runtime check', () => {
    const f = fixture()
    expect(() => stageWin(f.root, (command: string, args: string[]) => {
      const result = f.run(command, args)
      if (command === process.execPath) writeFileSync(f.release.files[2], 'changed portable')
      return result
    })).toThrow('Artifacts changed')
    expect(f.actions()).toEqual([])
  })
  it('resumes partial uploads, skipping identical files without a rebuild', () => {
    const f = fixture(); f.state.remote = null; f.state.uploadFailure = true
    expect(() => stageWin(f.root, f.run)).toThrow('upload failed')
    expect(f.state.remote!.draft).toBe(true)
    expect(f.state.remote!.assets).toHaveLength(1)
    f.state.uploadFailure = false
    stageWin(f.root, f.run)
    expect(f.state.remote!.assets).toHaveLength(4)
    expect(f.actions()).toEqual(['create', 'upload', 'upload'])
    expect(f.calls.filter(call => call.args[1] === 'upload')[1].args).not.toContain(f.release.files[0])
    expect(f.calls.every(call => !call.args.includes('--clobber'))).toBe(true)
  })
  it('leaves an identical staged release alone', () => {
    const f = fixture(); stageWin(f.root, f.run)
    expect(f.actions()).toEqual([])
  })
  it.each([stageWin, publishWin])('rejects remote byte changes', action => {
    const f = fixture(); f.state.remote!.assets[0].digest = `sha256:${'0'.repeat(64)}`
    expect(() => action(f.root, f.run)).toThrow('Remote artifact differs')
    expect(f.actions()).toEqual([])
  })
  it.each([stageWin, publishWin])('refuses an already public release', action => {
    const f = fixture(); f.state.remote!.draft = false
    expect(() => action(f.root, f.run)).toThrow('unpublished draft')
    expect(f.actions()).toEqual([])
  })
  it.each(['dirty', 'tag'])('rejects source mismatch: %s', reason => {
    const f = fixture()
    if (reason === 'tag') f.state.tagSha = 'another-commit'
    else f.state.dirty = ' M src/main/index.ts'
    expect(() => stageWin(f.root, f.run)).toThrow(reason === 'tag' ? 'Remote version tag' : 'clean checkout')
    expect(f.actions()).toEqual([])
  })
  it('never treats authentication failure as an absent release', () => {
    const f = fixture(); f.state.authFailure = true
    expect(() => stageWin(f.root, f.run)).toThrow('403')
    expect(f.actions()).toEqual([])
  })
  it('refuses an incomplete draft without building', () => {
    const f = fixture(); f.state.remote!.assets.pop()
    expect(() => publishWin(f.root, f.run)).toThrow('Remote artifact missing')
    expect(f.actions()).toEqual([])
    expect(f.calls.every(call => call.command !== process.execPath)).toBe(true)
  })
  it.each(['1.0.0', '1.0.0-beta.1'])('publishes %s with no build or runtime launch', version => {
    const f = fixture(version); publishWin(f.root, f.run)
    expect(f.actions()).toEqual(['edit'])
    expect(f.calls.every(call => ['gh', 'git'].includes(call.command))).toBe(true)
    expect(f.calls.at(-1)!.args).toContain(`--latest=${!version.includes('-')}`)
    expect(f.calls.at(-1)!.args).toContain(`--prerelease=${version.includes('-')}`)
  })
  it('compares downloaded bytes when GitHub omits digests', () => {
    const f = fixture(); f.state.remote!.assets[0].digest = ''
    publishWin(f.root, f.run)
    expect(f.actions()).toEqual(['download', 'edit'])
  })
  it('rejects mismatched downloaded bytes instead of exposing the draft', () => {
    const f = fixture(); f.state.remote!.assets[0].digest = ''
    expect(() => publishWin(f.root, (command: string, args: string[]) => {
      const result = f.run(command, args)
      if (command === 'gh' && args[1] === 'download') {
        writeFileSync(join(args[args.indexOf('--dir') + 1], basename(f.release.files[0])), 'wrong')
      }
      return result
    })).toThrow('Remote artifact differs')
    expect(f.actions()).toEqual(['download'])
    expect(f.state.remote!.draft).toBe(true)
  })
  it('rejects a mismatched prerelease flag', () => {
    const f = fixture(); f.state.remote!.prerelease = true
    expect(() => publishWin(f.root, f.run)).toThrow('prerelease status')
    expect(f.actions()).toEqual([])
  })
  it('validates the specified output directory', () => {
    const f = fixture()
    expect(() => stageWin(f.root, f.run, { outputDirectory: join(f.root, 'missing') })).toThrow('Release artifact missing')
    expect(f.calls).toEqual([])
  })
  it.each([['--replace-existing'], ['--release-dir'], ['--stage', '--check'], ['--unknown']])('rejects invalid CLI options %j', (...args) => {
    expect(() => parsePublishArgs(args)).toThrow()
  })
})

describe('Release trigger boundaries', () => {
  const workflow = (name: string) => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
  it('only permits manual read-only artifact builds', () => {
    const release = workflow('release-win')
    expect(Object.keys(release.on)).toEqual(['workflow_dispatch'])
    expect(release.permissions).toEqual({ contents: 'read' })
    const steps = release.jobs['build-win'].steps
    expect(steps.some((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'))).toBe(true)
    expect(steps.some((step: { env?: object }) => step.env && 'GH_TOKEN' in step.env)).toBe(false)
  })
  it('retains required PR checks without duplicate branch-push runs', () => {
    const verify = workflow('verify')
    expect(verify.on.pull_request.branches).toEqual(['main', 'develop'])
    expect(verify.on.push).toBeUndefined()
    expect(verify.jobs.verify).toBeDefined()
  })
})
