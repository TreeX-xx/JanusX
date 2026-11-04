import { describe, expect, it } from 'vitest'
import { conversationFileChanges } from '../../src/shared/conversation-file-changes'
import type { ConversationItem } from '../../src/shared/conversation-display'

const edit = (overrides: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'edit', turnId: 'one', type: 'fileChange', status: 'completed', text: '',
  files: [{ path: 'a.ts', diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more' }], ...overrides,
})

describe('conversation file receipts', () => {
  it('deduplicates paths within a turn while preserving successive patches and turn boundaries', () => {
    const turns = conversationFileChanges([edit(), edit({ id: 'second' }), edit({ turnId: 'two' })])
    expect(turns.get('one')?.files).toHaveLength(1)
    expect(turns.get('one')?.files[0]).toMatchObject({ additions: 4, deletions: 2, countsKnown: true })
    expect(turns.get('one')?.files[0].patches).toHaveLength(2)
    expect(turns.get('two')?.files[0].additions).toBe(2)
  })
  it('excludes pending, rejected and failed edits, retaining completed work from an interrupted turn', () => {
    const turns = conversationFileChanges(['inProgress', 'failed', 'declined', 'completed'].map(status => edit({ status })))
    expect(turns.get('one')?.files[0].patches).toHaveLength(1)
    expect(conversationFileChanges([edit({ status: 'failed' })]).size).toBe(0)
    expect(conversationFileChanges([]).size).toBe(0)
  })
  it('does not claim exact counts for truncated, empty or provider-specific patch text', () => {
    expect(conversationFileChanges([edit({ truncated: true })]).get('one')).toMatchObject({ incomplete: true, files: [{ countsKnown: false }] })
    for (const diff of ['', '+hello', '- before\n+ after']) {
      expect(conversationFileChanges([edit({ files: [{ path: 'a.ts', diff }] })]).get('one')?.files[0].countsKnown).toBe(false)
    }
  })
})
