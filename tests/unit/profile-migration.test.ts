import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateLegacyPortableProfile } from '../../src/main/bootstrap/profile-migration'

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
}))

let root: string
let portable: string
let source: string
let target: string
function put(path: string, value = 'durable'): void {
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, value)
}
function migrate(): void { migrateLegacyPortableProfile(portable, target) }

describe('legacy no-install profile migration', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'janusx-profile-'))
    portable = join(root, 'exe')
    source = join(portable, 'data')
    target = join(root, 'appdata', 'JanusX-Portable')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('does not create data beside a fresh executable', () => {
    migrate()
    expect(fs.existsSync(source)).toBe(false)
  })

  it('preserves durable and unknown data, discards caches, and removes the empty old directory', () => {
    const durable = [
      'janusx/config.json', 'janusx/chat-conversations.jsonl', 'janusx/workspaces/project.json',
      'janusx/usage-ledger.sqlite', 'janusx/usage-ledger.sqlite-wal', 'knowledge/local-models/model.gguf',
      'chromium-session/Local Storage/leveldb/00001.log',
      'chromium-session/Partitions/janusx-browser/Network/Cookies', 'unknown/personal.bin',
    ]
    const caches = ['Cache/a', 'logs/main.log', 'janusx/logs/terminal.log', 'Crashpad/report',
      'chromium-session/Cache/data', 'chromium-session/Partitions/janusx-browser/Code Cache/js/a']
    for (const path of durable) put(join(source, path), path.endsWith('config.json') ? '{}' : path)
    for (const path of caches) put(join(source, path))
    fs.mkdirSync(join(source, 'empty-personal-dir'))
    migrate()
    for (const path of durable) expect(fs.readFileSync(join(target, path), 'utf8')).toBe(path.endsWith('config.json') ? '{}' : path)
    for (const path of caches) expect(fs.existsSync(join(target, path))).toBe(false)
    expect(fs.existsSync(join(target, 'empty-personal-dir'))).toBe(true)
    expect(fs.existsSync(source)).toBe(false)
    migrate()
  })

  it('does not clean an unrelated directory named data', () => {
    put(join(source, 'personal.txt'))
    put(join(source, 'Cache', 'keep'))
    migrate()
    expect(fs.existsSync(join(source, 'Cache', 'keep'))).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('never overwrites conflicting current settings or deletes old files on conflict', () => {
    put(join(source, 'janusx/config.json'), '{"old":true}')
    put(join(source, 'Cache/a'))
    put(join(target, 'janusx/config.json'), '{"new":true}')
    expect(migrate).toThrow('conflict')
    expect(fs.readFileSync(join(target, 'janusx/config.json'), 'utf8')).toBe('{"new":true}')
    expect(fs.existsSync(join(source, 'Cache/a'))).toBe(true)
  })

  it('accepts an identical partial import and finishes cleanup', () => {
    put(join(source, 'janusx/config.json'), '{}')
    put(join(target, 'janusx/config.json'), '{}')
    migrate()
    expect(fs.existsSync(source)).toBe(false)
  })

  it('keeps the original intact when copying fails and can retry', () => {
    put(join(source, 'janusx/config.json'), '{}')
    vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw new Error('disk full') })
    expect(migrate).toThrow('disk full')
    expect(fs.readFileSync(join(source, 'janusx/config.json'), 'utf8')).toBe('{}')
    vi.restoreAllMocks()
    migrate()
    expect(fs.existsSync(source)).toBe(false)
  })

  it('retries failed cleanup without restoring deleted data or replacing newer settings', () => {
    put(join(source, 'janusx/config.json'), '{}')
    put(join(source, 'janusx/chat-conversations.jsonl'), 'chat')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('read only') })
    migrate()
    expect(fs.existsSync(source)).toBe(true)
    vi.restoreAllMocks()
    put(join(target, 'janusx/config.json'), '{"new":true}')
    fs.unlinkSync(join(target, 'janusx/chat-conversations.jsonl'))
    migrate()
    expect(fs.readFileSync(join(target, 'janusx/config.json'), 'utf8')).toBe('{"new":true}')
    expect(fs.existsSync(join(target, 'janusx/chat-conversations.jsonl'))).toBe(false)
    expect(fs.existsSync(source)).toBe(false)
  })

  it('rejects source changes before cleaning anything', () => {
    put(join(source, 'janusx/config.json'), '{}')
    const copy = fs.copyFileSync
    vi.spyOn(fs, 'copyFileSync').mockImplementationOnce((...args) => {
      copy(...args)
      put(join(source, 'new-data'), 'arrived while copying')
    })
    expect(migrate).toThrow('changed during migration')
    expect(fs.existsSync(join(source, 'janusx/config.json'))).toBe(true)
  })

  it.each(['source', 'target'])('rejects %s junctions and retains external data', (side) => {
    put(join(source, 'janusx/config.json'), '{}')
    const outside = join(root, 'outside')
    put(join(outside, 'personal.txt'))
    if (side === 'source') fs.symlinkSync(outside, join(source, 'external'), 'junction')
    else {
      fs.mkdirSync(target, { recursive: true })
      fs.symlinkSync(outside, join(target, 'janusx'), 'junction')
    }
    expect(migrate).toThrow(/link/)
    expect(fs.existsSync(join(outside, 'personal.txt'))).toBe(true)
    expect(fs.existsSync(join(source, 'janusx/config.json'))).toBe(true)
  })

  it('relocates configured local model paths only within the old profile', () => {
    put(join(source, 'janusx/config.json'), JSON.stringify({
      knowledgeSettings: {
        automation: { local: { serverPath: join(source, 'knowledge/server.exe'), modelPath: join(source, 'knowledge/model.gguf') } },
      },
      description: source,
    }))
    put(join(source, 'knowledge/server.exe'))
    put(join(source, 'knowledge/model.gguf'))
    migrate()
    const config = JSON.parse(fs.readFileSync(join(target, 'janusx/config.json'), 'utf8'))
    expect(config.knowledgeSettings.automation.local.modelPath).toBe(join(target, 'knowledge/model.gguf'))
    expect(config.knowledgeSettings.automation.local.serverPath).toBe(join(target, 'knowledge/server.exe'))
    expect(config.description).toBe(source)
  })

  it('rejects overlapping profile roots', () => {
    put(join(source, 'janusx/config.json'), '{}')
    expect(() => migrateLegacyPortableProfile(portable, join(source, 'nested'))).toThrow('overlap')
    expect(() => migrateLegacyPortableProfile(portable, portable)).toThrow('overlap')
  })
})
