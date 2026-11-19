import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { verifyEnginePackages } from '../../scripts/verify-engine-packages.mjs'

it('rejects modified artifacts and installed bytes while requiring no sibling source checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janus-engine-test-'))
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  try {
    const vendor = join(root, 'vendor/janus-agent'), installed = join(root, 'node_modules/@janus-agent/test')
    await mkdir(vendor, { recursive: true }); await mkdir(installed, { recursive: true })
    await writeFile(join(vendor, 'test.tgz'), 'archive')
    await writeFile(join(installed, 'index.js'), 'export const value=1')
    await writeFile(join(vendor, 'manifest.json'), JSON.stringify({ schema: 1, build: 'fixture', packages: [{
      name: '@janus-agent/test', archive: 'test.tgz', sha256: hash('archive'), files: { 'index.js': hash('export const value=1') },
    }] }))
    const dependencies = { '@janus-agent/test': 'file:vendor/janus-agent/test.tgz' }
    expect(verifyEnginePackages(root, dependencies)).toEqual([])
    await writeFile(join(installed, 'index.js'), 'changed')
    expect(() => verifyEnginePackages(root, dependencies)).toThrow('Installed engine differs')
    await writeFile(join(vendor, 'test.tgz'), 'changed')
    expect(() => verifyEnginePackages(root, dependencies, false)).toThrow('artifact hash mismatch')
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('janus-engine-test-')) throw new Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
