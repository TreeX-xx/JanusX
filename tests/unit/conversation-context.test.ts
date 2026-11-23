import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationAttachmentImporter, selectNativeConversationImages } from '../../src/main/lib/conversation-attachment'
import { conversationPrompt, boundedConversationPrompt, activeConversationReferences, referenceToken,
  CONVERSATION_ATTACHMENT_CHUNK_BYTES } from '../../src/shared/conversation-context'
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
  it('keeps large clipboard bytes intact and prevents a filename escaping its private directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janus-attachment-'))
    try {
      const importer = new ConversationAttachmentImporter(root)
      const bytes = new Uint8Array(CONVERSATION_ATTACHMENT_CHUNK_BYTES).fill(128)
      const size = bytes.byteLength * 11
      const id = await importer.dispatch(1, { type: 'begin', size, name: '../../image.png' }) as string
      await expect(importer.dispatch(2, { type: 'append', id, bytes })).rejects.toThrow('Unknown attachment')
      for (let index = 0; index < 11; index++) await importer.dispatch(1, { type: 'append', id, bytes })
      const file = await importer.dispatch(1, { type: 'finish', id })
      if (!file || typeof file === 'string') throw new Error('Missing imported reference')
      expect(relative(root, file.path).startsWith('..')).toBe(false)
      const saved = await readFile(file.path)
      expect(saved.byteLength).toBe(size)
      expect(saved.compare(Buffer.alloc(size, 128))).toBe(0)
      expect(file).toMatchObject({ kind: 'image', size })
      expect(conversationPrompt('Inspect', [file])).toContain(JSON.stringify(file.path))
      const incomplete = await importer.dispatch(1, { type: 'begin', name: 'incomplete', size: 123 }) as string
      await expect(importer.dispatch(1, { type: 'finish', id: incomplete })).rejects.toThrow('Incomplete attachment')
      await importer.releaseOwner(1)
      expect(await readdir(root)).toEqual([id])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('references an existing large file without copying it or attaching it as native image data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janus-attachment-path-'))
    try {
      const large = join(root, 'large.png'), small = join(root, 'small.png'), svg = join(root, 'drawing.svg')
      for (const path of [large, small, svg]) await writeFile(path, 'fixture')
      const size = 200 * 1024 * 1024
      await truncate(large, size)
      const importer = new ConversationAttachmentImporter(join(root, 'imports'))
      await expect(importer.dispatch(1, { type: 'path', path: large })).resolves.toMatchObject({ path: large, size, kind: 'image' })
      await expect(importer.dispatch(1, { type: 'path', path: svg })).resolves.toMatchObject({ path: svg, kind: 'image' })
      expect(await selectNativeConversationImages([large, svg, small, small])).toEqual([small])
      expect(await readdir(root)).toEqual(['drawing.svg', 'large.png', 'small.png'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps inline file paths when quotes exceed the transport budget', () => {
    const first = { id: 'one', path: '/workspace/design.svg', name: 'design.svg', kind: 'image' as const, inline: true, quote: 'x'.repeat(40000) }
    const second = { id: 'two', path: '/workspace/app.ts', name: 'app.ts', kind: 'file' as const, inline: true }
    expect(boundedConversationPrompt(`Compare ${referenceToken(first)} with ${referenceToken(second)} next.`, [second, first]))
      .toBe('Compare image: "/workspace/design.svg" with file: "/workspace/app.ts" next.')
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
