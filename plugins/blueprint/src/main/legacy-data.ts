// Note: .agents/notes/planning/blueprint-official-plugin.md — copy legacy state before either runtime opens its stores.
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { NativeServiceError } from '@janusx/plugin-sdk/native'
import { blueprintReviewSettingsSchema } from '../shared/blueprint-review-settings'

type Outcome = { state: 'imported' | 'preserved' | 'absent'; files?: number; automaticReviewWasEnabled?: boolean }
export interface LegacyDataMigration { version: 1; steps: Record<string, Outcome>; disabled?: boolean }
const marker = '.legacy-import.json'
const maxBytes = 256 * 1024 * 1024
async function stat(path: string) {
  try { return await lstat(path) } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause }
}
async function directory(path: string) {
  const info = await stat(path)
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Unsafe migration directory')
  return info
}
async function json(path: string) {
  const info = await stat(path)
  if (!info) return null
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new Error('Unsafe migration file')
  const file = await open(path, 'r')
  try {
    const current = await file.stat()
    if (current.ino !== info.ino || current.size !== info.size) throw new Error('Migration source changed')
    const buffer = Buffer.alloc(info.size + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const read = await file.read(buffer, bytes, buffer.length - bytes, bytes)
      if (!read.bytesRead) break
      bytes += read.bytesRead
    }
    const after = await file.stat()
    if (bytes !== info.size || after.mtimeMs !== current.mtimeMs || after.size !== current.size) throw new Error('Migration source changed')
    const text = buffer.subarray(0, bytes).toString('utf8')
    return { text, value: JSON.parse(text), bytes }
  } finally { await file.close() }
}

/** SQLite owns the cross-process lock. A killed importer releases it; each renamed directory carries its recovery receipt. */
export async function migrateLegacyData(options: { directory: string; applicationDataDirectory: string; allowLegacyImport?: boolean }): Promise<LegacyDataMigration> {
  if (options.allowLegacyImport === false) return { version: 1, steps: {}, disabled: true }
  await mkdir(options.directory, { recursive: true })
  await directory(options.directory)
  const lock = new DatabaseSync(join(options.directory, '.legacy-migration.sqlite'))
  let locked = false
  try {
    lock.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL;')
    const deadline = Date.now() + 10_000
    for (;;) {
      try { lock.exec('BEGIN IMMEDIATE'); locked = true; break }
      catch (cause) {
        if ((cause as { errcode?: number }).errcode !== 5 || Date.now() >= deadline) throw cause
        await delay(50)
      }
    }
    lock.exec('CREATE TABLE IF NOT EXISTS migration (version INTEGER PRIMARY KEY, result TEXT NOT NULL)')
    const saved = lock.prepare('SELECT result FROM migration WHERE version=1').get() as { result: string } | undefined
    if (saved) { lock.exec('COMMIT'); locked = false; return JSON.parse(saved.result) as LegacyDataMigration }
    const sourceRoot = join(options.applicationDataDirectory, 'janusx')
    await directory(sourceRoot)
    const result: LegacyDataMigration = { version: 1, steps: {} }
    let total = 0, files = 0
    const consume = (bytes: number) => { total += bytes; files++; if (total > maxBytes || files > 10_000) throw new Error('Migration budget exceeded') }
    for (const [name, sourceName] of [['review', 'blueprint'], ['maintenance-audit', 'blueprint-maintenance-audit'], ['legacy', 'blueprints']] as const) {
      const source = join(sourceRoot, sourceName), target = join(options.directory, name), stage = join(options.directory, `.legacy-stage-${name}`)
      if (await directory(target)) {
        const receipt = await json(join(target, marker))
        result.steps[name] = receipt?.value ?? { state: 'preserved' }
        continue
      }
      if (!await directory(source)) { result.steps[name] = { state: 'absent' }; continue }
      await directory(stage)
      await rm(stage, { recursive: true, force: true })
      await mkdir(stage)
      const outcome: Outcome = { state: 'imported', files: 0 }
      try {
        const copyJson = async (relative: string) => {
          const input = await json(join(source, relative))
          if (!input) return
          consume(input.bytes)
          let text = input.text
          if (name === 'review' && relative === 'review-settings.json') {
            const settings = blueprintReviewSettingsSchema.parse(input.value)
            outcome.automaticReviewWasEnabled = settings.automatic.enabled
            settings.automatic.enabled = false
            text = JSON.stringify(settings, null, 2) + '\n'
          }
          await writeFile(join(stage, relative), text, { flag: 'wx' }); outcome.files!++
        }
        if (name === 'review') {
          for (const file of ['review-settings.json', 'note-reading.json', 'git-review-state.json']) await copyJson(file)
          if (await directory(join(source, 'note-repair'))) {
            await mkdir(join(stage, 'note-repair'))
            for (const file of await readdir(join(source, 'note-repair'))) if (/^[a-f\d-]+(?:\.status)?\.json$/i.test(file)) await copyJson(join('note-repair', file))
          }
          const database = join(source, 'current-suggestions.sqlite'), info = await stat(database)
          if (info) {
            if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Unsafe migration database')
            consume(info.size)
            const db = new DatabaseSync(database, { readOnly: true })
            try {
              db.exec('PRAGMA busy_timeout=5000')
              // VACUUM INTO is a consistent SQLite snapshot, including committed WAL pages, supported by Electron's Node 22.
              db.prepare('VACUUM INTO ?').run(join(stage, 'current-suggestions.sqlite'))
            } finally { db.close() }
            const snapshotSize = (await lstat(join(stage, 'current-suggestions.sqlite'))).size
            total += snapshotSize - info.size
            if (total > maxBytes) throw new Error('Migration budget exceeded')
            const snapshot = new DatabaseSync(join(stage, 'current-suggestions.sqlite'), { readOnly: true })
            try {
              if (snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Invalid migration snapshot')
            } finally { snapshot.close() }
            outcome.files!++
          }
        } else {
          for (const file of await readdir(source)) if (/^[a-f\d-]+\.json$/i.test(file)) await copyJson(file)
        }
        await writeFile(join(stage, marker), JSON.stringify(outcome) + '\n', { flag: 'wx' })
        await rename(stage, target)
        result.steps[name] = outcome
      } catch (cause) { await rm(stage, { recursive: true, force: true }).catch(() => {}); throw cause }
    }
    lock.prepare('INSERT INTO migration VALUES (1, ?)').run(JSON.stringify(result))
    lock.exec('COMMIT'); locked = false
    return result
  } catch { throw new NativeServiceError('LEGACY_MIGRATION_FAILED') }
  finally { if (locked) lock.exec('ROLLBACK'); lock.close() }
}
