import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyDifferences, publicArchives } from '../../scripts/plugins/public-archives.mjs'

test('archive cache reuses identical publications and invalidates changed source or corrupted archives', async t => {
  const root = await mkdtemp(join(tmpdir(), 'public-archives-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), vendor = join(root, 'vendor'), cache = join(root, 'cache')
  await mkdir(source); await mkdir(vendor)
  await writeFile(join(source, 'index.js'), 'first')
  let packs = 0
  const npm = args => {
    if (args.includes('--dry-run')) return JSON.stringify([{ name: 'fixture', filename: 'fixture.tgz', files: [{ path: 'index.js', mode: 420 }] }])
    packs++
    // The package contents are written before invoking this synchronous npm seam below.
    return JSON.stringify([{ name: 'fixture', version: '1', filename: 'fixture.tgz', integrity: 'fixture' }])
  }
  const build = () => publicArchives({ sources: [source], vendor, cache, npm })
  await writeFile(join(vendor, 'fixture.tgz'), 'archive-one')
  const first = await build()
  await rm(join(vendor, 'fixture.tgz'))
  assert.deepEqual(await build(), first)
  assert.equal(packs, 1)
  await writeFile(join(source, 'index.js'), 'second')
  await writeFile(join(vendor, 'fixture.tgz'), 'archive-two')
  const second = await build()
  assert.equal(packs, 2)
  assert.equal(dependencyDifferences({ dependencies: first }, { dependencies: second }).length, 1)
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(cache)) await writeFile(join(cache, entry, 'fixture.tgz'), 'corrupt')
  await writeFile(join(vendor, 'fixture.tgz'), 'archive-two')
  assert.deepEqual(await build(), second)
  assert.equal(packs, 3)
  assert.equal(await readFile(join(vendor, 'fixture.tgz'), 'utf8'), 'archive-two')
})
