import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.root } }))
import { ensureManagedRuntime, verifyRuntimeArchive } from '../../../src/main/external-cli/managed-runtime'
import { managedCliEnv, managedCliPaths } from '../../../src/main/external-cli/managed-paths'
import { CliDetector } from '../../../src/main/external-cli/cli-detector'
import { clearCache, resolveCLIPath } from '../../../src/main/janus-runner/cli-resolver'

beforeEach(async () => { fixture.root = await mkdtemp(join(tmpdir(), 'janusx-cli-runtime-')); clearCache() })
afterEach(async () => { vi.unstubAllGlobals(); await rm(fixture.root, { recursive: true, force: true }) })

describe('managed CLI runtime', () => {
  it('accepts only the expected checksum', () => {
    const bytes = Buffer.from('archive')
    const expected = createHash('sha256').update(bytes).digest('hex')
    expect(() => verifyRuntimeArchive(bytes, expected)).not.toThrow()
    expect(() => verifyRuntimeArchive(Buffer.from('tampered'), expected)).toThrow('checksum mismatch')
  })

  it('deduplicates preparation and cleans a rejected download without publishing it', async () => {
    const fetch = vi.fn(async () => new Response('not the official archive'))
    vi.stubGlobal('fetch', fetch)
    const first = ensureManagedRuntime()
    expect(ensureManagedRuntime()).toBe(first)
    await expect(first).rejects.toThrow('checksum mismatch')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await readdir(managedCliPaths().base)).toEqual([])
    await expect(ensureManagedRuntime()).rejects.toThrow('checksum mismatch')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds private directories only to child environments', async () => {
    const paths = managedCliPaths()
    await mkdir(paths.bin, { recursive: true })
    await mkdir(paths.toolsBin, { recursive: true })
    const original = { Path: 'system-path', EXAMPLE: 'preserved' }
    const child = managedCliEnv(original)
    expect(original).toEqual({ Path: 'system-path', EXAMPLE: 'preserved' })
    expect(child.Path).toBeUndefined()
    expect(child.PATH).toBe([paths.toolsBin, paths.bin, 'system-path'].join(delimiter))
  })

  it.runIf(process.env.JANUS_TEST_RUNTIME_DOWNLOAD === '1')('downloads official Node, installs a fixture with private npm, detects and resolves it without system Node', async () => {
    const paths = await ensureManagedRuntime()
    const source = join(fixture.root, 'fixture-package')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'janusx-runtime-fixture', version: '1.2.3', bin: { pi: 'pi.js' } }))
    await writeFile(join(source, 'pi.js'), '#!/usr/bin/env node\nconsole.log("1.2.3")\n')
    const npmJs = process.platform === 'win32' ? join(paths.runtime, 'node_modules/npm/bin/npm-cli.js') : join(paths.runtime, 'lib/node_modules/npm/bin/npm-cli.js')
    const env = { ...process.env, PATH: paths.bin, npm_config_prefix: paths.prefix }
    await execa(paths.node, [npmJs, 'install', '-g', source, '--prefix', paths.prefix, '--ignore-scripts', '--no-audit', '--no-fund'], { env, timeout: 60_000, windowsHide: true })
    const probe = await new CliDetector('pi').detect()
    expect(probe).toMatchObject({ installed: true, runnable: true, version: '1.2.3' })
    expect(probe.path).toContain(paths.toolsBin)
    expect(await resolveCLIPath('pi')).toContain(paths.toolsBin)
    const before = await readdir(paths.base)
    await ensureManagedRuntime()
    expect(await readdir(paths.base)).toEqual(before)
  }, 300_000)
})
