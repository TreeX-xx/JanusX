import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listOpencodeSessions,
  probeOpencodeSessionPresence,
  readOpencodeTurns,
  resolveOpencodeDbPath,
} from '../../src/main/sessions/opencode-sessions'
import { TRANSCRIPT_TEXT_CAP, TRANSCRIPT_TURN_CAP } from '../../src/main/sessions/transcript-reader'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixtureDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-sessions-'))
  roots.push(dir)
  const path = join(dir, 'opencode.db')
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
  `)
  database.close()
  return path
}

function insertSession(path: string, row: { id: string; directory?: string; title?: string; created?: number; updated?: number }): void {
  const database = new DatabaseSync(path)
  database
    .prepare('INSERT INTO session (id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.directory ?? 'C:/repo', row.title ?? '', row.created ?? 1000, row.updated ?? 2000)
  database.close()
}

let messageSeq = 0
function insertMessage(
  path: string | DatabaseSync,
  sessionId: string,
  role: string,
  texts: string[],
  created: number,
): void {
  const database = typeof path === 'string' ? new DatabaseSync(path) : path
  const messageId = `msg-${sessionId}-${messageSeq}`
  database
    .prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)')
    .run(messageId, sessionId, created, JSON.stringify({ role }))
  texts.forEach((text, index) => {
    messageSeq += 1
    database
      .prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)')
      .run(`part-${messageSeq}`, messageId, sessionId, created + index, JSON.stringify({ type: 'text', text }))
  })
  messageSeq += 1
  if (typeof path === 'string') database.close()
}

describe('opencode sessions', async () => {
  it('resolves the database under the home profile', async () => {
    expect(resolveOpencodeDbPath('/home/u')).toBe(join('/home/u', '.local', 'share', 'opencode', 'opencode.db'))
  })

  it('lists newest-first rows with first question, tail answer, and counts', async () => {
    const path = await fixtureDb()
    insertSession(path, { id: 'old', updated: 1000 })
    insertMessage(path, 'old', 'user', ['old question'], 1100)
    insertMessage(path, 'old', 'assistant', ['old answer'], 1200)
    insertSession(path, { id: 'new', title: 'New title', updated: 2000 })
    insertMessage(path, 'new', 'user', ['new question'], 2100)
    insertMessage(path, 'new', 'assistant', ['reasoning-only'], 2200)
    insertMessage(path, 'new', 'assistant', ['new answer'], 2300)
    // Rows without a directory or without any prose stay invisible.
    insertSession(path, { id: 'nocwd', directory: '', updated: 3000 })
    insertMessage(path, 'nocwd', 'user', [''], 3100)
    insertSession(path, { id: 'empty', updated: 4000 })

    const rows = await listOpencodeSessions(path, 10)
    expect(rows.map((row) => row.providerSessionId)).toEqual(['new', 'old'])
    expect(rows[0]).toMatchObject({
      cwd: 'C:/repo',
      title: 'New title',
      firstPrompt: 'new question',
      lastExcerpt: 'new answer',
      turnCount: 1,
    })
    expect(rows[1]).toMatchObject({ firstPrompt: 'old question', lastExcerpt: 'old answer', turnCount: 1 })
  })

  it('pairs turns in order and keeps a trailing open question', async () => {
    const path = await fixtureDb()
    insertSession(path, { id: 's' })
    insertMessage(path, 's', 'user', ['q1'], 1000)
    insertMessage(path, 's', 'assistant', ['a1'], 1100)
    insertMessage(path, 's', 'user', ['q2'], 1200)
    const list = readOpencodeTurns(path, 's')
    expect(list?.totalTurns).toBe(2)
    expect(list?.truncated).toBe(false)
    expect(list?.turns).toEqual([
      { prompt: 'q1', excerpt: 'a1' },
      { prompt: 'q2' },
    ])
  })

  it('yields during discovery and finds the last nonempty answer after a long history', async () => {
    const path = await fixtureDb()
    const database = new DatabaseSync(path)
    database.exec('BEGIN')
    for (let session = 0; session < 3; session++) {
      const id = `history-${session}`
      database.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run(id, 'C:/repo', '', 1000, 2000)
      insertMessage(database, id, 'user', ['first question'], 1000)
      for (let index = 0; index < 200; index++) insertMessage(database, id, 'assistant', [`answer ${index}`], 1100 + index)
      insertMessage(database, id, 'assistant', [''], 2000)
    }
    database.exec('COMMIT')
    database.close()
    let turns = 0
    let running = true
    const heartbeat = () => { if (running) { turns++; setImmediate(heartbeat) } }
    setImmediate(heartbeat)
    try {
      const rows = await listOpencodeSessions(path, 10)
      expect(rows).toHaveLength(3)
      expect(rows.every(row => row.firstPrompt === 'first question' && row.lastExcerpt === 'answer 199' && row.turnCount === 1)).toBe(true)
      expect(turns).toBeGreaterThanOrEqual(3)
    } finally { running = false }
  })

  it('caps turns to the most recent window and truncates long text', async () => {
    const path = await fixtureDb()
    insertSession(path, { id: 's' })
    // Seed the window in one transaction; hundreds of durable commits test disk latency.
    const database = new DatabaseSync(path)
    try {
      database.exec('BEGIN')
      for (let i = 0; i < TRANSCRIPT_TURN_CAP + 5; i += 1) {
        insertMessage(database, 's', 'user', [`q${i}`], 1000 + i * 2)
        insertMessage(database, 's', 'assistant', [`${'y'.repeat(TRANSCRIPT_TEXT_CAP + 10)}`], 1000 + i * 2 + 1)
      }
      database.exec('COMMIT')
    } finally {
      database.close()
    }
    const list = readOpencodeTurns(path, 's')
    expect(list?.totalTurns).toBe(TRANSCRIPT_TURN_CAP + 5)
    expect(list?.truncated).toBe(true)
    expect(list?.turns).toHaveLength(TRANSCRIPT_TURN_CAP)
    expect(list?.turns[0]?.prompt).toBe('q5')
    expect(list?.turns[0]?.excerpt?.length).toBeLessThanOrEqual(TRANSCRIPT_TEXT_CAP + 1)
  })

  it('resolves empty on missing databases and unknown sessions', async () => {
    expect(await listOpencodeSessions(join(tmpdir(), 'opencode-absent.db'), 10)).toEqual([])
    const path = await fixtureDb()
    expect(readOpencodeTurns(path, 'missing')).toBeNull()
    expect(readOpencodeTurns(join(tmpdir(), 'opencode-absent.db'), 's')).toBeNull()
    expect(readOpencodeTurns(path, '')).toBeNull()
  })

  it('probes presence without opening the message tables', async () => {
    const path = await fixtureDb()
    insertSession(path, { id: 'live' })
    expect(probeOpencodeSessionPresence(path, 'live')).toBe('present')
    expect(probeOpencodeSessionPresence(path, 'gone')).toBe('absent')
  })

  it('reports unknown for missing stores and blank ids', async () => {
    expect(probeOpencodeSessionPresence(join(tmpdir(), 'opencode-absent.db'), 's')).toBe('unknown')
    const path = await fixtureDb()
    expect(probeOpencodeSessionPresence(path, '')).toBe('unknown')
    expect(probeOpencodeSessionPresence(path, '   ')).toBe('unknown')
  })
})
