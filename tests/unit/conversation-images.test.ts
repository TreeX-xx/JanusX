import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { storeConversationImage, IMAGE_MAX_BYTES } from '../../src/main/terminal/conversation-images'
import { conversationImageLinks, conversationImageText } from '../../src/shared/conversation-images'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { conversationOutputGroups } from '../../src/shared/conversation-output'
import { PNG_PIXEL } from '../helpers/image-fixture'
import { exportConversationImage } from '../../src/main/terminal/conversation-image-export'
import { ConversationSession, conversationState } from '../../src/main/terminal/conversation-session'

describe('conversation image artifacts', () => {
  it('exports only a registered ready image to the chosen destination and respects cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-image-export-'))
    try {
      const image = await storeConversationImage(join(root, 'cache'), { data: PNG_PIXEL })
      const state = conversationState('test', 'codex')
      state.items = [{ id: 'item', turnId: 'turn', type: 'imageGeneration', text: '', status: 'completed', images: [{ ...image, status: 'ready' }] }]
      const choose = vi.fn(async () => ({ canceled: false, filePath: join(root, 'saved.png') }))
      await expect(exportConversationImage(state, 'missing', image.id, choose)).rejects.toThrow(/available/)
      expect(choose).not.toHaveBeenCalled()
      expect(await exportConversationImage(state, 'item', image.id, async () => ({ canceled: true }))).toEqual({ canceled: true })
      expect(await readdir(root)).toEqual(['cache'])
      await exportConversationImage(state, 'item', image.id, choose)
      expect(choose).toHaveBeenCalledWith('png')
      expect((await readFile(join(root, 'saved.png'))).toString('base64')).toBe(PNG_PIXEL)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('copies file and inline images into the same immutable artifact, with no bytes in the reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-images-'))
    try {
      const file = join(root, 'source.png'), store = join(root, 'images')
      await writeFile(file, Buffer.from(PNG_PIXEL, 'base64'))
      const first = await storeConversationImage(store, { path: file })
      const second = await storeConversationImage(store, { data: PNG_PIXEL })
      expect(first).toEqual(second)
      expect(await storeConversationImage(store, { path: pathToFileURL(file).href })).toEqual(first)
      await writeFile(file, 'replaced original')
      expect((await readFile(first.path)).toString('base64')).toBe(PNG_PIXEL)
      expect(await readdir(store)).toHaveLength(1)
      expect(JSON.stringify(first)).not.toContain(PNG_PIXEL)
      await expect(storeConversationImage(store, { path: file })).rejects.toThrow(/format/)
      await expect(storeConversationImage(store, { data: 'A'.repeat(IMAGE_MAX_BYTES * 2) })).rejects.toThrow(/oversized/)
      await expect(storeConversationImage(store, { path: 'https://example.com/image.png' })).rejects.toThrow(/local/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('does not guess paths or fetch remote images and preserves links in text', () => {
    const text = 'Saved /tmp/guess.png\n![Local](<images/a b.png>)\n![Remote](https://example.com/a.png)\n![Bad](javascript:x.png)'
    expect(conversationImageLinks(text)).toEqual(['images/a b.png'])
    expect(conversationImageText(text, ['images/a b.png'])).toContain('[Local](<images/a b.png>)')
    expect(conversationImageText(text, ['images/a b.png'])).toContain('![Remote]')
  })
  it('ignores fenced, indented, inline and escaped image examples without rewriting them', () => {
    const examples = [
      '```ts\nconst sample = "![Example](output.png)"\n```',
      '~~~md\n![Example](output.png)\n~~~',
      '    ![Example](output.png)',
      '`![Example](output.png)`',
      '\\![Example](output.png)',
    ].join('\n\n')
    const text = examples + '\n\n![Result](output.png)\n\n![Second](<images/a b.png>)'
    expect(conversationImageLinks(examples)).toEqual([])
    expect(conversationImageLinks(text)).toEqual(['output.png', 'images/a b.png'])
    expect(conversationImageText(text, ['output.png', 'images/a b.png'])).toBe(
      examples + '\n\n[Result](output.png)\n\n[Second](<images/a b.png>)')
  })
  it('keeps source-reading command output in the process group without discovering images', async () => {
    const state = conversationState('test', 'codex')
    const session = new ConversationSession(state, () => {})
    const fixture = await readFile(new URL('../helpers/hook-cli-fixture.ts', import.meta.url), 'utf8')
    state.items = [{ id: 'source', turnId: 'turn', type: 'commandExecution',
      text: 'Get-Content tests/helpers/hook-cli-fixture.ts\n' + fixture, status: 'completed' }]
    session.discoverImages('source')
    expect(state.items[0].images).toBeUndefined()
    expect(conversationOutputGroups(state.items, null)[0].process).toBe(true)
    expect(state.items[0].text).toContain("'![Fixture image](generated.png)'")
    session.stop()
  })
  it('projects Codex image generation, preserves failed status and does not publish raw bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-image-codex-'))
    const c = new CodexConversation('test', () => {}), wire = c as any
    wire.session.configureImages(root, root)
    try {
      wire.item({ id: 'img', type: 'imageGeneration', status: 'in_progress', result: '' }, 'turn', false)
      expect(c.state.items[0]).toMatchObject({ status: 'inProgress', images: undefined })
      wire.item({ id: 'img', type: 'imageGeneration', status: 'completed', result: PNG_PIXEL }, 'turn', true)
      await vi.waitFor(() => expect(c.state.items[0].images?.[0].status).toBe('ready'))
      wire.item({ id: 'img', type: 'imageGeneration', status: 'completed', result: PNG_PIXEL }, 'turn', true)
      expect(c.state.items).toHaveLength(1)
      expect(c.state.items[0].images?.[0].status).toBe('ready')
      wire.item({ id: 'failed', type: 'imageGeneration', status: 'failed', failure: { type: 'usageLimitExceeded' } }, 'turn', true)
      expect(c.state.items[1].status).toBe('failed')
      expect(c.state.items[1].images).toBeUndefined()
      wire.item({ id: 'file-only', type: 'imageGeneration', status: 'completed', fileId: 'not-resolved' }, 'turn', true)
      await vi.waitFor(() => expect(c.state.items[2].images?.[0].status).toBe('unavailable'))
      expect(JSON.stringify(c.snapshot())).not.toContain(PNG_PIXEL)
      expect(conversationOutputGroups([...c.state.items, { id: 'answer', turnId: 'turn', type: 'agentMessage', text: 'Done', status: 'completed' }], null)[0].process).toBe(false)
    } finally { await c.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  it.each(['claude', 'opencode'] as const)('%s converts only completed explicit local image results', async engine => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-image-tool-'))
    const c = engine === 'claude' ? new ClaudeConversation('test', () => {}) : new OpenCodeConversation('test', () => {})
    const wire = c as any
    wire.session.configureImages(join(root, 'images'), root)
    await writeFile(join(root, 'output.png'), Buffer.from(PNG_PIXEL, 'base64'))
    try {
      if (engine === 'claude') {
        wire.receive({ type: 'chunk', data: { turnId: 'turn', step: 1, chunk: { kind: 'text', text: '![Result](output.png)' } } })
        expect(c.state.items[0].images).toBeUndefined()
        wire.receive({ type: 'turn.complete', data: { turnId: 'turn' } })
      } else wire.receive({ type: 'item', item: { id: 'result', turnId: 'turn', type: 'agentMessage', text: '![Result](output.png)', status: 'completed' } })
      await vi.waitFor(() => expect(c.state.items[0].images?.[0].status).toBe('ready'))
      expect(c.state.items[0].images?.[0].source).toBe('output.png')
    } finally { await c.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})
