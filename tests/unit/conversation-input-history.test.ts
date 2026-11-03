import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNativeInputHistory } from '../../src/main/terminal/input-history'
import { InputHistoryCursor, inputHistoryScope, mergeInputHistory, rememberConversationInput, useConversationInputHistory } from '../../src/renderer/src/stores/conversation-input-history'

const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function historyFile(text: string) {
  const path = await mkdtemp(join(tmpdir(), 'janus-input-history-')); directories.push(path)
  await writeFile(join(path, 'history.jsonl'), text)
  return path
}

describe('native input history', () => {
  it('reads Claude project inputs and skips damaged and foreign records', async () => {
    const directory = await historyFile([
      JSON.stringify({ display: '[Pasted text #1 +2 lines]', pastedContents: { 1: { type: 'text', content: 'first\nsecond' } }, timestamp: 10, project: 'C:\\project' }),
      '{broken', JSON.stringify({ display: 'foreign', timestamp: 20, project: 'C:/other' }),
      JSON.stringify({ display: 'latest', timestamp: 30, project: 'C:/project' }),
      JSON.stringify({ display: '[Pasted text #1 +2 lines]', pastedContents: { 1: { type: 'text', content: 'x'.repeat(32001) } }, timestamp: 40, project: 'C:/project' }),
      '{partial',
    ].join('\n'))
    expect(await readNativeInputHistory('claude', 'C:/project', { CLAUDE_CONFIG_DIR: directory })).toEqual([{ text: 'first\nsecond', time: 10 }, { text: 'latest', time: 30 }])
  })
  it('reads bounded Codex history with seconds converted to milliseconds', async () => {
    const directory = await historyFile('x'.repeat(1024 * 1024 + 10) + '\n' + Array.from({ length: 250 }, (_, i) => JSON.stringify({ text: `prompt ${i}`, ts: i, session_id: 'old-session' })).join('\n'))
    const rows = await readNativeInputHistory('codex', '/project', { CODEX_HOME: directory })
    expect(rows).toHaveLength(200)
    expect(rows.at(-1)).toEqual({ text: 'prompt 249', time: 249000 })
    expect(await readNativeInputHistory('claude', '/project', { CLAUDE_CONFIG_DIR: join(directory, 'missing') })).toEqual([])
    expect(await readNativeInputHistory('shell', '/project')).toEqual([])
  })
})

describe('conversation history', () => {
  it('isolates scopes and keeps only bounded original input', () => {
    const scope = inputHistoryScope('remote-a', '/project', 'claude')
    const other = inputHistoryScope('remote-b', '/project', 'claude')
    useConversationInputHistory.setState({ entries: {} })
    for (let i = 0; i < 210; i++) rememberConversationInput(scope, `text ${i}`)
    rememberConversationInput(scope, 'text 209')
    rememberConversationInput(other, 'other host')
    expect(useConversationInputHistory.getState().entries[scope]).toHaveLength(200)
    expect(useConversationInputHistory.getState().entries[scope][0].text).toBe('text 10')
    expect(useConversationInputHistory.getState().entries[other][0].text).toBe('other host')
    expect(mergeInputHistory([{ text: 'same', time: 20 }], [{ text: 'old', time: 1 }, { text: 'same', time: 10 }])).toEqual(['old', 'same'])
  })
  it('restores draft, respects multiline caret/selection and freezes history during browsing', () => {
    const cursor = new InputHistoryCursor()
    expect(cursor.move('ArrowUp', 'draft\nlast', 10, 10, ['old'])).toBeUndefined()
    expect(cursor.move('ArrowUp', 'draft', 0, 2, ['old'])).toBeUndefined()
    expect(cursor.move('ArrowUp', 'draft', 0, 0, ['old', 'new\nline'])).toBe('new\nline')
    expect(cursor.move('ArrowDown', 'new\nline', 0, 0, [])).toBeUndefined()
    expect(cursor.move('ArrowUp', 'new\nline', 0, 0, ['arrival'])).toBe('old')
    expect(cursor.move('ArrowDown', 'old', 3, 3, [])).toBe('new\nline')
    expect(cursor.move('ArrowDown', 'new\nline', 8, 8, [])).toBe('draft')
    expect(cursor.move('ArrowDown', 'draft', 5, 5, [])).toBeUndefined()
    expect(cursor.move('ArrowUp', 'draft', 0, 0, ['old'])).toBe('old')
    expect(cursor.move('ArrowDown', 'edited history', 14, 14, ['old'])).toBeUndefined()
  })
})
