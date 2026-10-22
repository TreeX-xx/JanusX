import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// JS CLI is part of the packed public SDK; it never evaluates plugin resources.
import { checkPlugin, createPlugin } from '../../packages/plugin-sdk/tools/cli.mjs'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plugin-tools-'))
  directories.push(root)
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'dist/index.html'), '<script src="./index.js"></script>')
  await writeFile(join(root, 'dist/summary.html'), '<p>summary</p>')
  await writeFile(join(root, 'dist/index.js'), 'throw new Error("must never execute")')
  return { root, manifest }
}

describe('packed SDK development tools', () => {
  it('checks static resources without executing any plugin JavaScript', async () => {
    const { root } = await fixture()
    expect((await checkPlugin(root)).id).toBe('example.project-reference')
  })

  it('reports missing entries, resource budgets and unsupported resource types', async () => {
    const { root } = await fixture()
    await rm(join(root, 'dist/summary.html'))
    await expect(checkPlugin(root)).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
    await writeFile(join(root, 'dist/summary.html'), 'x'.repeat(5 * 1024 * 1024 + 1))
    await expect(checkPlugin(root)).rejects.toMatchObject({ code: 'PACKAGE_LIMIT_EXCEEDED' })
    await writeFile(join(root, 'dist/summary.html'), '')
    await writeFile(join(root, 'dist/native.exe'), '')
    await expect(checkPlugin(root)).rejects.toMatchObject({ code: 'INVALID_PACKAGE_PATH' })
  })

  it('rejects linked resource directories rather than traversing into the target', async () => {
    const { root } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'plugin-tools-outside-'))
    directories.push(outside)
    await writeFile(join(outside, 'secret.js'), 'private')
    await symlink(outside, join(root, 'dist/link'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(checkPlugin(root)).rejects.toMatchObject({ code: 'INVALID_PACKAGE_PATH' })
  })

  it('refuses an existing scaffold destination without changing its files', async () => {
    const { root } = await fixture()
    const tarball = join(root, 'sdk.tgz')
    await writeFile(tarball, '')
    const before = await readFile(join(root, 'manifest.json'), 'utf8')
    await expect(createPlugin(root, tarball)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe(before)
  })
})
