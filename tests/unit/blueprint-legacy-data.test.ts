import { afterEach, expect, it } from 'vitest'
import { fork } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { migrateLegacyData } from '../../plugins/blueprint/src/main/legacy-data'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { allowLegacyImport, markPluginDataReset } from '../../src/main/plugins/data-reset'

const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => { for (const clean of cleanup.splice(0).reverse()) await clean() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-migration-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const home = join(root, 'janusx'), source = join(home, 'blueprint'), directory = join(home, 'plugins/data/official.blueprint/native')
  await mkdir(source, { recursive: true })
  const settings = { ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, generation: { providerId: 'legacy', modelId: 'previous' }, automatic: { enabled: true, commits: 11 } }
  await writeFile(join(source, 'review-settings.json'), JSON.stringify(settings))
  return { root, home, source, directory, settings, options: { directory, applicationDataDirectory: root } }
}

it('copies a live WAL snapshot, settings and receipts without changing originals or enabling automatic reviews', async () => {
  const f = await fixture(), db = new DatabaseSync(join(f.source, 'current-suggestions.sqlite'))
  cleanup.push(() => db.close())
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE evidence (id TEXT); INSERT INTO evidence VALUES (\'saved-review\')')
  await mkdir(join(f.source, 'note-repair'))
  await mkdir(join(f.home, 'blueprint-maintenance-audit'))
  await mkdir(join(f.home, 'blueprints'))
  const id = 'cc7050c0-21f5-4b49-b3fd-0933a714a200'
  for (const path of [join(f.source, 'note-repair', id + '.status.json'), join(f.home, 'blueprint-maintenance-audit', id + '.json'), join(f.home, 'blueprints', id + '.json')]) {
    await writeFile(path, JSON.stringify({ id, content: 'keep' }))
  }
  await writeFile(join(f.source, 'unexpected.credential'), 'never copy credentials')
  const migrated = await migrateLegacyData(f.options)
  expect(migrated.steps.review).toMatchObject({ state: 'imported', automaticReviewWasEnabled: true })
  const next = JSON.parse(await readFile(join(f.directory, 'review/review-settings.json'), 'utf8'))
  expect(next).toEqual({ ...f.settings, automatic: { enabled: false, commits: 11 } })
  expect(JSON.parse(await readFile(join(f.source, 'review-settings.json'), 'utf8'))).toEqual(f.settings)
  const snapshot = new DatabaseSync(join(f.directory, 'review/current-suggestions.sqlite'))
  expect(snapshot.prepare('SELECT id FROM evidence').get()?.id).toBe('saved-review'); snapshot.close()
  expect(db.prepare('SELECT id FROM evidence').get()?.id).toBe('saved-review')
  for (const target of ['review/note-repair/' + id + '.status.json', 'maintenance-audit/' + id + '.json', 'legacy/' + id + '.json']) {
    expect(JSON.parse(await readFile(join(f.directory, target), 'utf8'))).toEqual({ id, content: 'keep' })
  }
  await expect(readFile(join(f.directory, 'review/unexpected.credential'))).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(f.source, 'review-settings.json'), '{broken after migration')
  expect(await migrateLegacyData(f.options)).toEqual(migrated)
})

it('preserves existing plugin data and never replaces it with older application state', async () => {
  const f = await fixture()
  await mkdir(join(f.directory, 'review'), { recursive: true })
  await writeFile(join(f.directory, 'review/review-settings.json'), '{"new":"user choice"}')
  expect((await migrateLegacyData(f.options)).steps.review.state).toBe('preserved')
  expect(await readFile(join(f.directory, 'review/review-settings.json'), 'utf8')).toBe('{"new":"user choice"}')
})

it('recovers a directory committed before its migration journal and does not replay old settings', async () => {
  const f = await fixture(), original = await migrateLegacyData(f.options)
  await rm(join(f.directory, '.legacy-migration.sqlite'))
  await writeFile(join(f.source, 'review-settings.json'), '{invalid newer source')
  expect(await migrateLegacyData(f.options)).toEqual(original)
})

it('leaves malformed legacy data intact, refuses to open empty replacement stores and retries after repair', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'note-reading.json'), 'not JSON')
  await expect(migrateLegacyData(f.options)).rejects.toThrow('LEGACY_MIGRATION_FAILED')
  expect(await readFile(join(f.source, 'note-reading.json'), 'utf8')).toBe('not JSON')
  await expect(readFile(join(f.directory, 'review/review-settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(f.source, 'note-reading.json'), '{}')
  expect((await migrateLegacyData(f.options)).steps.review.state).toBe('imported')
})

it('serializes desktop and MCP importers in separate processes', async () => {
  const f = await fixture(), worker = join(f.root, 'worker.cjs')
  await build({ stdin: { contents: "import { migrateLegacyData } from './plugins/blueprint/src/main/legacy-data'; process.send('ready'); process.once('message', async options => { try { process.send(await migrateLegacyData(options)); process.disconnect() } catch (e) { console.error(e); process.exit(1) } });", resolveDir: process.cwd(), loader: 'ts' },
    outfile: worker, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const start = () => {
    const child = fork(worker, [], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
    cleanup.push(() => { child.kill() })
    const ready = new Promise<void>(resolve => child.once('message', () => resolve()))
    let value: unknown
    const result = new Promise<unknown>((resolve, reject) => {
      child.on('message', message => { if (message !== 'ready') value = message })
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve(value) : reject(new Error('Migration worker failed')))
    })
    return { ready, result, run: () => child.send(f.options) }
  }
  const first = start(), second = start()
  await Promise.all([first.ready, second.ready]); first.run(); second.run()
  const [a, b] = await Promise.all([first.result, second.result])
  expect(a).toEqual(b); expect(a).toMatchObject({ steps: { review: { state: 'imported' } } })
})

it('rejects linked source directories and respects an explicit private-data reset across reinstall', async () => {
  const f = await fixture(), external = join(f.root, 'other')
  await mkdir(external)
  await symlink(external, join(f.source, 'note-repair'), 'junction')
  await expect(migrateLegacyData(f.options)).rejects.toThrow('LEGACY_MIGRATION_FAILED')
  const pluginHome = join(f.home, 'plugins')
  expect(await allowLegacyImport(pluginHome, 'official.blueprint')).toBe(true)
  await markPluginDataReset(pluginHome, 'official.blueprint')
  await rm(f.directory, { recursive: true, force: true })
  const allowed = await allowLegacyImport(pluginHome, 'official.blueprint')
  expect(allowed).toBe(false)
  expect(await migrateLegacyData({ ...f.options, allowLegacyImport: allowed })).toMatchObject({ disabled: true })
  await expect(readFile(join(f.directory, 'review/review-settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
