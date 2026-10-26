import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginCredentials } from '../../src/main/plugins/network'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plugin-credential-migration-')); roots.push(root)
  const source = join(root, 'legacy.credential')
  // Deterministic test encryption; production uses Electron safeStorage only.
  const encryption = { encrypt: (value: string) => Buffer.from('encrypted:' + value), decrypt: (value: Buffer) => {
    if (!value.toString().startsWith('encrypted:')) throw new Error('invalid ciphertext')
    return value.toString().slice(10)
  } }
  await writeFile(source, encryption.encrypt('previous-key'))
  const storage = new PluginCredentials(join(root, 'credentials'), encryption)
  const migrate = () => storage.importLegacy('official.blueprint', 'jev', 'https://api.typesafe.ai', source, () => {})
  const args = ['official.blueprint', 'application', 'jev', 'https://api.typesafe.ai'] as const
  return { source, storage, migrate, args }
}

it('migrates a legacy key inside the host and leaves the encrypted original intact', async () => {
  const f = await fixture(), before = await readFile(f.source)
  await f.migrate()
  expect(await f.storage.get(...f.args)).toBe('previous-key')
  expect(await readFile(f.source)).toEqual(before)
  await f.storage.set(...f.args, null, () => {})
  await f.migrate()
  expect(await f.storage.status(...f.args)).toBe(false)
})
it('never overwrites a credential already saved in the plugin and serializes simultaneous imports', async () => {
  const f = await fixture()
  await f.storage.set(...f.args, 'new-key', () => {})
  await Promise.all([f.migrate(), f.migrate()])
  expect(await f.storage.get(...f.args)).toBe('new-key')
})
it('fails without copying unreadable ciphertext and can retry after the user repairs it', async () => {
  const f = await fixture()
  await writeFile(f.source, 'broken')
  await expect(f.migrate()).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' })
  expect(await f.storage.status(...f.args)).toBe(false)
  await writeFile(f.source, 'encrypted:recovered-key')
  await f.migrate()
  expect(await f.storage.get(...f.args)).toBe('recovered-key')
})
