import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveConversationAttachment } from '../../src/main/lib/conversation-attachment'
import { conversationPrompt, activeConversationReferences, referenceToken, MAX_CONVERSATION_ATTACHMENT_BYTES } from '../../src/shared/conversation-context'
import { validateConversationDelivery, type ConversationSnapshot } from '../../src/shared/conversation-display'

describe('conversation context and delivery boundaries', () => {
  it('expands inline references in authored order and omits deleted attachments', () => {
    const first = { id: 'one', path: 'C:/one.png', name: 'one.png', kind: 'image' as const, inline: true }
    const second = { ...first, id: 'two', path: 'C:/two.png', name: 'two.png' }
    const removed = { ...first, id: 'gone', path: 'C:/gone.png' }
    const text = `Compare ${referenceToken(second)} against ${referenceToken(first)}. Explain ${referenceToken(second)}.`
    expect(conversationPrompt(text, [first, second, removed])).toBe('Compare image: "C:/two.png" against image: "C:/one.png". Explain image: "C:/two.png".')
    expect(activeConversationReferences(text, [first, second, removed])).toEqual([second, first])
    expect(conversationPrompt('', [first, second, removed])).toBe('')
  })
  it('keeps imported bytes intact and prevents a filename escaping its private directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janus-attachment-'))
    try {
      const bytes = new Uint8Array([0, 128, 255])
      const file = await saveConversationAttachment(root, '../../image.png', bytes)
      expect(relative(root, file.path).startsWith('..')).toBe(false)
      expect(new Uint8Array(await readFile(file.path))).toEqual(bytes)
      expect(file.kind).toBe('image')
      await expect(saveConversationAttachment(root, 'large', new Uint8Array(MAX_CONVERSATION_ATTACHMENT_BYTES + 1))).rejects.toThrow('10 MB')
      expect(conversationPrompt('Inspect', [file])).toContain(JSON.stringify(file.path))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('never converts an expired steer into a new turn, or a queued message into steering', () => {
    const snapshot = { engine: 'codex', turnId: 'active', capabilities: { liveInput: true, steer: true } } as ConversationSnapshot
    const command = { type: 'send' as const, text: 'message', commandId: 'id', controlEpoch: 1 }
    expect(() => validateConversationDelivery(snapshot, { ...command, delivery: 'queue' })).toThrow('new turn')
    expect(() => validateConversationDelivery(snapshot, { ...command, delivery: 'steer', expectedTurnId: 'old' })).toThrow('target turn')
    expect(() => validateConversationDelivery(snapshot, { ...command, delivery: 'steer', expectedTurnId: 'active' })).not.toThrow()
    expect(() => validateConversationDelivery({ ...snapshot, engine: 'claude', capabilities: { ...snapshot.capabilities, steer: false } }, { ...command, delivery: 'steer', expectedTurnId: 'active' })).toThrow()
  })
})
